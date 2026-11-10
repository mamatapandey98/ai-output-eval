/**
 * Score extraction outputs with field-aware similarity and classification outputs with exact
 * categorical accuracy. Each returns the record stored at
 * scores/<doc>__<variant>__<job>.json; `score` is always 0–1.
 */
import { classifiedLabels, extractedValues, sortedPages } from "../03-running-pipelines/jobs.mjs";
import { scorePairs } from "./similarity/confidence.mjs";
import { valueToText } from "./similarity/text.mjs";

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round3 = (n) => (n === null ? null : Math.round(n * 1000) / 1000);

export const EXTRACTION_SCORING_VERSION = "document-value-first-nonempty-v8-field-aware-normalization";

function embeddingEligible(field, category) {
  const name = String(field.name).toLowerCase();
  const type = String(field.type).toLowerCase();
  if (
    category === "email" ||
    /email|date|time|amount|money|currency|number|identifier|invoice|account|phone|postal/.test(name)
  )
    return false;
  if (/date|time|number|integer|currency|money|amount/.test(type)) return false;
  if (/sender|recipient|from \(|to \(|organization|department|vendor|seller|author|byline/.test(name)) return false;
  return /headline|title|subject|topic|purpose|request|message|action|description|details|summary/.test(name);
}

export async function scoreExtraction({ raw, document, embedder, settings }) {
  const { fields, values: expected } = document.extraction;
  const predicted = extractedValues(raw.result, fields);
  // Extraction references are document-level. The API emits a copy of its extraction schema
  // on each page, so page blanks or page-specific headers must not be compared to the same
  // document-level reference as if each were an independent gold answer. `extractedValues`
  // defines the document answer as the first non-empty page value; retain every page value
  // below for audit, but score that one document answer exactly once.
  const pairs = fields.map((field) => ({
    expected: expected[field.name],
    predicted: predicted[field.name].value,
    field: { ...field, useEmbeddings: embeddingEligible(field, document.category) },
  }));
  const comparisons = await scorePairs(pairs, embedder, settings);
  const scored = fields.map((field, index) => {
    const fieldScore = {
      ...comparisons[index],
      scope: "document-first-nonempty-page-value",
      ...(sortedPages(raw.result).length > 1 && {
        pageScopeNote:
          "Per-page values are shown for review; document-level reference is scored once against the first non-empty value.",
      }),
    };
    return {
      name: field.name,
      expected: valueToText(expected[field.name]),
      predicted: valueToText(predicted[field.name].value),
      pageValues: sortedPages(raw.result).map((page) => ({
        page: page.pg_no,
        value: valueToText(predicted[field.name].pages.find((entry) => entry.page === page.pg_no)?.value),
      })),
      ...fieldScore,
      ...(comparisons[index].limitation && { limitation: comparisons[index].limitation }),
    };
  });
  const counts = Object.fromEntries(
    ["match", "partial", "mismatch", "missing", "hallucinated", "agreed-empty"].map((v) => [
      v,
      scored.filter((f) => f.verdict === v).length,
    ]),
  );
  const comparisonCounts = Object.fromEntries(
    ["match", "partial", "mismatch", "missing", "hallucinated", "agreed-empty"].map((verdict) => [
      verdict,
      comparisons.filter((result) => result.verdict === verdict).length,
    ]),
  );
  return {
    job: "extraction",
    status: "scored",
    scoringVersion: EXTRACTION_SCORING_VERSION,
    score: round3(mean(scored.map((f) => f.confidence))),
    matchRate: round3((counts.match + counts["agreed-empty"]) / scored.length),
    counts,
    comparisonCounts,
    fields: scored,
    resultPages: sortedPages(raw.result).length,
  };
}

export async function scoreClassification({ raw, document, embedder: _embedder, settings }) {
  const truth = document.classification;
  const predicted = classifiedLabels(raw.result);
  const pairs = [{ expected: truth.label, predicted: predicted.label }];
  if (truth.pages) {
    for (const p of truth.pages) {
      pairs.push({ expected: p.label, predicted: predicted.pages.find((q) => q.page === p.page)?.label ?? null });
    }
  }
  const [documentResult, ...pageResults] = await scorePairs(pairs, null, settings);
  const pages = truth.pages
    ? truth.pages.map((p, i) => ({
        page: p.page,
        expected: p.label,
        predicted: pairs[i + 1].predicted,
        ...pageResults[i],
      }))
    : null;
  const pageAccuracy = pages ? round3(pages.filter((p) => p.verdict === "match").length / pages.length) : null;
  const labels = [...new Set((truth.pages ?? []).map((p) => p.label))];
  const perClass = Object.fromEntries(
    labels.map((label) => {
      const tp = pages?.filter((p) => p.expected === label && p.predicted === label).length ?? 0;
      const fp = pages?.filter((p) => p.expected !== label && p.predicted === label).length ?? 0;
      const fn = pages?.filter((p) => p.expected === label && p.predicted !== label).length ?? 0;
      const precision = tp + fp ? tp / (tp + fp) : 0;
      const recall = tp + fn ? tp / (tp + fn) : 0;
      return [
        label,
        {
          support: tp + fn,
          precision: round3(precision),
          recall: round3(recall),
          f1: round3(precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
        },
      ];
    }),
  );
  return {
    job: "classification",
    status: "scored",
    expected: truth.label,
    predicted: predicted.label,
    correct: documentResult.verdict === "match",
    // Classification is categorical: the job score uses exact accuracy, not fuzzy text similarity.
    score: pages ? pageAccuracy : documentResult.verdict === "match" ? 1 : 0,
    documentResult,
    pageAccuracy,
    pageMacroF1: labels.length ? round3(mean(Object.values(perClass).map((m) => m.f1))) : null,
    perClass,
    pages,
    predictedPages: predicted.pages,
    extraPredictedPages: truth.pages
      ? predicted.pages.filter((p) => !truth.pages.some((expectedPage) => expectedPage.page === p.page))
      : [],
    resultPages: sortedPages(raw.result).length,
  };
}
