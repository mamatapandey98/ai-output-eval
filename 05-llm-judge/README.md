# Step 5 · LLM judge (summaries)

> **Why this step exists:** two good summaries of the same document can share almost no words.
> Word overlap cannot tell a faithful paraphrase from a wrong summary, so free text is scored
> by an LLM, with a fixed rubric that makes it behave like a careful, consistent marker.

## The setup

For each summary the judge receives:

1. the **rubric** (system prompt), the same for every request;
2. the **reference summary**, written during annotation (Step 1);
3. the **candidate summary**, produced by one model setup.

It returns **four numbers and nothing else**:

| Criterion   | Weight | 10 means                                     | Hard rule                             |
| ----------- | -----: | -------------------------------------------- | ------------------------------------- |
| coverage    |    0.4 | all material points of the reference present | missing a central fact caps it at 3   |
| accuracy    |    0.4 | names, numbers, dates, relationships agree   | a material contradiction caps it at 2 |
| clarity     |    0.1 | easy to follow, internally consistent        |                                       |
| conciseness |    0.1 | complete without padding or repetition       |                                       |

The **overall score** (out of 10) is the weighted mean, calculated **in code**
(`overallScore` in [`rubric.mjs`](rubric.mjs)), not by the judge. It is reported as a percentage.

```js
// rubric.mjs: the judge's reply must be exactly four numbers from 0 to 10
const extra = Object.keys(verdict).filter((key) => !allowed.has(key));
if (extra.length) throw new Error(`unexpected key(s): ${extra.join(", ")}`);

// the weighted overall is calculated here, not by the judge
total += verdict[c] * weights[c]; // coverage 0.4, accuracy 0.4, clarity 0.1, conciseness 0.1
```

Worked example: coverage 9, accuracy 10, clarity 9, conciseness 8 gives
`0.4·9 + 0.4·10 + 0.1·9 + 0.1·8 = 9.3`, reported as 93%.

### Why Gemini, not Claude

Four of the six setups use a Claude model (Sonnet 4.6, Sonnet 4.5, Haiku 4.5, and Sonnet 4.6
with vision). A Claude judge might well be the stronger judge, but LLM judges tend to score
output from their own model family a little higher. A Gemini judge has no stake in any of the
candidates, so the ranking between Claude and non-Claude setups stays fair.

### Which model actually answered

For the results, the judge was configured as **`gemini-3.5-flash`** with high thinking effort.
The API actually served every request with **`gemini-3.6-flash`**. Each score record keeps
both the requested and the served model, which is how we know, and which is why the workbook
names 3.6. Always record the served model: a provider can change what answers you. A Claude
judge is still supported, for evaluations where no candidate is a Claude model: set `judge.provider` to `"anthropic"` in
[`config/eval.config.json`](../config/eval.config.json).

## Design decisions, and why

| Decision                                                        | Reason                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Blind judging**: no model or variant name in the prompt       | Three of the candidates are Claude models; a judge must not be able to recognise, and favour, a label                     |
| **A judge from a different model family** than most candidates  | Reduces the risk of a model preferring its own family's writing style                                                     |
| **Anchored scale**: what 10, 8, 5, 2 and 0 mean, per criterion  | Without anchors, scores drift between requests                                                                            |
| **Caps for material errors**                                    | A fluent summary with the wrong total is a bad summary; the caps keep good writing from hiding that                       |
| **Paraphrase is a full match; page structure is not penalised** | DocWeaver summarises page by page while the reference is one paragraph; that difference is not an error                   |
| **Score-only JSON, schema-enforced**                            | Structured output with exactly four numeric keys; anything else is rejected by `validateVerdict` and recorded as an error |
| **Weights applied in code**                                     | The judge cannot do the arithmetic wrong, and weights can change without re-judging                                       |
| **Reference first in the request**                              | The rubric and reference are shared by all variants of a document, so they can be reused from the prompt cache            |
| **Rubric version saved with every score**                       | Changing the rubric (`RUBRIC_VERSION`, now `summary-reference-v4`) makes old scores stale, so they are judged again       |
| **One request at a time, no automatic retry for Gemini**        | A failed request may still have been billed; it is saved as an error and only retried when someone runs `score` again     |

Without the source PDF the reference is incomplete evidence, so the judge is told that a fact
missing from the reference is not automatically false. Setting `judge.includeSourcePdf: true`
attaches the PDF so the judge can check such facts itself.

## The files

| File                       | Role                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| [`rubric.mjs`](rubric.mjs) | the full prompt, the output schema, verdict validation, the weighted overall          |
| [`judge.mjs`](judge.mjs)   | builds one request per summary, picks the provider, turns a reply into a score record |
| [`gemini.mjs`](gemini.mjs) | the Gemini `generateContent` REST call                                                |

The rubric in [`rubric.mjs`](rubric.mjs) is the most important file in this step: read the prompt
itself, not only this summary of it.

## Try it

```bash
npm run score     # judges every completed summary of the latest run; needs GEMINI_API_KEY
```

**Next:** [Step 6 · Reporting](../06-reporting/)
