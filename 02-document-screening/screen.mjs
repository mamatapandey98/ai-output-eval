/**
 * Screening: send PDFs that have no ground truth yet through a few pipelines to learn which ones
 * DocWeaver can process, before anyone annotates them. Each candidate is asked for its category's
 * extraction fields (taken from the ground truth); the extracted values are kept as a draft
 * annotation. Screens live in screensDir, apart from evaluation runs, and are never scored.
 */
import fs from "node:fs";
import path from "node:path";
import { TASK_UPLOAD_CONSTRAINTS } from "../03-running-pipelines/docweaver/contract.mjs";
import { documentId } from "../01-ground-truth-annotation/ground-truth.mjs";
import { extractedValues } from "../03-running-pipelines/jobs.mjs";
import { valueToText } from "../04-deterministic-scoring/similarity/text.mjs";

/** Stable pseudo-random order, so the same candidates are picked on every machine. */
function sampleKey(file) {
  let h = 2166136261;
  for (const ch of file) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/**
 * Up to `perCategory` PDFs per category that are not in the ground truth and fit the upload
 * limits. A category is eligible only if the ground truth defines its extraction fields.
 * @returns {Promise<{ documents: object[], skipped: string[] }>}
 */
export async function screenCandidates(config, groundTruth, { perCategory, categories, countPages }) {
  const known = new Set(groundTruth.documents.map((d) => d.file));
  const wanted = categories ?? Object.keys(groundTruth.categoryFields);
  const missing = wanted.filter((c) => !groundTruth.categoryFields[c]);
  if (missing.length)
    throw new Error(`no extraction fields for categor${missing.length > 1 ? "ies" : "y"} ${missing.join(", ")}`);

  const documents = [];
  const skipped = [];
  for (const category of wanted) {
    const dir = path.join(config.dataDir, category);
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .map((name) => `${category}/${name}`)
      .filter((file) => !known.has(file))
      .sort((a, b) => sampleKey(a) - sampleKey(b) || a.localeCompare(b));
    let picked = 0;
    for (const file of files) {
      if (picked >= perCategory) break;
      const full = path.join(config.dataDir, file);
      const bytes = fs.statSync(full).size;
      if (bytes > TASK_UPLOAD_CONSTRAINTS.MAX_FILE_SIZE_BYTES) {
        skipped.push(`${file}: ${(bytes / 2 ** 20).toFixed(1)} MB exceeds the upload limit`);
        continue;
      }
      let pages;
      try {
        pages = await countPages(fs.readFileSync(full));
      } catch (error) {
        skipped.push(`${file}: unreadable PDF (${error.message})`);
        continue;
      }
      if (pages > TASK_UPLOAD_CONSTRAINTS.MAX_PDF_PAGES) {
        skipped.push(`${file}: ${pages} pages exceeds the page limit`);
        continue;
      }
      documents.push({
        id: documentId(category, file),
        file,
        category,
        pages,
        bytes,
        jobs: ["extraction"],
        summary: null,
        classification: null,
        extraction: {
          fields: groundTruth.categoryFields[category],
          values: Object.fromEntries(groundTruth.categoryFields[category].map((f) => [f.name, null])),
        },
      });
      picked++;
    }
  }
  return { documents, skipped };
}

const minutes = (ms) => (ms === null || ms === undefined ? null : Math.round(ms / 6000) / 10);

/** One row per screened document: how each variant fared and the values it extracted. */
export function screenSummary(store, manifest) {
  const rows = manifest.documents.map((document) => {
    const variants = manifest.variants.map((variant) => {
      const rel = store.rawFile(document.id, variant.id, "extraction");
      if (!store.has(rel)) return { variantId: variant.id, outcome: "pending" };
      const raw = store.read(rel);
      const values =
        raw.outcome === "completed"
          ? Object.fromEntries(
              Object.entries(extractedValues(raw.result, document.extraction.fields)).map(([name, v]) => [
                name,
                valueToText(v.value),
              ]),
            )
          : null;
      return {
        variantId: variant.id,
        outcome: raw.outcome,
        minutes: minutes(raw.processingMs),
        taskId: raw.taskId,
        stillOnStaging: raw.taskId !== null && raw.deleted === false,
        remarks: raw.failedRemarks ?? raw.error ?? null,
        values,
      };
    });
    const done = variants.filter((v) => v.outcome !== "pending");
    const verdict = !done.length
      ? "pending"
      : done.every((v) => v.outcome === "completed")
        ? "works"
        : done.some((v) => v.outcome === "completed")
          ? "partly works"
          : "fails";
    return {
      documentId: document.id,
      file: document.file,
      category: document.category,
      pages: document.pages,
      verdict,
      variants,
    };
  });
  const count = (verdict) => rows.filter((r) => r.verdict === verdict).length;
  return {
    screenId: store.runId,
    generatedAt: new Date().toISOString(),
    totals: {
      documents: rows.length,
      works: count("works"),
      partlyWorks: count("partly works"),
      fails: count("fails"),
      pending: count("pending"),
    },
    rows,
  };
}

export function renderScreenMarkdown(summary) {
  const t = summary.totals;
  const lines = [
    `# Screen ${summary.screenId}`,
    "",
    `${t.documents} documents: ${t.works} work, ${t.partlyWorks} partly work, ${t.fails} fail, ${t.pending} pending.`,
    "",
    "| Verdict | Document | Pages | " + summary.rows[0]?.variants.map((v) => v.variantId).join(" | ") + " |",
    "| --- | --- | ---: | " + (summary.rows[0]?.variants.map(() => "---").join(" | ") ?? "") + " |",
  ];
  for (const r of summary.rows) {
    const cells = r.variants.map((v) => {
      if (v.outcome === "completed") return `completed (${v.minutes} min)`;
      if (v.outcome === "pending") return "pending";
      return `${v.outcome}${v.remarks ? `: ${String(v.remarks).slice(0, 60)}` : ""}${v.stillOnStaging ? ` (task #${v.taskId} still on staging)` : ""}`;
    });
    lines.push(`| ${r.verdict} | ${r.file} | ${r.pages ?? ""} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Draft values (first completed variant)", "");
  for (const r of summary.rows) {
    const first = r.variants.find((v) => v.values);
    if (!first) continue;
    lines.push(`### ${r.file} (${first.variantId})`, "");
    for (const [name, value] of Object.entries(first.values)) lines.push(`- **${name}**: ${value || "—"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
