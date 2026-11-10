#!/usr/bin/env node
/** Read-only status for the dedicated 30-task VLM run. */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_DIR, loadConfig } from "../shared/config.mjs";
import { RunStore } from "../shared/store.mjs";

const { values } = parseArgs({
  options: {
    "run-id": { type: "string" },
    config: { type: "string", default: path.join(PROJECT_DIR, "config/vlm-eval.config.json") },
    watch: { type: "boolean", default: false },
    interval: { type: "string", default: "5" },
  },
});
const config = loadConfig(values.config);
const candidateIds = fs.existsSync(config.runsDir)
  ? fs
      .readdirSync(config.runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
  : [];
const latest = candidateIds.find((candidate) => {
  const file = path.join(config.runsDir, candidate, "manifest.json");
  return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).mode === "guarded-vlm-30";
});
const runId = values["run-id"] ?? latest;
if (!runId) throw new Error("no run found");
const store = new RunStore(config.runsDir, runId);
const manifest = store.read("manifest.json");
if (manifest.mode !== "guarded-vlm-30") throw new Error(`${runId} is not the guarded 30-task VLM run`);
const interval = Number(values.interval);
if (!Number.isInteger(interval) || interval < 2 || interval > 30)
  throw new Error("--interval must be between 2 and 30 seconds");
function snapshot() {
  const summary = new Map();
  for (const job of manifest.settings.jobs)
    summary.set(job, { completed: 0, failed: 0, halted: 0, pending: 0, total: 0 });
  let current = null;
  for (const item of manifest.taskPlan) {
    const counts = summary.get(item.job);
    counts.total++;
    const file = store.rawFile(item.documentId, item.variantId, item.job);
    if (!store.has(file)) {
      counts.pending++;
      continue;
    }
    const raw = store.read(file);
    if (raw.outcome === "completed" && raw.status === "completed" && raw.outputValid) counts.completed++;
    else if (raw.outcome === "failed") counts.failed++;
    else if (raw.outcome === "safety_stopped") counts.halted++;
    else if (["processing", "in_progress"].includes(raw.outcome)) current = { item, raw };
    else counts.pending++;
  }
  console.log(`Run ${runId} · ${new Date().toISOString()}`);
  const lockPath = path.join(config.runsDir, ".guarded-run.lock");
  let pid = null;
  try {
    pid = JSON.parse(fs.readFileSync(lockPath, "utf8")).pid;
  } catch {
    /* no readable lock: runner not running */
  }
  console.log(`Runner: ${pid ? `running (PID ${pid})` : "not running"}`);
  console.log(`Progress log: ${store.path("events.log")}`);
  for (const [job, counts] of summary)
    console.log(
      `${job}: ${counts.completed} completed, ${counts.failed} failed, ${counts.halted} halted, ${counts.pending} pending of ${counts.total}`,
    );
  console.log(`Total: ${[...summary.values()].reduce((sum, c) => sum + c.completed, 0)} completed of 30`);
  if (current)
    console.log(
      `Current: task #${current.raw.taskId ?? "unknown"} · ${current.item.job} · ${current.item.documentId} · ${current.raw.status ?? current.raw.outcome}`,
    );
}
snapshot();
if (values.watch) {
  const timer = setInterval(() => {
    console.log("\n---");
    snapshot();
  }, interval * 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("Status watcher stopped; guarded runner was not signaled.");
    process.exit(0);
  });
}
