/**
 * Join raw DocWeaver outcomes with their scores into one row per (document, variant, job), then
 * roll them up per variant, per category, per field and per label.
 *
 * Every job's `score` is on 0–1 (extraction confidence, classification accuracy, and summary
 * scores rescaled from the judge's 0–10), so jobs can be combined into one composite.
 */
import { CRITERIA } from "../05-llm-judge/rubric.mjs";
import { JOB_NAMES } from "../01-ground-truth-annotation/ground-truth.mjs";
import { detectOutliers } from "./outliers.mjs";
import { mean, median, quantile, round } from "./stats.mjs";

export function collectRows(store, documents, variants) {
  const rows = [];
  for (const document of documents) {
    for (const variant of variants) {
      for (const job of document.jobs) {
        const rawRel = store.rawFile(document.id, variant.id, job);
        if (!store.has(rawRel)) continue;
        const raw = store.read(rawRel);
        const scoreRel = store.scoreFile(document.id, variant.id, job);
        const s = store.has(scoreRel) ? store.read(scoreRel) : null;
        rows.push({
          documentId: document.id,
          category: document.category,
          documentPages: document.pages,
          variantId: variant.id,
          job,
          outcome: raw.outcome,
          failedRemarks: raw.failedRemarks ?? null,
          error: raw.error ?? null,
          processingMs: raw.processingMs ?? null,
          resultPages: Array.isArray(raw.result) ? raw.result.length : 0,
          scoreStatus: s ? s.status : raw.outcome === "completed" ? "missing" : "skipped",
          scoreReason: s?.reason ?? null,
          score: s?.status === "scored" ? s.score : null,
          detail: s?.status === "scored" ? detailOf(job, s) : null,
          judgeRequestedModel: s?.requestedModel ?? null,
          judgeServedModel: s?.servedModel ?? null,
          judgeUsage: s?.usage ?? null,
        });
      }
    }
  }
  return rows;
}

function detailOf(job, s) {
  if (job === "extraction") {
    return {
      matchRate: s.matchRate,
      counts: s.counts,
      comparisonCounts: s.comparisonCounts ?? null,
      fields: s.fields.map(
        ({
          name,
          expected,
          predicted,
          pageValues,
          pageComparisons,
          confidence,
          verdict,
          method,
          normalization,
          limitation,
          numericMismatch,
        }) => ({
          name,
          expected,
          predicted,
          pageValues,
          pageComparisons,
          confidence,
          verdict,
          method,
          normalization,
          limitation,
          numericMismatch,
        }),
      ),
    };
  }
  if (job === "classification") {
    return {
      expected: s.expected,
      predicted: s.predicted,
      correct: s.correct,
      pageAccuracy: s.pageAccuracy,
      pageMacroF1: s.pageMacroF1,
      perClass: s.perClass,
      pages: s.pages?.map(({ page, expected, predicted, verdict }) => ({ page, expected, predicted, verdict })),
      extraPredictedPages: s.extraPredictedPages ?? [],
    };
  }
  return { overall: s.overall, verdict: s.verdict, candidateChars: s.candidateChars };
}

const seconds = (ms) => (ms === null ? null : round(ms / 1000, 1));

function jobSummary(job, rows) {
  const scored = rows.filter((r) => r.score !== null);
  const fullyKnown = rows.every((r) => r.score !== null || r.outcome !== "completed");
  const summary = {
    tasks: rows.length,
    completed: rows.filter((r) => r.outcome === "completed").length,
    scored: scored.length,
    meanScore: round(mean(scored.map((r) => r.score)), 3),
    // Failed tasks count as 0; completed but unscored tasks leave quality unknown.
    effectiveScore: fullyKnown && rows.length ? round(scored.reduce((n, r) => n + r.score, 0) / rows.length, 3) : null,
  };
  if (job === "extraction") {
    summary.matchRate = round(mean(scored.map((r) => r.detail.matchRate)), 3);
    summary.hallucinatedFields = scored.reduce((n, r) => n + r.detail.counts.hallucinated, 0);
    summary.missingFields = scored.reduce((n, r) => n + r.detail.counts.missing, 0);
    summary.missingPageValues = scored.reduce((n, r) => n + (r.detail.comparisonCounts?.missing ?? 0), 0);
    summary.hallucinatedPageValues = scored.reduce((n, r) => n + (r.detail.comparisonCounts?.hallucinated ?? 0), 0);
  } else if (job === "classification") {
    summary.accuracy = scored.length ? round(scored.filter((r) => r.detail.correct).length / scored.length, 3) : null;
    const pages = scored.flatMap((r) => r.detail.pages ?? []);
    const labels = [...new Set(pages.map((p) => p.expected))];
    const f1 = labels.map((label) => {
      const tp = pages.filter((p) => p.expected === label && p.predicted === label).length;
      const fp = pages.filter((p) => p.expected !== label && p.predicted === label).length;
      const fn = pages.filter((p) => p.expected === label && p.predicted !== label).length;
      const precision = tp + fp ? tp / (tp + fp) : 0;
      const recall = tp + fn ? tp / (tp + fn) : 0;
      return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    });
    summary.pageMacroF1 = round(mean(f1), 3);
    summary.pageAccuracy = pages.length
      ? round(pages.filter((p) => p.expected === p.predicted).length / pages.length, 3)
      : null;
    summary.extraPredictedPages = scored.reduce((n, r) => n + (r.detail.extraPredictedPages?.length ?? 0), 0);
    summary.missingPageLabels = scored.reduce(
      (n, r) => n + (r.detail.pages?.filter((p) => p.predicted === null).length ?? 0),
      0,
    );
  } else if (job === "summarization") {
    summary.overall = round(mean(scored.map((r) => r.detail.overall)));
    for (const c of CRITERIA) summary[c] = round(mean(scored.map((r) => r.detail.verdict[c])));
    summary.contradictions = scored.some((r) => Array.isArray(r.detail.verdict.contradictions))
      ? scored.reduce((n, r) => n + (r.detail.verdict.contradictions?.length ?? 0), 0)
      : null;
  }
  return summary;
}

export function summarizeVariants(rows, variants, jobs, expectedTasksPerVariant = null) {
  return variants.map((variant) => {
    const own = rows.filter((r) => r.variantId === variant.id);
    const perJob = Object.fromEntries(
      jobs.map((job) => [
        job,
        jobSummary(
          job,
          own.filter((r) => r.job === job),
        ),
      ]),
    );
    const effective = jobs.map((job) => perJob[job].effectiveScore).filter((s) => s !== null);
    const times = own.filter((r) => r.processingMs !== null).map((r) => r.processingMs);
    return {
      variantId: variant.id,
      ocr: variant.ocr_provider,
      llm: variant.llm_model,
      vlm: variant.vlm_model ?? null,
      tasks: own.length,
      failed: own.filter((r) => r.outcome !== "completed").length,
      // A partial run can look like a winner when only its easiest tasks are present.
      // Keep the composite unavailable until every manifest task has a recorded outcome.
      composite:
        (expectedTasksPerVariant !== null && own.length !== expectedTasksPerVariant) ||
        jobs.some((job) => perJob[job].effectiveScore === null)
          ? null
          : round(mean(effective), 3),
      jobs: perJob,
      medianSeconds: seconds(median(times)),
      p90Seconds: seconds(quantile(times, 0.9)),
    };
  });
}

export function rankVariants(variantSummaries) {
  return [...variantSummaries]
    .sort(
      (a, b) =>
        (b.composite ?? -1) - (a.composite ?? -1) || (a.medianSeconds ?? Infinity) - (b.medianSeconds ?? Infinity),
    )
    .map((v, i) => ({ ...v, rank: v.composite === null ? null : i + 1 }));
}

export function categoryBreakdown(rows, variants, job) {
  const own = rows.filter((r) => r.job === job);
  return [...new Set(own.map((r) => r.category))].sort().map((category) => ({
    category,
    cells: Object.fromEntries(
      variants.map((v) => [
        v.id,
        round(
          mean(
            own.filter((r) => r.category === category && r.variantId === v.id && r.score !== null).map((r) => r.score),
          ),
          3,
        ),
      ]),
    ),
  }));
}

export function scoreMatrix(rows, documents, variants, job) {
  return documents
    .filter((d) => d.jobs.includes(job))
    .map((d) => ({
      documentId: d.id,
      category: d.category,
      pages: d.pages,
      cells: Object.fromEntries(
        variants.map((v) => {
          const row = rows.find((r) => r.job === job && r.documentId === d.id && r.variantId === v.id);
          return [v.id, row ? (row.score ?? (row.outcome !== "completed" ? "FAIL" : null)) : null];
        }),
      ),
    }));
}

/** Ground-truth label × predicted label counts over every scored classification. */
export function confusionMatrix(rows) {
  const scored = rows.filter((r) => r.job === "classification" && r.detail);
  const labels = [...new Set(scored.flatMap((r) => [r.detail.expected, r.detail.predicted ?? "(none)"]))].sort();
  const counts = Object.fromEntries(labels.map((e) => [e, Object.fromEntries(labels.map((p) => [p, 0]))]));
  for (const r of scored) counts[r.detail.expected][r.detail.predicted ?? "(none)"]++;
  return { labels, counts };
}

/** Mean confidence per extraction field ("<category> · <field>") and variant. */
export function fieldBreakdown(rows, variants) {
  const scored = rows.filter((r) => r.job === "extraction" && r.detail);
  const keys = [...new Set(scored.flatMap((r) => r.detail.fields.map((f) => `${r.category} · ${f.name}`)))].sort();
  return keys.map((key) => ({
    field: key,
    cells: Object.fromEntries(
      variants.map((v) => {
        const values = scored
          .filter((r) => r.variantId === v.id)
          .flatMap((r) => r.detail.fields.filter((f) => `${r.category} · ${f.name}` === key).map((f) => f.confidence));
        return [v.id, round(mean(values), 3)];
      }),
    ),
  }));
}

export function judgeUsage(rows) {
  const total = {
    requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  for (const r of rows.filter((x) => x.judgeUsage)) {
    total.requests++;
    for (const key of Object.keys(total).filter((k) => k !== "requests")) total[key] += r.judgeUsage[key] ?? 0;
  }
  return total;
}

export function buildReport({ store, manifest, outlierSettings }) {
  const { documents, variants } = manifest;
  const jobs = JOB_NAMES.filter((job) => documents.some((d) => d.jobs.includes(job)));
  const rows = collectRows(store, documents, variants);
  const expectedTasksPerVariant = documents.reduce((n, document) => n + document.jobs.length, 0);
  const leaderboard = rankVariants(summarizeVariants(rows, variants, jobs, expectedTasksPerVariant));
  const outliers = detectOutliers(rows, leaderboard, jobs, outlierSettings);
  return {
    runId: store.runId,
    generatedAt: new Date().toISOString(),
    settings: manifest.settings,
    jobs,
    totals: {
      documents: documents.length,
      variants: variants.length,
      expectedTasks: documents.reduce((n, d) => n + d.jobs.length, 0) * variants.length,
      recordedTasks: rows.length,
      completed: rows.filter((r) => r.outcome === "completed").length,
      scored: rows.filter((r) => r.score !== null).length,
      scoreCoverageByJob: Object.fromEntries(
        jobs.map((job) => {
          const expected = documents.reduce((n, d) => n + (d.jobs.includes(job) ? variants.length : 0), 0);
          const own = rows.filter((r) => r.job === job);
          return [
            job,
            {
              expected,
              recorded: own.length,
              completed: own.filter((r) => r.outcome === "completed").length,
              scored: own.filter((r) => r.score !== null).length,
            },
          ];
        }),
      ),
      outliers: outliers.length,
      highSeverityOutliers: outliers.filter((o) => o.severity === "high").length,
    },
    leaderboard,
    categories: Object.fromEntries(jobs.map((job) => [job, categoryBreakdown(rows, variants, job)])),
    matrices: Object.fromEntries(jobs.map((job) => [job, scoreMatrix(rows, documents, variants, job)])),
    confusion: jobs.includes("classification") ? confusionMatrix(rows) : null,
    fields: jobs.includes("extraction") ? fieldBreakdown(rows, variants) : null,
    outliers,
    judgeUsage: judgeUsage(rows),
    rows: rows.map(({ judgeUsage: _u, ...r }) => r),
  };
}
