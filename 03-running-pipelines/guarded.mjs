/**
 * Shared core of the guarded runners (bin/llmjudge-guarded.mjs, bin/llmjudge-vlm-30.mjs): one-shot
 * transport, watchdog, single-task lifecycle and output validation. Each bin owns only its plan.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_DIR } from "../shared/config.mjs";
import { DocWeaverApiError, DocWeaverClient } from "./docweaver/client.mjs";
import {
  createTask,
  uploadDocument,
  configureTask,
  executeTask,
  getTask,
  getResults,
  deleteTask,
} from "./docweaver/tasks.mjs";
import { classifiedLabels, compactKey, extractedValues, jsonSchemaFor, summaryText } from "./jobs.mjs";

export const PRIOR_SUCCESSES = [
  {
    runId: "20261102-102753",
    documentId: "invoice-5978221-sprout-invoice",
    variantId: "textract-sonnet-4-6",
    taskId: 109,
  },
  {
    runId: "20261102-103030",
    documentId: "invoice-5978221-sprout-invoice",
    variantId: "textract-sonnet-4-5",
    taskId: 110,
  },
  {
    runId: "20261102-103030",
    documentId: "invoice-5978221-sprout-invoice",
    variantId: "textract-haiku-4-5",
    taskId: 111,
  },
];
export const SLOW_LIMIT_MS = 60_000;
export const COOLDOWN_MS = 20_000;
export const POLL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
export const LOCK_PATH = path.join(PROJECT_DIR, "runs", ".guarded-run.lock");
const TERMINAL = new Set(["completed", "failed"]);
export function watchdogAction(status, elapsedMs) {
  if (status === "queued") return "stop_queued";
  if (status === "processing" && elapsedMs >= SLOW_LIMIT_MS) return "stop_slow";
  if (!status || !["processing", ...TERMINAL].includes(status)) return "stop_unknown";
  return TERMINAL.has(status) ? "terminal" : "continue";
}

export function pendingTasks(documents, variants, job = "summarization") {
  return documents
    .flatMap((document) => variants.map((variant) => ({ documentId: document.id, variantId: variant.id, job })))
    .filter(
      (task) =>
        job !== "summarization" ||
        !PRIOR_SUCCESSES.some((done) => done.documentId === task.documentId && done.variantId === task.variantId),
    );
}

export function validateClassificationResult(result, document, categories) {
  const prediction = classifiedLabels(result);
  const allowed = new Set(categories.map((category) => String(category.name).trim().toLocaleLowerCase()));
  const pageNumbers = prediction.pages.map((page) => Number(page.page)).sort((a, b) => a - b);
  const pagesValid =
    prediction.pages.length === document.pages &&
    pageNumbers.every((page, index) => Number.isInteger(page) && page === index + 1);
  const labelsValid =
    prediction.pages.length > 0 &&
    prediction.pages.every((page) => allowed.has(String(page.label).trim().toLocaleLowerCase())) &&
    allowed.has(
      String(prediction.label ?? "")
        .trim()
        .toLocaleLowerCase(),
    );
  return {
    valid: pagesValid && labelsValid,
    prediction,
    expectedPageCount: document.pages,
    observedPageCount: prediction.pages.length,
    labelsValid,
    pagesValid,
  };
}

export function validateExtractionResult(result, document) {
  const fields = document.extraction?.fields ?? [];
  if (!Array.isArray(result) || result.length === 0 || fields.length === 0) {
    return { valid: false, reason: "empty extraction payload or field schema", values: null };
  }
  if (result.some((page) => !page || typeof page !== "object" || Array.isArray(page))) {
    return { valid: false, reason: "malformed extraction page", values: null };
  }
  const pageNumbers = result.map((page) => Number(page.pg_no));
  if (
    pageNumbers.some((page) => !Number.isInteger(page) || page < 1 || page > document.pages) ||
    new Set(pageNumbers).size !== pageNumbers.length
  ) {
    return { valid: false, reason: "invalid or duplicate page numbers", values: null };
  }
  const requestedKeys = new Set(fields.map((field) => compactKey(field.name)));
  const hasRequestedField = result.some((page) =>
    Object.keys(page).some((key) => key !== "pg_no" && requestedKeys.has(compactKey(key))),
  );
  if (!hasRequestedField) return { valid: false, reason: "wrong job shape or no requested field keys", values: null };
  const values = extractedValues(result, fields);
  const fieldNames = fields.map((field) => field.name);
  const mappingValid =
    Object.keys(values).length === fieldNames.length &&
    fieldNames.every(
      (name) =>
        Object.hasOwn(values, name) &&
        values[name] &&
        Object.hasOwn(values[name], "value") &&
        Array.isArray(values[name].pages),
    );
  return {
    valid: mappingValid,
    reason: mappingValid ? null : "extracted field mapping did not match the requested schema",
    values,
  };
}

export async function runPending(items, executeOne, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const results = [];
  for (const [index, item] of items.entries()) {
    const result = await executeOne(item);
    results.push(result);
    if (result.stop) break;
    if (index < items.length - 1) await wait(COOLDOWN_MS);
  }
  return results;
}

export async function selfTest() {
  assert.equal(watchdogAction("queued", 0), "stop_queued");
  assert.equal(watchdogAction("processing", 45_000), "continue", "45 seconds remains allowed");
  assert.equal(watchdogAction("processing", SLOW_LIMIT_MS - 1), "continue");
  assert.equal(watchdogAction("processing", SLOW_LIMIT_MS), "stop_slow", "one minute halts");
  assert.equal(watchdogAction("completed", SLOW_LIMIT_MS), "terminal");
  assert.equal(watchdogAction(null, 0), "stop_unknown");
  const submitted = [];
  const waits = [];
  await runPending(
    [1, 2],
    async (item) => {
      submitted.push(item);
      return { stop: watchdogAction("queued", 0).startsWith("stop_") };
    },
    async (ms) => waits.push(ms),
  );
  assert.deepEqual(submitted, [1], "a queued result must prevent the next submission");
  assert.deepEqual(waits, [], "a stop result must not schedule a rest or another item");
  for (const failure of [
    () => new Response("rate limited", { status: 429 }),
    () => new Response("server error", { status: 500 }),
    () => {
      throw new Error("offline network failure");
    },
  ]) {
    let calls = 0;
    const client = clientWithOneShotTransport({ email: "offline", password: "offline" }, async () => {
      calls++;
      return failure();
    });
    client.csrfToken = "offline-token";
    await assert.rejects(client.post("https://offline.invalid/api/tasks/", { name: "test" }));
    assert.equal(calls, 1, "POST must not retry 429, 5xx or network failures");
  }
  const docs = [{ id: "invoice-5978221-sprout-invoice" }, ...Array.from({ length: 9 }, (_, i) => ({ id: `doc-${i}` }))];
  const variants = [
    "textract-sonnet-4-6",
    "textract-sonnet-4-5",
    "textract-haiku-4-5",
    "textract-qwen3-32b",
    "textract-llama4-maverick",
  ].map((id) => ({ id }));
  const summaryPlan = pendingTasks(docs, variants, "summarization");
  const classificationPlan = pendingTasks(docs, variants, "classification");
  const extractionPlan = pendingTasks(docs, variants, "extraction");
  assert.equal(summaryPlan.length, 47, "50 summary cells less 3 verified successful skips");
  assert.equal(summaryPlan.filter((t) => t.documentId === "invoice-5978221-sprout-invoice").length, 2);
  assert.equal(classificationPlan.length, 50, "classification plan has its own complete 50-cell scope");
  assert.equal(extractionPlan.length, 50, "extraction plan has its own complete 50-cell scope");
  assert.equal(classificationPlan.filter((t) => t.documentId === "invoice-5978221-sprout-invoice").length, 5);
  assert.equal(pendingTasks([{ id: "invoice-5978221-sprout-invoice" }], variants, "classification").length, 5);
  const categories = ["budget", "news article", "invoice", "letter", "email"].map((name) => ({ name }));
  assert.equal(
    validateClassificationResult(
      [
        { pg_no: 1, document_type: "invoice" },
        { pg_no: 2, document_type: "Invoice" },
      ],
      { pages: 2 },
      categories,
    ).valid,
    true,
  );
  assert.equal(validateClassificationResult([], { pages: 2 }, categories).valid, false);
  assert.equal(
    validateClassificationResult([{ pg_no: 1, document_type: "unknown" }], { pages: 1 }, categories).valid,
    false,
  );
  const extractionDocument = {
    pages: 2,
    extraction: { fields: [{ name: "First Name" }, { name: "Vendor / Seller Name" }] },
  };
  const extractionCheck = validateExtractionResult(
    [
      { pg_no: 1, first_name: null },
      { pg_no: 2, vendor__seller_name: "Sprout Social" },
    ],
    extractionDocument,
  );
  assert.equal(extractionCheck.valid, true, "null and absent requested fields are allowed");
  assert.equal(extractionCheck.values["First Name"].value, null);
  assert.equal(extractionCheck.values["Vendor / Seller Name"].value, "Sprout Social");
  assert.equal(validateExtractionResult([], extractionDocument).valid, false, "empty payload is rejected");
  assert.equal(
    validateExtractionResult([{ pg_no: 1, document_type: "invoice" }], extractionDocument).valid,
    false,
    "wrong-job output is rejected",
  );
  console.log(
    "guarded runner offline checks passed (one-shot POST, stop/no-next, job-scoped plans, extraction/classification output validation)",
  );
}

export function assertNoOtherRunner() {
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (ps.status !== 0) throw new Error("cannot inspect process table; refusing live run");
  const conflicts = ps.stdout.split("\n").filter((line) => {
    const fields = line.trim().split(/\s+/);
    const pid = Number(fields[0]);
    if (!pid || pid === process.pid) return false;
    const executable = path.basename(fields[1] ?? "");
    const command = fields.slice(1).join(" ");
    if (executable === "node") return /llmjudge\.mjs\s+(run|all|screen)|llmjudge-guarded\.mjs\s+--live/.test(command);
    if (["npm", "yarn", "pnpm"].includes(executable)) return /run\s+(run|all|screen)(?:\s|$)/.test(command);
    return false;
  });
  if (conflicts.length) throw new Error("another run/all/screen process appears active; refusing live run");
}

export function clientWithOneShotTransport(credentials, fetchImpl = globalThis.fetch) {
  const fetchOnce = async (input, init = {}) => {
    try {
      return await fetchImpl(input, init);
    } catch {
      throw Object.assign(new Error("single-shot network request failed"), { code: "SINGLE_SHOT_FAILURE" });
    }
  };
  const client = new DocWeaverClient({ ...credentials, fetchImpl: fetchOnce, requestTimeoutMs: REQUEST_TIMEOUT_MS });
  // The standard client retries GET/DELETE failures and renews auth transparently. This runner
  // deliberately makes every request once and stops on any failure, including auth renewal.
  client.request = async function requestOnce(method, url, { json, query } = {}) {
    if (!this.csrfToken) await this.login();
    const target = new URL(url);
    for (const [key, value] of Object.entries(query ?? {})) target.searchParams.set(key, String(value));
    const headers = { Cookie: this.cookieHeader() };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const response = await this.fetch(target, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.storeCookies(response);
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 500) };
      }
    }
    if (!response.ok) throw new DocWeaverApiError(method, target.href, response.status, body);
    return body;
  };
  return client;
}

export function validatePriorSuccesses(config, variants, documents) {
  for (const item of PRIOR_SUCCESSES) {
    // Look in the working runs/ folder first, then in the committed evidence (07-results/runs).
    const runDir =
      [config.runsDir, config.evidenceDir]
        .filter(Boolean)
        .map((dir) => path.join(dir, item.runId))
        .find((dir) => fs.existsSync(path.join(dir, "manifest.json"))) ?? path.join(config.runsDir, item.runId);
    const manifestPath = path.join(runDir, "manifest.json");
    const rawPath = path.join(runDir, "raw", `${item.documentId}__${item.variantId}__summarization.json`);
    if (!fs.existsSync(manifestPath) || !fs.existsSync(rawPath))
      throw new Error(`prior success artifact missing for ${item.variantId}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    const doc = manifest.documents.find((d) => d.id === item.documentId);
    const variant = manifest.variants.find((v) => v.id === item.variantId);
    const currentDoc = documents.find((d) => d.id === item.documentId);
    if (
      !doc ||
      doc.file !== currentDoc.file ||
      doc.bytes !== currentDoc.bytes ||
      !variant ||
      raw.taskId !== item.taskId ||
      raw.outcome !== "completed" ||
      raw.status !== "completed" ||
      raw.deleted !== true ||
      !raw.result ||
      !summaryText(raw.result).text
    ) {
      throw new Error(`prior task ${item.taskId} is not a verified successful artifact`);
    }
    const expectedVariant = variants.find((v) => v.id === item.variantId);
    if (JSON.stringify(variant) !== JSON.stringify(expectedVariant))
      throw new Error(`prior task ${item.taskId} variant fingerprint changed`);
  }
  if (!documents.some((d) => d.id === "invoice-5978221-sprout-invoice"))
    throw new Error("prior success document is absent from the configured root corpus");
}

function stopReason(status, elapsed) {
  const action = watchdogAction(status, elapsed);
  if (action === "stop_queued") return "queued status observed; immediate stop requested";
  if (action === "stop_slow") return `processing exceeded ${SLOW_LIMIT_MS} ms (${elapsed} ms)`;
  if (action === "stop_unknown") return `unknown remote status: ${String(status)}`;
  return null;
}

async function attemptStop(client, taskId) {
  try {
    await deleteTask(client, taskId);
    return { deleted: true, message: "DELETE accepted" };
  } catch (error) {
    return { deleted: false, message: error.message };
  }
}

export async function runOne({ client, store, config, loaded, document, variant, pipelineId, item }) {
  const job = item.job;
  const rel = store.rawFile(document.id, variant.id, job);
  const startedAt = new Date().toISOString();
  const startedMs = Date.parse(startedAt);
  const raw = {
    documentId: document.id,
    variantId: variant.id,
    job,
    taskId: null,
    status: null,
    outcome: "submission_uncertain",
    startedAt,
    submissionUncertain: true,
  };
  let deletionAttempted = false;
  store.write(rel, raw);
  try {
    const task = await createTask(
      client,
      `test-${document.id.match(/(?:^|-)(\d{3,})(?:-|$)/)?.[1] ?? document.id.slice(0, 24)}`,
    );
    if (task?.id === null || task?.id === undefined)
      throw new Error("task create response omitted an id; submission state is uncertain");
    raw.taskId = task.id;
    raw.outcome = "in_progress";
    raw.submissionUncertain = false;
    raw.createdAt = new Date().toISOString();
    store.write(rel, raw);
    const filePath = path.join(config.dataDir, document.file);
    const uploadFetch = async (input, init = {}) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    await uploadDocument(
      client,
      task.id,
      { fileName: path.basename(filePath), bytes: fs.readFileSync(filePath) },
      { fetchImpl: uploadFetch },
    );
    const elapsedAfterUpload = Date.now() - startedMs;
    if (elapsedAfterUpload >= SLOW_LIMIT_MS)
      throw Object.assign(new Error(`setup exceeded watchdog threshold (${elapsedAfterUpload} ms)`), {
        safetyStop: true,
      });
    await configureTask(client, task.id, {
      taskType: job,
      pipelineId,
      jsonSchema: jsonSchemaFor(job, document, loaded.groundTruth),
      additionalInstruction: config.task.additionalInstruction,
      enableContext: config.task.enableContext,
    });
    const elapsedBeforeExecute = Date.now() - startedMs;
    if (elapsedBeforeExecute >= SLOW_LIMIT_MS)
      throw Object.assign(new Error(`setup exceeded watchdog threshold (${elapsedBeforeExecute} ms)`), {
        safetyStop: true,
      });
    raw.status = "ready";
    raw.configuredAt = new Date().toISOString();
    store.write(rel, raw);
    await executeTask(client, task.id);
    raw.executedAt = new Date().toISOString();
    raw.outcome = "processing";
    store.write(rel, raw);
    for (;;) {
      let statusTask;
      try {
        statusTask = await getTask(client, task.id);
      } catch (error) {
        raw.outcome = "safety_stopped";
        raw.error = `status request failed: ${error.message}`;
        raw.stop = await attemptStop(client, task.id);
        raw.stoppedAt = new Date().toISOString();
        store.write(rel, raw);
        return { stop: true, raw };
      }
      raw.status = statusTask.status ?? null;
      raw.lastPolledAt = new Date().toISOString();
      const elapsed = Date.now() - startedMs;
      const reason = stopReason(raw.status, elapsed);
      if (reason) {
        raw.outcome = "safety_stopped";
        raw.stopReason = reason;
        raw.elapsedAtStopMs = elapsed;
        deletionAttempted = true;
        raw.stop = await attemptStop(client, task.id);
        raw.stoppedAt = new Date().toISOString();
        store.write(rel, raw);
        return { stop: true, raw };
      }
      if (TERMINAL.has(raw.status)) {
        raw.finishedAt = new Date().toISOString();
        raw.failedRemarks = statusTask.failed_remarks ?? null;
        raw.outcome = raw.status;
        if (raw.status === "completed") {
          try {
            raw.result = (await getResults(client, task.id)).result ?? null;
          } catch (error) {
            raw.outcome = "failed";
            raw.error = `results request failed: ${error.message}`;
          }
        }
        if (raw.status === "completed" && raw.outcome === "completed") {
          if (job === "summarization") {
            raw.summary = raw.result ? summaryText(raw.result).text : null;
            raw.outputValid = Boolean(raw.summary?.trim());
            if (!raw.outputValid) {
              raw.outcome = "failed";
              raw.error = "summary output was empty";
            }
          } else if (job === "classification") {
            const validation = validateClassificationResult(
              raw.result,
              document,
              loaded.groundTruth.classificationCategories,
            );
            raw.classification = validation.prediction;
            raw.classificationValidation = {
              valid: validation.valid,
              expectedPageCount: validation.expectedPageCount,
              observedPageCount: validation.observedPageCount,
              pagesValid: validation.pagesValid,
              labelsValid: validation.labelsValid,
            };
            raw.outputValid = validation.valid;
            if (!validation.valid) {
              raw.outcome = "failed";
              raw.error = `classification output failed page/label validation (${validation.observedPageCount}/${validation.expectedPageCount} pages)`;
            }
          } else {
            const validation = validateExtractionResult(raw.result, document);
            raw.extraction = validation.values;
            raw.extractionValidation = {
              valid: validation.valid,
              requestedFields: document.extraction.fields.map((field) => field.name),
              reason: validation.reason,
            };
            raw.outputValid = validation.valid;
            if (!validation.valid) {
              raw.outcome = "failed";
              raw.error = `extraction output failed format validation (${validation.reason})`;
            }
          }
        }
        raw.processingMs = Date.parse(raw.finishedAt) - Date.parse(raw.executedAt);
        raw.totalMs = Date.parse(raw.finishedAt) - startedMs;
        deletionAttempted = true;
        try {
          await deleteTask(client, task.id);
          raw.deleted = true;
        } catch (error) {
          raw.deleted = false;
          raw.cleanupError = error.message;
        }
        store.write(rel, raw);
        return {
          stop: raw.outcome !== "completed" || !raw.outputValid || raw.totalMs >= SLOW_LIMIT_MS,
          raw,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch (error) {
    raw.outcome = error.safetyStop ? "safety_stopped" : "failed";
    raw.error = error.message;
    raw.stoppedAt = new Date().toISOString();
    if (raw.taskId !== null && !deletionAttempted) {
      raw.stop = await attemptStop(client, raw.taskId);
    }
    store.write(rel, raw);
    return { stop: true, raw };
  }
}
