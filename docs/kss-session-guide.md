# KSS session guide: evaluating AI output

A plan for presenting this work as a knowledge-sharing session (KSS): about **60 minutes**, made
up of 45 minutes of talk and demo and 15 minutes of questions.

**Audience:** engineers, QA and product people who build on or choose LLM features.
**Goal:** everyone leaves with a method they can reuse to answer _"is this AI output good
enough, and which model should we use?"_ with evidence.

## Agenda

| Time  | Part                                              | Material                                                           |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 0–8   | The question and the testing strategy             | [README](../README.md), [Step 0](../00-testing-strategy/)          |
| 8–16  | Ground truth: writing the correct answers         | [Step 1](../01-ground-truth-annotation/)                           |
| 16–22 | Choosing documents: limits, screening, difficulty | [Step 2](../02-document-screening/)                                |
| 22–27 | Running every model fairly and safely             | [Step 3](../03-running-pipelines/)                                 |
| 27–34 | Scoring: code where possible, an LLM where needed | [Step 4](../04-deterministic-scoring/), [Step 5](../05-llm-judge/) |
| 34–41 | Reporting: ranking, flags, review                 | [Step 6](../06-reporting/)                                         |
| 41–45 | Results and recommendation                        | [Step 7](../07-results/), the workbook                             |
| 45–60 | Questions                                         | [Lessons learned](lessons-learned.md)                              |

## Talking points

### The question and the strategy (8 min)

- DocWeaver can run six model setups. On a demo document they all look fine.
- Choosing wrong is costly and quiet: a wrong total, a summary that misses the point, a page
  filed under the wrong type.
- Our approach: write the correct answers first, run every model on the same documents, and
  score against those answers.
- Show the "alternatives we considered" table in Step 0. Explain why each one did not fit.

### Ground truth (8 min)

- **Demo:** open the annotation app (`npm run load-reference && npm run dev` in
  `01-ground-truth-annotation/app`). Show the page view and the three tabs on the Sprout invoice.
  If the app cannot run in the room, use the screenshots in Step 1.
- Show the full Sprout invoice reference: one answer per job.
- Five fixed fields per category. The same list becomes the instruction sent to DocWeaver.
- An empty field is an answer. That is how hallucinated values are caught.
- In the app, show page 2 of the Richmond invoice: a short payment note that is still part of
  the invoice. Four of the six setups called it a letter. This is why labels are per page.
- The reference changed during the project: per-page labels, PDF corrections, four excluded
  fields. Say so openly. A reference that never changes was probably never checked.

### Choosing documents (6 min)

- 998 PDFs → 380 in five categories → 315 within every limit → 10 documents.
- Two sets of limits: DocWeaver's (30 MB, 50 pages) removed 2 files; the annotation app's
  (1 MB, 15 pages, so documents stay small enough to label by hand) removed 64. News articles
  lost the most: 29 of 84 are scanned pages over 1 MB.
- Show the easy/harder pairs table: structure (pages, scan quality, layout) predicts difficulty
  better than category.
- Our expectation was "invoices easy, news articles hardest". News articles were the hardest.
  Invoices split: one of the easiest documents and one of the harder ones.

### Running (5 min)

- A variant is an OCR engine plus an LLM. The vision setup changes only the OCR.
- The first all-at-once run left tasks hanging for 30 minutes on a shared server. The guarded
  runner was the fix.
- **Demo:** `npm run run:guarded` prints the exact 47-task plan and sends nothing.

### Scoring (7 min)

- Exact answers are scored by code. Show the rule table in Step 4.
- Ask the room: _would `$1,250` and `$1,520` look similar to a text-similarity measure?_ They
  would, which is why number fields are capped at 0.4 when the values differ.
- Free text is scored by an LLM judge. Show the rubric: blind, anchored scale, caps for material
  errors, four numbers only, weights applied in code.
- **Demo:** open [`05-llm-judge/rubric.mjs`](../05-llm-judge/rubric.mjs) and read the anchors.

### Reporting (7 min)

- Failures count as 0 (the effective score). Walk through the 9-of-10 example.
- The composite stays blank until every task is scored. Show the real leaderboard where it did.
- Document accuracy 1.00 vs page accuracy 0.77: why the detail tables exist.
- Outliers compare a setup with the others on the same document. Walk through the mayor's letter
  example.
- Of 175 below-full extraction cases, only 23 were confirmed model errors after the PDF review.
- The judge is Gemini, not Claude: four of the six setups are Claude models, and a judge tends
  to score its own family a little higher.
- The judge was requested as `gemini-3.5-flash` and served as `gemini-3.6-flash`. Record the
  model that actually answered.

### Results (4 min)

- Open `07-results/DocWeaver_Model_Evaluation.xlsx` → _Overview_.
- **Recommendation: Claude Sonnet 4.6.** With vision it is the best overall but about 3× slower;
  with Textract it is the best of the text-based setups. Haiku 4.5 is the faster option if page
  labelling matters less.
- State the limits: 10 documents, so treat small differences as tendencies.

## Demo checklist

All of these run offline, without keys or network access (each `npm install` needs the network once):

```bash
npm install
npm run check                          # lint and format check
npm run preflight                      # checks the 10 PDFs in data/
npm run difficulty                     # difficulty by category and by document
npm run run:guarded                    # the 47-task plan, nothing sent
npm run report:workbook                # rebuild the stakeholder workbook from the evidence

cd 01-ground-truth-annotation/app      # the annotation app (needs Poppler)
npm install && npm run load-reference && npm run dev
```

Have these open: the annotation app on the Richmond invoice, the workbook _Overview_ sheet, [`rubric.mjs`](../05-llm-judge/rubric.mjs), the
[final comparison report](../07-results/runs/_comparisons/comparison-20261102-150555/report.md) and the
[extraction review](../07-results/runs/_comparisons/comparison-20261102-150555/extraction-field-adjudication.md).

## Questions to expect

| Question                               | Short answer                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isn't an LLM judging LLMs circular?    | Partly. That is why it is used only for summaries, is blind to model names, scores against a human reference, and is Gemini, so it does not favour the Claude candidates. |
| Why not use embeddings for everything? | They rate `$1,250` and `$1,520` as near-identical. Exact fields need exact rules; embeddings are optional and off by default.                                             |
| Are 10 documents enough?               | Enough to separate clearly different setups and find failure patterns; not enough to separate setups within a point or two.                                               |
| How long did the runs take?            | 5–23 s per task plus a 20 s rest between tasks; each 50-task phase took under an hour.                                                                                    |
| Can I reuse this for another product?  | Yes. Replace Step 3's API client with your system's; the ground truth format, scorers, judge and reports carry over.                                                      |
| Who wrote the ground truth?            | People, in the annotation app, then checked against the PDFs (Step 1).                                                                                                    |
