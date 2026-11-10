// Server-side file access: where the PDFs and the annotation file live, and PDF page counts.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

// The PDF corpus, one sub-folder per category. Defaults to the repo's data/ folder, the same
// one the evaluation tool uses.
// The paths are read at run time, so the build is told not to trace them.
export const DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.ANNOTATION_DATA_DIR || path.join(process.cwd(), "../../data"),
);

// The working annotation file. It is git-ignored; export it from the app to keep a copy.
export const GROUND_TRUTH_FILE = path.resolve(
  /* turbopackIgnore: true */ process.env.ANNOTATION_FILE || path.join(process.cwd(), "workspace/ground_truth.json"),
);

/** Resolves a corpus-relative path, refusing anything outside DATA_DIR. */
export function resolveDataPath(relativePath: string, { pdfOnly = false } = {}): string {
  const absolutePath = path.resolve(DATA_DIR, relativePath);
  const inside = path.relative(DATA_DIR, absolutePath);
  if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("Access denied");
  if (pdfOnly && path.extname(absolutePath).toLowerCase() !== ".pdf") throw new Error("Not a PDF file");
  return absolutePath;
}

/** Page count from Poppler's pdfinfo. */
export function readPageCount(absolutePath: string): number {
  const output = execFileSync("pdfinfo", [absolutePath], { encoding: "utf-8", timeout: 10_000 });
  const pageCount = Number(output.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Could not read the PDF page count.");
  return pageCount;
}

export function writeGroundTruth(data: unknown): void {
  fs.mkdirSync(path.dirname(GROUND_TRUTH_FILE), { recursive: true });
  fs.writeFileSync(GROUND_TRUTH_FILE, JSON.stringify(data, null, 2), "utf-8");
}
