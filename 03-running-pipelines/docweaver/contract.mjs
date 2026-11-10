/**
 * DocWeaver API contract: the endpoints, task states and upload limits this project uses.
 *
 * Verified against the staging app bundle and live read-only calls (September 2026). Only the
 * entries the evaluation calls are kept. If the API moves, this is the one file to update.
 */

/** API origin. The API is served from its own subdomain, separate from the UI. Not a secret. */
export const DOCWEAVER_API_BASE = "https://api.staging.docweaver.lftechnology.com/api";

/** Origin the app prefixes onto a relative presigned upload URL (verified 2026-10-29). */
export const DOCWEAVER_API_ORIGIN = new URL(DOCWEAVER_API_BASE).origin;

export const AUTH_REFRESH_ENDPOINT = `${DOCWEAVER_API_BASE}/auth/refresh`;

/** POST /auth/login takes { email, password }; the session comes back as cookies + a CSRF token. */
export const LOGIN_API = Object.freeze({
  AUTH: Object.freeze({
    method: "POST",
    endpoint: `${DOCWEAVER_API_BASE}/auth/login`,
    alias: "authLogin",
    expectedStatus: 200,
  }),
});

export const PIPELINES_API = Object.freeze({
  LIST: Object.freeze({
    method: "GET",
    endpoint: `${DOCWEAVER_API_BASE}/pipelines/`,
    endpointPattern: `${DOCWEAVER_API_BASE}/pipelines/*`,
    alias: "pipelinesList",
    expectedStatus: 200,
  }),
  CREATE: Object.freeze({
    method: "POST",
    endpoint: `${DOCWEAVER_API_BASE}/pipelines/`,
    alias: "pipelinesCreate",
    expectedStatus: 200,
  }),
  /** The OCR providers, parsing methods and LLM models a pipeline can be built from. */
  CONFIGS: Object.freeze({
    method: "GET",
    endpoint: `${DOCWEAVER_API_BASE}/pipelines/configs`,
    alias: "pipelinesConfigs",
    expectedStatus: 200,
  }),
});

/** draft → doc_pending → doc_uploaded → ready → queued → processing → completed | failed */
export const TASK_STATUS = Object.freeze({
  DRAFT: "draft",
  DOCUMENT_PENDING: "doc_pending",
  DOCUMENT_UPLOADED: "doc_uploaded",
  READY: "ready",
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const TASK_UPLOAD_CONSTRAINTS = Object.freeze({
  ACCEPTED_EXTENSIONS: Object.freeze([".pdf", ".jpg", ".jpeg", ".png"]),
  MAX_FILE_SIZE_BYTES: 30 * 1024 * 1024,
  MAX_PDF_PAGES: 50,
});

/**
 * One task's lifecycle, in call order: CREATE → PRESIGNED_URL → (PUT upload) → DOCUMENT_CONFIRM
 * → CONFIGURATION → EXECUTE → poll DETAIL → RESULTS → DELETE.
 */
export const TASKS_API = Object.freeze({
  CREATE: Object.freeze({
    method: "POST",
    endpoint: `${DOCWEAVER_API_BASE}/tasks/`,
    alias: "tasksCreate",
    expectedStatus: 200,
  }),
  PRESIGNED_URL: Object.freeze({
    method: "POST",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*/presigned-url`,
    alias: "taskPresignedUrl",
    expectedStatus: 200,
  }),
  DOCUMENT_CONFIRM: Object.freeze({
    method: "POST",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*/document-confirm`,
    alias: "taskDocumentConfirm",
    expectedStatus: 200,
  }),
  CONFIGURATION: Object.freeze({
    method: "PUT",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*/configuration`,
    alias: "taskConfiguration",
    expectedStatus: 200,
  }),
  EXECUTE: Object.freeze({
    method: "POST",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*/execute`,
    alias: "taskExecute",
    expectedStatus: 200,
  }),
  DETAIL: Object.freeze({
    method: "GET",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*`,
    alias: "taskDetail",
    expectedStatus: 200,
  }),
  RESULTS: Object.freeze({
    method: "GET",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*/results`,
    alias: "taskResults",
    expectedStatus: 200,
  }),
  DELETE: Object.freeze({
    method: "DELETE",
    endpointPattern: `${DOCWEAVER_API_BASE}/tasks/*`,
    alias: "taskDelete",
    expectedStatus: 200,
  }),
});

/**
 * Fill the `*` in a config's endpointPattern with a resource id.
 *
 * @param {{ endpointPattern?: string, endpoint?: string }} entry - a *_API config entry.
 * @param {string|number} [id]
 * @returns {string}
 */
export function endpointFor(entry, id) {
  if (id !== undefined && entry.endpointPattern) {
    return entry.endpointPattern.replace("*", encodeURIComponent(String(id)));
  }
  if (entry.endpoint) return entry.endpoint;
  throw new Error(`endpointFor: ${entry.alias} needs an id`);
}
