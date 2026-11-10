# Step 7 · Results

> **The question:** which model setup should DocWeaver use for summarizing, labelling and
> extracting data from documents?
>
> **The answer:** **Claude Sonnet 4.6.** Read through the vision model, it gives the best results
> of any setup. Read through Textract, it is the best of the text-based setups.

Evaluated on 2 November 2026: 10 documents (2 each of budget, email, invoice, letter and news
article; 17 pages), 6 model setups, 3 jobs, **180 runs, all completed.**

## Scores at a glance

| Model setup                      | Summary quality |    Page labelling |   Data extraction | Seconds per task |
| -------------------------------- | --------------: | ----------------: | ----------------: | ---------------: |
| **Claude Sonnet 4.6 + Vision**   |       **98.2%** |     94.1% (16/17) | **90.2%** (39/46) |             23.0 |
| **Claude Sonnet 4.6 + Textract** |           95.8% | **94.1%** (16/17) |     87.0% (38/46) |              7.2 |
| Claude Sonnet 4.5 + Textract     |           94.8% |     88.2% (15/17) |     88.0% (38/46) |             10.5 |
| Claude Haiku 4.5 + Textract      |           95.1% |     82.4% (14/17) |     85.9% (37/46) |              5.8 |
| Llama 4 Maverick + Textract      |           89.4% |     88.2% (15/17) |     82.6% (35/46) |              4.9 |
| Qwen3 32B + Textract             |           90.7% |     76.5% (13/17) |     78.3% (33/46) |              5.5 |

Each job is compared on its own; the scores are not added together. Extraction counts a
partly correct field as half, so the percentage is a little higher than "fields fully correct ÷ 46".

## What we found

- **Best quality overall: Sonnet 4.6 reading through the vision model.** It writes the best
  summaries and extracts data most accurately. The catch is speed: about **3× slower** (around
  23 s per task instead of 7).
- **Best text-based choice: Sonnet 4.6 with Textract.** It writes the best summaries and labels
  pages most reliably of the text-based setups. Sonnet 4.5 is slightly ahead on extraction
  (88% vs 87%) but slower (11 s vs 7 s).
- **A good faster option: Haiku 4.5.** It is close to Sonnet 4.6 on summaries (95% vs 96%) and
  extraction (86% vs 87%), but weaker at labelling pages (82%).
- **Weakest: Qwen3 32B**, with the lowest page labelling (76%) and extraction (78%).
  **Llama 4 Maverick** is the fastest (about 5 s) but writes the weakest summaries (89%).
- **Summary accuracy is high for every model** (96–100%). The differences come mainly from
  **coverage**, meaning how much of the key content each summary includes.
- **Most mistakes come from three documents:** a two-page news article (the Missoulian), a
  school budget where text recognition garbles the title (Singleton), and the second page of
  the Oxnard mayor's letter. Emails are handled well by nearly every model.

## Vision vs Textract, same LLM

| Job              | Textract | Vision | Difference                                                                                            |
| ---------------- | -------: | -----: | ----------------------------------------------------------------------------------------------------- |
| Summary quality  |    95.8% |  98.2% | +2.4 points, mostly on news articles and budgets                                                      |
| Page labelling   |    94.1% |  94.1% | same: fixes the news-article page every Textract model missed, but gets the mayor's letter page wrong |
| Data extraction  |    87.0% |  90.2% | +3.3 points: reads the Singleton school name the text reader garbled                                  |
| Seconds per task |      7.2 |   23.0 | about 3× slower                                                                                       |

Worth it where accuracy matters more than turnaround time.

## Keep in mind

- **Small test set.** Two documents per type; a perfect score for a type can rest on three or
  four pages. Treat small differences as a tendency, not a verdict.
- **Four extraction fields are not scored** for any model, because the reference itself has no
  single correct answer (listed in the workbook's _About This Test_ sheet).
- **One reference summary was corrected** (the Richmond invoice) after its Textract summaries
  were scored; those five scores were kept as recorded.
- **Speed is the median per task, one task at a time.** It is not a load test.
- **The judge was served as `gemini-3.6-flash`** although `gemini-3.5-flash` was requested (see
  [Step 5](../05-llm-judge/)).

## What is in this folder

| Path                                                                                            | What it is                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`DocWeaver_Model_Evaluation.xlsx`](DocWeaver_Model_Evaluation.xlsx)                            | **the stakeholder workbook**: recommendation, findings, every scored item, the reference answers |
| [`source/DocWeaver_Complete_Evaluation.xlsx`](source/)                                          | verified per-item scores, including the PDF-reviewed extraction; the workbook's input            |
| [`runs/20261102-102753`](runs/20261102-102753/), [`…-103030`](runs/20261102-103030/)            | three single summary tasks that completed before the guarded runs                                |
| [`runs/20261102-104021`](runs/20261102-104021/)                                                 | guarded run: 47 summary tasks, 5 Textract variants                                               |
| [`runs/20261102-111617`](runs/20261102-111617/)                                                 | guarded run: 50 classification tasks                                                             |
| [`runs/20261102-115831`](runs/20261102-115831/)                                                 | guarded run: 50 extraction tasks                                                                 |
| [`runs/20261102-145512`](runs/20261102-145512/)                                                 | guarded run: 30 vision tasks (10 per job)                                                        |
| [`runs/_comparisons/comparison-20261102-150555`](runs/_comparisons/comparison-20261102-150555/) | the combined Textract report, outlier flags, and the extraction review ledger                    |

Each run folder has a `manifest.json` (documents, variants, pipelines, safety settings), one
`raw/` file per task (DocWeaver's output and timing) and, where scored, a `scores/` file per
task. Rebuild the workbook from this evidence with `npm run report:workbook`.

**Back to:** [the overview](../README.md) · [KSS session guide](../docs/kss-session-guide.md)
