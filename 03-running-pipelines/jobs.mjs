/**
 * What each DocWeaver job is asked for (PUT /tasks/{id}/configuration json_schema) and how its
 * per-page result is read back. Shapes live-verified on staging tasks 2, 9 and 11 (2026-10-29):
 *
 *   extraction      json_schema [{ name, type, description }]          result [{ pg_no, <field_key>: value }]
 *   classification  json_schema [{ category, fields: [{ name, description }] }]
 *                                                                        result [{ pg_no, <category>: label }]
 *   summarization   json_schema []                                       result [{ pg_no, generation_response }]
 *
 * <field_key> is the field name lower-cased with spaces as "_" ("customer number" →
 * "customer_number"). Other punctuation is not mapped one-to-one: "Vendor / Seller Name" came
 * back as "vendor__seller_name" (staging, 2026-10-31). Result keys are therefore matched to fields
 * by their letters and digits alone (`compactKey`).
 */

export const CLASSIFICATION_CATEGORY_KEY = "document_type";

export function fieldKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Letters and digits only, lower-cased: the part of a field name every key spelling keeps. */
export function compactKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** The result key on `page` holding field `name`: the exact fieldKey, else the compact match. */
function keyFor(page, name) {
  const exact = fieldKey(name);
  if (Object.hasOwn(page, exact)) return exact;
  const compact = compactKey(name);
  return Object.keys(page).find((k) => k !== "pg_no" && compactKey(k) === compact) ?? null;
}

export function sortedPages(result) {
  return (Array.isArray(result) ? result : [])
    .filter((p) => p && typeof p === "object")
    .sort((a, b) => (a.pg_no ?? 0) - (b.pg_no ?? 0));
}

/**
 * @param {string} job
 * @param {object} document - normalised ground-truth document.
 * @param {{ classificationCategories: {name: string, description: string}[] }} groundTruth
 */
export function jsonSchemaFor(job, document, groundTruth) {
  if (job === "extraction") {
    return document.extraction.fields.map((f) => ({ name: f.name, type: f.type, description: f.description }));
  }
  if (job === "classification") {
    return [
      {
        category: CLASSIFICATION_CATEGORY_KEY,
        fields: groundTruth.classificationCategories.map((c) => ({ name: c.name, description: c.description })),
      },
    ];
  }
  if (job === "summarization") return [];
  throw new Error(`unknown job "${job}"`);
}

/**
 * Document-level extracted values: for each field, the first non-empty value in page order,
 * plus every page's value for the record.
 * @returns {Record<string, { value: unknown, pages: { page: number, value: unknown }[] }>}
 */
export function extractedValues(result, fields) {
  const pages = sortedPages(result);
  const isUnknown = (value) => typeof value === "string" && /^<unknown>$/i.test(value.trim());
  return Object.fromEntries(
    fields.map((f) => {
      const perPage = pages
        .map((p) => ({ p, key: keyFor(p, f.name) }))
        .filter(({ key }) => key !== null)
        .map(({ p, key }) => ({ page: p.pg_no, value: p[key] }));
      const first = perPage.find(
        (p) => p.value !== null && p.value !== undefined && String(p.value).trim() !== "" && !isUnknown(p.value),
      );
      return [f.name, { value: first?.value ?? null, pages: perPage }];
    }),
  );
}

/** Per-page labels and the document label (most frequent; ties go to the earliest page). */
export function classifiedLabels(result) {
  const pages = sortedPages(result)
    .map((p) => ({ page: p.pg_no, label: p[CLASSIFICATION_CATEGORY_KEY] ?? null }))
    .filter((p) => p.label !== null && String(p.label).trim() !== "");
  const counts = new Map();
  for (const p of pages) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
  let label = null;
  for (const p of pages) if (label === null || counts.get(p.label) > counts.get(label)) label = p.label;
  return { label, pages };
}

/** "Page 1: …\n\nPage 2: …", plus page count and character length. */
export function summaryText(result) {
  const pages = sortedPages(result);
  const texts = pages.map((p) => String(p.generation_response ?? "").trim());
  return {
    text: pages.map((p, i) => `Page ${p.pg_no ?? i + 1}: ${texts[i]}`).join("\n\n"),
    pages: pages.length,
    chars: texts.reduce((n, t) => n + t.length, 0),
  };
}
