# Step 6 · Reporting

Scoring gives us 180 numbers. Reporting has three jobs:

1. **Rank** the model setups in a way that cannot be gamed.
2. **Explain** where the differences come from: which job, which category, which document.
3. **Flag** results a person should check before anyone trusts the ranking.

It produces two outputs for two audiences:

| Output                                    | Audience                          | Command                   | Code                                                                                         |
| ----------------------------------------- | --------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| `report.md`, `report.html`, `report.json` | the people running the evaluation | `npm run report`          | [`aggregate.mjs`](aggregate.mjs), [`outliers.mjs`](outliers.mjs), [`render.mjs`](render.mjs) |
| `DocWeaver_Model_Evaluation.xlsx`         | stakeholders                      | `npm run report:workbook` | [`build_workbook.py`](build_workbook.py)                                                     |

## How the numbers flow

```text
runs/<id>/raw/*.json      what DocWeaver returned, and how long it took
runs/<id>/scores/*.json   the score for each output (Steps 4–5)
        │
        ▼  collectRows()           one row per document × variant × job
        ▼  jobSummary()            per variant and job: mean, effective score, job-specific detail
        ▼  summarizeVariants()     composite, failures, median and p90 seconds
        ▼  rankVariants()          the leaderboard
        ▼  detectOutliers()        flags for review
        ▼  render                  Markdown, HTML and JSON
```

### Step 1: put every job on the same scale

Each job's score is converted to 0–1, so the jobs can be compared and combined:

| Job            | Score                                  |
| -------------- | -------------------------------------- |
| extraction     | mean field confidence for the document |
| classification | share of pages labelled correctly      |
| summarization  | the judge's weighted overall ÷ 10      |

### Step 2: count failures as zero

There are two averages per job. The difference between them is the most important rule in the
report:

```js
// aggregate.mjs: jobSummary()
meanScore: round(mean(scored.map((r) => r.score)), 3),
// Failed tasks count as 0; completed but unscored tasks leave quality unknown.
effectiveScore: fullyKnown && rows.length ? round(scored.reduce((n, r) => n + r.score, 0) / rows.length, 3) : null,
```

Example: a setup completes 9 of 10 extraction tasks and scores 0.90 on each.

| Measure         | Calculation    | Result |
| --------------- | -------------- | -----: |
| mean (scored)   | 8.1 ÷ 9 tasks  |   0.90 |
| effective score | 8.1 ÷ 10 tasks |   0.81 |

Without this rule, a setup that fails on the hard documents would look better than one that
attempts them. The leaderboard uses the effective score.

### Step 3: combine, but only when everything is known

The **composite** is the mean of a setup's three effective scores. It is left blank on purpose
when anything is missing:

```js
// aggregate.mjs: summarizeVariants()
// A partial run can look like a winner when only its easiest tasks are present.
composite:
  (expectedTasksPerVariant !== null && own.length !== expectedTasksPerVariant) ||
  jobs.some((job) => perJob[job].effectiveScore === null)
    ? null
    : round(mean(effective), 3),
```

This rule fired in the final comparison. The Richmond invoice's reference summary was being
corrected, so its five summaries were not scored there, and the report showed **no composite and
no rank** instead of a ranking built on 9 of 10 documents:

```text
| # | Variant                  | Composite | Extraction | Classification | Summarization | Failed | Median s |
| – | textract-sonnet-4-6      | –         | 0.78       | 0.95           | –             | 0/30   | 7.2      |
| – | textract-sonnet-4-5      | –         | 0.81       | 0.90           | –             | 0/30   | 10.7     |
```

### Step 4: rank, then break ties by speed

```js
// aggregate.mjs: rankVariants()
.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1) || (a.medianSeconds ?? Infinity) - (b.medianSeconds ?? Infinity))
```

Speed is reported as the **median** and the **90th percentile**, so one slow task does not hide
the typical one, and the slow tail is still visible.

## Reading the report

After the leaderboard, each job gets its own section. Each table answers a specific question:

| Section                          | Question it answers                                         |
| -------------------------------- | ----------------------------------------------------------- |
| per-variant table                | how does each setup do on this job?                         |
| by category                      | is a setup weak on one type of document?                    |
| by document                      | which documents cause the trouble?                          |
| extraction: confidence by field  | which questions are hard, e.g. _Net Balance_ vs _Subject_?  |
| classification: confusion matrix | which labels get confused with which?                       |
| summarization: criteria          | is a low score about coverage, accuracy, clarity or length? |

A real example of why the detail matters. In the classification table of the final comparison,
**document** accuracy is perfect for every setup, but **page** accuracy is not:

```text
| Variant                  | Document accuracy | Page accuracy | Page macro-F1 |
| textract-sonnet-4-6      | 1.00              | 0.94          | 0.93          |
| textract-qwen3-32b       | 1.00              | 0.77          | 0.76          |
```

A report with only the document column would call these two setups equal.

## Outlier flags

[`outliers.mjs`](outliers.mjs) marks results a person should look at. The rules follow one
principle:

> **Compare a setup with the other setups on the same document and job.**

Documents differ in difficulty far more than setups do (see [Step 2](../02-document-screening/)).
A score of 0.67 on the Missoulian article is normal; a score of 0.67 where every other setup
got 1.0 is not.

### How "far below the others" is measured

The `low-score` rule needs **both** of these:

1. a real gap: at least **0.25** below the other setups' median;
2. a statistical outlier: a **robust z-score** of −2.5 or lower.

A robust z-score is a z-score built from the median and the median absolute deviation (MAD)
instead of the mean and standard deviation. One extreme score cannot drag the median, so it
cannot hide itself:

```js
// stats.mjs
export function robustZ(value, values) {
  const spread = mad(values);
  if (!spread) return null; // most scores identical: fall back to the gap rule alone
  return (value - median(values)) / (1.4826 * spread);
}
```

**Worked example from the final run.** Classification of the Oxnard mayor's letter (2 pages):

| Setup      | Sonnet 4.6 | Sonnet 4.5 | Haiku 4.5 | Qwen3 32B | Llama 4 |
| ---------- | ---------: | ---------: | --------: | --------: | ------: |
| Page score |        1.0 |        1.0 |       0.5 |       0.5 |     1.0 |

- Median = 1.0. The gap for Haiku and Qwen is 0.5, which passes the 0.25 rule.
- Most scores are identical, so MAD = 0 and the z-score is undefined. The gap rule alone decides.
- Result: two **high** `low-score` flags, which is where the "second page labelled as a budget"
  finding came from.

### All the flags

| Flag                            | Fires when                                                                  | What to check                                   |
| ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| `run-failed`, `empty-output`    | DocWeaver failed, timed out, or returned no pages                           | the task on staging, then rerun                 |
| `low-score`                     | far below the other setups on the same document and job (rule above)        | the output vs the PDF                           |
| `misclassified`                 | a wrong label where most setups got it right                                | the page itself                                 |
| `check-ground-truth`            | most setups disagree with the reference label                               | **the reference**, not the models               |
| `hallucinated-field`            | a value returned for a field the reference leaves empty                     | whether the value is really absent from the PDF |
| `verbose` / `terse`             | summary length robust \|z\| ≥ 3 against the same document's other summaries | whether length cost coverage or conciseness     |
| `page-mismatch`                 | result pages ≠ PDF pages                                                    | the OCR step                                    |
| `slow`                          | above Q3 + 1.5 × IQR (the Tukey fence) for that setup and job               | timing only, not quality                        |
| `weak-variant`                  | a setup's job or composite score far below the others'                      | the per-job tables                              |
| `score-error`, `judge-fallback` | a score could not be produced, or a different judge model answered          | the score record                                |

One flag is inactive: `contradiction` reads a list of contradictions that earlier rubric
versions returned. The current rubric returns only the four scores and caps accuracy at 2
for a material contradiction instead, so this flag no longer fires.

Thresholds live under `outliers` in [`config/eval.config.json`](../config/eval.config.json).

### What the 71 flags in the final comparison turned out to be

| Flag                 | Count | What it meant                                                                                                                                                             |
| -------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `judge-fallback`     |    45 | every summary score: `gemini-3.5-flash` was requested, `gemini-3.6-flash` answered. Recorded, not an error                                                                |
| `hallucinated-field` |     9 | two fields: a handwritten newspaper date (5 setups) and an invoice date (4). Same value from most setups, so the reference was checked first; the date was later excluded |
| `slow`               |     7 | five on the Missoulian article; each a few seconds over the fence                                                                                                         |
| `verbose` / `terse`  |     7 | summary length differences; length is already reflected in the conciseness score                                                                                          |
| `low-score`          |     3 | real model errors: later pages labelled wrongly (mayor's letter page 2, Forbes email page 3)                                                                              |

The large counts were explained by one cause each. The three `low-score` flags were the real findings.

## From report to stakeholder workbook

The run report is a working tool. Before a recommendation went out, the numbers went through one
more review:

```text
run report + flags ──► review against the PDFs ──► verified per-item scores ──► stakeholder workbook
 (npm run report)       (Step 4, "Checking the      (07-results/source/          (npm run report:workbook)
                         scoring itself")              …Complete_Evaluation.xlsx)
```

[`build_workbook.py`](build_workbook.py) reads the verified scores, the run records (for speed
and completion counts) and the final reference, and writes a workbook in plain language:

| Sheet              | Shows                                                     |
| ------------------ | --------------------------------------------------------- |
| Overview           | the recommendation, key findings, scores at a glance      |
| Model Comparison   | every setup side by side, summary criteria, speed per job |
| By Document Type   | where each setup does well and where it struggles         |
| Vision vs Textract | same LLM, two ways of reading the PDF                     |
| Summaries          | every summary score                                       |
| Page Labels        | every page prediction                                     |
| Extracted Data     | every field: expected, extracted, verdict                 |
| Ground Truth       | the reference answers                                     |
| About This Test    | method, scoring, excluded fields, limits                  |

The builder refuses to produce a workbook that disagrees with its evidence. It stops if:

- its headline numbers differ from the verified source workbook's, or
- any extraction field below full marks has no review verdict.

## Try it

```bash
npm run report                                            # report for the latest run
node bin/llmjudge.mjs report --run-ids <id1>,<id2>        # combine runs into one comparison
python3 -m pip install --user openpyxl                    # once
npm run report:workbook                                   # rebuild the stakeholder workbook
```

Open [`07-results/runs/_comparisons/comparison-20261102-150555/report.md`](../07-results/runs/_comparisons/comparison-20261102-150555/report.md)
to see a full real report alongside this page.

**Next:** [Step 7 · Results](../07-results/)
