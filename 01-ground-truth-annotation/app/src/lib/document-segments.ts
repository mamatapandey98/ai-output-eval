import { PAGE_CLASSIFICATIONS } from "@/lib/constants";
import { DocumentSegment } from "@/lib/types";

export interface SegmentValidation {
  errors: string[];
  gaps: Array<{ startPage: number; endPage: number }>;
  valid: boolean;
}

const allowedLabels = new Set<string>(PAGE_CLASSIFICATIONS.map(({ key }) => key));

export function validateDocumentSegments(segments: DocumentSegment[], pageCount: number): SegmentValidation {
  const errors: string[] = [];
  const gaps: Array<{ startPage: number; endPage: number }> = [];
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { errors: ["PDF page count is unavailable."], gaps, valid: false };
  }
  if (!segments.length) return { errors: ["Add at least one document segment."], gaps, valid: false };

  for (const [index, segment] of segments.entries()) {
    if (!Number.isInteger(segment.startPage) || !Number.isInteger(segment.endPage)) {
      errors.push(`Segment ${index + 1} needs whole page numbers.`);
      continue;
    }
    if (segment.startPage < 1 || segment.endPage > pageCount || segment.startPage > segment.endPage) {
      errors.push(`Segment ${index + 1} must be within pages 1–${pageCount}, with start before end.`);
    }
    if (!allowedLabels.has(segment.label)) errors.push(`Segment ${index + 1} needs a document type.`);
  }

  const sorted = [...segments]
    .filter(
      (segment) =>
        Number.isInteger(segment.startPage) &&
        Number.isInteger(segment.endPage) &&
        segment.startPage >= 1 &&
        segment.endPage <= pageCount &&
        segment.startPage <= segment.endPage,
    )
    .sort((a, b) => a.startPage - b.startPage || a.endPage - b.endPage);
  let nextPage = 1;
  for (const segment of sorted) {
    if (segment.startPage < nextPage)
      errors.push(`Pages ${segment.startPage}–${Math.min(segment.endPage, nextPage - 1)} overlap.`);
    if (segment.startPage > nextPage) gaps.push({ startPage: nextPage, endPage: segment.startPage - 1 });
    nextPage = Math.max(nextPage, segment.endPage + 1);
  }
  if (nextPage <= pageCount) gaps.push({ startPage: nextPage, endPage: pageCount });
  return { errors: [...new Set(errors)], gaps, valid: errors.length === 0 && sorted.length > 0 };
}
