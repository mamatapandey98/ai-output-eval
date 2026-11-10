# Annotation app

A local Next.js app for writing the ground truth: choose the PDFs, label every page, fill in the
fields, and write the summary. How it fits into the evaluation is explained in
[Step 1](../README.md).

## Run it

Requirements: Node.js 22.15 or later (the same as the rest of the repo) and Poppler for page counts and
page images (`brew install poppler` on macOS, `apt install poppler-utils` on Debian/Ubuntu).

```bash
npm install
npm run load-reference   # optional: start from the final reference used for scoring
npm run dev              # http://localhost:3000
```

| Setting               | Default                       | What it is                                  |
| --------------------- | ----------------------------- | ------------------------------------------- |
| `ANNOTATION_DATA_DIR` | `../../data`                  | the PDF folder, one sub-folder per category |
| `ANNOTATION_FILE`     | `workspace/ground_truth.json` | the working annotation file (git-ignored)   |

The repo ships only the 10 evaluated PDFs, so **Choose PDFs** lists those. To pick from the
full corpus, extract the release archive and set `ANNOTATION_DATA_DIR` to it.

Other commands: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`.

## Selection rules

The rules live in [`src/lib/constants.ts`](src/lib/constants.ts) and are checked both in the
browser and by the server before a selection is saved:

- exactly **2 PDFs** in each of the **5 categories**;
- each PDF **1 MB or smaller** and **1–15 pages**.

## Code layout

| File                                                                     | What it does                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [`src/app/page.tsx`](src/app/page.tsx)                                   | the whole interface: document list, page viewer, forms      |
| [`src/app/api/categories/route.ts`](src/app/api/categories/route.ts)     | lists the category folders and their PDFs                   |
| [`src/app/api/pdf/route.ts`](src/app/api/pdf/route.ts)                   | serves a PDF, its page count, or one page as an image       |
| [`src/app/api/ground-truth/route.ts`](src/app/api/ground-truth/route.ts) | loads, validates and saves annotations; JSON and CSV export |
| [`src/lib/files.ts`](src/lib/files.ts)                                   | data paths, path safety, page counts                        |
| [`src/lib/constants.ts`](src/lib/constants.ts)                           | categories, fields per category, page labels, limits        |
| [`src/lib/selection-validation.ts`](src/lib/selection-validation.ts)     | the size and page limits                                    |
| [`src/lib/document-segments.ts`](src/lib/document-segments.ts)           | checks page ranges (no gaps, no overlaps)                   |
| [`scripts/load-final-reference.mjs`](scripts/load-final-reference.mjs)   | loads `../data/final-reference.json` into the workspace     |

## Exports

- **Export JSON**: the whole workspace, plus a `meta` block (`schemaVersion`
  `groundtruth.docweaver.page-v1`, counts). This is the file the evaluation reads.
- **CSV**: one row per document, with page-level data as JSON columns.
- **Export JSONL**: the selected PDF's current tab as one line per page, in the same shape
  DocWeaver returns:
  - classification: `{ "pg_no": 1, "document_type": "Invoice" }`
  - extraction: `{ "pg_no": 1, "invoice_number": "1102092", … }`
  - summary: `{ "pg_no": 1, "generation_response": "…" }`

Page-level extraction keys are snake_case. `pg_no`, `document_type` and `generation_response`
are reserved.
