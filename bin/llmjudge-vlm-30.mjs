#!/usr/bin/env node
/**
 * Pessimistic, resumable runner for one VLM pipeline and exactly 30 tasks.
 * Defaults to an offline plan. Live work requires --live; this command never scores or reports.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { PROJECT_DIR, loadConfig, loadCredentials, loadVariants } from "../shared/config.mjs";
import {
  configMismatches,
  ensureVariantPipelines,
  listAllPipelines,
  validateVariants,
} from "../03-running-pipelines/docweaver/pipelines.mjs";
import { loadDocuments } from "../02-document-screening/documents.mjs";
import { RunStore, newRunId } from "../shared/store.mjs";
import {
  COOLDOWN_MS,
  LOCK_PATH,
  POLL_MS,
  SLOW_LIMIT_MS,
  assertNoOtherRunner,
  clientWithOneShotTransport,
  pendingTasks,
  runOne,
  runPending,
  selfTest,
} from "../03-running-pipelines/guarded.mjs";

const ENV_FILE = path.join(PROJECT_DIR, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const { values: flags } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    "self-test": { type: "boolean", default: false },
    jobs: { type: "string", default: "summarization,classification,extraction" },
    config: { type: "string", default: path.join(PROJECT_DIR, "config/vlm-eval.config.json") },
  },
  strict: true,
});

let eventLogPath = null;
const log = (s) => {
  const line = `[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${s}`;
  console.log(line);
  if (eventLogPath) fs.appendFileSync(eventLogPath, `${line}\n`);
};

async function readPlan(config, jobs) {
  const jobOrder = ["summarization", "classification", "extraction"];
  if (JSON.stringify(jobs) !== JSON.stringify(jobOrder))
    throw new Error("--jobs must be summarization,classification,extraction in that order");
  const variantsAll = loadVariants(config);
  const variants = variantsAll;
  if (variants.length !== 1 || variants[0].id !== "vlm-sonnet-4-6" || variants[0].ocr_provider !== "vlm")
    throw new Error("expected the single vlm-sonnet-4-6 VLM variant");
  if (variants[0].llm_model !== "bedrock/us.anthropic.claude-sonnet-4-6" || !variants[0].vlm_model)
    throw new Error("VLM variant must preserve Sonnet 4.6 LLM and an explicit VLM model");
  const loaded = await loadDocuments(config, undefined, jobs);
  if (loaded.problems.length) throw new Error(`ground-truth input is invalid: ${loaded.problems.join("; ")}`);
  const documents = loaded.documents.filter((d) => d.jobs.length);
  for (const job of jobs) {
    const count = documents.filter((d) => d.jobs.includes(job)).length;
    if (count !== 10) throw new Error(`expected 10 ${job} documents, found ${count}`);
  }
  if (loaded.groundTruth.classificationCategories.length !== 5)
    throw new Error(`expected 5 classification labels, found ${loaded.groundTruth.classificationCategories.length}`);
  if (documents.some((doc) => !doc.extraction?.fields?.length))
    throw new Error("every extraction document must have at least one requested field");
  if (documents.reduce((sum, doc) => sum + doc.pages, 0) !== 17)
    throw new Error("page plan changed; expected 17 source pages");
  const plan = jobs.flatMap((job) =>
    pendingTasks(
      documents.filter((d) => d.jobs.includes(job)),
      variants,
      job,
    ),
  );
  if (plan.length !== 30 || jobs.some((job) => plan.filter((item) => item.job === job).length !== 10))
    throw new Error(`expected exactly 30 tasks (10 per job), found ${plan.length}`);
  return { loaded, documents, variants, plan, jobs };
}

function storeManifest(store, runId, loaded, documents, variants, plan, jobs) {
  store.write("manifest.json", {
    runId,
    createdAt: new Date().toISOString(),
    mode: "guarded-vlm-30",
    safety: {
      slowLimitMs: SLOW_LIMIT_MS,
      pollMs: POLL_MS,
      cooldownMs: COOLDOWN_MS,
      retries: false,
    },
    settings: { jobs },
    classificationCategories: loaded.groundTruth.classificationCategories,
    documents,
    variants,
    taskPlan: plan,
    successfulTasksSkipped: [],
    pipelines: null,
  });
}

async function main() {
  if (flags["self-test"]) return selfTest();
  const config = loadConfig(flags.config);
  const jobs = flags.jobs.split(",").map((job) => job.trim());
  const { loaded, documents, variants, plan } = await readPlan(config, jobs);
  if (!flags.live) {
    console.log(
      `offline plan only: ${plan.length} tasks on one VLM pipeline (10 summarization, 10 classification, 10 extraction)`,
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
  const runId = newRunId();
  const store = new RunStore(config.runsDir, runId);
  let manifest;
  try {
    if (fs.existsSync(store.dir)) throw new Error(`run directory ${store.dir} already exists`);
    storeManifest(store, runId, loaded, documents, variants, plan, jobs);
    manifest = store.read("manifest.json");
    eventLogPath = store.path("events.log");
    if (!fs.existsSync(eventLogPath)) fs.writeFileSync(eventLogPath, `guarded VLM 30-task run ${runId}\n`);
    log(`run ${runId}; one VLM pipeline; ${plan.length} task cells (10 per job)`);
    const existing = new Map();
    for (const item of plan) {
      const doc = documents.find((d) => d.id === item.documentId);
      const variant = variants.find((v) => v.id === item.variantId);
      const rel = store.rawFile(doc.id, variant.id, item.job);
      if (!store.has(rel)) {
        existing.set(`${item.documentId}|${item.variantId}|${item.job}`, "pending");
        continue;
      }
      const raw = store.read(rel);
      if (raw.outcome === "completed" && raw.status === "completed" && raw.result && raw.outputValid)
        existing.set(`${item.documentId}|${item.variantId}|${item.job}`, "done");
      else throw new Error(`refusing to resubmit unresolved task artifact ${rel}`);
    }
    const client = clientWithOneShotTransport(loadCredentials(config));
    const variantProblems = await validateVariants(client, variants);
    if (variantProblems.length) throw new Error(`variants unavailable: ${variantProblems.join("; ")}`);
    const pipelines = await ensureVariantPipelines(client, variants, { namePrefix: config.pipelineNamePrefix, log });
    if (Object.keys(pipelines).length !== 1 || pipelines["vlm-sonnet-4-6"]?.id == null)
      throw new Error("expected exactly one verified VLM pipeline");
    const verifiedPipeline = (await listAllPipelines(client)).find(
      (pipeline) => pipeline.id === pipelines["vlm-sonnet-4-6"].id,
    );
    const mismatches = verifiedPipeline
      ? configMismatches(verifiedPipeline, {
          ocr_provider: "vlm",
          parsing_method: "layout_conserved",
          llm_model: "bedrock/us.anthropic.claude-sonnet-4-6",
          vlm_model: "bedrock/qwen.qwen3-vl-235b-a22b",
        })
      : ["pipeline missing from live listing after ensure"];
    if (mismatches.length) throw new Error(`live VLM pipeline verification failed: ${mismatches.join("; ")}`);
    log(`verified VLM pipeline metadata: OCR=vlm, VLM=${variants[0].vlm_model}, LLM=${variants[0].llm_model}`);
    manifest.pipelines = pipelines;
    store.write("manifest.json", manifest);
    const pending = plan.filter((item) => existing.get(`${item.documentId}|${item.variantId}|${item.job}`) !== "done");
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
        existing.set(`${item.documentId}|${item.variantId}|${item.job}`, "done");
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
