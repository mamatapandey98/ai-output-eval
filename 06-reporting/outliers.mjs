/**
 * Outlier rules. Each returns flags of the shape
 *   { kind, severity: "high" | "medium", job?, documentId?, variantId?, value?, detail }
 *
 * Cross-variant comparisons are made within one (document, job), because documents differ in
 * difficulty far more than variants do: a low score on a hard scan is normal, a variant scoring
 * far below its peers on the same document is not.
 */
import { median, quantile, robustZ, round } from "./stats.mjs";

const flag = (kind, severity, r, detail, value) => ({
  kind,
  severity,
  job: r.job,
  documentId: r.documentId,
  variantId: r.variantId,
  ...(value !== undefined && { value }),
  detail,
});

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/** DocWeaver did not complete the task, it returned nothing, or it could not be scored. */
export function runFailures(rows) {
  const flags = [];
  for (const r of rows) {
    if (r.outcome !== "completed") {
      const why = r.failedRemarks ?? r.error;
      flags.push(flag("run-failed", "high", r, `DocWeaver ${r.outcome}${why ? `: ${why}` : ""}`));
    } else if (r.resultPages === 0) {
      flags.push(flag("empty-output", "high", r, "task completed with no result pages"));
    } else if (r.scoreStatus === "error") {
      flags.push(flag("score-error", "medium", r, r.scoreReason));
    } else if (r.scoreStatus === "missing") {
      flags.push(flag("not-scored", "medium", r, "no score yet — run `score`"));
    }
  }
  return flags;
}

/** A variant scores far below the other variants on the same document and job. */
export function lowScoreWithinDocument(rows, { robustZ: zLimit, minScoreGap }) {
  const flags = [];
  const scored = rows.filter((r) => r.score !== null);
  for (const group of groupBy(scored, (r) => `${r.job}|${r.documentId}`).values()) {
    if (group.length < 3) continue;
    const scores = group.map((r) => r.score);
    const mid = median(scores);
    for (const r of group) {
      const z = robustZ(r.score, scores);
      // Need a meaningful gap and statistical extremity (z, when the peers' scores have spread).
      if (mid - r.score >= minScoreGap && (z === null || z <= -zLimit)) {
        flags.push(
          flag(
            "low-score",
            "high",
            r,
            `${r.score} vs document median ${round(mid, 3)}${z === null ? "" : ` (robust z ${round(z)})`}`,
            r.score,
          ),
        );
      }
    }
  }
  return flags;
}

/**
 * A wrong label is an outlier when most variants got the document right. When most got it
 * wrong, the ground-truth label itself may be at fault: one flag for the document instead.
 */
export function classificationOutliers(rows) {
  const flags = [];
  const scored = rows.filter((r) => r.job === "classification" && r.detail);
  for (const group of groupBy(scored, (r) => r.documentId).values()) {
    const wrong = group.filter((r) => !r.detail.correct);
    if (!wrong.length) continue;
    if (wrong.length * 2 < group.length) {
      for (const r of wrong) {
        flags.push(
          flag(
            "misclassified",
            "high",
            r,
            `predicted "${r.detail.predicted ?? "(none)"}", ground truth "${r.detail.expected}"`,
          ),
        );
      }
    } else {
      const predictions = [...groupBy(wrong, (r) => r.detail.predicted ?? "(none)")]
        .map(([label, rs]) => `"${label}" ×${rs.length}`)
        .join(", ");
      flags.push({
        kind: "check-ground-truth",
        severity: "medium",
        job: "classification",
        documentId: group[0].documentId,
        detail: `${wrong.length}/${group.length} variants disagree with "${group[0].detail.expected}": ${predictions}`,
      });
    }
  }
  return flags;
}

/** Extraction returned a value for a field the ground truth leaves empty. */
export function hallucinatedFields(rows) {
  return rows
    .filter((r) => r.job === "extraction" && r.detail?.counts.hallucinated > 0)
    .map((r) => {
      const names = r.detail.fields
        .filter((f) => f.verdict === "hallucinated")
        .map((f) => `${f.name}="${f.predicted.slice(0, 60)}"`);
      return flag("hallucinated-field", "medium", r, names.join(", "), r.detail.counts.hallucinated);
    });
}

/** The judge found a claim in the summary that conflicts with the ground-truth summary. */
export function summaryContradictions(rows) {
  return rows
    .filter((r) => r.job === "summarization" && r.detail?.verdict.contradictions?.length > 0)
    .map((r) => {
      const [first] = r.detail.verdict.contradictions;
      const more = r.detail.verdict.contradictions.length - 1;
      return flag(
        "contradiction",
        "high",
        r,
        `"${first.candidate_claim.slice(0, 120)}" — reference: "${first.reference_says.slice(0, 120)}"${more ? ` (+${more} more)` : ""}`,
        r.detail.verdict.contradictions.length,
      );
    });
}

/** Summary far longer or shorter than the other variants' summaries of the same document. */
export function summaryLength(rows, { lengthRobustZ }) {
  const flags = [];
  const scored = rows.filter((r) => r.job === "summarization" && r.detail);
  for (const group of groupBy(scored, (r) => r.documentId).values()) {
    if (group.length < 3) continue;
    const lengths = group.map((r) => r.detail.candidateChars);
    for (const r of group) {
      const z = robustZ(r.detail.candidateChars, lengths);
      if (z !== null && Math.abs(z) >= lengthRobustZ) {
        flags.push(
          flag(
            z > 0 ? "verbose" : "terse",
            "medium",
            r,
            `${r.detail.candidateChars} chars vs document median ${round(median(lengths), 0)} (robust z ${round(z)})`,
            r.detail.candidateChars,
          ),
        );
      }
    }
  }
  return flags;
}

/** Result pages ≠ PDF pages: the pipeline dropped or invented pages. */
export function pageMismatches(rows) {
  return rows
    .filter(
      (r) => r.outcome === "completed" && r.resultPages > 0 && r.documentPages && r.resultPages !== r.documentPages,
    )
    .map((r) =>
      flag("page-mismatch", "medium", r, `${r.resultPages} result page(s) for a ${r.documentPages}-page PDF`),
    );
}

/** Processing time beyond the Tukey upper fence of the same variant's tasks for that job. */
export function latencyOutliers(rows) {
  const flags = [];
  const timed = rows.filter((r) => r.processingMs !== null);
  for (const group of groupBy(timed, (r) => `${r.variantId}|${r.job}`).values()) {
    if (group.length < 4) continue;
    const times = group.map((r) => r.processingMs);
    const q1 = quantile(times, 0.25);
    const q3 = quantile(times, 0.75);
    const fence = q3 + 1.5 * (q3 - q1);
    for (const r of group) {
      if (r.processingMs > fence) {
        flags.push(
          flag(
            "slow",
            "medium",
            r,
            `${round(r.processingMs / 1000, 1)} s vs fence ${round(fence / 1000, 1)} s for this variant and job`,
            r.processingMs,
          ),
        );
      }
    }
  }
  return flags;
}

/** The judge was served by a fallback model, so its scale may differ from the other verdicts. */
export function judgeFallbacks(rows) {
  return rows
    .filter((r) => r.judgeServedModel && r.judgeRequestedModel && !r.judgeServedModel.startsWith(r.judgeRequestedModel))
    .map((r) =>
      flag("judge-fallback", "medium", r, `judged by ${r.judgeServedModel} instead of ${r.judgeRequestedModel}`),
    );
}

/** A variant whose effective score on a job (or composite) sits far below the other variants'. */
export function weakVariants(leaderboard, jobs, { robustZ: zLimit, minScoreGap }) {
  const flags = [];
  const metrics = [
    ...jobs.map((job) => ({ job, get: (v) => v.jobs[job].effectiveScore })),
    { job: null, get: (v) => v.composite },
  ];
  for (const { job, get } of metrics) {
    const scored = leaderboard.filter((v) => get(v) !== null);
    if (scored.length < 3) continue;
    const values = scored.map(get);
    const mid = median(values);
    for (const v of scored) {
      const z = robustZ(get(v), values);
      if (mid - get(v) >= minScoreGap / 2 && (z === null || z <= -zLimit)) {
        flags.push({
          kind: "weak-variant",
          severity: "high",
          ...(job && { job }),
          variantId: v.variantId,
          value: get(v),
          detail: `${job ?? "composite"} ${get(v)} vs variant median ${round(mid, 3)}${z === null ? "" : ` (robust z ${round(z)})`}`,
        });
      }
    }
  }
  return flags;
}

export function detectOutliers(rows, leaderboard, jobs, settings) {
  return [
    ...runFailures(rows),
    ...lowScoreWithinDocument(rows, settings),
    ...classificationOutliers(rows),
    ...hallucinatedFields(rows),
    ...summaryContradictions(rows),
    ...summaryLength(rows, settings),
    ...pageMismatches(rows),
    ...latencyOutliers(rows),
    ...judgeFallbacks(rows),
    ...weakVariants(leaderboard, jobs, settings),
  ];
}
