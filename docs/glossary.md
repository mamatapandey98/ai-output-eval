# Glossary

| Term                   | Meaning here                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Annotation**         | One document's hand-written reference answers: field values, a summary and a category, written in the annotation app                             |
| **Category schema**    | The fixed list of extraction fields for a document category, e.g. five fields for every invoice                                                  |
| **Candidate**          | A model's output being scored, as opposed to the reference                                                                                       |
| **Composite**          | A variant's mean score across the three jobs on a 0–1 scale; failed tasks count as 0                                                             |
| **Confidence**         | The 0–1 similarity of an extracted value to its reference ([Step 4](../04-deterministic-scoring/))                                               |
| **DocWeaver**          | The document-processing app being evaluated: OCR plus an LLM, run as "tasks" on "pipelines"                                                      |
| **Ground truth**       | The set of reference answers every output is scored against ([Step 1](../01-ground-truth-annotation/))                                           |
| **Guarded runner**     | The safety-first way of running tasks: offline by default, one at a time, no blind retries ([Step 3](../03-running-pipelines/))                  |
| **Hallucinated field** | A value returned for a field whose reference is empty                                                                                            |
| **Job**                | One of the three things DocWeaver does: extraction, classification or summarization                                                              |
| **LLM judge**          | An LLM that scores summaries against the reference with a fixed rubric ([Step 5](../05-llm-judge/))                                              |
| **Macro-F1**           | The F1 score averaged over categories, so rare categories count as much as common ones                                                           |
| **OCR**                | Optical character recognition: turning a PDF page into text. Here AWS Textract, or a vision model                                                |
| **Outlier flag**       | A result marked for a person to review, e.g. `low-score` or `check-ground-truth` ([Step 6](../06-reporting/))                                    |
| **Pipeline**           | A DocWeaver configuration of one OCR engine and one LLM; one is created per variant                                                              |
| **Preflight**          | The offline check of config, ground truth and PDFs that runs before anything is sent                                                             |
| **Reference**          | The ground-truth answer for one document and job                                                                                                 |
| **Robust z-score**     | How far a value is from the median, measured in MADs (median absolute deviation); unlike a plain z-score, one extreme value cannot hide the rest |
| **Rubric**             | The judge's instructions: criteria, weights, anchored scores and hard caps                                                                       |
| **Run**                | One execution of a task plan, stored under `runs/<runId>/` with a manifest, raw outputs and scores                                               |
| **Screening**          | Trying candidate documents before annotating them ([Step 2](../02-document-screening/))                                                          |
| **Served model**       | The model that actually answered a request, which can differ from the requested one                                                              |
| **Task**               | One document × one variant × one job on DocWeaver                                                                                                |
| **Textract**           | AWS's OCR service, used by five of the six variants                                                                                              |
| **Variant**            | One model setup being compared: an OCR engine plus an LLM                                                                                        |
| **VLM**                | Vision-language model: reads the page image directly instead of OCR text                                                                         |
