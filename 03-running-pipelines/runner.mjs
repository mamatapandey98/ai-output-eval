/**
 * Execute the document × variant × job matrix against DocWeaver and store one raw file per task.
 */
import fs from "node:fs";
import path from "node:path";
import { runTask } from "./docweaver/tasks.mjs";
import { jsonSchemaFor } from "./jobs.mjs";

/** Every covered task, ordered by job so all summaries start before other jobs. */
export function buildMatrix(documents, variants) {
  const jobs = ["summarization", "extraction", "classification"];
  return jobs.flatMap((job) =>
    documents.flatMap((document) =>
      document.jobs.includes(job) ? variants.map((variant) => ({ document, variant, job })) : [],
    ),
  );
}

/**
 * `test-<DocumentCloud number>` (`invoice-5697493-re-…` → `test-5697493`), or the first 24 characters
 * of the document id when it has no number. `cleanup` recognises its tasks by this exact name.
 */
export function taskName(documentId) {
  return `test-${documentId.match(/(?:^|-)(\d{3,})(?:-|$)/)?.[1] ?? documentId.slice(0, 24)}`;
}

/**
 * @param {object} deps
 * @param {import("./docweaver/client.mjs").DocWeaverClient} deps.client
 * @param {import("../shared/store.mjs").RunStore} deps.store
 * @param {object} deps.config - loaded eval config.
 * @param {object} deps.groundTruth - normalised ground truth (for classification categories).
 * @param {Record<string, {id: number}>} deps.pipelines - variant id → pipeline.
 * @param {Function} [deps.runTaskImpl] - injectable for tests.
 * @returns {Promise<{ total: number, ran: number }>}
 */
export async function runMatrix({
  client,
  store,
  config,
  groundTruth,
  documents,
  variants,
  pipelines,
  log = () => {},
  runTaskImpl = runTask,
  taskOptions = {},
}) {
  const matrix = buildMatrix(documents, variants);
  const pending = matrix.filter(
    ({ document, variant, job }) => !store.has(store.rawFile(document.id, variant.id, job)),
  );
  const unresolved = matrix.find(({ document, variant, job }) => {
    const rel = store.rawFile(document.id, variant.id, job);
    if (!store.has(rel)) return false;
    const raw = store.read(rel);
    return (
      raw.submissionUncertain === true ||
      (raw.taskId !== null &&
        raw.taskId !== undefined &&
        raw.deleted !== true &&
        !["completed", "failed"].includes(raw.status))
    );
  });
  if (unresolved) {
    const { document, variant, job } = unresolved;
    const raw = store.read(store.rawFile(document.id, variant.id, job));
    const taskRef =
      raw.taskId === null || raw.taskId === undefined ? "submission with no task id" : `task #${raw.taskId}`;
    throw new Error(
      `cannot resume while ${taskRef} (${job} ${variant.id} × ${document.id}) may still be active; resolve or clean it up first`,
    );
  }
  log(`${matrix.length} tasks in matrix, ${matrix.length - pending.length} already done, ${pending.length} to run`);

  // One task owns the full remote lifecycle. Rest begins only after polling and deletion finish.
  const restMs = config.execution.restAfterTaskMs ?? 20_000;
  const sleep = taskOptions.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let done = 0;
  for (const [index, { document, variant, job }] of pending.entries()) {
    log(`start ${job.padEnd(14)} ${variant.id} × ${document.id}`);
    const filePath = path.join(config.dataDir, document.file);
    const outcome = await runTaskImpl(
      client,
      {
        name: taskName(document.id),
        fileName: path.basename(filePath),
        bytes: fs.readFileSync(filePath),
        pipelineId: pipelines[variant.id].id,
        taskType: job,
        jsonSchema: jsonSchemaFor(job, document, groundTruth),
        additionalInstruction: config.task.additionalInstruction,
        enableContext: config.task.enableContext,
      },
      {
        pollMs: config.execution.pollMs,
        timeoutMs: config.execution.timeoutMs,
        deleteAfter: config.execution.deleteTasksAfterRun,
        ...taskOptions,
      },
    );
    done++;
    if (outcome.outcome === "error" && outcome.taskId === null) {
      // A failed create response can be ambiguous: the server may have accepted the POST.
      store.write(store.rawFile(document.id, variant.id, job), {
        documentId: document.id,
        variantId: variant.id,
        job,
        pipelineId: pipelines[variant.id].id,
        ...outcome,
        submissionUncertain: true,
      });
      throw new Error(
        `stopping run after task submission failed without an id (${outcome.error}); verify remote task state before resuming`,
      );
    }
    store.write(store.rawFile(document.id, variant.id, job), {
      documentId: document.id,
      variantId: variant.id,
      job,
      pipelineId: pipelines[variant.id].id,
      ...outcome,
    });
    log(
      `[${done}/${pending.length}] ${job.padEnd(14)} ${variant.id} × ${document.id}: ${outcome.outcome}${outcome.error ? ` (${outcome.error})` : ""}`,
    );
    const remoteStateUnknown =
      outcome.taskId !== null &&
      outcome.taskId !== undefined &&
      !["completed", "failed"].includes(outcome.status) &&
      !["completed", "failed"].includes(outcome.outcome);
    if (remoteStateUnknown) {
      throw new Error(
        `stopping run after ${outcome.outcome} for task #${outcome.taskId}; its remote state may still be active. Resolve it with cleanup/status checks before resuming`,
      );
    }
    if (index < pending.length - 1) await (taskOptions.restSleep ?? sleep)(restMs);
  }
  return { total: matrix.length, ran: pending.length };
}
