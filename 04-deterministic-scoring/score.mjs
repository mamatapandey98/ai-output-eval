/**
 * Score every stored DocWeaver outcome that has no score yet:
 *   extraction, classification → embedding + word + character confidence (local, free)
 *   summarization              → LLM judge against the ground-truth summary
 *
 * Outcomes DocWeaver did not complete get a "skipped" score. Errors thrown while scoring (an API
 * outage, a model download failure) leave the score unwritten, so the next pass retries them.
 */
import fs from "node:fs";
import path from "node:path";
import { judgeSummary } from "../05-llm-judge/judge.mjs";
import { RUBRIC_VERSION } from "../05-llm-judge/rubric.mjs";
import { mapPool } from "../shared/pool.mjs";
import { EXTRACTION_SCORING_VERSION, scoreClassification, scoreExtraction } from "./similarity-jobs.mjs";

const SIMILARITY_SCORERS = { extraction: scoreExtraction, classification: scoreClassification };

export function pendingScores(store, documents, variants) {
  const pending = [];
  for (const document of documents) {
    for (const variant of variants) {
      for (const job of document.jobs) {
        const rawRel = store.rawFile(document.id, variant.id, job);
        const scoreRel = store.scoreFile(document.id, variant.id, job);
        if (!store.has(rawRel)) continue;
        const hasScore = store.has(scoreRel);
        const savedScore = hasScore ? store.read(scoreRel) : null;
        // A summary is judged again when the rubric changed or the last attempt errored. A
        // "skipped" record (DocWeaver did not complete the task) has nothing to judge.
        const staleSummary =
          hasScore &&
          job === "summarization" &&
          savedScore.status !== "skipped" &&
          (savedScore.rubricVersion !== RUBRIC_VERSION || savedScore.status !== "scored");
        const staleExtraction =
          hasScore && job === "extraction" && savedScore.scoringVersion !== EXTRACTION_SCORING_VERSION;
        if (!hasScore || staleSummary || staleExtraction) pending.push({ document, variant, job, rawRel, scoreRel });
      }
    }
  }
  return pending;
}

/**
 * @param {object} deps
 * @param {() => { embed: Function }} deps.getEmbedder - called only if extraction/classification are pending.
 * @param {() => object} deps.getJudgeClient - called only if summaries are pending.
 * @returns {Promise<{ scored: number, failed: number }>}
 */
export async function scoreAll({
  store,
  config,
  documents,
  variants,
  getEmbedder,
  getJudgeClient,
  concurrency = config.judge.concurrency ?? 1,
  log = () => {},
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50)
    throw new Error("judge concurrency must be an integer from 1 through 50");
  const pending = pendingScores(store, documents, variants);
  log(`${pending.length} outcome(s) to score`);
  let scored = 0;
  let failed = 0;

  const finish = (item, record) => {
    store.write(item.scoreRel, { documentId: item.document.id, variantId: item.variant.id, ...record });
    scored++;
    const value = record.score === null || record.score === undefined ? "" : ` ${record.score}`;
    log(
      `${item.job.padEnd(14)} ${item.variant.id} × ${item.document.id}: ${record.status}${value}${record.reason ? ` (${record.reason})` : ""}`,
    );
  };
  const fail = (item, error) => {
    failed++;
    if (item.job === "summarization" && config.judge.provider === "gemini") {
      // A failed Gemini POST may have been billed even if the response was lost. Persist a
      // terminal error marker so a later `score` does not silently submit the same candidate again.
      store.write(item.scoreRel, {
        documentId: item.document.id,
        variantId: item.variant.id,
        job: item.job,
        status: "error",
        score: null,
        reason: "Gemini request failed; automatic retry disabled",
        rubricVersion: RUBRIC_VERSION,
        requestedModel: config.judge.model,
        scoreScale: "0-10",
        weights: config.judge.weights,
        thinkingLevel: config.judge.thinkingLevel ?? "HIGH",
        maxOutputTokens: null,
      });
      log(`${item.job.padEnd(14)} ${item.variant.id} × ${item.document.id}: request failed; saved without retry`);
    } else {
      log(`${item.job.padEnd(14)} ${item.variant.id} × ${item.document.id}: not scored, will retry (${error.message})`);
    }
  };

  const ready = [];
  for (const item of pending) {
    const raw = store.read(item.rawRel);
    if (raw.outcome !== "completed") {
      finish(item, { job: item.job, status: "skipped", score: null, reason: `DocWeaver outcome was ${raw.outcome}` });
    } else ready.push({ ...item, raw });
  }

  const similarityItems = ready.filter((i) => SIMILARITY_SCORERS[i.job]);
  // Embeddings are opt-in: scoring never downloads a model implicitly. The lexical
  // fallback records its method and limitation in each field result.
  const embedder = similarityItems.length && config.similarity.useEmbeddings === true ? getEmbedder() : null;
  for (const item of similarityItems) {
    try {
      finish(
        item,
        await SIMILARITY_SCORERS[item.job]({
          raw: item.raw,
          document: item.document,
          embedder,
          settings: config.similarity,
        }),
      );
    } catch (error) {
      fail(item, error);
    }
  }

  let summaries = ready.filter((i) => i.job === "summarization");
  let judgeClient = null;
  let stopJudgeDispatch = false;
  if (summaries.length) {
    try {
      judgeClient = getJudgeClient();
    } catch (error) {
      for (const item of summaries) fail(item, error);
      summaries = [];
    }
  }
  const judgeOne = async (item) => {
    if (stopJudgeDispatch) return;
    try {
      const pdfBase64 = config.judge.includeSourcePdf
        ? fs.readFileSync(path.join(config.dataDir, item.document.file)).toString("base64")
        : null;
      finish(
        item,
        await judgeSummary({
          client: judgeClient,
          raw: item.raw,
          reference: item.document.summary,
          pdfBase64,
          judgeConfig: config.judge,
        }),
      );
    } catch (error) {
      fail(item, error);
      if (config.judge.provider === "gemini") stopJudgeDispatch = true;
    }
  };
  // Calls may use independent concurrency across all documents. Each completion is written
  // immediately; Gemini transport errors stop workers from dispatching further pending calls.
  await mapPool(summaries, concurrency, judgeOne);
  return { scored, failed };
}
