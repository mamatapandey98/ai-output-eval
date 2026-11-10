# Step 2 · Document screening and selection

Labelling is the most expensive part of the evaluation, so the documents to label were chosen
with care. Three filters took us from the full corpus to 10 documents:

```text
998 PDFs, 13 categories (public DocumentCloud records)
  │  choose 5 categories for this evaluation
  ▼
380 PDFs in invoice, letter, email, budget, news article
  │  filter 1: limits, i.e. what DocWeaver accepts and what the annotation app allows  → removes 65
  ▼
315 PDFs within every limit
  │  filter 2: screening, i.e. a quick trial run on 2 models  → shows which ones process cleanly
  ▼
candidates for annotation
  │  filter 3: choose for difficulty: 2 per category, an easy one and a harder one
  ▼
10 documents, 17 pages
```

## Filter 1 · Limits

Two sets of limits apply, and the stricter one did the work:

| Limit set                | Rule                          | Where it is enforced                                      | Removes from 380 |
| ------------------------ | ----------------------------- | --------------------------------------------------------- | ---------------: |
| DocWeaver upload         | ≤ 30 MB, ≤ 50 pages, readable | [`documents.mjs`](documents.mjs), before any task is sent |                2 |
| Annotation app selection | ≤ 1 MB, 1–15 pages            | [the annotation app](../01-ground-truth-annotation/app/)  |               64 |

**DocWeaver's limits** are a safety gate. [`documents.mjs`](documents.mjs) checks every
ground-truth document before any task is created, and `preflight` lists any problem:

```js
// documents.mjs: loadDocuments()
if (bytes > TASK_UPLOAD_CONSTRAINTS.MAX_FILE_SIZE_BYTES)
  problems.push(`${doc.id}: ${(bytes / 2 ** 20).toFixed(1)} MB exceeds the 30 MB upload limit`);
pages = await countPages(fs.readFileSync(file));
if (pages > TASK_UPLOAD_CONSTRAINTS.MAX_PDF_PAGES) problems.push(`${doc.id}: ${pages} pages exceeds the 50-page limit`);
```

Only two files fail it: one invoice `pdf-lib` cannot read, and one budget over 50 pages.

**The annotation app's limits** keep each document small enough to label by hand. The app
refuses a selection that breaks them:

```ts
// 01-ground-truth-annotation/app/src/lib/constants.ts
export const MAX_PDF_PAGES = 15;
export const MAX_PDF_BYTES = 1_048_576;

// 01-ground-truth-annotation/app/src/lib/selection-validation.ts: validateSelectedPdfMetadata()
if (file.pageCount > MAX_PDF_PAGES) {
  return `${file.path} has ${file.pageCount} pages; maximum is ${MAX_PDF_PAGES} pages per PDF.`;
}
if (file.sizeBytes > MAX_PDF_BYTES) {
  return `${file.path} exceeds the 1 MB file limit.`;
}
```

Together they remove 65 PDFs (the over-50-page budget breaks both). The 1 MB rule alone removed 60, and it hit news articles hardest: **29 of 84** are scanned
newspaper pages over 1 MB. The Missoulian article that was chosen is 929 KB, just under it.

| Category     | PDFs | Within all limits | Over 1 MB | Over 15 pages or unreadable |
| ------------ | ---: | ----------------: | --------: | --------------------------: |
| invoice      |   57 |                54 |         2 |                           1 |
| letter       |  149 |               124 |        23 |                           2 |
| email        |   32 |                31 |         1 |                           0 |
| budget       |   58 |                51 |         5 |                           2 |
| news article |   84 |                55 |        29 |                           0 |

What the five categories look like by page count:

| Category     | PDFs | One page | Median pages |
| ------------ | ---: | -------: | -----------: |
| invoice      |   57 |       40 |            1 |
| letter       |  149 |       57 |            2 |
| email        |   32 |       14 |            2 |
| budget       |   58 |       20 |            2 |
| news article |   84 |       55 |            1 |

The page count is kept for later. The runner checks that DocWeaver returns one result per page,
and a mismatch is flagged as `page-mismatch` (Step 6).

## Filter 2 · Screening

Screening answers one question before anyone spends time labelling: **does DocWeaver process
this document cleanly?** [`screen.mjs`](screen.mjs) does it in three steps.

**1. Pick candidates.** Up to 4 per category that are not already annotated and pass the limits.
The order comes from a hash of the file path, so it is random but the same on every machine:

```js
// screen.mjs
function sampleKey(file) {
  let h = 2166136261;
  for (const ch of file) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
```

**2. Run extraction** on each candidate with its category's five fields, on two setups (Sonnet 4.6
and Qwen3 32B, configured under `screen` in [`config/eval.config.json`](../config/eval.config.json)),
one task at a time.

**3. Give each document a verdict** and list the values each model extracted in `screen.md`:

```js
// screen.mjs: screenSummary()
const verdict = !done.length
  ? "pending"
  : done.every((v) => v.outcome === "completed")
    ? "works"
    : done.some((v) => v.outcome === "completed")
      ? "partly works"
      : "fails";
```

Two rules keep screening honest:

- **The extracted values are a draft, not an answer.** They give the annotator a starting point
  to correct.
- **Screens are never scored.** They are stored in `screens/`, apart from evaluation runs. A
  model's own output must never become the reference it is graded against.

The screen of 31 October planned 20 candidates (4 per category) on the two setups.

## Filter 3 · Choosing for difficulty

A test set made only of easy documents makes every model look good. One made only of hard
documents tells you nothing about the everyday case. So each category got **two documents: one
straightforward, one harder.**

What makes a document hard is mostly its **structure**, not its category:

| Difficulty factor                         | Example in the set                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| more than one page                        | every page-labelling mistake (13 of 13) was on a second or third page     |
| a later page that looks like another type | Richmond invoice page 2 was labelled a letter by four of six setups       |
| poor scan quality                         | Singleton budget: OCR garbled the school name in the title                |
| newspaper pages                           | Missoulian article: its second page was given four different wrong labels |
| handwriting                               | Consumer Alert: a handwritten date that may not be the publication date   |
| a total hidden among subtotals            | Singleton budget: models picked a subtotal instead of the total           |

### Did it work? What the results say

We expected invoices to be easy and news articles to be the hardest.
[`difficulty.py`](difficulty.py) checks that expectation against the verified scores of all six
setups:

```bash
npm run difficulty
```

| Category (easiest first) | Summary | Page labels | Extraction |   Overall |
| ------------------------ | ------: | ----------: | ---------: | --------: |
| email                    |   95.9% |       95.8% |      98.4% |     96.7% |
| budget                   |   94.5% |        100% |      83.4% |     92.6% |
| invoice                  |   96.5% |       77.8% |      92.6% |     89.0% |
| letter                   |   96.4% |       83.3% |      78.8% |     86.2% |
| **news article**         |   86.7% |       72.2% |      77.0% | **78.6%** |

- **News articles are the hardest**, as expected: lowest on every job.
- **Invoices were only partly easy.** The one-page Sprout invoice scored 99.1%, one of the easiest
  documents in the set. The two-page Richmond invoice scored 81.9%, almost entirely because of
  its second page. The category average hides that split.
- **Emails turned out to be the easiest category**, which we did not predict.

By document, the easy/harder pairs show up clearly in four of the five categories:

| Category     | Easier document                | Overall | Harder document                 | Overall |
| ------------ | ------------------------------ | ------: | ------------------------------- | ------: |
| budget       | Encore budget (1 page)         |   99.6% | Singleton budget (3 pages)      |   85.7% |
| invoice      | Sprout invoice (1 page)        |   99.1% | Richmond invoice (2 pages)      |   81.9% |
| news article | Consumer Alert (1 page)        |   95.8% | Missoulian article (2 pages)    |   66.9% |
| letter       | Gov. McAuliffe letter (1 page) |   92.4% | Oxnard mayor's letter (2 pages) |   82.7% |
| email        | Kloor email (1 page)           |   98.0% | Forbes email (3 pages)          |   96.2% |

**The takeaway:** when you pick test documents, sort by structure (page count, scan quality,
layout), not only by category. "Invoice" covers both the easiest and one of the harder documents
in this set.

## Try it

```bash
npm run preflight                              # filter 1 on the final reference
node bin/llmjudge.mjs screen --dry-run         # filter 2: list the candidates; needs the full corpus
node bin/llmjudge.mjs screen                   # live screen → screens/<id>/screen.md
npm run difficulty                             # the difficulty tables above, from the evidence
```

Screening needs the full corpus, not just the 10 PDFs in `data/`: download it from the v1
release and point `dataDir` at it.

| File                             | What it does                                           |
| -------------------------------- | ------------------------------------------------------ |
| [`documents.mjs`](documents.mjs) | checks each ground-truth PDF against the upload limits |
| [`screen.mjs`](screen.mjs)       | picks candidates, runs the screen, writes the verdicts |
| [`difficulty.py`](difficulty.py) | ranks categories and documents by verified score       |

**Next:** [Step 3 · Running pipelines](../03-running-pipelines/)
