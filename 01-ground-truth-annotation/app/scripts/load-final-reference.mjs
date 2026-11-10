// Loads the final reference (../data/final-reference.json) into the app's workspace file, so the
// app opens on the answers that were actually used for scoring.
//
//   node scripts/load-final-reference.mjs          refuses to overwrite an existing workspace
//   node scripts/load-final-reference.mjs --force  replaces it
import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const source = path.join(appDir, "../data/final-reference.json");
const target = path.resolve(process.env.ANNOTATION_FILE || path.join(appDir, "workspace/ground_truth.json"));

if (fs.existsSync(target) && !process.argv.includes("--force")) {
  console.error(`${path.relative(process.cwd(), target)} already exists; pass --force to replace it`);
  process.exit(1);
}

const reference = JSON.parse(fs.readFileSync(source, "utf-8"));
const now = new Date().toISOString();
const categorySchemas = {};
const annotations = {};

for (const doc of reference.documents) {
  const fields = doc.extraction.fields.map((field) => field.name);
  categorySchemas[doc.category] ??= fields;
  annotations[doc.file] = {
    relativePath: doc.file,
    category: doc.category,
    filename: path.basename(doc.file),
    // An empty field means "not in this document"; the app shows it as blank.
    extraction: Object.fromEntries(fields.map((name) => [name, doc.extraction.values[name] ?? ""])),
    summary: doc.summary,
    // Page labels use snake_case keys in the app ("news article" -> "news_article").
    pageClassifications: doc.classification.map(({ page, label }) => ({
      page,
      label: label.replace(/\s+/g, "_"),
      reviewed: true,
    })),
    completed: true,
    updatedAt: now,
  };
}

const workspace = {
  updatedAt: now,
  categorySchemas,
  selectedCategories: Object.keys(categorySchemas),
  selectedDocuments: Object.keys(annotations),
  annotations,
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(workspace, null, 2)}\n`);
console.log(`loaded ${reference.documents.length} documents into ${path.relative(process.cwd(), target)}`);
