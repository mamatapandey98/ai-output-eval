/**
 * Gemini judge transport: the generateContent REST endpoint, called with plain fetch.
 *
 * Request and response shapes: https://ai.google.dev/api/generate-content
 */
import { JUDGE_OUTPUT_SCHEMA, candidateBlock, judgeSystemPrompt, referenceBlock } from "./rubric.mjs";

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** The rubric schema without `additionalProperties`; validateVerdict still checks the result. */
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== "additionalProperties")
      .map(([key, value]) => [key, geminiSchema(value)]),
  );
}

/**
 * @param {object} [options]
 * @param {string} [options.apiKey] - defaults to GEMINI_API_KEY, then GOOGLE_API_KEY.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createGeminiClient({
  apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  fetchImpl = fetch,
  maxRetries = 4,
  timeoutMs = 60_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!apiKey) throw new Error("no Gemini API key: set GEMINI_API_KEY");

  async function call(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt >= maxRetries) throw new Error(`Gemini request failed: ${error.message}`, { cause: error });
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (response.ok) return response.json();
      const detail = await response.text();
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      let message = detail.slice(0, 500);
      try {
        message = JSON.parse(detail).error?.message ?? message;
      } catch {
        // not JSON; keep the raw text
      }
      throw new Error(`Gemini ${response.status}: ${message}`);
    }
  }

  return {
    provider: "gemini",
    generateContent: (model, body) =>
      call("POST", `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, body),
    getModel: (model) => call("GET", `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}`),
  };
}

export function buildGeminiRequest({ reference, candidateText, pdfBase64, judgeConfig }) {
  const parts = [];
  if (pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBase64 } });
  parts.push({ text: referenceBlock(reference) });
  parts.push({ text: candidateBlock(candidateText) });
  return {
    systemInstruction: { parts: [{ text: judgeSystemPrompt({ includeSourcePdf: Boolean(pdfBase64) }) }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: geminiSchema(JUDGE_OUTPUT_SCHEMA),
      thinkingConfig: { thinkingLevel: judgeConfig.thinkingLevel ?? "HIGH" },
    },
  };
}

/** One judge call → { servedModel, stopReason, blocked, truncated, text, usage }. */
export async function callGemini(client, request, judgeConfig) {
  const response = await client.generateContent(judgeConfig.model, request);
  const candidate = response.candidates?.[0];
  const stopReason = candidate?.finishReason ?? null;
  const meta = response.usageMetadata ?? {};
  const cached = meta.cachedContentTokenCount ?? 0;
  return {
    // Gemini may return a serving version; never label it with the configured alias.
    servedModel: response.modelVersion ?? response.model ?? null,
    stopReason,
    blocked: !candidate
      ? (response.promptFeedback?.blockReason ?? "no candidates")
      : stopReason && !["STOP", "MAX_TOKENS"].includes(stopReason)
        ? stopReason
        : null,
    truncated: stopReason === "MAX_TOKENS",
    text: (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join(""),
    usage: {
      input_tokens: (meta.promptTokenCount ?? 0) - cached,
      output_tokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  };
}
