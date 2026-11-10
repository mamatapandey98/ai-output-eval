# Step 3 · Running pipelines

> **Why this step exists:** to compare model setups fairly, every setup has to process exactly
> the same documents with exactly the same instructions, and the run has to be safe against a
> shared, live system.

## What a "variant" is

A **variant** is one model setup: an OCR engine that reads the PDF and an LLM that does the job.
They are listed in [`config/variants.json`](../config/variants.json) (Textract) and
[`config/vlm-sonnet-4-6.variants.json`](../config/vlm-sonnet-4-6.variants.json) (vision):

| Variant                    | Reads the PDF with             | LLM (via AWS Bedrock) |
| -------------------------- | ------------------------------ | --------------------- |
| `textract-sonnet-4-6`      | AWS Textract                   | Claude Sonnet 4.6     |
| `textract-sonnet-4-5`      | AWS Textract                   | Claude Sonnet 4.5     |
| `textract-haiku-4-5`       | AWS Textract                   | Claude Haiku 4.5      |
| `textract-qwen3-32b`       | AWS Textract                   | Qwen3 32B             |
| `textract-llama4-maverick` | AWS Textract                   | Llama 4 Maverick      |
| `vlm-sonnet-4-6`           | Qwen3 VL 235B (a vision model) | Claude Sonnet 4.6     |

The vision variant keeps the LLM the same as `textract-sonnet-4-6` and changes only how the PDF
is read. That makes it a controlled comparison: any difference comes from the OCR step.

The vision setup was run only for the best Textract LLM, because vision is slower and costs more
per task. The flowchart is in the [main README](../README.md#how-the-six-setups-were-run).

## The run matrix

```text
10 documents × 5 Textract variants × 3 jobs = 150 tasks
10 documents × 1 vision variant    × 3 jobs =  30 tasks
                                              ─────────
                                              180 tasks
```

[`runner.mjs`](runner.mjs) builds the matrix (`buildMatrix`), ordered by job with summaries
first. A document only gets the jobs it has a reference for. Each finished task is saved as
one file, `runs/<runId>/raw/<document>__<variant>__<job>.json`, so a rerun skips what is
already done.

## What one task looks like

[`docweaver/tasks.mjs`](docweaver/tasks.mjs) drives a task through the same calls the DocWeaver
web app makes:

```text
POST /tasks/                      create the task (named test-<DocumentCloud number>)
POST /tasks/{id}/presigned-url    get an upload URL
PUT  <presigned url>              upload the PDF
POST /tasks/{id}/document-confirm
PUT  /tasks/{id}/configuration    task type + json_schema built from the ground truth
POST /tasks/{id}/execute
GET  /tasks/{id}                  poll until completed or failed
GET  /tasks/{id}/results          the per-page output
DELETE /tasks/{id}                clean up
```

[`jobs.mjs`](jobs.mjs) defines what each job is asked for and how its answer is read back:

| Job            | `json_schema` sent                                    | Result per page                   |
| -------------- | ----------------------------------------------------- | --------------------------------- |
| extraction     | the category's fields `[{ name, type, description }]` | `{ pg_no, <field_key>: value }`   |
| classification | `[{ category: "document_type", fields: [labels] }]`   | `{ pg_no, document_type: label }` |
| summarization  | `[]`                                                  | `{ pg_no, generation_response }`  |

One detail worth knowing: DocWeaver turns a field name into a key in a way that is not
one-to-one. `Vendor / Seller Name` came back as `vendor__seller_name`. Keys are therefore matched
on their letters and digits only (`compactKey`).

The supporting files:

| File                                                 | Role                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| [`docweaver/contract.mjs`](docweaver/contract.mjs)   | every endpoint, task state and upload limit, in one place                |
| [`docweaver/client.mjs`](docweaver/client.mjs)       | login session, CSRF header, token refresh, timeouts, and careful retries |
| [`docweaver/pipelines.mjs`](docweaver/pipelines.mjs) | finds or creates one pipeline per variant, named `llmjudge-<variant>`    |
| [`docweaver/tasks.mjs`](docweaver/tasks.mjs)         | the task lifecycle above                                                 |
| [`jobs.mjs`](jobs.mjs)                               | `json_schema` per job, and reading results back                          |
| [`runner.mjs`](runner.mjs)                           | the document × variant × job matrix, resume logic                        |
| [`guarded.mjs`](guarded.mjs)                         | the shared core of the guarded runners, described below                  |

Retries are deliberately asymmetric. A `GET` or `DELETE` can safely be retried. A `POST` or
`PUT` that may have reached the server is **not** retried, because it may already have created
a task. A request that provably never left the machine (DNS failure, connection refused) is safe
to retry for any method:

```js
// docweaver/client.mjs
if (!(IDEMPOTENT.has(method) || wasNotSent(error)) || retry >= RETRY_DELAYS_MS.length) throw error;
// …
const retryable = response.status === 429 || (response.status >= 500 && IDEMPOTENT.has(method));
```

## Why the final runs used a guarded runner

The first attempt sent the whole matrix (15 documents, 10 variants) to staging. Tasks failed or
stayed "processing" past the 30-minute timeout, and a shared staging server is not the place to
find out by trial. The final evaluation was therefore run with **guarded runners**:
[`bin/llmjudge-guarded.mjs`](../bin/llmjudge-guarded.mjs) for the Textract variants, one job per
run, and [`bin/llmjudge-vlm-30.mjs`](../bin/llmjudge-vlm-30.mjs) for the 30 vision tasks.

| Rule                                           | Why                                                           |
| ---------------------------------------------- | ------------------------------------------------------------- |
| offline by default; `--live` required          | printing the exact plan first costs nothing                   |
| exactly one task at a time, with a lock file   | two processes can never submit together                       |
| 20 s rest after each task                      | leaves room for other users of staging                        |
| no retries; each API request times out at 10 s | an uncertain request is never repeated blindly                |
| stop on `queued` or an unknown status          | a queue means the system is busy; do not add to it            |
| stop if a task is still running at 60 s        | something is wrong; a person should look before continuing    |
| progress saved before each submission          | a crash can never silently resubmit a task                    |
| output shape checked before moving on          | e.g. one valid label per PDF page; wrong output halts the run |
| fixed plan: 10 documents, 5 variants, 17 pages | if the inputs drift, the runner refuses to start              |

The heart of the guarded runner is a small watchdog, called on every poll. Anything other than
"still processing, and not slow yet" or "finished" stops the run:

```js
// guarded.mjs
export function watchdogAction(status, elapsedMs) {
  if (status === "queued") return "stop_queued";
  if (status === "processing" && elapsedMs >= SLOW_LIMIT_MS) return "stop_slow";
  if (!status || !["processing", ...TERMINAL].includes(status)) return "stop_unknown";
  return TERMINAL.has(status) ? "terminal" : "continue";
}
```

Three summary tasks had already completed in an earlier run. The guarded summary plan verifies
those records ([`07-results/runs`](../07-results/runs/)) and skips them, which is why it has
47 tasks instead of 50.

## Try it

```bash
npm run run:guarded                              # offline: the 47-task summary plan
npm run run:guarded -- --job classification      # offline: the 50-task classification plan
npm run run:guarded -- --self-test               # offline safety checks
node bin/llmjudge-vlm-30.mjs                     # offline: the 30-task vision plan
npm run run -- --dry-run                         # the general runner's plan

npm run run:guarded -- --live                    # live: needs DW_EMAIL / DW_PASSWORD
npm run status:guarded -- --run-id <id> --watch  # read-only progress from local files
npm run cleanup                                  # delete tasks left on staging once they finish
```

**Next:** [Step 4 · Deterministic scoring](../04-deterministic-scoring/)
