#!/usr/bin/env node
/**
 * llmjudge <command> [options]
 *
 *   preflight   validate config, variants, ground truth and the PDFs, offline
 *               (--live also checks the variants against GET /pipelines/configs, and the Gemini
 *               judge's key and model)
 *   pipelines   find or create one DocWeaver pipeline per variant
 *   run         start a new run (or resume --run-id) and execute every document × variant × job task
 *               (--dry-run prints the plan without contacting DocWeaver; a new run can be narrowed
 *               with --jobs extraction,classification, --documents <id>,<id> and --variants <id>,<id>)
 *   score       score the latest run (or --run-id) against ground truth
 *               (--rescore reloads the ground truth file and scores everything again)
 *   report      write report.json / report.md / report.html for the latest run (or --run-id/--run-ids)
 *   all         run → score → report
 *   screen      send PDFs that have no ground truth yet through a few pipelines (extraction only) to
 *               see which ones DocWeaver can process; writes screen.md / screen.json with draft values
 *               (--per-category <n>, --categories <list>, --variants <list>, --run-id to resume)
 *   cleanup     delete tasks a run or screen could not delete (still processing at the time)
 *
 * Options: --config <path>  --run-id <id>  --live  --dry-run  --rescore  --jobs <list>  --documents <list>
 *          --variants <list>  --per-category <n>  --categories <list>  --concurrency 1
 *          (DocWeaver task concurrency is fixed at one; higher values are rejected)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG, PROJECT_DIR, loadConfig, loadCredentials, loadVariants } from "../shared/config.mjs";
import { DocWeaverClient } from "../03-running-pipelines/docweaver/client.mjs";
import { ensureVariantPipelines, validateVariants } from "../03-running-pipelines/docweaver/pipelines.mjs";
import { deleteTask, getTask } from "../03-running-pipelines/docweaver/tasks.mjs";
import { loadDocuments, pdfPageCount } from "../02-document-screening/documents.mjs";
import { JOB_NAMES, loadGroundTruth } from "../01-ground-truth-annotation/ground-truth.mjs";
import { createJudgeClient, judgeProvider } from "../05-llm-judge/judge.mjs";
import { buildReport } from "../06-reporting/aggregate.mjs";
import { renderHtml, renderMarkdown } from "../06-reporting/render.mjs";
import { buildMatrix, runMatrix, taskName } from "../03-running-pipelines/runner.mjs";
import { renderScreenMarkdown, screenCandidates, screenSummary } from "../02-document-screening/screen.mjs";
import { pendingScores, scoreAll } from "../04-deterministic-scoring/score.mjs";
import { createLocalEmbedder, withCache } from "../04-deterministic-scoring/similarity/embedder.mjs";
import { RunStore, newRunId } from "../shared/store.mjs";

// Keys from .env at the project root (gitignored). Variables already set in the shell take precedence.
const ENV_FILE = path.join(PROJECT_DIR, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const log = (message) => console.log(`[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${message}`);

const USAGE =
  "usage: llmjudge <preflight|pipelines|run|score|report|all|screen|cleanup> [--config <path>] [--run-id <id>] [--run-ids <id,id,...>] [--live] [--dry-run] [--rescore] [--jobs <list>] [--documents <list>] [--variants <list>] [--per-category <n>] [--categories <list>] [--concurrency <n>]";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    "run-id": { type: "string" },
    "run-ids": { type: "string" },
    live: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    rescore: { type: "boolean", default: false },
    jobs: { type: "string" },
    documents: { type: "string" },
    variants: { type: "string" },
    "per-category": { type: "string" },
    categories: { type: "string" },
    concurrency: { type: "string" },
  },
});

let config;

function docWeaver() {
  return new DocWeaverClient(loadCredentials(config));
}

async function documentsOrThrow() {
  const loaded = await loadDocuments(config);
  if (loaded.problems.length)
    throw new Error(`ground truth documents are not usable:\n  ${loaded.problems.join("\n  ")}`);
  return loaded;
}

async function checkedVariants(client, variants) {
  const problems = await validateVariants(client, variants);
  if (problems.length) throw new Error(`variants not offered by DocWeaver:\n  ${problems.join("\n  ")}`);
}

function openStore() {
  const store = flags["run-id"] ? new RunStore(config.runsDir, flags["run-id"]) : RunStore.latest(config.runsDir);
  if (!store?.has("manifest.json")) {
    throw new Error(flags["run-id"] ? `run ${flags["run-id"]} has no manifest` : "no runs yet — start one with `run`");
  }
  return store;
}

const listFlag = (name) =>
  flags[name]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? null;

function selectVariants(variants, ids = listFlag("variants")) {
  const unknown = (ids ?? []).filter((id) => !variants.some((v) => v.id === id));
  if (unknown.length) throw new Error(`--variants: unknown variant id(s) ${unknown.join(", ")}`);
  return ids ? variants.filter((v) => ids.includes(v.id)) : variants;
}

/** Narrow a new run to --documents and --jobs; documents left with no job are dropped. */
function selectForRun(documents) {
  const ids = listFlag("documents");
  const jobs = listFlag("jobs");
  const unknownIds = (ids ?? []).filter((id) => !documents.some((d) => d.id === id));
  if (unknownIds.length) throw new Error(`--documents: unknown document id(s) ${unknownIds.join(", ")}`);
  const unknownJobs = (jobs ?? []).filter((job) => !JOB_NAMES.includes(job));
  if (unknownJobs.length) throw new Error(`--jobs: unknown job(s) ${unknownJobs.join(", ")}`);
  return documents
    .filter((d) => !ids || ids.includes(d.id))
    .map((d) => ({ ...d, jobs: jobs ? d.jobs.filter((job) => jobs.includes(job)) : d.jobs }))
    .filter((d) => d.jobs.length);
}

function composeSummaryScoreSources(sourceIds) {
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("--run-ids must not contain duplicates");
  const sources = sourceIds.map((id) => new RunStore(config.runsDir, id));
  for (const source of sources)
    if (!source.has("manifest.json")) throw new Error(`run ${source.runId} has no manifest`);
  const manifests = sources.map((source) => source.read("manifest.json"));
  for (const manifest of manifests) {
    if (manifest.documents.some((document) => document.jobs.some((job) => job !== "summarization")))
      throw new Error("multi-run score source may contain summarization jobs only");
  }
  const variantMap = new Map();
  for (const manifest of manifests)
    for (const variant of manifest.variants) {
      const previous = variantMap.get(variant.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(variant))
        throw new Error(`source runs disagree on variant ${variant.id}`);
      variantMap.set(variant.id, variant);
    }
  const configuredVariants = loadVariants(config);
  const unknownVariants = [...variantMap.keys()].filter((id) => !configuredVariants.some((v) => v.id === id));
  if (unknownVariants.length) throw new Error(`source runs contain unknown variants: ${unknownVariants.join(", ")}`);
  const documents = new Map();
  for (const manifest of manifests)
    for (const document of manifest.documents) {
      const previous = documents.get(document.id);
      if (!previous) documents.set(document.id, { ...document, jobs: [...document.jobs] });
      else {
        const { jobs: _oldJobs, ...a } = previous;
        const { jobs: _newJobs, ...b } = document;
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`source runs disagree on document ${document.id}`);
        previous.jobs = [...new Set([...previous.jobs, ...document.jobs])];
      }
    }
  const manifest = {
    ...manifests[0],
    documents: [...documents.values()],
    variants: configuredVariants.filter((variant) => variantMap.has(variant.id)),
    sourceRuns: sourceIds,
  };
  const rawFile = (doc, variant, job) => sources[0].rawFile(doc, variant, job);
  const scoreFile = (doc, variant, job) => sources[0].scoreFile(doc, variant, job);
  const owner = (rel) => {
    const rawRel = rel.startsWith("scores/") ? rel.replace(/^scores\//, "raw/") : rel;
    return sources.find((source) => source.has(rel) || (rel.startsWith("scores/") && source.has(rawRel)));
  };
  const store = {
    runId: `summary-shards-${sourceIds.join("+")}`,
    rawFile,
    scoreFile,
    has: (rel) => Boolean(owner(rel)?.has(rel)),
    read: (rel) => {
      const source = owner(rel);
      if (!source?.has(rel)) throw new Error(`source artifact missing: ${rel}`);
      return source.read(rel);
    },
    write: (rel, value) => {
      const source = owner(rel);
      if (!source) throw new Error(`no source run owns score artifact: ${rel}`);
      return source.write(rel, value);
    },
  };
  return { store, manifest };
}

function jobCounts(documents) {
  return JOB_NAMES.map((job) => `${documents.filter((d) => d.jobs.includes(job)).length} ${job}`).join(", ");
}

const commands = {
  async preflight() {
    const variants = loadVariants(config);
    const { groundTruth, documents, problems } = await loadDocuments(config);
    const tasks = documents.reduce((n, d) => n + d.jobs.length, 0) * variants.length;
    log(
      `${documents.length} documents (${jobCounts(documents)}) × ${variants.length} variants = ${tasks} DocWeaver tasks`,
    );
    const categories = [...new Set(documents.map((d) => d.category))];
    log(
      `categories: ${categories.map((c) => `${c} (${documents.filter((d) => d.category === c).length})`).join(", ")}`,
    );
    if (documents.some((d) => d.jobs.includes("classification"))) {
      log(
        `classification labels: ${groundTruth.classificationCategories.map((c) => c.name).join(", ")}${groundTruth.categoriesDerived ? " (derived from the ground-truth labels — add classificationCategories with descriptions to control what DocWeaver is offered)" : ""}`,
      );
    }
    const provider = judgeProvider(config.judge);
    const judgeDetails = [
      provider === "anthropic" && `effort ${config.judge.effort}`,
      config.judge.includeSourcePdf && "with source PDF",
    ].filter(Boolean);
    log(
      `scoring: embeddings ${config.similarity.embeddingModel}; summary judge ${provider} ${config.judge.model}${judgeDetails.length ? ` (${judgeDetails.join(", ")})` : ""}`,
    );
    if (flags.live) {
      problems.push(...(await validateVariants(docWeaver(), variants)));
      if (provider === "gemini" && documents.some((d) => d.jobs.includes("summarization"))) {
        try {
          await createJudgeClient(config.judge).getModel(config.judge.model);
        } catch (error) {
          problems.push(`summary judge: ${error.message}`);
        }
      }
    }
    if (problems.length) {
      for (const p of problems) log(`PROBLEM ${p}`);
      process.exitCode = 1;
    } else log(`preflight ok${flags.live ? " (variants checked against live configs)" : " (offline)"}`);
  },

  async pipelines() {
    const client = docWeaver();
    const variants = loadVariants(config);
    await checkedVariants(client, variants);
    await ensureVariantPipelines(client, variants, { namePrefix: config.pipelineNamePrefix, log });
  },

  async run() {
    const store = new RunStore(config.runsDir, flags["run-id"] ?? newRunId());
    let manifest;
    if (store.has("manifest.json")) {
      if (flags.jobs || flags.documents || flags.variants)
        throw new Error("--jobs, --documents and --variants apply only to a new run");
      manifest = store.read("manifest.json");
      log(`resuming run ${store.runId}`);
    } else {
      if (flags["run-id"]) throw new Error(`run ${flags["run-id"]} has no manifest`);
      const loaded = flags.jobs ? await loadDocuments(config, undefined, listFlag("jobs")) : await documentsOrThrow();
      if (loaded.problems.length)
        throw new Error(`ground truth documents are not usable:\n  ${loaded.problems.join("\n  ")}`);
      const { groundTruth } = loaded;
      const documents = selectForRun(loaded.documents);
      if (!documents.length) throw new Error("--documents/--jobs leave nothing to run");
      manifest = {
        runId: store.runId,
        createdAt: new Date().toISOString(),
        settings: {
          jobs: JOB_NAMES.filter((job) => documents.some((d) => d.jobs.includes(job))),
          embeddingModel: config.similarity.embeddingModel,
          judgeProvider: judgeProvider(config.judge),
          judgeModel: config.judge.model,
          includeSourcePdf: config.judge.includeSourcePdf,
        },
        classificationCategories: groundTruth.classificationCategories,
        documents,
        variants: selectVariants(loadVariants(config)),
        pipelines: null,
      };
    }
    if (flags["dry-run"]) {
      const matrix = buildMatrix(manifest.documents, manifest.variants);
      log(
        `dry run: ${matrix.length} tasks (${manifest.documents.length} documents × ${manifest.variants.length} variants; ${jobCounts(manifest.documents)}), nothing sent`,
      );
      for (const { document, variant, job } of matrix)
        log(`  ${job.padEnd(14)} ${variant.id.padEnd(24)} ${document.id}`);
      return null;
    }
    const client = docWeaver();
    if (!manifest.pipelines) {
      await checkedVariants(client, manifest.variants);
      manifest.pipelines = await ensureVariantPipelines(client, manifest.variants, {
        namePrefix: config.pipelineNamePrefix,
        log,
      });
      store.write("manifest.json", manifest);
    }
    log(`run ${store.runId} → ${store.dir}`);
    await runMatrix({
      client,
      store,
      config,
      groundTruth: manifest,
      documents: manifest.documents,
      variants: manifest.variants,
      pipelines: manifest.pipelines,
      log,
    });
    return store;
  },

  async score(store = openStore()) {
    const sourceIds = listFlag("run-ids");
    if (sourceIds && (flags["run-id"] || flags.rescore))
      throw new Error("multi-run score uses --run-ids without --run-id or --rescore");
    const composed = sourceIds ? composeSummaryScoreSources(sourceIds) : null;
    const activeStore = composed?.store ?? store;
    const manifest = composed?.manifest ?? store.read("manifest.json");
    if (flags.rescore) {
      const { groundTruth, documents } = await documentsOrThrow();
      const before = new Set(manifest.documents.map((d) => d.id));
      const missing = documents.filter((d) => !before.has(d.id)).map((d) => d.id);
      if (missing.length) throw new Error(`--rescore cannot add documents to an existing run: ${missing.join(", ")}`);
      // Keep each document's run-time job list: only jobs that ran can be scored.
      manifest.documents = manifest.documents.map((old) => ({
        ...documents.find((d) => d.id === old.id),
        jobs: old.jobs,
      }));
      manifest.classificationCategories = groundTruth.classificationCategories;
      activeStore.write("manifest.json", manifest);
      fs.rmSync(activeStore.path("scores"), { recursive: true, force: true });
      log("ground truth reloaded; previous scores removed");
    }
    const concurrency = flags.concurrency === undefined ? (config.judge.concurrency ?? 1) : Number(flags.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50)
      throw new Error("score --concurrency must be an integer from 1 through 50");
    const pendingCount = pendingScores(activeStore, manifest.documents, manifest.variants).length;
    if (flags["dry-run"]) {
      log(
        `dry run: ${pendingCount} score request(s) pending across ${manifest.documents.length} documents and ${manifest.variants.length} variants; concurrency ${concurrency}`,
      );
      return activeStore;
    }
    if (sourceIds && pendingCount > 50)
      throw new Error(`multi-run summary scoring is limited to 50 pending cells (found ${pendingCount})`);
    log(`scoring run ${activeStore.runId} with judge concurrency ${concurrency}`);
    const { scored, failed } = await scoreAll({
      store: activeStore,
      config,
      documents: manifest.documents,
      variants: manifest.variants,
      concurrency,
      getEmbedder: () =>
        withCache(
          createLocalEmbedder({
            model: config.similarity.embeddingModel,
            cacheDir: path.join(config.cacheDir, "models"),
          }),
        ),
      getJudgeClient: () => createJudgeClient(config.judge),
      log,
    });
    const remaining = pendingScores(activeStore, manifest.documents, manifest.variants).length;
    log(`scored ${scored}, failed ${failed}, pending ${remaining}`);
    if (failed) process.exitCode = 1;
    return store;
  },

  async report(store = openStore()) {
    const sourceIds = listFlag("run-ids");
    let outputStore = store;
    const manifest = store.read("manifest.json");
    let reportManifest = manifest;
    let reportStore = store;
    if (sourceIds) {
      if (flags["run-id"]) throw new Error("use either --run-id or --run-ids, not both");
      const sources = sourceIds.map((id) => new RunStore(config.runsDir, id));
      for (const source of sources)
        if (!source.has("manifest.json")) throw new Error(`run ${source.runId} has no manifest`);
      const manifests = sources.map((source) => source.read("manifest.json"));
      const mergedVariants = new Map();
      for (const m of manifests)
        for (const variant of m.variants) {
          const prior = mergedVariants.get(variant.id);
          if (prior && JSON.stringify(prior) !== JSON.stringify(variant))
            throw new Error(`source runs disagree on variant ${variant.id}`);
          mergedVariants.set(variant.id, variant);
        }
      const configuredVariants = loadVariants(config);
      const unknownVariants = [...mergedVariants.keys()].filter((id) => !configuredVariants.some((v) => v.id === id));
      if (unknownVariants.length)
        throw new Error(`source runs contain variants not in current config: ${unknownVariants.join(", ")}`);
      const mergedVariantList = configuredVariants.filter((variant) => mergedVariants.has(variant.id));
      const docs = new Map();
      const truthKeyByJob = { extraction: "extraction", classification: "classification", summarization: "summary" };
      for (const m of manifests)
        for (const d of m.documents) {
          const prior = docs.get(d.id);
          if (prior) {
            const {
              jobs: _oldJobs,
              extraction: _oldExtraction,
              classification: _oldClassification,
              summary: _oldSummary,
              ...a
            } = prior;
            const {
              jobs: _newJobs,
              extraction: _newExtraction,
              classification: _newClassification,
              summary: _newSummary,
              ...b
            } = d;
            if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`source runs disagree on document ${d.id}`);
            for (const job of d.jobs) {
              const key = truthKeyByJob[job];
              if (!key) continue;
              if (prior.jobs.includes(job) && JSON.stringify(prior[key]) !== JSON.stringify(d[key]))
                throw new Error(`source runs disagree on ${job} ground truth for document ${d.id}`);
              prior[key] = d[key];
            }
            prior.jobs = [...new Set([...prior.jobs, ...d.jobs])];
          } else docs.set(d.id, { ...d, jobs: [...d.jobs] });
        }
      reportManifest = {
        ...manifests[0],
        documents: [...docs.values()],
        variants: mergedVariantList,
        sourceRuns: sourceIds,
      };
      const comparisonId = `comparison-${newRunId()}`;
      // Keep composed reports out of the top-level run namespace so `latest` never
      // mistakes a report-only directory for a resumable evaluation run.
      outputStore = new RunStore(path.join(config.runsDir, "_comparisons"), comparisonId);
      outputStore.write("manifest.json", reportManifest);
      reportStore = {
        runId: comparisonId,
        rawFile: (doc, variant, job) => sources[0].rawFile(doc, variant, job),
        scoreFile: (doc, variant, job) => sources[0].scoreFile(doc, variant, job),
        has: (rel) => sources.some((source) => source.has(rel)),
        read: (rel) => {
          const source = sources.find((candidate) => candidate.has(rel));
          if (!source) throw new Error(`source artifact missing: ${rel}`);
          return source.read(rel);
        },
      };
    }
    const report = buildReport({ store: reportStore, manifest: reportManifest, outlierSettings: config.outliers });
    outputStore.write("report.json", report);
    outputStore.write("report.md", renderMarkdown(report));
    const html = outputStore.write("report.html", renderHtml(report));
    const t = report.totals;
    log(
      `report: ${t.completed}/${t.expectedTasks} tasks completed, ${t.scored} scored, ${t.outliers} outliers (${t.highSeverityOutliers} high)`,
    );
    for (const v of report.leaderboard) {
      const jobs = report.jobs.map((job) => `${job.slice(0, 5)} ${v.jobs[job].effectiveScore ?? "–"}`).join("  ");
      log(`  #${v.rank ?? "–"} ${v.variantId.padEnd(24)} composite ${v.composite ?? "–"}  ${jobs}`);
    }
    log(`→ ${html}`);
  },

  async screen() {
    const store = new RunStore(config.screensDir, flags["run-id"] ?? newRunId());
    let manifest;
    if (store.has("manifest.json")) {
      if (flags["per-category"] || flags.categories || flags.variants)
        throw new Error("--per-category, --categories and --variants apply only to a new screen");
      manifest = store.read("manifest.json");
      log(`resuming screen ${store.runId}`);
    } else {
      if (flags["run-id"]) throw new Error(`screen ${flags["run-id"]} has no manifest`);
      const perCategory = Number(flags["per-category"] ?? config.screen.perCategory);
      if (!Number.isInteger(perCategory) || perCategory < 1)
        throw new Error("--per-category must be a positive integer");
      const { documents, skipped } = await screenCandidates(config, loadGroundTruth(config.groundTruthFile), {
        perCategory,
        categories: listFlag("categories"),
        countPages: pdfPageCount,
      });
      for (const reason of skipped) log(`skipped ${reason}`);
      if (!documents.length) throw new Error("no screening candidates");
      manifest = {
        kind: "screen",
        runId: store.runId,
        createdAt: new Date().toISOString(),
        documents,
        variants: selectVariants(loadVariants(config), listFlag("variants") ?? config.screen.variants),
        pipelines: null,
      };
    }
    if (flags["dry-run"]) {
      const matrix = buildMatrix(manifest.documents, manifest.variants);
      log(`dry run: ${matrix.length} screening tasks, nothing sent`);
      for (const d of manifest.documents) log(`  ${d.file} (${d.pages} pages)`);
      return;
    }
    const client = docWeaver();
    if (!manifest.pipelines) {
      await checkedVariants(client, manifest.variants);
      manifest.pipelines = await ensureVariantPipelines(client, manifest.variants, {
        namePrefix: config.pipelineNamePrefix,
        log,
      });
    }
    store.write("manifest.json", manifest);
    log(`screen ${store.runId} → ${store.dir}`);
    await runMatrix({
      client,
      store,
      config,
      groundTruth: { classificationCategories: [] },
      documents: manifest.documents,
      variants: manifest.variants,
      pipelines: manifest.pipelines,
      log,
    });
    const summary = screenSummary(store, manifest);
    store.write("screen.json", summary);
    const md = store.write("screen.md", renderScreenMarkdown(summary));
    const t = summary.totals;
    log(`screen: ${t.works} work, ${t.partlyWorks} partly work, ${t.fails} fail, ${t.pending} pending → ${md}`);
  },

  async cleanup() {
    const client = docWeaver();
    let deleted = 0;
    let waiting = 0;
    for (const dir of [config.runsDir, config.screensDir]) {
      if (!fs.existsSync(dir)) continue;
      for (const runId of fs.readdirSync(dir).sort()) {
        const store = new RunStore(dir, runId);
        if (!store.has("manifest.json") || !store.has("raw")) continue;
        for (const name of fs.readdirSync(store.path("raw"))) {
          const rel = `raw/${name}`;
          const raw = store.read(rel);
          if (raw.taskId === null || raw.taskId === undefined || raw.deleted !== false) continue;
          try {
            const task = await getTask(client, raw.taskId);
            if (
              task.name !== taskName(raw.documentId) &&
              !task.name?.startsWith(`${config.pipelineNamePrefix}-${runId}-`)
            ) {
              log(`task #${raw.taskId} is "${task.name}", not from ${runId}; left alone`);
              continue;
            }
            if (!["completed", "failed"].includes(task.status)) {
              waiting++;
              log(`task #${raw.taskId} (${runId}) is still ${task.status}; try again later`);
              continue;
            }
            await deleteTask(client, raw.taskId);
            store.write(rel, { ...raw, deleted: true, cleanupError: undefined });
            deleted++;
            log(`deleted task #${raw.taskId} (${runId}, ${task.status})`);
          } catch (error) {
            log(`task #${raw.taskId} (${runId}): ${error.message}`);
          }
        }
      }
    }
    log(`cleanup: ${deleted} deleted, ${waiting} still processing`);
  },

  async all() {
    const store = await commands.run();
    if (!store) return;
    await commands.score(store);
    await commands.report(store);
  },
};

/** On macOS, keep the machine from idle-sleeping while this process runs tasks. */
function stayAwake() {
  if (process.platform !== "darwin") return;
  try {
    spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {
    // caffeinate is optional; a run without it still works if the machine stays awake
  }
}

function acquireTaskLock() {
  const lockPath = path.resolve(path.dirname(config.runsDir), ".llmjudge-task.lock");
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `another run or screen may be active (lock: ${lockPath}); remove it only after confirming no llmjudge process is running`,
        { cause: error },
      );
    }
    throw error;
  }
  const owner = `${process.pid}:${Date.now()}`;
  fs.writeFileSync(fd, owner);
  fs.closeSync(fd);
  return () => {
    try {
      if (fs.readFileSync(lockPath, "utf8") === owner) fs.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
}

const command = positionals[0];
if (!commands[command]) {
  console.error(USAGE);
  process.exit(2);
}
try {
  config = loadConfig(flags.config ? path.resolve(flags.config) : DEFAULT_CONFIG);
  if (config.execution.restAfterTaskMs !== 20_000) {
    throw new Error("execution.restAfterTaskMs must be 20000; the required post-task rest is 20 seconds");
  }
  if (!Number.isInteger(config.judge.concurrency) || config.judge.concurrency < 1 || config.judge.concurrency > 50) {
    throw new Error("judge.concurrency must be an integer from 1 through 50");
  }
  if (flags.concurrency !== undefined && ["run", "all", "screen"].includes(command)) {
    const n = Number(flags.concurrency);
    if (n !== 1) throw new Error("--concurrency must be 1; DocWeaver tasks run one at a time");
  }
  const releaseTaskLock = ["run", "all", "screen"].includes(command) && !flags["dry-run"] ? acquireTaskLock() : null;
  if (releaseTaskLock) stayAwake();
  try {
    await commands[command]();
  } finally {
    releaseTaskLock?.();
  }
} catch (error) {
  console.error(`llmjudge ${command} failed: ${error.message}`);
  process.exitCode = 1;
}
