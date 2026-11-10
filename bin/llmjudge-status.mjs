#!/usr/bin/env node
/** Read-only local status for a guarded run. It never contacts or signals DocWeaver. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { loadConfig } from "../shared/config.mjs";

const { values } = parseArgs({
  options: {
    "run-id": { type: "string" },
    watch: { type: "boolean", default: false },
    interval: { type: "string", default: "3" },
    config: { type: "string" },
  },
  strict: true,
});

const config = loadConfig(values.config);
const SUCCESS = new Set(["completed"]);
const FAILED = new Set(["failed"]);
const ACTIVE = new Set(["processing", "in_progress", "submission_uncertain"]);

function latestGuardedRun() {
  if (!fs.existsSync(config.runsDir)) throw new Error("runs directory not found");
  const ids = fs.readdirSync(config.runsDir).sort().reverse();
  for (const id of ids) {
    const file = path.join(config.runsDir, id, "manifest.json");
    if (!fs.existsSync(file)) continue;
    try {
      const mode = JSON.parse(fs.readFileSync(file, "utf8")).mode;
      if (
        mode === "guarded-summary-only" ||
        mode === "guarded-summarization" ||
        mode === "guarded-classification" ||
        mode === "guarded-extraction"
      )
        return id;
    } catch {
      // Ignore a manifest that is in the middle of an atomic replacement.
    }
  }
  throw new Error("no guarded run found; pass --run-id");
}

function runnerState() {
  const lockPath = path.join(config.runsDir, ".guarded-run.lock");
  let lock = null;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    if (fs.existsSync(lockPath)) return "lock present; PID state unknown";
  }
  const ps = spawnSync("ps", ["-axo", "pid=,etime=,command="], { encoding: "utf8" });
  if (ps.status !== 0) return lock ? `lock PID ${lock.pid}; process table unavailable` : "process state unavailable";
  const lines = ps.stdout.split("\n").filter(Boolean);
  if (lock) {
    const line = lines.find((entry) => Number(entry.trim().split(/\s+/, 1)[0]) === Number(lock.pid));
    return line
      ? `running (PID ${lock.pid}, ${line.trim().split(/\s+/)[1]} elapsed)`
      : `lock PID ${lock.pid} not visible; runner may have ended`;
  }
  const process = lines.find((line) => /node\s+.*llmjudge-guarded\.mjs\s+--live/.test(line));
  return process
    ? `running (PID ${process.trim().split(/\s+/, 1)[0]}; lock absent)`
    : "not running (no active lock/process found)";
}

function readRaw(storeDir, documentId, variantId, job) {
  const file = path.join(storeDir, "raw", `${documentId}__${variantId}__${job}.json`);
  if (!fs.existsSync(file))
    return fs.existsSync(`${file}.tmp`) ? { state: "unknown", file, reason: "atomic write in progress" } : null;
  try {
    return { ...JSON.parse(fs.readFileSync(file, "utf8")), file };
  } catch {
    return { state: "unknown", file, reason: "raw file is temporarily unreadable" };
  }
}

function timestamp(item) {
  return Date.parse(item?.finishedAt ?? item?.stoppedAt ?? item?.lastPolledAt ?? item?.startedAt ?? "") || 0;
}

function summarize(runId) {
  const storeDir = path.join(config.runsDir, runId);
  const manifestPath = path.join(storeDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const job = manifest.settings?.jobs?.[0] ?? manifest.taskPlan?.[0]?.job ?? "summarization";
  if (
    !new Set(["guarded-summary-only", "guarded-summarization", "guarded-classification", "guarded-extraction"]).has(
      manifest.mode,
    )
  )
    throw new Error(`${runId} is not a guarded run`);

  const skipped = manifest.successfulTasksSkipped ?? [];
  const items = manifest.taskPlan ?? [];
  const all = [];
  for (const item of skipped) {
    const raw = readRaw(path.join(config.runsDir, item.runId), item.documentId, item.variantId, job);
    all.push({ item, raw, skipped: true });
  }
  for (const item of items) {
    const raw = readRaw(storeDir, item.documentId, item.variantId, item.job);
    all.push({ item, raw, skipped: false });
  }

  const counts = { completed: 0, failed: 0, halted: 0, active: 0, pending: 0, unknown: 0 };
  const visible = [];
  for (const row of all) {
    const raw = row.raw;
    if (!raw) {
      counts.pending++;
      continue;
    }
    const outcome = raw.outcome ?? "unknown";
    if (
      SUCCESS.has(outcome) &&
      raw.status === "completed" &&
      raw.result &&
      (job === "summarization" || raw.outputValid)
    )
      counts.completed++;
    else if (FAILED.has(outcome) || raw.status === "failed" || outcome === "completed") counts.failed++;
    else if (outcome === "safety_stopped" || outcome === "timeout") {
      counts.halted++;
      visible.push({ ...row, raw });
    } else if (ACTIVE.has(outcome)) {
      counts.active++;
      visible.push({ ...row, raw });
    } else if (raw.state === "unknown" || outcome === "unknown") {
      counts.unknown++;
      visible.push({ ...row, raw });
    } else counts.pending++;
  }

  const total = all.length;
  const remaining = counts.active + counts.pending + counts.unknown;
  const docs = manifest.documents ?? [];
  const variants = manifest.variants ?? [];
  const completedCells = new Set();
  for (const row of all) {
    if (
      row.raw?.outcome === "completed" &&
      row.raw?.status === "completed" &&
      row.raw?.result &&
      (job === "summarization" || row.raw.outputValid)
    ) {
      completedCells.add(`${row.item.documentId}|${row.item.variantId}`);
    }
  }
  const fullyCompleteDocs = docs.filter((doc) =>
    variants.every((variant) => completedCells.has(`${doc.id}|${variant.id}`)),
  ).length;
  const current = visible.find(({ raw }) => ACTIVE.has(raw.outcome));
  const mostRecent = all.filter((row) => row.raw).sort((a, b) => timestamp(b.raw) - timestamp(a.raw))[0];
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const currentVariant = current && variantById.get(current.item.variantId);
  const runner = runnerState();
  const betweenTasks = !current && runner.startsWith("running") && counts.pending > 0;
  const now = new Date().toISOString();

  console.log(`Run ${runId} · ${job} · ${now}`);
  console.log(`Runner: ${runner}${betweenTasks ? " · between tasks/cooldown" : ""}`);
  const eventsPath = path.join(storeDir, "events.log");
  if (fs.existsSync(eventsPath)) console.log(`Progress log: ${eventsPath}`);
  console.log(
    `Tasks: ${counts.completed} completed, ${counts.failed} failed, ${counts.halted} halted, ${remaining} remaining of ${total}`,
  );
  console.log(`Documents: ${fullyCompleteDocs}/${docs.length} fully complete · ${variants.length} variants each`);
  if (current) {
    const state =
      current.raw.outcome === "processing"
        ? `processing (last persisted status: ${current.raw.status ?? "unknown"})`
        : (current.raw.status ?? current.raw.outcome);
    console.log(
      `Current task: #${current.raw.taskId ?? "unknown"} · ${current.item.documentId} · ${current.item.variantId}${currentVariant?.llm_model ? ` (${currentVariant.llm_model})` : ""} · ${state}`,
    );
  } else if (betweenTasks) console.log("Current task: none persisted; runner is between tasks or resting");
  else console.log("Current task: none");
  if (mostRecent) {
    const when =
      mostRecent.raw.finishedAt ??
      mostRecent.raw.stoppedAt ??
      mostRecent.raw.lastPolledAt ??
      mostRecent.raw.startedAt ??
      "time unavailable";
    const recentVariant = variantById.get(mostRecent.item.variantId);
    console.log(
      `Most recent: #${mostRecent.raw.taskId ?? "unknown"} · ${mostRecent.item.variantId}${recentVariant?.llm_model ? ` (${recentVariant.llm_model})` : ""} × ${mostRecent.item.documentId} · ${mostRecent.raw.outcome ?? mostRecent.raw.state} · ${when}`,
    );
    if (mostRecent.raw.stopReason || mostRecent.raw.error)
      console.log(`Reason: ${mostRecent.raw.stopReason ?? mostRecent.raw.error}`);
  }
  return { runId, counts, total, remaining, runner };
}

function main() {
  const runId = values["run-id"] ?? latestGuardedRun();
  const intervalSeconds = Number(values.interval);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 2 || intervalSeconds > 10)
    throw new Error("--interval must be between 2 and 10 seconds");
  if (!values.watch) return summarize(runId);
  const refresh = () => {
    console.log("\n---");
    summarize(runId);
  };
  refresh();
  const timer = setInterval(refresh, intervalSeconds * 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("Status watcher stopped; guarded runner was not signaled.");
    process.exit(0);
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
