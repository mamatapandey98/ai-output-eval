#!/usr/bin/env node
/**
 * Pessimistic, resumable runner for the original 10-document × 5-Textract matrix.
 * Defaults to an offline plan. Live work requires --live; this command never scores or reports.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG, PROJECT_DIR, loadConfig, loadCredentials, loadVariants } from "../shared/config.mjs";
import { ensureVariantPipelines, validateVariants } from "../03-running-pipelines/docweaver/pipelines.mjs";
import { loadDocuments } from "../02-document-screening/documents.mjs";
import { RunStore, newRunId } from "../shared/store.mjs";
import {
  COOLDOWN_MS,
  LOCK_PATH,
  POLL_MS,
  PRIOR_SUCCESSES,
  SLOW_LIMIT_MS,
  assertNoOtherRunner,
  clientWithOneShotTransport,
  pendingTasks,
  runOne,
  runPending,
  selfTest,
  validatePriorSuccesses,
} from "../03-running-pipelines/guarded.mjs";

const ENV_FILE = path.join(PROJECT_DIR, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const { values: flags } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    "run-id": { type: "string" },
    "self-test": { type: "boolean", default: false },
    job: { type: "string", default: "summarization" },
    config: { type: "string", default: DEFAULT_CONFIG },
  },
  strict: true,
});

let eventLogPath = null;
const log = (s) => {
  const line = `[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${s}`;
  console.log(line);
  if (eventLogPath) fs.appendFileSync(eventLogPath, `${line}\n`);
};

async function readPlan(config, job) {
  if (!new Set(["summarization", "classification", "extraction"]).has(job))
    throw new Error("--job must be summarization, classification or extraction");
  const variantsAll = loadVariants(config);
  const variants = variantsAll.filter((v) => v.ocr_provider === "aws_textract");
  if (variants.length !== 5) throw new Error(`expected 5 Textract variants, found ${variants.length}`);
  const loaded = await loadDocuments(config, undefined, [job]);
  if (loaded.problems.length) throw new Error(`ground-truth input is invalid: ${loaded.problems.join("; ")}`);
  const documents = loaded.documents.filter((d) => d.jobs.includes(job));
  if (documents.length !== 10) throw new Error(`expected 10 ${job} documents, found ${documents.length}`);
  if (job === "summarization") validatePriorSuccesses(config, variants, documents);
  if (job === "classification" && loaded.groundTruth.classificationCategories.length !== 5)
    throw new Error(`expected 5 classification labels, found ${loaded.groundTruth.classificationCategories.length}`);
  if (job === "extraction" && documents.some((doc) => !doc.extraction?.fields?.length))
    throw new Error("every extraction document must have at least one requested field");
  const plan = pendingTasks(documents, variants, job);
  const expectedTasks = job === "summarization" ? 47 : 50;
  if (plan.length !== expectedTasks)
    throw new Error(`expected exactly ${expectedTasks} ${job} tasks, found ${plan.length}`);
  if (job !== "summarization" && documents.reduce((sum, doc) => sum + doc.pages, 0) !== 17)
    throw new Error(`${job} page plan changed; expected 17 pages`);
  return { loaded, documents, variants, plan, job };
}

function storeManifest(store, runId, loaded, documents, variants, plan, job) {
  store.write("manifest.json", {
    runId,
    createdAt: new Date().toISOString(),
    mode: `guarded-${job}`,
    safety: {
      slowLimitMs: SLOW_LIMIT_MS,
      pollMs: POLL_MS,
      cooldownMs: COOLDOWN_MS,
      retries: false,
    },
    settings: { jobs: [job] },
    classificationCategories: loaded.groundTruth.classificationCategories,
    documents,
    variants,
    taskPlan: plan,
    successfulTasksSkipped: job === "summarization" ? PRIOR_SUCCESSES : [],
    pipelines: null,
  });
}

async function main() {
  if (flags["self-test"]) return selfTest();
  const config = loadConfig(flags.config);
  const { loaded, documents, variants, plan, job } = await readPlan(config, flags.job);
  if (!flags.live) {
    console.log(
      job === "summarization"
        ? `offline plan only: ${plan.length} tasks (10 documents × 5 Textract variants − 3 verified completed summary cells)`
        : job === "classification"
          ? `offline plan only: ${plan.length} classification tasks (10 documents × 5 Textract variants; 17 page labels)`
          : `offline plan only: ${plan.length} extraction tasks (10 documents × 5 Textract variants; 17 source pages; configured field schemas)`,
    );
    for (const item of plan) console.log(`  ${item.job.padEnd(14)} ${item.variantId.padEnd(24)} ${item.documentId}`);
    console.log(
      `watchdog: stop on queued/unknown status; stop at ${SLOW_LIMIT_MS} ms or later; poll ${POLL_MS} ms; rest ${COOLDOWN_MS} ms`,
    );
    console.log("No remote calls made. Pass --live to execute.");
    return;
  }
  assertNoOtherRunner();
  fs.mkdirSync(config.runsDir, { recursive: true });
  const lock = fs.openSync(LOCK_PATH, "wx", 0o600);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const runId = flags["run-id"] ?? newRunId();
  const store = new RunStore(config.runsDir, runId);
  let manifest;
  try {
    if (store.has("manifest.json")) {
      manifest = store.read("manifest.json");
      if (manifest.mode !== `guarded-${job}` || JSON.stringify(manifest.taskPlan) !== JSON.stringify(plan))
        throw new Error(`resume manifest does not match the current ${job} plan`);
    } else {
      if (flags["run-id"]) throw new Error(`run ${runId} has no guarded manifest`);
      if (fs.existsSync(store.dir)) throw new Error(`run directory ${store.dir} already exists`);
      storeManifest(store, runId, loaded, documents, variants, plan, job);
      manifest = store.read("manifest.json");
    }
    eventLogPath = store.path("events.log");
    if (!fs.existsSync(eventLogPath)) fs.writeFileSync(eventLogPath, `guarded ${job} run ${runId}\n`);
    log(`run ${runId}; ${job}; ${plan.length} task cells`);
    const existing = new Map();
    for (const item of plan) {
      const doc = documents.find((d) => d.id === item.documentId);
      const variant = variants.find((v) => v.id === item.variantId);
      const rel = store.rawFile(doc.id, variant.id, item.job);
      if (!store.has(rel)) {
        existing.set(`${item.documentId}|${item.variantId}`, "pending");
        continue;
      }
      const raw = store.read(rel);
      if (raw.outcome === "completed" && raw.status === "completed" && raw.result)
        existing.set(`${item.documentId}|${item.variantId}`, "done");
      else throw new Error(`refusing to resubmit unresolved task artifact ${rel}`);
    }
    const client = clientWithOneShotTransport(loadCredentials(config));
    const variantProblems = await validateVariants(client, variants);
    if (variantProblems.length) throw new Error(`variants unavailable: ${variantProblems.join("; ")}`);
    const pipelines = await ensureVariantPipelines(client, variants, { namePrefix: config.pipelineNamePrefix, log });
    manifest.pipelines = pipelines;
    store.write("manifest.json", manifest);
    const pending = plan.filter((item) => existing.get(`${item.documentId}|${item.variantId}`) !== "done");
    await runPending(
      pending,
      async (item) => {
        const document = documents.find((d) => d.id === item.documentId);
        const variant = variants.find((v) => v.id === item.variantId);
        log(`starting ${item.variantId} × ${item.documentId}`);
        const result = await runOne({
          client,
          store,
          config,
          loaded,
          document,
          variant,
          pipelineId: pipelines[variant.id].id,
          item,
        });
        log(
          `task ${result.raw.taskId ?? "unknown"}: ${result.raw.outcome}/${result.raw.status ?? "unknown"}${result.raw.totalMs ? ` ${result.raw.totalMs}ms total` : ""}`,
        );
        if (result.stop) {
          log(
            `HALT: ${result.raw.stopReason ?? result.raw.error ?? "task did not complete successfully within watchdog limits"}`,
          );
          return result;
        }
        existing.set(`${item.documentId}|${item.variantId}`, "done");
        return result;
      },
      async (ms) => {
        log("post-completion cooldown: 20 seconds");
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
    );
  } finally {
    fs.closeSync(lock);
    fs.rmSync(LOCK_PATH, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
