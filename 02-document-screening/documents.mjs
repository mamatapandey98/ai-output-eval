/**
 * The evaluated documents are exactly the ground-truth documents. This module checks each one
 * against DocWeaver's upload limits before anything is sent.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { TASK_UPLOAD_CONSTRAINTS } from "../03-running-pipelines/docweaver/contract.mjs";
import { jobsFor, loadGroundTruth } from "../01-ground-truth-annotation/ground-truth.mjs";

export async function pdfPageCount(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/**
 * @returns {Promise<{ groundTruth: object, documents: object[], problems: string[] }>}
 *   documents carry `pages`, `bytes` and `jobs` in addition to their ground truth.
 */
export async function loadDocuments(config, countPages = pdfPageCount, requestedJobs = config.jobs) {
  const groundTruth = loadGroundTruth(config.groundTruthFile);
  const problems = [];
  const documents = [];
  for (const doc of groundTruth.documents) {
    const file = path.join(config.dataDir, doc.file);
    if (!fs.existsSync(file)) {
      problems.push(`${doc.id}: ${file} not found`);
      continue;
    }
    const bytes = fs.statSync(file).size;
    if (bytes > TASK_UPLOAD_CONSTRAINTS.MAX_FILE_SIZE_BYTES)
      problems.push(`${doc.id}: ${(bytes / 2 ** 20).toFixed(1)} MB exceeds the 30 MB upload limit`);
    let pages = null;
    try {
      pages = await countPages(fs.readFileSync(file));
      if (pages > TASK_UPLOAD_CONSTRAINTS.MAX_PDF_PAGES)
        problems.push(`${doc.id}: ${pages} pages exceeds the 50-page limit`);
    } catch (error) {
      problems.push(`${doc.id}: unreadable PDF (${error.message})`);
    }
    const jobs = jobsFor(doc).filter((job) => requestedJobs.includes(job));
    documents.push({ ...doc, pages, bytes, jobs });
  }
  return { groundTruth, documents, problems };
}
