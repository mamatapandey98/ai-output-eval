import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SCHEMAS,
  DEFAULT_RECOMMENDED_DOCS,
  DOCUMENT_CLASSIFICATIONS,
  FALLBACK_FIELDS,
  PAGE_CLASSIFICATIONS,
  RESERVED_PAGE_OUTPUT_KEYS,
} from "@/lib/constants";
import { GroundTruthData, DocumentAnnotation, DocumentSegment, PageAnnotation, PageClassification } from "@/lib/types";
import { blankAnnotation } from "@/lib/annotations";
import { validateDocumentSegments } from "@/lib/document-segments";
import { validateSelectedPdfMetadata } from "@/lib/selection-validation";
import { GROUND_TRUTH_FILE, readPageCount, resolveDataPath, writeGroundTruth } from "@/lib/files";

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const DOCUMENT_LABELS = new Set<string>(DOCUMENT_CLASSIFICATIONS.map(({ key }) => key));
const PAGE_LABELS = new Set<string>(PAGE_CLASSIFICATIONS.map(({ key }) => key));
const RESERVED_OUTPUT_KEYS = new Set<string>(RESERVED_PAGE_OUTPUT_KEYS);

function folderSuggestion(category: string): string | undefined {
  const key = category
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  return DOCUMENT_LABELS.has(key) ? key : undefined;
}

function getPdfPageCount(docPath: string): number {
  return readPageCount(resolveDataPath(docPath, { pdfOnly: true }));
}

function isOutputKey(key: unknown): key is string {
  return typeof key === "string" && SNAKE_CASE.test(key) && !RESERVED_OUTPUT_KEYS.has(key);
}

function validateSubmittedSegments(payload: Partial<GroundTruthData>, selectedDocuments: string[]): string | null {
  for (const docPath of selectedDocuments) {
    const annotation = payload.annotations?.[docPath];
    if (!annotation || !Object.prototype.hasOwnProperty.call(annotation, "documentSegments")) continue;
    const segments = annotation.documentSegments as DocumentSegment[] | undefined;
    if (!Array.isArray(segments)) return `${docPath}: documentSegments must be an array.`;
    if (segments.length === 0) continue;
    const ids = new Set<string>();
    for (const segment of segments) {
      if (!segment || typeof segment.id !== "string" || !segment.id.trim() || ids.has(segment.id)) {
        return `${docPath}: every segment needs a unique id.`;
      }
      ids.add(segment.id);
      if (typeof segment.title !== "undefined" && typeof segment.title !== "string") {
        return `${docPath}: segment titles must be text.`;
      }
    }
    if (segments.some((segment) => !PAGE_LABELS.has(segment?.label))) {
      return `${docPath}: every page range needs a supported page type.`;
    }
    let pageCount: number;
    try {
      pageCount = getPdfPageCount(docPath);
    } catch (error) {
      return `${docPath}: ${error instanceof Error ? error.message : "Could not read PDF page count."}`;
    }
    const validation = validateDocumentSegments(segments, pageCount);
    if (!validation.valid) return `${docPath}: ${validation.errors.join(" ")}`;
  }
  return null;
}

function validateSelectedDocuments(selectedDocuments: string[]): string | null {
  const files = [];
  for (const docPath of selectedDocuments) {
    try {
      const absolutePath = resolveDataPath(docPath, { pdfOnly: true });
      files.push({ path: docPath, pageCount: readPageCount(absolutePath), sizeBytes: fs.statSync(absolutePath).size });
    } catch (error) {
      return `${docPath}: ${error instanceof Error ? error.message : "Could not validate PDF metadata."}`;
    }
  }
  return validateSelectedPdfMetadata(files);
}

function validateCategorySelection(data: GroundTruthData): string | null {
  if (new Set(data.selectedDocuments).size !== data.selectedDocuments.length) {
    return "A PDF can only be selected once.";
  }
  const counts = new Map<string, number>();
  for (const docPath of data.selectedDocuments) {
    const category = data.annotations?.[docPath]?.category || docPath.split("/")[0] || "unknown";
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  for (const category of DEFAULT_CATEGORIES) {
    if (counts.get(category) !== 2) return `Select exactly 2 PDFs for ${category}.`;
  }
  if (data.selectedDocuments.length !== DEFAULT_CATEGORIES.length * 2) {
    return "Select exactly 2 PDFs in each of the 5 categories.";
  }
  return null;
}

function validateSubmittedPageAnnotations(
  payload: Partial<GroundTruthData>,
  selectedDocuments: string[],
): string | null {
  for (const docPath of selectedDocuments) {
    const annotation = payload.annotations?.[docPath];
    if (!annotation || !Object.prototype.hasOwnProperty.call(annotation, "pageAnnotations")) continue;
    const pages = annotation.pageAnnotations as PageAnnotation[] | undefined;
    if (!Array.isArray(pages)) return `${docPath}: pageAnnotations must be an array.`;
    if (!pages.length) continue;
    let pageCount: number;
    try {
      pageCount = getPdfPageCount(docPath);
    } catch (error) {
      return `${docPath}: ${error instanceof Error ? error.message : "Could not read PDF page count."}`;
    }
    const seen = new Set<number>();
    for (const item of pages) {
      if (!Number.isInteger(item?.page) || item.page < 1 || item.page > pageCount || seen.has(item.page)) {
        return `${docPath}: page annotations must use unique page numbers from 1 to ${pageCount}.`;
      }
      seen.add(item.page);
      if (!item.extraction || typeof item.extraction !== "object" || typeof item.summary !== "string") {
        return `${docPath}: each page annotation needs extraction values and a summary string.`;
      }
      if (!Object.keys(item.extraction).every(isOutputKey)) {
        return `${docPath}: extraction keys must be snake_case and cannot use reserved page output keys.`;
      }
    }
  }
  for (const docPath of selectedDocuments) {
    const annotation = payload.annotations?.[docPath];
    const keys = [...(annotation?.pageExtractionKeys || []), ...(annotation?.excludedPageExtractionKeys || [])];
    if (!keys.every(isOutputKey))
      return `${docPath}: extraction schema keys must be snake_case and cannot use reserved page output keys.`;
  }
  return null;
}

function validateSubmittedPageClassifications(
  payload: Partial<GroundTruthData>,
  selectedDocuments: string[],
): string | null {
  for (const docPath of selectedDocuments) {
    const annotation = payload.annotations?.[docPath];
    if (!annotation || !Object.prototype.hasOwnProperty.call(annotation, "pageClassifications")) continue;
    const items = annotation.pageClassifications;
    if (!Array.isArray(items)) return `${docPath}: pageClassifications must be an array.`;
    if (!items.length) continue;
    let pageCount: number;
    try {
      pageCount = getPdfPageCount(docPath);
    } catch (error) {
      return `${docPath}: ${error instanceof Error ? error.message : "Could not read PDF page count."}`;
    }
    const seen = new Set<number>();
    for (const item of items) {
      if (!Number.isInteger(item?.page) || item.page < 1 || item.page > pageCount || seen.has(item.page)) {
        return `${docPath}: page classifications must use unique page numbers from 1 to ${pageCount}.`;
      }
      seen.add(item.page);
      if (typeof item.label !== "string" || (item.label !== "" && !PAGE_LABELS.has(item.label))) {
        return `${docPath}: unsupported page classification label.`;
      }
    }
  }
  return null;
}

// A new workspace starts with the recommended two PDFs per category, all blank.
function getInitialGroundTruth(): GroundTruthData {
  const selectedDocuments = DEFAULT_CATEGORIES.flatMap((category) => DEFAULT_RECOMMENDED_DOCS[category] || []);
  const annotations: Record<string, DocumentAnnotation> = Object.fromEntries(
    selectedDocuments.map((docPath) => {
      const category = docPath.split("/")[0];
      return [docPath, blankAnnotation(docPath, category, DEFAULT_SCHEMAS[category])];
    }),
  );

  return {
    updatedAt: new Date().toISOString(),
    categorySchemas: { ...DEFAULT_SCHEMAS },
    selectedCategories: [...DEFAULT_CATEGORIES],
    selectedDocuments,
    annotations,
  };
}

function cleanPageAnnotations(items: PageAnnotation[]): PageAnnotation[] {
  const pages = new Map<number, PageAnnotation>();
  for (const item of items) {
    if (!Number.isInteger(item?.page) || item.page < 1 || !item.extraction || typeof item.extraction !== "object")
      continue;
    const extraction: Record<string, string> = {};
    for (const [key, value] of Object.entries(item.extraction)) {
      if (isOutputKey(key)) extraction[key] = typeof value === "string" ? value : String(value ?? "");
    }
    pages.set(item.page, {
      page: item.page,
      extraction,
      summary: typeof item.summary === "string" ? item.summary : "",
      ...(typeof item.reviewed === "boolean" ? { reviewed: item.reviewed } : {}),
    });
  }
  return [...pages.values()].sort((a, b) => a.page - b.page);
}

function cleanPageClassifications(items: PageClassification[]): PageClassification[] {
  const byPage = new Map<number, PageClassification>();
  for (const item of items) {
    if (!Number.isInteger(item?.page) || item.page < 1 || typeof item.label !== "string") continue;
    if (item.label !== "" && !PAGE_LABELS.has(item.label)) continue;
    byPage.set(item.page, {
      page: item.page,
      label: item.label,
      // An "unclear" page can never count as reviewed.
      ...(item.label === "unclear"
        ? { reviewed: false }
        : typeof item.reviewed === "boolean"
          ? { reviewed: item.reviewed }
          : {}),
      ...(typeof item.note === "string" ? { note: item.note } : {}),
    });
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

// Normalise saved data: keep annotations for selected documents only, and drop invalid values.
function cleanGroundTruth(raw: GroundTruthData): GroundTruthData {
  const selectedDocuments = raw.selectedDocuments || [];
  const cleanedAnnotations: Record<string, DocumentAnnotation> = {};

  for (const docPath of selectedDocuments) {
    const existing = raw.annotations?.[docPath];
    const cat = docPath.split("/")[0] || "unknown";
    const schema = raw.categorySchemas?.[cat] || FALLBACK_FIELDS;

    const extraction: Record<string, string> = {};
    schema.forEach((f) => {
      extraction[f] = existing?.extraction?.[f] || "";
    });

    // A document is complete when marked so, or when every field and the summary are filled.
    const filledCount = Object.values(extraction).filter((v) => v && v.trim().length > 0).length;
    const hasSummary = Boolean(existing?.summary && existing.summary.trim().length > 0);
    const isCompleted = existing?.completed === true || (filledCount === schema.length && hasSummary);

    cleanedAnnotations[docPath] = {
      relativePath: docPath,
      category: existing?.category || cat,
      filename: existing?.filename || docPath.split("/").pop() || "",
      extraction,
      summary: existing?.summary || "",
      completed: isCompleted,
      updatedAt: existing?.updatedAt || new Date().toISOString(),
      documentClassification:
        typeof existing?.documentClassification === "string" && DOCUMENT_LABELS.has(existing.documentClassification)
          ? existing.documentClassification
          : folderSuggestion(existing?.category || cat),
      documentClassificationReviewed: existing?.documentClassificationReviewed === true,
      ...(Array.isArray(existing?.documentSegments)
        ? {
            documentSegments: existing.documentSegments
              .filter(
                (item) =>
                  item &&
                  typeof item.id === "string" &&
                  Number.isInteger(item.startPage) &&
                  Number.isInteger(item.endPage) &&
                  PAGE_LABELS.has(item.label),
              )
              .map((item) => ({
                id: item.id,
                startPage: item.startPage,
                endPage: item.endPage,
                label: item.label,
                ...(typeof item.title === "string" && item.title.trim() ? { title: item.title.trim() } : {}),
              }))
              .sort((a, b) => a.startPage - b.startPage),
          }
        : {}),
      ...(Array.isArray(existing?.pageAnnotations)
        ? { pageAnnotations: cleanPageAnnotations(existing.pageAnnotations) }
        : {}),
      ...(Array.isArray(existing?.pageExtractionKeys)
        ? { pageExtractionKeys: [...new Set(existing.pageExtractionKeys.filter(isOutputKey))] }
        : {}),
      ...(Array.isArray(existing?.excludedPageExtractionKeys)
        ? { excludedPageExtractionKeys: [...new Set(existing.excludedPageExtractionKeys.filter(isOutputKey))] }
        : {}),
      ...(Array.isArray(existing?.pageClassifications)
        ? { pageClassifications: cleanPageClassifications(existing.pageClassifications) }
        : {}),
    };
  }

  return {
    updatedAt: raw.updatedAt || new Date().toISOString(),
    categorySchemas: raw.categorySchemas || { ...DEFAULT_SCHEMAS },
    selectedCategories: raw.selectedCategories || [...DEFAULT_CATEGORIES],
    selectedDocuments,
    annotations: cleanedAnnotations,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");
  const download = searchParams.get("download");

  let data: GroundTruthData;

  if (fs.existsSync(GROUND_TRUTH_FILE)) {
    try {
      const raw = fs.readFileSync(GROUND_TRUTH_FILE, "utf-8");
      data = cleanGroundTruth(JSON.parse(raw));
    } catch (e) {
      // Never overwrite a file that cannot be parsed; the annotator should fix or move it.
      console.error(`Failed to parse ${GROUND_TRUTH_FILE}:`, e);
      return NextResponse.json({ error: `Could not parse ${GROUND_TRUTH_FILE}` }, { status: 500 });
    }
  } else {
    data = getInitialGroundTruth();
    writeGroundTruth(data);
  }

  // CSV export: one row per document; page-level data as JSON columns.
  if (format === "csv") {
    const rows = [
      [
        "Category",
        "Filename",
        "Relative Path",
        "Completed",
        "Field 1 Name",
        "Field 1 Value",
        "Field 2 Name",
        "Field 2 Value",
        "Field 3 Name",
        "Field 3 Value",
        "Field 4 Name",
        "Field 4 Value",
        "Field 5 Name",
        "Field 5 Value",
        "Document Classification",
        "Document Segments",
        "Page Classifications JSON",
        "Page Extractions JSON",
        "Page Summaries JSON",
        "Summary",
        "Last Updated",
      ],
    ];

    for (const docPath of data.selectedDocuments) {
      const anno = data.annotations[docPath];
      if (!anno) continue;

      const extractionEntries = Object.entries(anno.extraction || {});
      const row = [
        anno.category,
        anno.filename,
        anno.relativePath,
        anno.completed ? "Yes" : "No",
        extractionEntries[0]?.[0] || "",
        extractionEntries[0]?.[1] || "",
        extractionEntries[1]?.[0] || "",
        extractionEntries[1]?.[1] || "",
        extractionEntries[2]?.[0] || "",
        extractionEntries[2]?.[1] || "",
        extractionEntries[3]?.[0] || "",
        extractionEntries[3]?.[1] || "",
        extractionEntries[4]?.[0] || "",
        extractionEntries[4]?.[1] || "",
        anno.documentClassification || "",
        JSON.stringify(anno.documentSegments || []),
        JSON.stringify(
          (anno.pageClassifications || []).map((item) => ({
            pg_no: item.page,
            document_type: PAGE_CLASSIFICATIONS.find((option) => option.key === item.label)?.label || "Unclear",
          })),
        ),
        JSON.stringify((anno.pageAnnotations || []).map((item) => ({ pg_no: item.page, ...item.extraction }))),
        JSON.stringify(
          (anno.pageAnnotations || []).map((item) => ({ pg_no: item.page, generation_response: item.summary })),
        ),
        anno.summary || "",
        anno.updatedAt,
      ];

      const escapedRow = row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`);
      rows.push(escapedRow);
    }

    const csvContent = rows.map((r) => (Array.isArray(r) ? r.join(",") : r)).join("\n");

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="ground_truth.csv"',
      },
    });
  }

  // JSON export: the full workspace plus a meta block.
  if (download === "true") {
    const completedCount = Object.values(data.annotations).filter((a) => a.completed).length;
    const exportPayload = {
      meta: {
        schemaVersion: "groundtruth.docweaver.page-v1",
        exportedAt: new Date().toISOString(),
        totalDocuments: data.selectedDocuments.length,
        completedDocuments: completedCount,
        percentComplete: Math.round((completedCount / data.selectedDocuments.length) * 100),
      },
      ...data,
    };

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ground_truth_${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  try {
    const payload: Partial<GroundTruthData> = await request.json();

    let existingData: GroundTruthData;
    if (fs.existsSync(GROUND_TRUTH_FILE)) {
      existingData = JSON.parse(fs.readFileSync(GROUND_TRUTH_FILE, "utf-8"));
    } else {
      existingData = getInitialGroundTruth();
    }

    const mergedData: GroundTruthData = {
      ...existingData,
      ...payload,
      updatedAt: new Date().toISOString(),
    };

    const segmentError = validateSubmittedSegments(
      payload,
      payload.selectedDocuments || existingData.selectedDocuments,
    );
    if (segmentError) return NextResponse.json({ error: segmentError }, { status: 400 });
    const pageAnnotationError = validateSubmittedPageAnnotations(
      payload,
      payload.selectedDocuments || existingData.selectedDocuments,
    );
    if (pageAnnotationError) return NextResponse.json({ error: pageAnnotationError }, { status: 400 });
    const pageClassificationError = validateSubmittedPageClassifications(
      payload,
      payload.selectedDocuments || existingData.selectedDocuments,
    );
    if (pageClassificationError) return NextResponse.json({ error: pageClassificationError }, { status: 400 });
    if (
      payload.selectedDocuments &&
      JSON.stringify(payload.selectedDocuments) !== JSON.stringify(existingData.selectedDocuments)
    ) {
      const selectionError = validateSelectedDocuments(payload.selectedDocuments);
      if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
    }
    // Reject stale clients holding an older selection before any save can overwrite
    // a newly curated ten-document dataset.
    const categoryError = validateCategorySelection(mergedData);
    if (categoryError) return NextResponse.json({ error: categoryError }, { status: 400 });

    // Clean data so stale/orphan documents don't linger
    const cleaned = cleanGroundTruth(mergedData);

    writeGroundTruth(cleaned);

    return NextResponse.json({
      success: true,
      updatedAt: cleaned.updatedAt,
      completedCount: Object.values(cleaned.annotations).filter((a) => a.completed).length,
    });
  } catch (error) {
    console.error("Error saving ground truth:", error);
    return NextResponse.json({ error: "Failed to save ground truth" }, { status: 500 });
  }
}
