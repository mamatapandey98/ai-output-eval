import { MAX_PDF_BYTES, MAX_PDF_PAGES } from "@/lib/constants";

export interface SelectedPdfMetadata {
  path: string;
  pageCount: number;
  sizeBytes: number;
}

export function validateSelectedPdfMetadata(files: SelectedPdfMetadata[]): string | null {
  for (const file of files) {
    if (!Number.isInteger(file.pageCount) || file.pageCount < 1) {
      return `${file.path} does not have a valid PDF page count.`;
    }
    if (file.pageCount > MAX_PDF_PAGES) {
      return `${file.path} has ${file.pageCount} pages; maximum is ${MAX_PDF_PAGES} pages per PDF.`;
    }
    if (!Number.isFinite(file.sizeBytes) || file.sizeBytes < 0) {
      return `${file.path} does not have a valid file size.`;
    }
    if (file.sizeBytes > MAX_PDF_BYTES) {
      return `${file.path} exceeds the 1 MB file limit.`;
    }
  }
  return null;
}
