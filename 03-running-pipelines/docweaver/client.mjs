/**
 * Minimal DocWeaver API session, the same shape the web app uses (bundle-verified 2026-10-29):
 *   - POST /auth/login sets an HttpOnly access_token cookie and returns { data: { csrf_token } }.
 *   - Mutating requests carry X-CSRF-Token.
 *   - An expired token (401/403 with ERR_TOKEN_* or ERR_CSRF_TOKEN_INVALID) is renewed with
 *     POST /auth/refresh; if that fails the client logs in again once.
 *   - 429 and failures to connect at all (DNS, refused, unreachable) are retried for every method.
 *     5xx and other network errors are retried only for GET and DELETE, since a POST or PUT that
 *     reached the server may already have taken effect.
 *   - Every call is aborted after requestTimeoutMs, so a connection that died while the machine
 *     slept fails instead of hanging the run.
 */
import { AUTH_REFRESH_ENDPOINT, LOGIN_API } from "./contract.mjs";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENT = new Set(["GET", "DELETE"]);
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
// Errors raised before the request reached the server.
const NOT_SENT = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function wasNotSent(error) {
  return NOT_SENT.has(error?.cause?.code ?? error?.code);
}
const RENEWABLE_ERRORS = new Set([
  "ERR_INVALID_TOKEN",
  "ERR_TOKEN_EXPIRED",
  "ERR_TOKEN_NOT_FOUND",
  "ERR_CSRF_TOKEN_INVALID",
]);

export class DocWeaverApiError extends Error {
  constructor(method, url, status, body) {
    const detail = body?.message || body?.error_code || JSON.stringify(body)?.slice(0, 300);
    super(`${method} ${url} → HTTP ${status}: ${detail}`);
    this.status = status;
    this.body = body;
  }
}

export class DocWeaverClient {
  /**
   * @param {{ email: string, password: string, fetchImpl?: typeof fetch,
   *           sleep?: (ms: number) => Promise<void>, requestTimeoutMs?: number }} options
   */
  constructor({
    email,
    password,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = 60_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    if (!email || !password) throw new Error("DocWeaverClient: email and password are required");
    this.email = email;
    this.password = password;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.requestTimeoutMs = requestTimeoutMs;
    this.cookies = new Map();
    this.csrfToken = null;
  }

  storeCookies(response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const line of setCookies) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async login() {
    const response = await this.fetch(LOGIN_API.AUTH.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const body = await readBody(response);
    if (!response.ok) throw new DocWeaverApiError("POST", LOGIN_API.AUTH.endpoint, response.status, body);
    this.storeCookies(response);
    this.csrfToken = body?.data?.csrf_token ?? null;
    return body?.data;
  }

  async refresh() {
    const response = await this.fetch(AUTH_REFRESH_ENDPOINT, {
      method: "POST",
      headers: {
        Cookie: this.cookieHeader(),
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!response.ok) return false;
    this.storeCookies(response);
    const body = await readBody(response);
    if (body?.data?.csrf_token) this.csrfToken = body.data.csrf_token;
    return true;
  }

  /**
   * @param {string} method
   * @param {string} url - absolute endpoint from contract.mjs.
   * @param {{ json?: unknown, query?: Record<string, string|number> }} [options]
   * @returns {Promise<any>} the parsed response body (the `{ data, ... }` envelope).
   */
  async request(method, url, { json, query } = {}) {
    if (!this.csrfToken) await this.login();
    const target = new URL(url);
    for (const [k, v] of Object.entries(query ?? {})) target.searchParams.set(k, String(v));

    let renewed = false;
    for (let retry = 0; ;) {
      const headers = { Cookie: this.cookieHeader() };
      if (json !== undefined) headers["Content-Type"] = "application/json";
      if (MUTATING.has(method) && this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;

      let response;
      try {
        response = await this.fetch(target, {
          method,
          headers,
          body: json === undefined ? undefined : JSON.stringify(json),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        if (!(IDEMPOTENT.has(method) || wasNotSent(error)) || retry >= RETRY_DELAYS_MS.length) throw error;
        await this.sleep(RETRY_DELAYS_MS[retry++]);
        continue;
      }
      this.storeCookies(response);
      const body = await readBody(response);
      if (response.ok) return body;

      const renewable = (response.status === 401 || response.status === 403) && RENEWABLE_ERRORS.has(body?.error_code);
      if (renewable && !renewed) {
        renewed = true;
        if (!(await this.refresh())) await this.login();
        continue;
      }
      const retryable = response.status === 429 || (response.status >= 500 && IDEMPOTENT.has(method));
      if (retryable && retry < RETRY_DELAYS_MS.length) {
        await this.sleep(RETRY_DELAYS_MS[retry++]);
        continue;
      }
      throw new DocWeaverApiError(method, target.href, response.status, body);
    }
  }

  get(url, options) {
    return this.request("GET", url, options);
  }
  post(url, json) {
    return this.request("POST", url, { json });
  }
  put(url, json) {
    return this.request("PUT", url, { json });
  }
  delete(url) {
    return this.request("DELETE", url);
  }
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}
