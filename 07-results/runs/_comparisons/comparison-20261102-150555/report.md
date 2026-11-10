# Pipeline variant evaluation — comparison-20261102-150555

embeddings Xenova/all-MiniLM-L6-v2 · judge gemini-3.5-flash

10 documents × 5 variants · extraction, classification, summarization = 150 tasks; 150 recorded, 150 completed, 145 scored. 71 outliers flagged (3 high).

## Leaderboard

Scores are 0–1. Each job's effective score counts failed or unscored tasks as 0, so a variant cannot rank well by failing; composite is the mean of the job scores.

| # | Variant | Composite | Extraction | Classification | Summarization | Failed | Median s | p90 s |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| – | textract-llama4-maverick | – | 0.76 | 0.90 | – | 0/30 | 5.0 | 7.3 |
| – | textract-haiku-4-5 | – | 0.78 | 0.85 | – | 0/30 | 5.1 | 7.3 |
| – | textract-qwen3-32b | – | 0.74 | 0.82 | – | 0/30 | 5.2 | 7.8 |
| – | textract-sonnet-4-6 | – | 0.78 | 0.95 | – | 0/30 | 7.2 | 9.9 |
| – | textract-sonnet-4-5 | – | 0.81 | 0.90 | – | 0/30 | 10.7 | 14.0 |

## Outliers (71)

| Severity | Kind | Job | Document | Variant | Detail |
|---|---|---|---|---|---|
| high | low-score | classification | letter-1004917-mayors-letter | textract-haiku-4-5 | 0.5 vs document median 1 |
| high | low-score | classification | letter-1004917-mayors-letter | textract-qwen3-32b | 0.5 vs document median 1 |
| high | low-score | classification | email-3892423-re-your-forbes-article | textract-qwen3-32b | 0.667 vs document median 1 |
| medium | hallucinated-field | extraction | news-article-3903433-consumer-alert-newspaper | textract-haiku-4-5 | Publication Date="4-29-89" |
| medium | hallucinated-field | extraction | invoice-20694747-invoice | textract-haiku-4-5 | Invoice Date="04-30-2021" |
| medium | hallucinated-field | extraction | news-article-3903433-consumer-alert-newspaper | textract-llama4-maverick | Publication Date="4-29-89" |
| medium | hallucinated-field | extraction | news-article-3903433-consumer-alert-newspaper | textract-qwen3-32b | Publication Date="4-29-89" |
| medium | hallucinated-field | extraction | invoice-20694747-invoice | textract-qwen3-32b | Invoice Date="04-30-2021" |
| medium | hallucinated-field | extraction | news-article-3903433-consumer-alert-newspaper | textract-sonnet-4-5 | Publication Date="4-29-89" |
| medium | hallucinated-field | extraction | invoice-20694747-invoice | textract-sonnet-4-5 | Invoice Date="04-30-2021" |
| medium | hallucinated-field | extraction | news-article-3903433-consumer-alert-newspaper | textract-sonnet-4-6 | Publication Date="4-29-89" |
| medium | hallucinated-field | extraction | invoice-20694747-invoice | textract-sonnet-4-6 | Invoice Date="04-30-2021" |
| medium | judge-fallback | summarization | invoice-5978221-sprout-invoice | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165158-encore-budget-fy15 | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165040-singleton-budget | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-3903433-consumer-alert-newspaper | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1009064-letter-from-gov-terry-mcauliffe | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1004917-mayors-letter | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3862260-kloor-on-nature-article | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3892423-re-your-forbes-article | textract-haiku-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | invoice-5978221-sprout-invoice | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165158-encore-budget-fy15 | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165040-singleton-budget | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-3903433-consumer-alert-newspaper | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1009064-letter-from-gov-terry-mcauliffe | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1004917-mayors-letter | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3862260-kloor-on-nature-article | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3892423-re-your-forbes-article | textract-llama4-maverick | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | invoice-5978221-sprout-invoice | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165158-encore-budget-fy15 | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165040-singleton-budget | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-3903433-consumer-alert-newspaper | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1009064-letter-from-gov-terry-mcauliffe | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1004917-mayors-letter | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3862260-kloor-on-nature-article | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3892423-re-your-forbes-article | textract-qwen3-32b | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | invoice-5978221-sprout-invoice | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165158-encore-budget-fy15 | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165040-singleton-budget | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-3903433-consumer-alert-newspaper | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1009064-letter-from-gov-terry-mcauliffe | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1004917-mayors-letter | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3862260-kloor-on-nature-article | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3892423-re-your-forbes-article | textract-sonnet-4-5 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | invoice-5978221-sprout-invoice | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165158-encore-budget-fy15 | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | budget-1165040-singleton-budget | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-3903433-consumer-alert-newspaper | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1009064-letter-from-gov-terry-mcauliffe | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | letter-1004917-mayors-letter | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3862260-kloor-on-nature-article | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | judge-fallback | summarization | email-3892423-re-your-forbes-article | textract-sonnet-4-6 | judged by gemini-3.6-flash instead of gemini-3.5-flash |
| medium | slow | summarization | invoice-5978221-sprout-invoice | textract-haiku-4-5 | 12.7 s vs fence 10.7 s for this variant and job |
| medium | slow | extraction | news-article-2071912-conservative-groups-push-development-missoulan | textract-haiku-4-5 | 8.7 s vs fence 8.4 s for this variant and job |
| medium | slow | classification | news-article-2071912-conservative-groups-push-development-missoulan | textract-llama4-maverick | 8.5 s vs fence 7.8 s for this variant and job |
| medium | slow | classification | news-article-2071912-conservative-groups-push-development-missoulan | textract-qwen3-32b | 10 s vs fence 8.3 s for this variant and job |
| medium | slow | extraction | news-article-2071912-conservative-groups-push-development-missoulan | textract-qwen3-32b | 8.6 s vs fence 7.2 s for this variant and job |
| medium | slow | summarization | budget-1165040-singleton-budget | textract-sonnet-4-5 | 18.3 s vs fence 17.7 s for this variant and job |
| medium | slow | classification | news-article-2071912-conservative-groups-push-development-missoulan | textract-sonnet-4-5 | 14.3 s vs fence 12.8 s for this variant and job |
| medium | terse | summarization | invoice-5978221-sprout-invoice | textract-llama4-maverick | 132 chars vs document median 341 (robust z -3.44) |
| medium | terse | summarization | budget-1165158-encore-budget-fy15 | textract-llama4-maverick | 369 chars vs document median 606 (robust z -3.55) |
| medium | terse | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-llama4-maverick | 184 chars vs document median 634 (robust z -17.85) |
| medium | verbose | summarization | budget-1165158-encore-budget-fy15 | textract-sonnet-4-5 | 835 chars vs document median 606 (robust z 3.43) |
| medium | verbose | summarization | budget-1165040-singleton-budget | textract-sonnet-4-5 | 2461 chars vs document median 1262 (robust z 31.1) |
| medium | verbose | summarization | news-article-2071912-conservative-groups-push-development-missoulan | textract-sonnet-4-5 | 785 chars vs document median 634 (robust z 5.99) |
| medium | verbose | summarization | budget-1165040-singleton-budget | textract-sonnet-4-6 | 1987 chars vs document median 1262 (robust z 18.81) |

## Extraction

Extraction uses field-aware exact checks and lexical overlap by default; optional cached embeddings add semantic similarity. Classification labels are exact after normalization. Page macro-F1 is included when page annotations exist.

| Variant | Effective | Mean (scored) | Match rate | Missing page values | Missing | Hallucinated | Scored |
|---|---:|---:|---:|---:|---:|---:|---:|
| textract-llama4-maverick | 0.76 | 0.76 | 0.66 | 2 | 2 | 1 | 10/10 |
| textract-haiku-4-5 | 0.78 | 0.78 | 0.70 | 2 | 2 | 2 | 10/10 |
| textract-qwen3-32b | 0.74 | 0.74 | 0.62 | 1 | 1 | 2 | 10/10 |
| textract-sonnet-4-6 | 0.78 | 0.78 | 0.70 | 1 | 1 | 2 | 10/10 |
| textract-sonnet-4-5 | 0.81 | 0.81 | 0.72 | 1 | 1 | 2 | 10/10 |

### Extraction — confidence by field

| Field | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|
| budget · Fiscal Year / Period | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| budget · Net Balance / Surplus / Deficit | 0.50 | 0.50 | 0.59 | 1.00 | 1.00 |
| budget · Organization / Department Name | 0.57 | 0.58 | 0.58 | 0.58 | 0.58 |
| budget · Total Budget / Revenue | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| budget · Total Expenditure / Costs | 1.00 | 0.59 | 0.65 | 1.00 | 0.66 |
| email · Core Message / Action Item | 0.27 | 0.27 | 0.13 | 0.28 | 0.23 |
| email · Date / Time | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| email · From (Sender) | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| email · Subject | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| email · To (Recipient) | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| invoice · Due Date | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| invoice · Invoice Date | 0.50 | 1.00 | 0.50 | 0.50 | 0.50 |
| invoice · Invoice Number | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| invoice · Total Amount | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| invoice · Vendor / Seller Name | 1.00 | 1.00 | 0.75 | 1.00 | 1.00 |
| letter · Letter Date | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| letter · Main Purpose / Request | 0.39 | 0.46 | 0.52 | 0.38 | 0.35 |
| letter · Recipient Name / Organization | 0.74 | 0.86 | 0.86 | 0.86 | 0.86 |
| letter · Sender Name / Organization | 0.75 | 0.65 | 0.49 | 0.75 | 0.69 |
| letter · Subject / Reference | 0.41 | 0.12 | 0.47 | 0.42 | 0.33 |
| news article · Author / Byline | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| news article · Headline / Title | 1.00 | 0.82 | 0.53 | 1.00 | 1.00 |
| news article · Primary Subject / Topic | 0.47 | 0.08 | 0.46 | 0.39 | 0.38 |
| news article · Publication Date | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| news article · Publication Source / Organization | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

### Extraction — by category

| Category | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|
| budget | 0.81 | 0.73 | 0.76 | 0.92 | 0.85 |
| email | 0.85 | 0.85 | 0.83 | 0.85 | 0.85 |
| invoice | 0.90 | 1.00 | 0.85 | 0.90 | 0.90 |
| letter | 0.66 | 0.62 | 0.67 | 0.68 | 0.65 |
| news article | 0.69 | 0.58 | 0.60 | 0.68 | 0.68 |

### Extraction — by document

| Document | Pages | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|---:|
| invoice-5978221-sprout-invoice | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| budget-1165158-encore-budget-fy15 | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| budget-1165040-singleton-budget | 3 | 0.63 | 0.47 | 0.52 | 0.83 | 0.69 |
| news-article-3903433-consumer-alert-newspaper | 1 | 0.69 | 0.54 | 0.69 | 0.67 | 0.66 |
| news-article-2071912-conservative-groups-push-development-missoulan | 2 | 0.70 | 0.62 | 0.51 | 0.69 | 0.70 |
| invoice-20694747-invoice | 2 | 0.80 | 1.00 | 0.70 | 0.80 | 0.80 |
| letter-1009064-letter-from-gov-terry-mcauliffe | 1 | 0.69 | 0.59 | 0.72 | 0.72 | 0.66 |
| letter-1004917-mayors-letter | 2 | 0.62 | 0.65 | 0.62 | 0.65 | 0.63 |
| email-3862260-kloor-on-nature-article | 1 | 0.86 | 0.86 | 0.80 | 0.87 | 0.85 |
| email-3892423-re-your-forbes-article | 3 | 0.84 | 0.85 | 0.85 | 0.84 | 0.84 |

## Classification

Extraction uses field-aware exact checks and lexical overlap by default; optional cached embeddings add semantic similarity. Classification labels are exact after normalization. Page macro-F1 is included when page annotations exist.

| Variant | Effective | Mean (scored) | Document accuracy | Page accuracy | Page macro-F1 | Missing page labels | Extra predicted pages | Scored |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| textract-llama4-maverick | 0.90 | 0.90 | 1.00 | 0.88 | 0.87 | 0 | 0 | 10/10 |
| textract-haiku-4-5 | 0.85 | 0.85 | 1.00 | 0.82 | 0.80 | 0 | 0 | 10/10 |
| textract-qwen3-32b | 0.82 | 0.82 | 1.00 | 0.77 | 0.76 | 0 | 0 | 10/10 |
| textract-sonnet-4-6 | 0.95 | 0.95 | 1.00 | 0.94 | 0.93 | 0 | 0 | 10/10 |
| textract-sonnet-4-5 | 0.90 | 0.90 | 1.00 | 0.88 | 0.87 | 0 | 0 | 10/10 |

### Classification — confusion matrix

| Ground truth ↓ / predicted → | budget | email | invoice | letter | news article |
|---|---:|---:|---:|---:|---:|
| budget | 10 | · | · | · | · |
| email | · | 10 | · | · | · |
| invoice | · | · | 10 | · | · |
| letter | · | · | · | 10 | · |
| news article | · | · | · | · | 10 |

### Classification — by category

| Category | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|
| budget | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| email | 1.00 | 1.00 | 0.83 | 1.00 | 1.00 |
| invoice | 0.75 | 0.75 | 0.75 | 0.75 | 1.00 |
| letter | 0.75 | 1.00 | 0.75 | 1.00 | 1.00 |
| news article | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 |

### Classification — by document

| Document | Pages | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|---:|
| invoice-5978221-sprout-invoice | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| budget-1165158-encore-budget-fy15 | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| budget-1165040-singleton-budget | 3 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| news-article-3903433-consumer-alert-newspaper | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| news-article-2071912-conservative-groups-push-development-missoulan | 2 | 0.50 | 0.50 | 0.50 | 0.50 | 0.50 |
| invoice-20694747-invoice | 2 | 0.50 | 0.50 | 0.50 | 0.50 | 1.00 |
| letter-1009064-letter-from-gov-terry-mcauliffe | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| letter-1004917-mayors-letter | 2 | 0.50 | 1.00 | 0.50 | 1.00 | 1.00 |
| email-3862260-kloor-on-nature-article | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| email-3892423-re-your-forbes-article | 3 | 1.00 | 1.00 | 0.67 | 1.00 | 1.00 |

## Summarization

LLM judge comparing each summary with the ground-truth summary; four 0–10 criteria, weighted to an out-of-10 score. The cross-job composite uses overall / 10.

| Variant | Effective | Mean (scored) | Overall /10 | Coverage /10 | Accuracy /10 | Clarity /10 | Conciseness /10 | Contradictions | Scored |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| textract-llama4-maverick | – | 0.90 | 8.97 | 8.11 | 9.72 | 9.17 | 9.17 | – | 9/10 |
| textract-haiku-4-5 | – | 0.95 | 9.48 | 9.33 | 9.78 | 9.33 | 9.00 | – | 9/10 |
| textract-qwen3-32b | – | 0.91 | 9.06 | 8.37 | 9.78 | 9.20 | 8.78 | – | 9/10 |
| textract-sonnet-4-6 | – | 0.95 | 9.54 | 9.44 | 9.78 | 9.56 | 8.92 | – | 9/10 |
| textract-sonnet-4-5 | – | 0.94 | 9.43 | 9.20 | 9.83 | 9.50 | 8.67 | – | 9/10 |

### Summarization — by category

| Category | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|
| budget | 0.94 | 0.92 | 0.96 | 0.94 | 0.93 |
| email | 0.97 | 0.95 | 0.91 | 0.98 | 0.98 |
| invoice | 1.00 | 0.92 | 0.93 | 0.99 | 1.00 |
| letter | 1.00 | 0.89 | 0.92 | 0.99 | 0.99 |
| news article | 0.86 | 0.81 | 0.82 | 0.84 | 0.90 |

### Summarization — by document

| Document | Pages | textract-haiku-4-5 | textract-llama4-maverick | textract-qwen3-32b | textract-sonnet-4-5 | textract-sonnet-4-6 |
|---|---:|---:|---:|---:|---:|---:|
| invoice-5978221-sprout-invoice | 1 | 1.00 | 0.92 | 0.93 | 0.99 | 1.00 |
| budget-1165158-encore-budget-fy15 | 1 | 0.99 | 0.98 | 0.98 | 0.98 | 0.99 |
| budget-1165040-singleton-budget | 3 | 0.88 | 0.86 | 0.94 | 0.90 | 0.86 |
| news-article-3903433-consumer-alert-newspaper | 1 | 0.96 | 0.98 | 0.96 | 0.97 | 0.98 |
| news-article-2071912-conservative-groups-push-development-missoulan | 2 | 0.75 | 0.65 | 0.68 | 0.70 | 0.81 |
| invoice-20694747-invoice | 2 | – | – | – | – | – |
| letter-1009064-letter-from-gov-terry-mcauliffe | 1 | 1.00 | 0.80 | 0.87 | 0.99 | 0.99 |
| letter-1004917-mayors-letter | 2 | 0.99 | 0.98 | 0.98 | 0.99 | 0.98 |
| email-3862260-kloor-on-nature-article | 1 | 0.99 | 0.94 | 0.97 | 0.99 | 0.99 |
| email-3892423-re-your-forbes-article | 3 | 0.95 | 0.96 | 0.84 | 0.97 | 0.96 |

Judge: 45 requests · 43846 input, 0 cache-read, 0 cache-write, 35122 output tokens.
