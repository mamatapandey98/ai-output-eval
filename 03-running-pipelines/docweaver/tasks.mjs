/**
 * Drive one DocWeaver task through the same calls the create wizard makes
 * (bundle-verified 2026-10-29):
 *   POST /tasks/ → POST /tasks/{id}/presigned-url → PUT <presigned url> → POST /tasks/{id}/document-confirm
 *   → PUT /tasks/{id}/configuration → POST /tasks/{id}/execute → poll GET /tasks/{id} → GET /tasks/{id}/results
 */
import path from "node:path";
import { DOCWEAVER_API_ORIGIN, TASKS_API, TASK_STATUS, endpointFor } from "./contract.mjs";
import { DocWeaverApiError } from "./client.mjs";

const TERMINAL = new Set([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED]);
const UPLOAD_TIMEOUT_MS = 300_000;

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function contentTypeFor(filePath) {
  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!type) throw new Error(`Unsupported upload type: ${filePath}`);
  return type;
}

/** The app accepts a relative presigned URL and prefixes the API origin onto it. */
export function absoluteUploadUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${DOCWEAVER_API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function createTask(client, name) {
  const body = await client.post(endpointFor(TASKS_API.CREATE), { name });
  return body.data;
}

/**
 * @param {{ fileName: string, bytes: Uint8Array }} file
 */
export async function uploadDocument(client, taskId, { fileName, bytes }, { fetchImpl = globalThis.fetch } = {}) {
  const contentType = contentTypeFor(fileName);
  const presigned = await client.post(endpointFor(TASKS_API.PRESIGNED_URL, taskId), {
    filename: fileName,
    file_metadata: { file_size: bytes.byteLength, content_type: contentType },
  });
  const { url, file_key: fileKey } = presigned.data;
  const target = absoluteUploadUrl(url);
  // A URL on the API origin goes through the session (app's gt.put); S3 takes a bare PUT.
  const headers = { "Content-Type": contentType };
  if (target.startsWith(DOCWEAVER_API_ORIGIN)) {
    headers.Cookie = client.cookieHeader();
    if (client.csrfToken) headers["X-CSRF-Token"] = client.csrfToken;
  }
  const put = await fetchImpl(target, {
    method: "PUT",
    headers,
    body: bytes,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!put.ok) throw new Error(`Upload PUT failed: HTTP ${put.status} ${await put.text()}`.slice(0, 500));
  await client.post(endpointFor(TASKS_API.DOCUMENT_CONFIRM, taskId), {
    file_key: fileKey,
  });
  return fileKey;
}

export async function configureTask(
  client,
  taskId,
  { taskType, pipelineId, additionalInstruction = "", enableContext = false, jsonSchema = [] },
) {
  const body = await client.put(endpointFor(TASKS_API.CONFIGURATION, taskId), {
    additional_instruction: additionalInstruction,
    task_type: taskType,
    json_schema: jsonSchema,
    enable_context: enableContext,
    pipeline_id: pipelineId,
  });
  return body.data;
}

export async function executeTask(client, taskId) {
  const body = await client.post(endpointFor(TASKS_API.EXECUTE, taskId));
  return body.data;
}

export async function getTask(client, taskId) {
  return (await client.get(endpointFor(TASKS_API.DETAIL, taskId))).data;
}

export async function getResults(client, taskId) {
  return (await client.get(endpointFor(TASKS_API.RESULTS, taskId))).data;
}

export async function deleteTask(client, taskId) {
  await client.delete(endpointFor(TASKS_API.DELETE, taskId));
}

/**
 * Poll until the task reaches completed or failed. A poll that fails on the network or with a 5xx
 * is skipped, so a short outage does not abandon a task that is still running; a 4xx is thrown.
 * @returns {Promise<object>} the final task detail.
 */
export async function waitForTerminal(client, taskId, { pollMs, timeoutMs, sleep = defaultSleep, now = Date.now }) {
  const deadline = now() + timeoutMs;
  let lastStatus = null;
  for (;;) {
    let lastError = null;
    try {
      const task = await getTask(client, taskId);
      if (TERMINAL.has(task.status)) return task;
      lastStatus = task.status;
    } catch (error) {
      if (error instanceof DocWeaverApiError && error.status < 500) throw error;
      lastError = error;
    }
    if (now() >= deadline) {
      const error = new Error(
        `Task ${taskId} still "${lastStatus}" after ${timeoutMs} ms${lastError ? ` (last poll: ${lastError.message})` : ""}`,
      );
      error.code = "TIMEOUT";
      error.lastStatus = lastStatus;
      throw error;
    }
    await sleep(pollMs);
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one document through one pipeline end to end.
 *
 * Never throws for a task-level failure: the outcome (completed, failed, timeout, error) is
 * returned so the matrix keeps going and the report can count failures per variant.
 */
export async function runTask(client, spec, options) {
  const { name, fileName, bytes, pipelineId, taskType, jsonSchema, additionalInstruction, enableContext } = spec;
  const { pollMs, timeoutMs, deleteAfter, sleep, now = Date.now } = options;
  const outcome = {
    taskId: null,
    outcome: "error",
    status: null,
    timings: {},
    result: null,
    failedRemarks: null,
    error: null,
  };
  const mark = (key) => (outcome.timings[key] = new Date(now()).toISOString());
  try {
    mark("startedAt");
    const task = await createTask(client, name);
    outcome.taskId = task.id;
    await uploadDocument(client, task.id, { fileName, bytes }, options);
    mark("uploadedAt");
    await configureTask(client, task.id, {
      taskType,
      pipelineId,
      jsonSchema,
      additionalInstruction,
      enableContext,
    });
    await executeTask(client, task.id);
    mark("executedAt");
    const final = await waitForTerminal(client, task.id, {
      pollMs,
      timeoutMs,
      sleep,
      now,
    });
    mark("finishedAt");
    outcome.status = final.status;
    outcome.failedRemarks = final.failed_remarks ?? null;
    if (final.status === TASK_STATUS.COMPLETED) {
      outcome.result = (await getResults(client, task.id)).result ?? null;
      outcome.outcome = "completed";
    } else {
      outcome.outcome = "failed";
    }
  } catch (error) {
    outcome.outcome = error.code === "TIMEOUT" ? "timeout" : "error";
    outcome.status = error.lastStatus ?? outcome.status;
    outcome.error = error.message;
  }
  const { executedAt, finishedAt } = outcome.timings;
  outcome.processingMs = executedAt && finishedAt ? Date.parse(finishedAt) - Date.parse(executedAt) : null;
  if (deleteAfter && outcome.taskId !== null) {
    try {
      await deleteTask(client, outcome.taskId);
      outcome.deleted = true;
    } catch (error) {
      outcome.deleted = false;
      outcome.cleanupError = error.message;
    }
  }
  return outcome;
}
