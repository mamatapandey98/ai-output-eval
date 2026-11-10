/**
 * Reference-based rubric for judging a pipeline summary against the human ground-truth summary.
 *
 * The judge is blind: it never sees the variant id, pipeline or model name, so a judge from the
 * same model family as a candidate cannot recognise it by label. Scores are numeric 0–10; the
 * weighted overall is computed in code (overallScore), not by the judge.
 */

export const CRITERIA = ["coverage", "accuracy", "clarity", "conciseness"];

export const RUBRIC_VERSION = "summary-reference-v4";

const BASE_PROMPT = `You compare a CANDIDATE summary, produced by a document-processing pipeline, with a REFERENCE summary written by a human expert for the same document. Treat the reference as the scoring target, while recognizing it may omit details. Do not infer facts absent from both inputs.

Score each criterion from 0 (very poor) to 10 (excellent). Fractional scores are allowed when performance falls between anchors:

- coverage: include central purpose, parties, key figures, dates, decisions and outcomes. Missing a central fact caps coverage at 3; missing most central facts caps it at 2. Minor omissions should have a proportionate effect, not the same penalty as losing the document's main point.
- accuracy: preserve names, identifiers, amounts, dates, and relationships. A material contradiction caps accuracy at 2. Penalize specific material invented claims that are unsupported by the provided evidence; absence from the reference alone does not prove a claim false. Do not penalize harmless paraphrase or formatting changes. Do not deduct again under accuracy for the same omission already reflected in coverage.
- clarity: readable, coherent, and internally consistent. Do not reward verbosity.
- conciseness: no unnecessary repetition or boilerplate; concise complete writing is best. Do not penalize useful details merely for making a summary longer.

Use these anchors consistently; scores between anchors interpolate:
- coverage 10: all material points are present; 8: only minor details are missing; 5: one central point or several important details are missing; 2: most central points are missing; 0: the document's purpose and key facts are essentially absent.
- accuracy 10: no material factual error; 8: only minor imprecision; 5: a material ambiguity changes some meaning; 2: material contradictions or unsupported claims; 0: the summary is wholly unreliable. A direct material contradiction caps accuracy at 2.
- clarity 10: easy to follow and coherent; 8: clear with minor awkwardness; 5: understandable but meaning is occasionally unclear; 2: difficult to follow; 0: incoherent.
- conciseness 10: complete without irrelevant detail or repetition; 8: mostly focused with minor padding; 5: noticeable unnecessary material; 2: dominated by repetition or boilerplate; 0: almost entirely irrelevant or repetitive.

Judge meaning, not wording: a paraphrase that preserves the facts is a full match. The candidate may be organised page by page while the reference is not; do not penalise the structure itself. Do not reward irrelevant detail or verbosity.

Return exactly one JSON object with exactly these four numeric keys and no prose, markdown, reasoning, citations, or extra keys: coverage, accuracy, clarity, conciseness. Each value must be a number from 0 through 10, inclusive. Do not include an overall score; the application computes it.`;

const WITHOUT_SOURCE = `

You do not have the source document, so the reference is incomplete evidence. Do not treat every fact omitted by the reference as false. Lower accuracy for a specific material addition only when it is implausible or conflicts with supplied evidence.`;

const WITH_SOURCE = `

The source PDF is attached. Use it as evidence for material facts omitted by the reference. If the reference and the PDF disagree, the PDF is correct.`;

export function judgeSystemPrompt({ includeSourcePdf }) {
  return BASE_PROMPT + (includeSourcePdf ? WITH_SOURCE : WITHOUT_SOURCE);
}

const SCORE = {
  type: "number",
  minimum: 0,
  maximum: 10,
  description: "Number from 0 through 10; fractional values allowed",
};

export const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...CRITERIA],
  properties: {
    coverage: SCORE,
    accuracy: SCORE,
    clarity: SCORE,
    conciseness: SCORE,
  },
};

export function referenceBlock(reference) {
  return `<reference_summary>\n${reference}\n</reference_summary>`;
}

export function candidateBlock(candidateText) {
  return `<candidate_summary>\n${candidateText || "(empty — the pipeline returned no summary text)"}\n</candidate_summary>\n\nScore the candidate summary against the reference.`;
}

/**
 * Validate the judge's score-only JSON against the rubric.
 * @returns {object} the verdict.
 */
export function validateVerdict(verdict) {
  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) throw new Error("verdict must be an object");
  const allowed = new Set(CRITERIA);
  const extra = Object.keys(verdict).filter((key) => !allowed.has(key));
  if (extra.length) throw new Error(`unexpected key(s): ${extra.join(", ")}`);
  for (const c of CRITERIA) {
    const n = verdict?.[c];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10)
      throw new Error(`${c} must be a number from 0 through 10`);
  }
  return verdict;
}

/** Weighted mean of the criteria on the 0–10 scale, to two decimals. */
export function overallScore(verdict, weights) {
  let total = 0;
  let weightSum = 0;
  for (const c of CRITERIA) {
    if (!Number.isFinite(weights[c]) || weights[c] < 0) throw new Error(`invalid weight for ${c}`);
    total += verdict[c] * weights[c];
    weightSum += weights[c];
  }
  if (weightSum <= 0) throw new Error("judge weights must sum to a positive value");
  return Math.round((total / weightSum) * 100) / 100;
}

/** 0–10 → 0–1 adapter for reports combining summaries with other job scores. */
export function normalizeOverall(overall) {
  return Math.round((overall / 10) * 1000) / 1000;
}
