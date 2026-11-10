/**
 * Render a built report as Markdown (for PRs and chat) and as a self-contained HTML page.
 * Both are built from the same table definitions, so they always show the same numbers.
 */
import { CRITERIA } from "../05-llm-judge/rubric.mjs";

const JOB_TITLES = { extraction: "Extraction", classification: "Classification", summarization: "Summarization" };

const fmt = (v, digits = 2) =>
  v === null || v === undefined ? "–" : typeof v === "number" ? v.toFixed(digits) : String(v);
const int = (v) => (v === null || v === undefined ? "–" : String(v));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A table: { columns: [{ label, numeric?, heat? }], rows: [[cell, …]] }. Heat cells hold 0–1 scores. */
function leaderboardTable(report) {
  const columns = [
    { label: "#", numeric: true },
    { label: "Variant" },
    { label: "Composite", numeric: true, heat: true },
    ...report.jobs.map((job) => ({ label: JOB_TITLES[job], numeric: true, heat: true })),
    { label: "Failed", numeric: true },
    { label: "Median s", numeric: true },
    { label: "p90 s", numeric: true },
  ];
  const rows = report.leaderboard.map((v) => [
    v.rank,
    v.variantId,
    v.composite,
    ...report.jobs.map((job) => v.jobs[job].effectiveScore),
    `${v.failed}/${v.tasks}`,
    fmt(v.medianSeconds, 1),
    fmt(v.p90Seconds, 1),
  ]);
  return { columns, rows };
}

function jobTable(report, job) {
  const lb = report.leaderboard;
  const base = [
    { label: "Variant" },
    { label: "Effective", numeric: true, heat: true },
    { label: "Mean (scored)", numeric: true, heat: true },
  ];
  const done = (j) => `${j.scored}/${j.tasks}`;
  if (job === "extraction") {
    return {
      columns: [
        ...base,
        { label: "Match rate", numeric: true, heat: true },
        { label: "Missing page values", numeric: true },
        { label: "Missing", numeric: true },
        { label: "Hallucinated", numeric: true },
        { label: "Scored", numeric: true },
      ],
      rows: lb.map((v) => {
        const j = v.jobs.extraction;
        return [
          v.variantId,
          j.effectiveScore,
          j.meanScore,
          j.matchRate,
          int(j.missingPageValues),
          int(j.missingFields),
          int(j.hallucinatedFields),
          done(j),
        ];
      }),
    };
  }
  if (job === "classification") {
    return {
      columns: [
        ...base,
        { label: "Document accuracy", numeric: true, heat: true },
        { label: "Page accuracy", numeric: true, heat: true },
        { label: "Page macro-F1", numeric: true, heat: true },
        { label: "Missing page labels", numeric: true },
        { label: "Extra predicted pages", numeric: true },
        { label: "Scored", numeric: true },
      ],
      rows: lb.map((v) => {
        const j = v.jobs.classification;
        return [
          v.variantId,
          j.effectiveScore,
          j.meanScore,
          j.accuracy,
          j.pageAccuracy,
          j.pageMacroF1,
          int(j.missingPageLabels),
          int(j.extraPredictedPages),
          done(j),
        ];
      }),
    };
  }
  return {
    columns: [
      ...base,
      { label: "Overall /10", numeric: true },
      ...CRITERIA.map((c) => ({ label: `${cap(c)} /10`, numeric: true })),
      { label: "Contradictions", numeric: true },
      { label: "Scored", numeric: true },
    ],
    rows: lb.map((v) => {
      const j = v.jobs.summarization;
      return [
        v.variantId,
        j.effectiveScore,
        j.meanScore,
        fmt(j.overall),
        ...CRITERIA.map((c) => fmt(j[c])),
        int(j.contradictions),
        done(j),
      ];
    }),
  };
}

function gridTable(firstLabel, items, variantIds, labelOf, extra = []) {
  return {
    columns: [
      { label: firstLabel },
      ...extra.map((e) => ({ label: e.label, numeric: true })),
      ...variantIds.map((id) => ({ label: id, numeric: true, heat: true })),
    ],
    rows: items.map((item) => [
      labelOf(item),
      ...extra.map((e) => e.value(item)),
      ...variantIds.map((id) => item.cells[id]),
    ]),
  };
}

function confusionTable(confusion) {
  return {
    columns: [{ label: "Ground truth ↓ / predicted →" }, ...confusion.labels.map((l) => ({ label: l, numeric: true }))],
    rows: confusion.labels.map((e) => [
      e,
      ...confusion.labels.map((p) => (confusion.counts[e][p] ? confusion.counts[e][p] : "·")),
    ]),
  };
}

function outlierTable(outliers) {
  const order = { high: 0, medium: 1 };
  const sorted = [...outliers].sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      a.kind.localeCompare(b.kind) ||
      String(a.variantId).localeCompare(String(b.variantId)),
  );
  return {
    columns: [
      { label: "Severity" },
      { label: "Kind" },
      { label: "Job" },
      { label: "Document" },
      { label: "Variant" },
      { label: "Detail", wrap: true },
    ],
    rows: sorted.map((o) => [
      o.severity,
      o.kind,
      o.job ?? "–",
      o.documentId ?? "–",
      o.variantId ?? "–",
      o.detail ?? "",
    ]),
  };
}

/** Section list shared by both renderers. */
function sections(report) {
  const variantIds = report.leaderboard.map((v) => v.variantId).sort();
  const out = [
    {
      title: "Leaderboard",
      note: "Scores are 0–1. Each job's effective score counts failed or unscored tasks as 0, so a variant cannot rank well by failing; composite is the mean of the job scores.",
      table: leaderboardTable(report),
    },
    {
      title: `Outliers (${report.outliers.length})`,
      table: report.outliers.length ? outlierTable(report.outliers) : null,
      note: report.outliers.length ? null : "None flagged.",
    },
  ];
  for (const job of report.jobs) {
    const title = JOB_TITLES[job];
    out.push({
      title,
      note:
        job === "summarization"
          ? "LLM judge comparing each summary with the ground-truth summary; four 0–10 criteria, weighted to an out-of-10 score. The cross-job composite uses overall / 10."
          : "Extraction uses field-aware exact checks and lexical overlap by default; optional cached embeddings add semantic similarity. Classification labels are exact after normalization. Page macro-F1 is included when page annotations exist.",
      table: jobTable(report, job),
    });
    if (job === "classification" && report.confusion?.labels.length) {
      out.push({ title: "Classification — confusion matrix", level: 3, table: confusionTable(report.confusion) });
    }
    if (job === "extraction" && report.fields?.length) {
      out.push({
        title: "Extraction — confidence by field",
        level: 3,
        table: gridTable("Field", report.fields, variantIds, (f) => f.field),
      });
    }
    out.push({
      title: `${title} — by category`,
      level: 3,
      table: gridTable("Category", report.categories[job], variantIds, (c) => c.category),
    });
    out.push({
      title: `${title} — by document`,
      level: 3,
      table: gridTable("Document", report.matrices[job], variantIds, (d) => d.documentId, [
        { label: "Pages", value: (d) => int(d.pages) },
      ]),
    });
  }
  return out;
}

function headline(report) {
  const t = report.totals;
  return `${t.documents} documents × ${t.variants} variants · ${report.jobs.join(", ")} = ${t.expectedTasks} tasks; ${t.recordedTasks} recorded, ${t.completed} completed, ${t.scored} scored. ${t.outliers} outliers flagged (${t.highSeverityOutliers} high).`;
}

function usageLine(report) {
  const u = report.judgeUsage;
  return `Judge: ${u.requests} requests · ${u.input_tokens} input, ${u.cache_read_input_tokens} cache-read, ${u.cache_creation_input_tokens} cache-write, ${u.output_tokens} output tokens.`;
}

function settingsLine(report) {
  const s = report.settings ?? {};
  return [
    s.embeddingModel && `embeddings ${s.embeddingModel}`,
    s.judgeModel && `judge ${s.judgeModel}${s.includeSourcePdf ? " (with source PDF)" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------- Markdown

const mdCell = (v, col) =>
  (col.heat && typeof v === "number" ? v.toFixed(2) : v === null || v === undefined ? "–" : String(v))
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");

function mdTable({ columns, rows }) {
  return [
    `| ${columns.map((c) => c.label).join(" | ")} |`,
    `|${columns.map((c) => (c.numeric ? "---:" : "---")).join("|")}|`,
    ...rows.map((r) => `| ${r.map((v, i) => mdCell(v, columns[i])).join(" | ")} |`),
  ].join("\n");
}

export function renderMarkdown(report) {
  const lines = [`# Pipeline variant evaluation — ${report.runId}`, "", settingsLine(report), "", headline(report), ""];
  for (const s of sections(report)) {
    lines.push(`${"#".repeat(s.level ?? 2)} ${s.title}`, "");
    if (s.note) lines.push(s.note, "");
    if (s.table) lines.push(mdTable(s.table), "");
  }
  lines.push(usageLine(report), "");
  return lines.join("\n");
}

// ---------------------------------------------------------------- HTML

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function htmlCell(v, col) {
  const classes = [col.numeric && "num", col.wrap && "wrap"].filter(Boolean);
  if (v === "FAIL") return `<td class="num fail">FAIL</td>`;
  if (col.heat) {
    if (typeof v !== "number") return `<td class="num muted">–</td>`;
    return `<td class="num heat" style="--s:${v.toFixed(3)}">${v.toFixed(2)}</td>`;
  }
  if (v === "high" || v === "medium") classes.push(`sev-${v}`);
  return `<td${classes.length ? ` class="${classes.join(" ")}"` : ""}>${esc(v ?? "–")}</td>`;
}

function htmlTable({ columns, rows }) {
  const head = columns.map((c) => `<th${c.numeric ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((v, i) => htmlCell(v, columns[i])).join("")}</tr>`).join("\n");
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

export function renderHtml(report) {
  const t = report.totals;
  const kpis = [
    [`${t.documents} × ${t.variants}`, "documents × variants"],
    [`${t.completed}/${t.expectedTasks}`, "tasks completed"],
    [`${t.scored}`, "scored"],
    [`${t.highSeverityOutliers}`, "high-severity outliers"],
    [report.leaderboard[0]?.variantId ?? "–", "top variant"],
  ];
  const body = sections(report)
    .map((s) => {
      const tag = s.level === 3 ? "h3" : "h2";
      return `<${tag}>${esc(s.title)}</${tag}>${s.note ? `<p class="meta">${esc(s.note)}</p>` : ""}${s.table ? htmlTable(s.table) : ""}`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pipeline Variant Evaluation</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6b66;--line:#e3e2dd;--card:#fff;--bad:#b3261e;--warn:#8a5a00;--lo:179,38,30;--hi:31,122,72}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--fg:#ecebe6;--muted:#a19f97;--line:#2e2d2a;--card:#1e1e1c;--bad:#f2867d;--warn:#e0b450;--lo:242,134,125;--hi:108,195,143}}
:root[data-theme="dark"]{--bg:#161615;--fg:#ecebe6;--muted:#a19f97;--line:#2e2d2a;--card:#1e1e1c;--bad:#f2867d;--warn:#e0b450;--lo:242,134,125;--hi:108,195,143}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1240px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:36px 0 6px}h3{font-size:14px;margin:24px 0 6px}
.meta{color:var(--muted);margin:0 0 10px}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:140px}
.kpi b{display:block;font-size:19px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.kpi span{color:var(--muted);font-size:12px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
th{font-weight:600;color:var(--muted);font-size:12px}
.num{text-align:right}.muted{color:var(--muted)}td.wrap{white-space:normal;min-width:320px}
td.heat{background:linear-gradient(rgba(var(--hi),calc(var(--s)*.30)),rgba(var(--hi),calc(var(--s)*.30))),rgba(var(--lo),calc((1 - var(--s))*.22))}
.fail{color:var(--bad);font-weight:600}.sev-high{color:var(--bad);font-weight:600}.sev-medium{color:var(--warn)}
</style></head><body><main>
<h1>Pipeline variant evaluation</h1>
<p class="meta">Run ${esc(report.runId)} · ${esc(settingsLine(report))} · generated ${esc(report.generatedAt)}</p>
<p>${esc(headline(report))}</p>
<div class="kpis">${kpis.map(([v, l]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>
${body}
<p class="meta" style="margin-top:32px">${esc(usageLine(report))}</p>
</main></body></html>
`;
}
