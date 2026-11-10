# Extraction review-adjusted comparison

This is a separate Luna adjudication view. The original lexical report and score artifacts remain unchanged. For eligible fields, only pairs explicitly marked semantically equivalent in the adjudication ledger receive a manual full-match value. Partials and confirmed errors keep their automatic confidence. The same four ambiguous document-fields are excluded for every model.

## Per-model comparison

| Variant | Automated mean on same eligible fields | Review-adjusted mean | Manual full-match overrides | Eligible fields |
|---|---:|---:|---:|---:|
| textract-sonnet-4-6 | 0.810 | 0.876 | 4 | 46/50 |
| textract-sonnet-4-5 | 0.831 | 0.874 | 3 | 46/50 |
| textract-haiku-4-5 | 0.808 | 0.852 | 3 | 46/50 |
| textract-llama4-maverick | 0.796 | 0.839 | 3 | 46/50 |
| textract-qwen3-32b | 0.773 | 0.802 | 2 | 46/50 |

## Coverage and exclusions

| Document | Field excluded from every model | Reason |
|---|---|---|
| invoice-20694747-invoice | Vendor / Seller Name | The candidate names Richmond Police Department Central Records Unit, which the PDF gives as the remittance recipient; the document header identifies the City of Richmond Police Department. Entity overlaps, but seller versus remit-to unit is ambiguous. |
| letter-1004917-mayors-letter | Subject / Reference | PDF page 1 has “AGENDA ITEM NO. M-1” but no distinct subject line; page 2 has a different budgeting heading. The target mixes an agenda reference with inferred topic, so candidate subject paraphrases cannot be fairly graded against one unique value. |
| letter-1009064-letter-from-gov-terry-mcauliffe | Subject / Reference | The scanned letter has no printed subject line; its text discusses a dual-naming request and legislation. The reference is an inferred topic, so an empty subject and paraphrased topic are not directly comparable. |
| news-article-3903433-consumer-alert-newspaper | Publication Date | The PDF has a handwritten “4-29-89” beside the article, not a printed issue date. It may be clipping metadata, so neither the empty reference nor assigning it as publication date is certain. |

Each model has 46 eligible extraction fields out of 50: 46/50. Four fields (20 model-field cells) are excluded uniformly. Semantic overrides are limited to 15 explicitly reviewed equivalent predictions; all other eligible field scores remain automatic.

## Limits

These review-adjusted means reflect Luna’s manual comparison of the saved outputs with the reference and source evidence. They are not the original deterministic confidence scores, a paid model judgment, or a claim that every partial is a factual error. The automated report remains the reproducible baseline. Full per-field hashes, original values, override reasons, and evidence are in the JSON and CSV ledgers.
