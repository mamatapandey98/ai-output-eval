# Step 4 · Deterministic scoring (extraction and classification)

> **Why this step exists:** when an answer has a right value, such as an invoice number, a date
> or a document type, you do not need an LLM to grade it. Code gives the same score every time,
> costs nothing and can be explained line by line. Save the LLM judge for the free text that
> needs it (Step 5).

## Extraction: how close is each field?

Each extracted field is compared with its reference value and given a **confidence** from 0 to 1.
Before any fuzzy comparison, a set of rules settles the clear cases:

| Case                                                       | Score             | Example                                             |
| ---------------------------------------------------------- | ----------------- | --------------------------------------------------- |
| **same value** after normalising format                    | 1                 | `12/18/2013` = `Dec 18, 2013`; `$1,250.00` = `1250` |
| **reference empty, model empty**                           | 1, `agreed-empty` |                                                     |
| **reference has a value, model empty**                     | 0, `missing`      |                                                     |
| **reference empty, model has a value**                     | 0, `hallucinated` |                                                     |
| **numbers or dates differ** on an amount, date or ID field | capped at 0.4     | `$1,250` vs `$1,520`                                |

The number cap matters. Text-similarity measures, embeddings included, rate `$1,250` and
`$1,520` as nearly identical, but for a total amount they are simply different answers. The
cap is applied after the similarity is calculated, on date, money, ID and fiscal-period fields:

```js
// similarity/confidence.mjs
const strictNumericField = dateField || moneyField || idField || fiscalPeriodField;
// … numericMismatch is true when the amounts, dates or IDs differ
if (numericMismatch) confidence = Math.min(confidence, settings.numericMismatchCap); // 0.4
```

Everything else gets a weighted text similarity, configured under `similarity` in
[`config/eval.config.json`](../config/eval.config.json):

```text
by default (offline):     confidence = 0.7 · word F1 + 0.3 · character similarity
with embeddings enabled:  confidence = 0.5 · cosine′ + 0.25 · word F1 + 0.25 · character similarity
```

| Part                 | What it measures                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| word F1              | shared words, ignoring order                                                                     |
| character similarity | 1 − edit distance ÷ length; catches typos and abbreviations                                      |
| cosine′              | meaning, from a local `all-MiniLM-L6-v2` embedding, rescaled so unrelated text (0.2) counts as 0 |

Embeddings are **off by default** so that scoring never downloads a model by surprise. Every
field records which method scored it (`lexical-only` or `embedding+lexical`).

**Verdicts:** `match` ≥ 0.8, `partial` ≥ 0.5, `mismatch` below that.

**Document level, not page level.** The reference holds one value per field for the whole
document, so each field is scored once, against the first non-empty value the model returned in
page order. All page values are kept in the score record for review.

**Normalisation is field-aware.** [`similarity/text.mjs`](similarity/text.mjs) knows about dates,
date-times, fiscal periods (`2014–2015` = `2014-15`), currencies, and contact names with an email in
angle brackets (`Jon Entine <jon@…>` = `Jon Entine`). Each rule exists because a real model output
was marked wrong for formatting alone.

## Classification: exact match

Classification is categorical, so there is **no partial credit** for a near-synonym:

- **Per-page accuracy** when the reference has page labels (all 10 final documents do, 17 pages
  in total).
- **Document-majority accuracy** otherwise.
- **Macro-F1** across categories and missing or extra page labels are reported alongside.

## The files

| File                                                     | Role                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`similarity/text.mjs`](similarity/text.mjs)             | normalising text, dates, amounts; word F1; edit distance                   |
| [`similarity/confidence.mjs`](similarity/confidence.mjs) | the confidence formula and its guards                                      |
| [`similarity/embedder.mjs`](similarity/embedder.mjs)     | optional local sentence embeddings (transformers.js)                       |
| [`similarity-jobs.mjs`](similarity-jobs.mjs)             | `scoreExtraction` and `scoreClassification`                                |
| [`score.mjs`](score.mjs)                                 | scores a whole run: similarity jobs here, summaries via the judge (Step 5) |

[`score.mjs`](score.mjs) also decides what needs scoring. An output with no score is scored. So
is one scored under an older scoring version: extraction records carry
`EXTRACTION_SCORING_VERSION`, summaries carry the rubric version. A task DocWeaver did not
complete gets a `skipped` record and counts as 0 in the report.

## Checking the scoring itself

A scoring rule is a hypothesis too. After the first full scoring pass, all 175 extraction cases
that scored below full marks were reviewed against the PDFs, grouped into 93 unique cases.
Most turned out to be scoring or reference problems, not model errors:

- **92 cases** became full matches after a fix: format normalisation, document-level scope, or
  a corrected reference.
- **12 cases** were good paraphrases underrated by word overlap. This is a known limit of lexical
  scoring for long free-text fields such as _Core Message_.
- **23 cases** were confirmed model errors: wrong value, missing value, hallucination or
  garbled OCR text.
- The rest were partly correct, or could not be graded because the reference itself was
  ambiguous.

The full review is in
[`07-results/runs/_comparisons/comparison-20261102-150555/extraction-field-adjudication.md`](../07-results/runs/_comparisons/comparison-20261102-150555/extraction-field-adjudication.md).
The final extraction scores use those verdicts: correct 1, partly correct 0.5, otherwise 0.

## Try it

```bash
npm run score                       # score the latest run
npm run score -- --rescore          # reload the ground truth and score from scratch
```

**Next:** [Step 5 · LLM judge](../05-llm-judge/)
