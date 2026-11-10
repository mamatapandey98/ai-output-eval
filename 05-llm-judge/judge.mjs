/**
 * LLM judge for summaries: one request per pipeline summary, comparing it with the ground-truth
 * summary (and optionally the source PDF). `judge.provider` picks Claude ("anthropic", the default)
 * or Gemini ("gemini", see gemini.mjs). Either way the response is constrained to
 * JUDGE_OUTPUT_SCHEMA by structured outputs.
 *
 * The shared part of a document's requests (system prompt, optional PDF, reference summary)
 * comes first, so the ten variants of one document reuse it from the prompt cache.
 */
import Anthropic from "@anthropic-ai/sdk";
import { summaryText } from "../03-running-pipelines/jobs.mjs";
import { buildGeminiRequest, callGemini, createGeminiClient } from "./gemini.mjs";
import {
  JUDGE_OUTPUT_SCHEMA,
  candidateBlock,
  judgeSystemPrompt,
  normalizeOverall,
  overallScore,
  referenceBlock,
  RUBRIC_VERSION,
  validateVerdict,
} from "./rubric.mjs";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const JUDGE_PROVIDERS = ["anthropic", "gemini"];

export function judgeProvider(judgeConfig) {
  const provider = judgeConfig.provider ?? "anthropic";
  if (!JUDGE_PROVIDERS.includes(provider))
    throw new Error(`judge.provider must be one of ${JUDGE_PROVIDERS.join(", ")} (got "${provider}")`);
  return provider;
}

export function createAnthropicClient() {
  // Credentials resolve from ANTHROPIC_API_KEY or an `ant auth login` profile.
  return new Anthropic({ maxRetries: 4 });
}

export function createJudgeClient(judgeConfig) {
  return judgeProvider(judgeConfig) === "gemini"
    ? createGeminiClient({ maxRetries: judgeConfig.maxRetries ?? 0, timeoutMs: judgeConfig.timeoutMs ?? 60_000 })
    : createAnthropicClient();
}

export function buildJudgeRequest({ reference, candidateText, pdfBase64, judgeConfig }) {
  const content = [];
  if (pdfBase64) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } });
  }
  content.push({ type: "text", text: referenceBlock(reference), cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: candidateBlock(candidateText) });

  const request = {
    model: judgeConfig.model,
    max_tokens: judgeConfig.maxTokens ?? 16000,
    system: judgeSystemPrompt({ includeSourcePdf: Boolean(pdfBase64) }),
    output_config: {
      effort: judgeConfig.effort,
      format: { type: "json_schema", schema: JUDGE_OUTPUT_SCHEMA },
    },
    messages: [{ role: "user", content }],
  };
  if (judgeConfig.useServerFallback) {
    request.betas = [FALLBACK_BETA];
    request.fallbacks = "default";
  }
  return request;
}

/**
 * Judge one completed summarization task. Throws only for API errors (after the SDK's retries),
 * so the caller can leave the score unwritten and retry it on the next pass.
 * @returns {Promise<object>} the record for scores/<doc>__<variant>__summarization.json.
 */
/** One Claude call → { servedModel, stopReason, blocked, truncated, text, usage }. */
async function callAnthropic(client, request, judgeConfig) {
  const api = judgeConfig.useServerFallback ? client.beta.messages : client.messages;
  const response = await api.create(request);
  return {
    servedModel: response.model,
    stopReason: response.stop_reason,
    blocked: response.stop_reason === "refusal" ? (response.stop_details?.category ?? "no category") : null,
    truncated: response.stop_reason === "max_tokens",
    text: response.content.find((b) => b.type === "text")?.text,
    usage: response.usage,
  };
}

export async function judgeSummary({ client, raw, reference, pdfBase64 = null, judgeConfig }) {
  const provider = judgeProvider(judgeConfig);
  const candidate = summaryText(raw.result);
  const input = { reference, candidateText: candidate.text, pdfBase64, judgeConfig };
  const reply =
    provider === "gemini"
      ? await callGemini(client, buildGeminiRequest(input), judgeConfig)
      : await callAnthropic(client, buildJudgeRequest(input), judgeConfig);

  const record = {
    job: "summarization",
    candidatePages: candidate.pages,
    candidateChars: candidate.chars,
    resultPages: candidate.pages,
    withSourcePdf: Boolean(pdfBase64),
    judgeProvider: provider,
    rubricVersion: RUBRIC_VERSION,
    requestedModel: judgeConfig.model,
    servedModel: reply.servedModel,
    thinkingLevel: provider === "gemini" ? (judgeConfig.thinkingLevel ?? "HIGH") : null,
    maxOutputTokens: provider === "gemini" ? null : (judgeConfig.maxTokens ?? 16000),
    stopReason: reply.stopReason,
    usage: reply.usage,
  };
  if (reply.blocked) return { ...record, status: "error", reason: `judge refused (${reply.blocked})` };
  if (reply.truncated) return { ...record, status: "error", reason: "judge output truncated at max_tokens" };
  const { text } = reply;
  try {
    const verdict = validateVerdict(JSON.parse(text));
    const overall = overallScore(verdict, judgeConfig.weights);
    return {
      ...record,
      status: "scored",
      scoreScale: "0-10",
      weights: judgeConfig.weights,
      verdict,
      criteriaScores: verdict,
      overall,
      overallOutOf10: overall,
      overallPercentage: Math.round(overall * 10 * 100) / 100,
      score: normalizeOverall(overall),
    };
  } catch (error) {
    return {
      ...record,
      status: "error",
      reason: `unusable judge output: ${error.message}`,
    };
  }
}
