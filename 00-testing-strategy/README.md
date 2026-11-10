# Step 0 · Testing strategy

Before any document was labelled, we had to decide _how_ to test AI output at all. This page
explains the approach we chose, the alternatives we did not choose, and why this approach fits
this problem.

## What we are testing

We are testing **the quality of what the models produce**, not whether DocWeaver's buttons and
APIs work. The question is:

> Given the same documents and the same instructions, which model setup gives the most correct
> answers, and how fast?

Three properties of the problem shaped every decision:

| Property of the problem                               | What it means for testing                                      |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Most answers can be checked: an invoice has one total | we can write the right answer down in advance                  |
| Some answers are free text: summaries                 | no single right wording, so exact checks will not work         |
| The result has to support a business decision         | the method must be repeatable and explainable to non-engineers |

## The approach: reference-based evaluation

We built a small **golden dataset**: documents with hand-written correct answers (the _ground
truth_). Every model setup processes the same documents, and every output is scored against
those answers.

```text
fixed documents  +  hand-written answers  →  every model, same input  →  score vs answers  →  compare
```

### Alternatives we considered

| Approach                               | Why we did not use it                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| People review outputs side by side     | 180 outputs is too many to review consistently; reviewers drift and disagree       |
| An LLM rates outputs with no reference | nothing anchors the score; the judge's own opinion becomes the standard            |
| Public benchmarks                      | they test other documents and other tasks, not ours                                |
| A/B test with real users               | no production traffic for this decision, and a wrong model would reach users first |

A reference-based test is slower to set up, because someone has to write the answers. In
exchange you get scores that mean the same thing for every model and every rerun.

## Five decisions that make it work

### 1. Match the scoring method to the type of answer

| Job            | Answer type       | Scored by                        | Why                          |
| -------------- | ----------------- | -------------------------------- | ---------------------------- |
| Extraction     | a value per field | code: normalise, then compare    | exact, free, repeatable      |
| Classification | a label per page  | code: exact match                | a label is right or wrong    |
| Summarization  | free text         | an LLM judge with a fixed rubric | meaning matters, not wording |

Code is used wherever the answer is exact; the LLM judge is used only where it is not. See
[Step 4](../04-deterministic-scoring/) and [Step 5](../05-llm-judge/).

### 2. A small, deliberate sample instead of a large random one

10 documents, 2 per category, 17 pages. In four of the five categories, one document is
straightforward and the other is harder (more pages, a poor scan, or a busy layout). A small set can be labelled carefully and
checked against the PDFs by hand; a large random set cannot. See
[Step 2](../02-document-screening/) for how difficulty played out.

### 3. Control the variables

- Every model gets **the same documents** and **the same instructions**: the extraction fields
  and category labels are generated from the ground truth, never typed twice.
- The vision setup changes **only the OCR step** (same LLM as `textract-sonnet-4-6`), so any
  difference can be traced to OCR.
- The judge **never sees model names**, and it comes from **a different model family** (Gemini)
  than most candidates (Claude), so it has no reason to favour its own family.

### 4. Run safely and resumably

Runs go one task at a time against a shared staging server, with the plan printed offline first
and a hard stop on anything unexpected. Every result is saved to disk as it arrives, so an
interrupted run resumes instead of restarting. See [Step 3](../03-running-pipelines/).

### 5. Test the scoring, not only the models

A scoring rule can be wrong too. Unusual results are flagged automatically, and every extraction
field that scored below full marks was checked against the PDF before the numbers were final.
Of 175 below-full extraction cases, 92 turned out to be scoring or reference problems rather
than model errors. See [Step 6](../06-reporting/).

## Sanity-checking the evaluation code itself

The tool is code, so it gets a few cheap checks that need no keys and no network:

```bash
npm run check       # lint and format check
npm run preflight   # config, ground truth, the PDFs and the task count
npm run run:guarded # prints the exact task plan; nothing is sent
```

The annotation app ([Step 1](../01-ground-truth-annotation/app/)) is checked with `npm run lint`
and `npm run typecheck`, and its server re-validates every saved selection and annotation.

## Where this approach falls short

Being clear about the limits is part of the strategy:

- **10 documents** rank clearly different setups, but cannot separate setups within a point or two.
- **The LLM judge is still an LLM.** It is constrained (blind, anchored, reference-based) but
  not perfect, which is why it is used only for summaries.
- **The ground truth is written by people** and can be wrong. The review step exists for that.
- **Speed is measured one task at a time.** It is not a load test.

**Next:** [Step 1 · Ground-truth annotation](../01-ground-truth-annotation/)
