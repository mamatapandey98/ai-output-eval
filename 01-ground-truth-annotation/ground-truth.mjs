/**
 * Human ground truth — the single source for which documents are evaluated, what each DocWeaver
 * job is asked for, and what each output is scored against.
 *
 * Accepted input (see config/ground-truth.example.json):
 *
 *   {
 *     "classificationCategories": [ { "name": "Invoice", "description": "…" } | "Invoice", … ],
 *     "documents": [
 *       {
 *         "file": "invoice/123-x.pdf",              // required, relative to dataDir
 *         "id": "…", "category": "invoice",           // optional; derived from file
 *         "summary": "…" | [ { "page": 1, "text": "…" } ],
 *         "classification": "Invoice" | { "label": "Invoice" } | [ { "page": 1, "label": "Invoice" } ],
 *         "extraction": { "Invoice Number": "INV-1", … }
 *                     | { "fields": [ { "name", "type"?, "description"? } ], "values": { … } }
 *       }
 *     ]
 *   }
 *
 * The annotation tool's export (ground_truth_cleaned.json) is also accepted and converted to the form
 * above by `fromAnnotationExport`:
 *
 *   {
 *     "categorySchemas": { "invoice": ["Invoice Number", …], … },   // extraction fields per category
 *     "selectedCategories": ["invoice", …],                         // the classification labels
 *     "selectedDocuments": ["invoice/123-x.pdf", …],                 // which annotations to evaluate
 *     "annotations": { "invoice/123-x.pdf": { "category", "extraction": { … }, "summary", "completed" } }
 *   }
 *
 * The export has no separate classification label, so each document's annotated category is its
 * label.
 *
 * Every job is optional per document: a document without "summary" is not summarised, and so on.
 * `normalizeGroundTruth` is the only code that reads the raw shape; adapt it if the format moves.
 */
import fs from "node:fs";
import path from "node:path";

export const JOB_NAMES = ["extraction", "classification", "summarization"];

export function documentId(category, file) {
  const slug = `${category}-${path.basename(file, path.extname(file))}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 80);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSummary(summary, where) {
  if (summary === undefined || summary === null) return null;
  if (nonEmptyString(summary)) return summary.trim();
  if (Array.isArray(summary)) {
    const pages = summary.map((p, i) => {
      if (!nonEmptyString(p?.text)) throw new Error(`${where}.summary[${i}].text must be a non-empty string`);
      return `Page ${p.page ?? i + 1}: ${p.text.trim()}`;
    });
    return pages.join("\n\n");
  }
  throw new Error(`${where}.summary must be a string or [{ page, text }]`);
}

function majority(labels) {
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best = null;
  for (const l of labels) if (best === null || counts.get(l) > counts.get(best)) best = l;
  return best;
}

function normalizeClassification(value, where) {
  if (value === undefined || value === null) return null;
  if (nonEmptyString(value)) return { label: value.trim(), pages: null };
  if (nonEmptyString(value?.label)) return { label: value.label.trim(), pages: null };
  if (Array.isArray(value) && value.length) {
    const pages = value.map((p, i) => {
      if (!nonEmptyString(p?.label)) throw new Error(`${where}.classification[${i}].label must be a non-empty string`);
      return { page: p.page ?? i + 1, label: p.label.trim() };
    });
    return { label: majority(pages.map((p) => p.label)), pages };
  }
  throw new Error(`${where}.classification must be a label, { label }, or [{ page, label }]`);
}

function normalizeExtraction(value, where) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}.extraction must be an object`);
  const values = value.values && typeof value.values === "object" ? value.values : value.fields ? {} : value;
  const declared = Array.isArray(value.fields) ? value.fields : Object.keys(values).map((name) => ({ name }));
  if (!declared.length) throw new Error(`${where}.extraction declares no fields`);
  const fields = declared.map((f, i) => {
    if (!nonEmptyString(f?.name)) throw new Error(`${where}.extraction.fields[${i}].name must be a non-empty string`);
    return { name: f.name.trim(), type: f.type ?? "Text", description: f.description ?? "" };
  });
  const names = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(values)) {
    if (!names.has(key)) throw new Error(`${where}.extraction.values has "${key}", which is not a declared field`);
  }
  return { fields, values: Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? null])) };
}

function normalizeCategories(raw, documents) {
  if (Array.isArray(raw) && raw.length) {
    return {
      derived: false,
      categories: raw.map((c, i) => {
        if (nonEmptyString(c)) return { name: c.trim(), description: "" };
        if (nonEmptyString(c?.name)) return { name: c.name.trim(), description: c.description ?? "" };
        throw new Error(`classificationCategories[${i}] must be a name or { name, description }`);
      }),
    };
  }
  const labels = [
    ...new Set(
      documents.flatMap((d) =>
        d.classification ? [d.classification.label, ...(d.classification.pages ?? []).map((p) => p.label)] : [],
      ),
    ),
  ];
  return { derived: true, categories: labels.sort().map((name) => ({ name, description: "" })) };
}

/** Annotation-tool export → { classificationCategories, documents } in the documented form. */
export function fromAnnotationExport(raw) {
  const schemas = raw.categorySchemas ?? {};
  const selected = Array.isArray(raw.selectedDocuments) ? raw.selectedDocuments : Object.keys(raw.annotations);
  const documents = selected.map((key) => {
    const where = `annotations["${key}"]`;
    const annotation = raw.annotations[key];
    if (!annotation) throw new Error(`${where} is selected but not annotated`);
    if (annotation.completed === false) throw new Error(`${where} is not completed`);
    const file = nonEmptyString(annotation.relativePath) ? annotation.relativePath : key;
    if (file !== key) throw new Error(`${where}.relativePath is "${file}"`);
    const category = nonEmptyString(annotation.category) ? annotation.category : path.dirname(file);
    let extraction = annotation.extraction ?? null;
    if (extraction && Array.isArray(schemas[category])) {
      const absent = schemas[category].filter((name) => !Object.hasOwn(extraction, name));
      if (absent.length) throw new Error(`${where}.extraction lacks ${absent.map((n) => `"${n}"`).join(", ")}`);
      extraction = { fields: schemas[category].map((name) => ({ name })), values: extraction };
    }
    // Per-page labels from the app use snake_case keys ("news_article"); categories use spaces.
    const pages = Array.isArray(annotation.pageClassifications) ? annotation.pageClassifications : [];
    const classification = pages.length
      ? pages.map(({ page, label }) => ({ page, label: String(label).replace(/_/g, " ") }))
      : category;
    return { file, category, summary: annotation.summary, classification, extraction };
  });
  return { classificationCategories: raw.selectedCategories ?? Object.keys(schemas), documents };
}

/**
 * @returns {{ documents: object[], classificationCategories: {name: string, description: string}[],
 *             categoriesDerived: boolean, categoryFields: Record<string, object[]> }}
 *   categoryFields: each category's extraction fields, from its first document with extraction.
 */
export function normalizeGroundTruth(raw) {
  if (raw?.annotations && typeof raw.annotations === "object") raw = fromAnnotationExport(raw);
  const entries = Array.isArray(raw) ? raw : raw?.documents;
  if (!Array.isArray(entries) || !entries.length) throw new Error("ground truth: expected a non-empty documents array");

  const documents = entries.map((entry, i) => {
    const where = `documents[${i}]`;
    if (!nonEmptyString(entry?.file)) throw new Error(`${where}.file must be a path relative to dataDir`);
    const file = entry.file.trim();
    const category = nonEmptyString(entry.category) ? entry.category.trim() : path.dirname(file);
    const doc = {
      id: nonEmptyString(entry.id) ? entry.id.trim() : documentId(category, file),
      file,
      category,
      summary: normalizeSummary(entry.summary, where),
      classification: normalizeClassification(entry.classification, where),
      extraction: normalizeExtraction(entry.extraction, where),
    };
    if (!doc.summary && !doc.classification && !doc.extraction)
      throw new Error(`${where} (${file}) has no summary, classification or extraction`);
    return doc;
  });

  const seen = new Set();
  for (const d of documents) {
    if (seen.has(d.id)) throw new Error(`ground truth: duplicate document id "${d.id}"`);
    seen.add(d.id);
  }

  const { categories, derived } = normalizeCategories(raw?.classificationCategories, documents);
  const known = new Set(categories.map((c) => c.name));
  for (const d of documents) {
    for (const label of d.classification
      ? [d.classification.label, ...(d.classification.pages ?? []).map((p) => p.label)]
      : []) {
      if (!known.has(label))
        throw new Error(`ground truth: ${d.id} is labelled "${label}", which is not in classificationCategories`);
    }
  }
  const categoryFields = {};
  for (const d of documents)
    if (d.extraction && !categoryFields[d.category]) categoryFields[d.category] = d.extraction.fields;
  return { documents, classificationCategories: categories, categoriesDerived: derived, categoryFields };
}

export function loadGroundTruth(file) {
  if (!file) throw new Error("groundTruthFile is not set in the eval config");
  if (!fs.existsSync(file)) throw new Error(`ground truth file not found: ${file}`);
  return normalizeGroundTruth(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Jobs this document has ground truth for. */
export function jobsFor(document) {
  return JOB_NAMES.filter((job) => (job === "summarization" ? document.summary : document[job]));
}
