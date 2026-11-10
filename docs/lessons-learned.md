# Lessons learned

What we would tell the next team that has to evaluate AI output. Each lesson links to the step
where it came from.

## About the ground truth

1. **Write the reference answers before you look at any model's output.** Otherwise the
   reference drifts toward whatever the first model said. ([Step 1](../01-ground-truth-annotation/))
2. **Fix the questions per category up front.** Five named fields per category made every
   document comparable and turned straight into the extraction schema.
3. **Record "empty" as an answer.** It is the only way to detect hallucinated values.
4. **Expect the ground truth to change, and version it.** Page-level labels and PDF corrections
   came after the first export. Keeping both files, and recording why fields were excluded,
   kept the history honest.
5. **Validate the reference in code.** A missing field or unknown label should stop
   `preflight`, not a paid run.

## About running

6. **Print the plan before you run it.** The guarded runner prints the exact task plan offline,
   and refuses to start if the document, task or page counts differ from what was expected.
   ([Step 3](../03-running-pipelines/))
7. **Treat a shared system with care.** One task at a time, a rest between tasks, and a hard stop
   on `queued` or slow tasks. The first all-at-once attempt left tasks hanging for 30 minutes.
8. **Never retry a request that may have succeeded.** A retried `POST` can create a second task.
   Save progress _before_ submitting, so a crash cannot resubmit silently.
9. **Change one thing at a time.** The vision variant kept the same LLM as a Textract variant, so
   its difference can be attributed to the OCR step alone.

## About scoring

10. **Use code where the answer is exact, and an LLM only where it is not.** Deterministic scores
    are free, repeatable and explainable. ([Step 4](../04-deterministic-scoring/))
11. **Text similarity is not correctness for numbers.** `$1,250` and `$1,520` look alike to every
    similarity measure, so numeric disagreements need a hard cap.
12. **Normalise format, not meaning.** `12/18/2013` = `Dec 18, 2013` is safe. Deciding that two
    different totals "roughly match" is not.
13. **Keep the LLM judge narrow and predictable.** Blind to model names, an anchored scale, caps for material
    errors, score-only JSON, and weights applied in code. ([Step 5](../05-llm-judge/))
14. **Record the model that actually answered, not just the one you asked for.** We requested
    `gemini-3.5-flash` and were served `gemini-3.6-flash`.
15. **Version the rubric and the scoring rules.** A changed rule must invalidate old scores
    automatically.

## About conclusions

16. **Check the scoring before trusting the scores.** A review of 175 below-full extraction cases found that 92 were
    scoring or reference problems; only 23 were confirmed model errors.
    ([Step 4](../04-deterministic-scoring/#checking-the-scoring-itself))
17. **Compare models within a document.** Documents differ in difficulty far more than models
    do. ([Step 6](../06-reporting/))
18. **When every model is "wrong" in the same way, suspect the reference.**
19. **Count failures as zero.** Otherwise a model ranks well by failing on the hard documents.
20. **State the limits next to the result.** Ten documents rank clearly different setups; they
    do not separate setups within a point or two. ([Step 7](../07-results/))
21. **A stakeholder document must not quietly disagree with its evidence.** The workbook builder
    refuses to build when its numbers do not match the verified source.
