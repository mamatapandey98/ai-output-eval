"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Check,
  RefreshCw,
  X,
  Shuffle,
  FolderSearch,
  Search,
  AlertTriangle,
} from "lucide-react";
import { GroundTruthData, CategoryInfo, DocumentSegment, PageClassification, PageAnnotation } from "@/lib/types";
import {
  DOCUMENT_CLASSIFICATIONS,
  FALLBACK_FIELDS,
  PAGE_CLASSIFICATIONS,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  RESERVED_PAGE_OUTPUT_KEYS,
} from "@/lib/constants";
import { blankAnnotation } from "@/lib/annotations";

type ClassificationRange = { startPage: number; endPage: number; label: string };

function getClassificationRanges(items: PageClassification[], pageCount: number): ClassificationRange[] {
  if (!pageCount) return [];
  const byPage = new Map(items.map((item) => [item.page, item.label]));
  const ranges: ClassificationRange[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const label = byPage.get(page) || "";
    const last = ranges[ranges.length - 1];
    if (last?.label === label) last.endPage = page;
    else ranges.push({ startPage: page, endPage: page, label });
  }
  return ranges;
}

function toSnakeCase(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findFileSize(docPath: string, categories: CategoryInfo[]): number {
  return categories.find((category) => category.files.includes(docPath))?.fileSizes?.[docPath] || 0;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getClassificationRuns(items: PageClassification[], pageCount: number): DocumentSegment[] {
  return getClassificationRanges(items, pageCount)
    .filter((range) => range.label)
    .map((range) => ({ ...range, id: `page-${range.startPage}-${range.endPage}` }));
}

export default function AnnotationStudio() {
  const [queueSearch, setQueueSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [fileMetadata, setFileMetadata] = useState<Record<string, { pageCount: number; sizeBytes: number }>>({});
  const [data, setData] = useState<GroundTruthData | null>(null);
  const [selectedDocPath, setSelectedDocPath] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [pageMetadata, setPageMetadata] = useState<{ path: string; pageCount: number; error?: boolean } | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [pagePreviewErrorKey, setPagePreviewErrorKey] = useState("");
  const [workflowTab, setWorkflowTab] = useState<"classification" | "extraction" | "summary">("classification");
  const [rangeEditorOpen, setRangeEditorOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [rangeLabel, setRangeLabel] = useState("");
  const [newExtractionKey, setNewExtractionKey] = useState("");

  const [pickerCategory, setPickerCategory] = useState<string | null>(null);
  const [tempSelectedFiles, setTempSelectedFiles] = useState<string[]>([]);
  const [selectionCheckPending, setSelectionCheckPending] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [confirmWarning, setConfirmWarning] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    cancelLabel?: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    cancelLabel: "Keep Existing",
    confirmLabel: "Yes, Replace",
    onConfirm: () => {},
  });

  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestDataRef = useRef<GroundTruthData | null>(null);
  const saveRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }, []);

  const ensurePdfMetadata = async (docPath: string): Promise<{ pageCount: number; sizeBytes: number } | null> => {
    if (fileMetadata[docPath]) return fileMetadata[docPath];
    const sizeBytes = findFileSize(docPath, categories);
    if (sizeBytes > MAX_PDF_BYTES) return { pageCount: 0, sizeBytes };
    try {
      const response = await fetch(`/api/pdf?path=${encodeURIComponent(docPath)}&metadata=true`);
      if (!response.ok) return null;
      const metadata: { pageCount: number; sizeBytes: number } = await response.json();
      setFileMetadata((current) => ({ ...current, [docPath]: metadata }));
      return metadata;
    } catch {
      return null;
    }
  };

  // Saves are queued so they reach the server in order.
  const triggerSave = useCallback((dataToSave: GroundTruthData, revision = saveRevisionRef.current) => {
    setSaveStatus("saving");
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(async () => {
        try {
          const res = await fetch("/api/ground-truth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dataToSave),
          });
          if (revision === saveRevisionRef.current) setSaveStatus(res.ok ? "saved" : "unsaved");
        } catch (err) {
          console.error("Save error:", err);
          if (revision === saveRevisionRef.current) setSaveStatus("unsaved");
        }
      });
    return saveQueueRef.current;
  }, []);

  // Every edit goes through here: update state, then save 400 ms after the last change.
  const handleDataChange = useCallback(
    (updater: (prev: GroundTruthData) => GroundTruthData) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        saveRevisionRef.current += 1;
        latestDataRef.current = next;
        setSaveStatus("unsaved");

        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = setTimeout(() => {
          triggerSave(next, saveRevisionRef.current);
        }, 400);

        return next;
      });
    },
    [triggerSave],
  );

  const flushSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (latestDataRef.current) {
      await triggerSave(latestDataRef.current, saveRevisionRef.current);
    }
  }, [triggerSave]);

  // Load categories and existing ground truth
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const [catRes, gtRes] = await Promise.all([fetch("/api/categories"), fetch("/api/ground-truth")]);

        const catData = await catRes.json();
        const gtData: GroundTruthData = await gtRes.json();

        setCategories(catData.categories || []);
        setData(gtData);

        const initialMetadata = await Promise.all(
          gtData.selectedDocuments.map(async (docPath) => {
            try {
              const response = await fetch(`/api/pdf?path=${encodeURIComponent(docPath)}&metadata=true`);
              if (!response.ok) return null;
              return [docPath, await response.json()] as const;
            } catch {
              return null;
            }
          }),
        );
        setFileMetadata(
          Object.fromEntries(initialMetadata.filter((item): item is NonNullable<typeof item> => Boolean(item))),
        );

        if (gtData.selectedDocuments.length > 0) {
          const firstPath =
            initialMetadata.find((item) => item?.[1]?.pageCount > 1)?.[0] || gtData.selectedDocuments[0];
          setSelectedDocPath(firstPath);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const activeAnnotation = data && selectedDocPath ? data.annotations[selectedDocPath] : null;
  const currentCategory = activeAnnotation?.category || (data?.selectedCategories[0] ?? "");
  const currentFields = (data && currentCategory && data.categorySchemas[currentCategory]) || FALLBACK_FIELDS;

  const totalDocs = data?.selectedDocuments.length || 0;
  const completedDocs = data ? data.selectedDocuments.filter((p) => data.annotations[p]?.completed).length : 0;
  const overallPercentage = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;

  const activeIndex = data ? data.selectedDocuments.indexOf(selectedDocPath) : -1;
  const visiblePageCount = pageMetadata?.path === selectedDocPath ? pageMetadata.pageCount : 0;
  const pageMetadataError = pageMetadata?.path === selectedDocPath && pageMetadata.error === true;
  const pagePreviewKey = `${selectedDocPath}:${selectedPage}`;
  const pagePreviewError = pagePreviewErrorKey === pagePreviewKey;
  const currentPageClassification = activeAnnotation?.pageClassifications?.find((item) => item.page === selectedPage);
  const classificationRanges = getClassificationRanges(activeAnnotation?.pageClassifications || [], visiblePageCount);
  const currentPageAnnotation = activeAnnotation?.pageAnnotations?.find((item) => item.page === selectedPage);
  const importedPageExtractionKeys = Array.from(
    new Set(
      (activeAnnotation?.pageAnnotations || []).flatMap((item) =>
        Object.keys(item.extraction || {}).filter(
          (key) => !RESERVED_PAGE_OUTPUT_KEYS.includes(key as (typeof RESERVED_PAGE_OUTPUT_KEYS)[number]),
        ),
      ),
    ),
  );
  const excludedPageExtractionKeys = new Set(activeAnnotation?.excludedPageExtractionKeys || []);
  const pageExtractionKeys = Array.from(
    new Set([
      ...(activeAnnotation?.pageExtractionKeys || []),
      ...importedPageExtractionKeys,
      ...currentFields.map(toSnakeCase),
    ]),
  ).filter(
    (key) =>
      !excludedPageExtractionKeys.has(key) &&
      !RESERVED_PAGE_OUTPUT_KEYS.includes(key as (typeof RESERVED_PAGE_OUTPUT_KEYS)[number]),
  );
  const documentClassificationKey = activeAnnotation?.documentClassification || "";
  const selectedMetadataLoaded =
    Boolean(data) && data!.selectedDocuments.every((docPath) => Boolean(fileMetadata[docPath]));
  const selectedTotalPages =
    data?.selectedDocuments.reduce((total, docPath) => total + (fileMetadata[docPath]?.pageCount || 0), 0) || 0;
  const selectedTotalBytes =
    data?.selectedDocuments.reduce(
      (total, docPath) => total + (fileMetadata[docPath]?.sizeBytes || findFileSize(docPath, categories)),
      0,
    ) || 0;
  const pickerOtherDocs =
    data && pickerCategory
      ? data.selectedDocuments.filter((docPath) => data.annotations[docPath]?.category !== pickerCategory)
      : [];
  const pickerTotalPages =
    (pickerOtherDocs || []).reduce((sum, docPath) => sum + (fileMetadata[docPath]?.pageCount || 0), 0) +
    tempSelectedFiles.reduce((sum, docPath) => sum + (fileMetadata[docPath]?.pageCount || 0), 0);

  useEffect(() => {
    let cancelled = false;
    if (!selectedDocPath) return;
    fetch(`/api/pdf?path=${encodeURIComponent(selectedDocPath)}&metadata=true`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Unable to load PDF page count"))))
      .then((metadata: { pageCount: number; sizeBytes?: number }) => {
        if (!cancelled) {
          setPageMetadata({ path: selectedDocPath, pageCount: metadata.pageCount });
          setFileMetadata((current) => ({
            ...current,
            [selectedDocPath]: {
              pageCount: metadata.pageCount,
              sizeBytes: metadata.sizeBytes || findFileSize(selectedDocPath, categories),
            },
          }));
          const annotation = latestDataRef.current?.annotations[selectedDocPath];
          if (metadata.pageCount === 1 && annotation && !annotation.pageAnnotations?.some((item) => item.page === 1)) {
            const extraction = Object.fromEntries(
              Object.entries(annotation.extraction || {}).map(([label, value]) => [toSnakeCase(label), value]),
            );
            if (Object.values(extraction).some((value) => value.trim()) || annotation.summary.trim()) {
              handleDataChange((prev) => ({
                ...prev,
                annotations: {
                  ...prev.annotations,
                  [selectedDocPath]: {
                    ...prev.annotations[selectedDocPath],
                    pageAnnotations: [{ page: 1, extraction, summary: annotation.summary }],
                  },
                },
              }));
            }
          }
        }
      })
      .catch((err) => {
        console.error("PDF metadata error:", err);
        if (!cancelled) {
          setPageMetadata({ path: selectedDocPath, pageCount: 0, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDocPath, categories, handleDataChange]);

  const selectDocument = useCallback((docPath: string) => {
    setSelectedPage(1);
    setSelectedDocPath(docPath);
    setRangeStart(1);
    setRangeEnd(1);
    setRangeLabel("");
  }, []);

  const changeDocumentClassification = (label: string) => {
    if (!selectedDocPath || !label) return;
    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;
      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          [selectedDocPath]: {
            ...current,
            documentClassification: label,
            documentClassificationReviewed: true,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const updatePageClassification = (updates: { label?: string; reviewed?: boolean; note?: string }) => {
    if (!selectedDocPath) return;
    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;
      const existing = current.pageClassifications?.find((item) => item.page === selectedPage);
      const label = updates.label ?? existing?.label ?? "";
      const changed = typeof updates.label === "string" && updates.label !== existing?.label;
      const reviewed = label === "unclear" ? false : (updates.reviewed ?? (changed ? false : existing?.reviewed));
      const note = updates.note ?? (changed ? undefined : existing?.note);
      const pageClassifications = (current.pageClassifications || []).filter((item) => item.page !== selectedPage);
      if (label || reviewed || note?.trim())
        pageClassifications.push({
          page: selectedPage,
          label,
          ...(typeof reviewed === "boolean" ? { reviewed } : {}),
          ...(note ? { note } : {}),
        });
      pageClassifications.sort((a, b) => a.page - b.page);
      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          [selectedDocPath]: {
            ...current,
            pageClassifications,
            documentSegments: getClassificationRuns(pageClassifications, visiblePageCount),
          },
        },
      };
    });
  };

  const applyClassificationRange = (startPage: number, endPage: number, label: string) => {
    if (
      !selectedDocPath ||
      !label ||
      !visiblePageCount ||
      startPage < 1 ||
      endPage > visiblePageCount ||
      startPage > endPage
    )
      return;
    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;
      const byPage = new Map((current.pageClassifications || []).map((item) => [item.page, item]));
      for (let page = startPage; page <= endPage; page += 1) {
        const existing = byPage.get(page);
        const changed = existing?.label !== label;
        byPage.set(page, {
          page,
          label,
          reviewed: changed ? false : (existing?.reviewed ?? false),
          ...(!changed && existing?.note ? { note: existing.note } : {}),
        });
      }
      const pageClassifications = [...byPage.values()].sort((a, b) => a.page - b.page);
      const isWholeDocument = startPage === 1 && endPage === visiblePageCount;
      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          [selectedDocPath]: {
            ...current,
            pageClassifications,
            documentSegments: getClassificationRuns(pageClassifications, visiblePageCount),
            ...(isWholeDocument ? { documentClassification: label, documentClassificationReviewed: true } : {}),
          },
        },
      };
    });
    setSelectedPage(startPage);
    showToast(
      startPage === 1 && endPage === visiblePageCount
        ? "Applied type to all pages"
        : `Applied type to pages ${startPage}–${endPage}`,
    );
  };

  const updatePageAnnotation = (updates: Partial<PageAnnotation>) => {
    if (!selectedDocPath) return;
    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;
      const pageAnnotations = [...(current.pageAnnotations || [])];
      const index = pageAnnotations.findIndex((item) => item.page === selectedPage);
      const existing = pageAnnotations[index] || { page: selectedPage, extraction: {}, summary: "" };
      const updated = {
        ...existing,
        ...updates,
        page: selectedPage,
        extraction: { ...existing.extraction, ...(updates.extraction || {}) },
      };
      if (index >= 0) pageAnnotations[index] = updated;
      else pageAnnotations.push(updated);
      pageAnnotations.sort((a, b) => a.page - b.page);
      return { ...prev, annotations: { ...prev.annotations, [selectedDocPath]: { ...current, pageAnnotations } } };
    });
  };

  const handlePageExtractionChange = (key: string, value: string) => {
    updatePageAnnotation({ extraction: { [key]: value } });
  };

  const addPageExtractionField = () => {
    const key = newExtractionKey.trim();
    if (
      !/^[a-z][a-z0-9_]*$/.test(key) ||
      RESERVED_PAGE_OUTPUT_KEYS.includes(key as (typeof RESERVED_PAGE_OUTPUT_KEYS)[number])
    ) {
      showToast("Use a snake_case key beginning with a letter");
      return;
    }
    if (pageExtractionKeys.includes(key)) {
      showToast("That key already exists");
      return;
    }
    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;
      const pageAnnotations = [...(current.pageAnnotations || [])];
      const index = pageAnnotations.findIndex((item) => item.page === selectedPage);
      const page = pageAnnotations[index] || { page: selectedPage, extraction: {}, summary: "" };
      const value = Object.prototype.hasOwnProperty.call(page.extraction, key) ? page.extraction[key] : "";
      const updated = { ...page, extraction: { ...page.extraction, [key]: value } };
      if (index >= 0) pageAnnotations[index] = updated;
      else pageAnnotations.push(updated);
      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          [selectedDocPath]: {
            ...current,
            pageExtractionKeys: [...new Set([...(current.pageExtractionKeys || []), key])],
            excludedPageExtractionKeys: (current.excludedPageExtractionKeys || []).filter((item) => item !== key),
            pageAnnotations,
          },
        },
      };
    });
    setNewExtractionKey("");
  };

  const removePageExtractionField = (key: string) => {
    if (!selectedDocPath) return;
    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;
      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          [selectedDocPath]: {
            ...current,
            pageExtractionKeys: (current.pageExtractionKeys || []).filter((item) => item !== key),
            excludedPageExtractionKeys: [...new Set([...(current.excludedPageExtractionKeys || []), key])],
          },
        },
      };
    });
  };

  const handleExportPageOutput = async () => {
    if (!activeAnnotation || !visiblePageCount) return;
    await flushSave();
    const lines = [];
    for (let page = 1; page <= visiblePageCount; page += 1) {
      if (workflowTab === "classification") {
        const key = activeAnnotation.pageClassifications?.find((item) => item.page === page)?.label || "unclear";
        const label = PAGE_CLASSIFICATIONS.find((item) => item.key === key)?.label || "Unclear";
        lines.push(JSON.stringify({ pg_no: page, document_type: label }));
      } else if (workflowTab === "extraction") {
        const values = activeAnnotation.pageAnnotations?.find((item) => item.page === page)?.extraction || {};
        lines.push(
          JSON.stringify({
            ...Object.fromEntries(
              pageExtractionKeys
                .filter((key) => !RESERVED_PAGE_OUTPUT_KEYS.includes(key as (typeof RESERVED_PAGE_OUTPUT_KEYS)[number]))
                .map((key) => [key, values[key] || ""]),
            ),
            pg_no: page,
          }),
        );
      } else {
        const summary = activeAnnotation.pageAnnotations?.find((item) => item.page === page)?.summary || "";
        lines.push(JSON.stringify({ pg_no: page, generation_response: summary }));
      }
    }
    const base = activeAnnotation.filename.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "_");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`${lines.join("\n")}\n`], { type: "application/x-ndjson;charset=utf-8" }),
    );
    link.download = `${base}_${workflowTab}.jsonl`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handlePrev = () => {
    if (!data || activeIndex <= 0) return;
    flushSave();
    selectDocument(data.selectedDocuments[activeIndex - 1]);
  };

  const handleNext = useCallback(() => {
    if (!data || activeIndex >= data.selectedDocuments.length - 1) return;
    flushSave();
    selectDocument(data.selectedDocuments[activeIndex + 1]);
  }, [data, activeIndex, flushSave, selectDocument]);

  // Cmd/Ctrl + Enter moves to the next document.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext]);

  const toggleCompleted = () => {
    if (!selectedDocPath) return;

    handleDataChange((prev) => {
      const current = prev.annotations[selectedDocPath];
      if (!current) return prev;

      const newCompleted = !current.completed;

      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          [selectedDocPath]: {
            ...current,
            completed: newCompleted,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const hasCategoryAnnotatedData = (catName: string) => {
    if (!data) return false;
    const catDocs = data.selectedDocuments.filter((p) => data.annotations[p]?.category === catName);
    return catDocs.some((p) => {
      const a = data.annotations[p];
      if (!a) return false;
      if (a.completed) return true;
      const filledFields = Object.values(a.extraction || {}).filter((v) => v && v.trim()).length;
      const hasSum = Boolean(a.summary && a.summary.trim());
      const hasPageData = Boolean(
        a.pageClassifications?.length ||
        a.documentClassification ||
        a.documentSegments?.length ||
        a.pageAnnotations?.some(
          (page) => page.summary.trim() || Object.values(page.extraction).some((value) => value.trim()),
        ),
      );
      return filledFields > 0 || hasSum || hasPageData;
    });
  };

  // Choose replacement PDFs that meet the per-file page and size limits.
  const pickEligibleFiles = async (catName: string, pool: string[], targetCount = 2) => {
    if (!data) return [] as string[];
    const eligible: string[] = [];
    for (const docPath of [...pool].sort(() => Math.random() - 0.5)) {
      if (eligible.length >= targetCount) break;
      if (findFileSize(docPath, categories) > MAX_PDF_BYTES) continue;
      const info = await ensurePdfMetadata(docPath);
      if (!info || info.sizeBytes > MAX_PDF_BYTES || info.pageCount < 1 || info.pageCount > MAX_PDF_PAGES) continue;
      eligible.push(docPath);
    }
    if (eligible.length < targetCount) {
      showToast(`Could not find 2 PDFs within the ${MAX_PDF_PAGES}-page and 1 MB per-file limits`);
      return [];
    }
    return eligible;
  };

  // Replace a category's two PDFs at random, after a warning if any are already annotated.
  const performRandomizeCategory = async (catName: string) => {
    if (!data) return;
    const catInfo = categories.find((c) => c.name === catName);
    if (!catInfo || catInfo.files.length < 1) {
      showToast(`Not enough PDFs to randomize in ${catName}`);
      return;
    }

    const currentCatFiles = data.selectedDocuments.filter((p) => data.annotations[p]?.category === catName);

    const availablePool =
      catInfo.files.length > 3 ? catInfo.files.filter((f) => !currentCatFiles.includes(f)) : [...catInfo.files];

    const targetCount = 2;
    const newPickedFiles = await pickEligibleFiles(catName, availablePool, targetCount);
    if (newPickedFiles.length !== 2) return;

    const otherDocs = data.selectedDocuments.filter((p) => data.annotations[p]?.category !== catName);
    const updatedSelectedDocs = [...otherDocs, ...newPickedFiles];

    const updatedAnnotations = { ...data.annotations };
    for (const docPath of newPickedFiles) {
      updatedAnnotations[docPath] ??= blankAnnotation(docPath, catName, data.categorySchemas[catName]);
    }

    const updatedData: GroundTruthData = {
      ...data,
      selectedDocuments: updatedSelectedDocs,
      annotations: updatedAnnotations,
    };

    setData(updatedData);
    latestDataRef.current = updatedData;
    saveRevisionRef.current += 1;
    selectDocument(newPickedFiles[0]);
    triggerSave(updatedData, saveRevisionRef.current);
    showToast(`Selected ${newPickedFiles.length} PDFs for ${catName}`);
  };

  const handleRandomizeCategory = (catName: string) => {
    if (hasCategoryAnnotatedData(catName)) {
      setConfirmWarning({
        isOpen: true,
        title: `Randomize ${catName}?`,
        message: `You already have annotated documents in "${catName}". Resampling will replace the current selection in this category. Continue?`,
        onConfirm: () => {
          setConfirmWarning((w) => ({ ...w, isOpen: false }));
          void performRandomizeCategory(catName);
        },
      });
      return;
    }
    void performRandomizeCategory(catName);
  };

  // "Choose PDFs" dialog
  const openFilePicker = (catName: string) => {
    if (!data) return;
    const currentCatFiles = data.selectedDocuments.filter((p) => data.annotations[p]?.category === catName);
    setPickerCategory(catName);
    setTempSelectedFiles(currentCatFiles);
    setFileSearchQuery("");
  };

  // Keep the benchmark balanced with exactly two PDFs per category.
  const togglePickerFile = async (filePath: string) => {
    if (tempSelectedFiles.includes(filePath)) {
      setTempSelectedFiles((files) => files.filter((item) => item !== filePath));
      return;
    }
    if (tempSelectedFiles.length >= 2) {
      showToast("Choose exactly 2 PDFs per category");
      return;
    }
    if (findFileSize(filePath, categories) > MAX_PDF_BYTES) {
      showToast("This PDF exceeds the 1 MB file limit");
      return;
    }
    if (!data || !pickerCategory || selectionCheckPending) return;
    setSelectionCheckPending(true);
    const newlySelected = await Promise.all([...tempSelectedFiles, filePath].map(ensurePdfMetadata));
    setSelectionCheckPending(false);
    if (newlySelected.some((item) => !item)) {
      showToast("Could not verify selected PDF page counts");
      return;
    }
    if (
      newlySelected.some(
        (item) => !item || item.pageCount < 1 || item.pageCount > MAX_PDF_PAGES || item.sizeBytes > MAX_PDF_BYTES,
      )
    ) {
      showToast(`Each PDF must be ${MAX_PDF_PAGES} pages or fewer`);
      return;
    }
    setTempSelectedFiles([...tempSelectedFiles, filePath]);
  };

  const randomizeInsidePicker = async () => {
    if (!pickerCategory) return;
    const catInfo = categories.find((c) => c.name === pickerCategory);
    if (!catInfo) return;
    if (selectionCheckPending) return;
    setSelectionCheckPending(true);
    const selected = await pickEligibleFiles(pickerCategory, catInfo.files, 2);
    setSelectionCheckPending(false);
    if (selected.length === 2) {
      setTempSelectedFiles(selected);
      showToast("Selected 2 eligible PDFs");
    }
  };

  const applyFilePickerSelection = async () => {
    if (!data || !pickerCategory) return;
    if (tempSelectedFiles.length !== 2) {
      showToast("Select exactly 2 PDFs");
      return;
    }

    const otherDocs = data.selectedDocuments.filter((p) => data.annotations[p]?.category !== pickerCategory);
    const limits = await Promise.all([...otherDocs, ...tempSelectedFiles].map(ensurePdfMetadata));
    if (
      limits.some((item) => !item) ||
      limits.some((item) => (item?.pageCount || 0) > MAX_PDF_PAGES || (item?.sizeBytes || 0) > MAX_PDF_BYTES)
    ) {
      showToast(`Each PDF must be ${MAX_PDF_PAGES} pages or fewer and 1 MB or smaller`);
      return;
    }
    const updatedSelectedDocs = [...otherDocs, ...tempSelectedFiles];

    const updatedAnnotations = { ...data.annotations };
    for (const docPath of tempSelectedFiles) {
      updatedAnnotations[docPath] ??= blankAnnotation(docPath, pickerCategory, data.categorySchemas[pickerCategory]);
    }

    const updatedData: GroundTruthData = {
      ...data,
      selectedDocuments: updatedSelectedDocs,
      annotations: updatedAnnotations,
    };

    setData(updatedData);
    latestDataRef.current = updatedData;
    saveRevisionRef.current += 1;
    selectDocument(tempSelectedFiles[0]);
    triggerSave(updatedData, saveRevisionRef.current);
    setPickerCategory(null);
    showToast(`Updated the 2 selected PDFs for ${pickerCategory}`);
  };

  // Exports save pending edits first, then download the file the server holds.
  const handleExportJSON = async () => {
    await flushSave();
    const link = document.createElement("a");
    link.href = "/api/ground-truth?download=true";
    link.download = "ground_truth.json";
    link.click();
    showToast("Exported verified ground_truth.json");
  };

  const handleExportCSV = async () => {
    await flushSave();
    const link = document.createElement("a");
    link.href = "/api/ground-truth?format=csv";
    link.download = "ground_truth.csv";
    link.click();
    showToast("Exported verified ground_truth.csv");
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-500 font-sans">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-slate-800" />
          <p className="text-xs font-medium tracking-wide text-slate-600">Loading the annotation workspace…</p>
        </div>
      </div>
    );
  }

  // Files for picker modal
  const pickerCatInfo = pickerCategory ? categories.find((c) => c.name === pickerCategory) : null;
  const filteredPickerFiles = pickerCatInfo
    ? pickerCatInfo.files.filter((f) => f.toLowerCase().includes(fileSearchQuery.toLowerCase()))
    : [];

  return (
    <div className="annotation-studio">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg animate-in fade-in duration-150">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Warning Confirmation Modal */}
      {confirmWarning.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">{confirmWarning.title}</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-5">{confirmWarning.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmWarning((w) => ({ ...w, isOpen: false }))}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                {confirmWarning.cancelLabel || "Keep Existing"}
              </button>
              <button
                onClick={confirmWarning.onConfirm}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 transition"
              >
                {confirmWarning.confirmLabel || "Yes, Replace"}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="studio-header">
        <div className="studio-brand">
          <div className="brand-mark">
            <FileText size={19} />
          </div>
          <strong>Groundtruth</strong>
          <span className="header-divider" />
          <span className="workspace-name">Annotation workspace</span>
        </div>
        <div className="header-actions">
          <button className="save-state" onClick={flushSave}>
            <span className={`status-dot ${saveStatus}`} />
            {saveStatus === "saved"
              ? "All changes saved"
              : saveStatus === "saving"
                ? "Saving changes…"
                : "Save changes"}
          </button>
          <div className="export-actions">
            <button onClick={handleExportJSON}>
              <Download size={14} /> Export JSON
            </button>
            <button onClick={handleExportCSV}>CSV</button>
          </div>
        </div>
      </header>
      <div className="studio-workspace">
        <aside className="document-queue" aria-label="Document queue">
          <div className="queue-heading">
            <span className="eyebrow">BENCHMARK DATASET</span>
            <div>
              <h2>Documents</h2>
              <span className="count-badge">{totalDocs}</span>
            </div>
            <p className="queue-selection-summary">
              {selectedMetadataLoaded
                ? `${selectedTotalPages} pages across ${totalDocs} PDFs · ${formatBytes(selectedTotalBytes)}`
                : "Checking selected page counts…"}
            </p>
            <p>Each PDF: up to {MAX_PDF_PAGES} pages, 1 MB.</p>
          </div>
          <div className="queue-search">
            <Search size={15} />
            <input
              aria-label="Search documents"
              placeholder="Find a document…"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
            />
          </div>
          <nav className="queue-list">
            {data &&
              [...data.selectedCategories]
                .sort(
                  (a, b) =>
                    (data?.selectedDocuments.findIndex((p) => data.annotations[p]?.category === a) ?? 0) -
                    (data?.selectedDocuments.findIndex((p) => data.annotations[p]?.category === b) ?? 0),
                )
                .map((cat) => {
                  const docs = data.selectedDocuments.filter((p) => data.annotations[p]?.category === cat);
                  const visible = docs.filter((p) => p.toLowerCase().includes(queueSearch.toLowerCase()));
                  if (!visible.length) return null;
                  return (
                    <section key={cat} className="queue-category">
                      <div className="category-heading">
                        <span>{cat}</span>
                        <span>
                          {docs.filter((p) => data.annotations[p]?.completed).length}/{docs.length}
                        </span>
                      </div>
                      {visible.map((path, index) => {
                        const annotation = data.annotations[path];
                        return (
                          <button
                            key={path}
                            className={`queue-document ${path === selectedDocPath ? "active" : ""}`}
                            title={annotation?.filename}
                            aria-current={path === selectedDocPath ? "page" : undefined}
                            onClick={() => {
                              flushSave();
                              selectDocument(path);
                            }}
                          >
                            {annotation?.completed ? (
                              <CheckCircle2 size={16} className="complete-icon" />
                            ) : (
                              <FileText size={16} />
                            )}
                            <span>
                              <strong>
                                {(annotation?.filename || path.split("/").pop() || "")
                                  .replace(/\.pdf$/i, "")
                                  .replace(/-/g, " ")}
                              </strong>
                              <small>
                                {annotation?.completed
                                  ? "Completed"
                                  : Object.values(annotation?.extraction || {}).some(Boolean) || annotation?.summary
                                    ? "In progress"
                                    : "Not started"}
                              </small>
                            </span>
                            <span className="queue-document-meta">
                              {fileMetadata[path]?.pageCount
                                ? `${fileMetadata[path].pageCount} page${fileMetadata[path].pageCount === 1 ? "" : "s"}`
                                : "Checking"}
                            </span>
                            <span className="document-number">{String(index + 1).padStart(2, "0")}</span>
                          </button>
                        );
                      })}
                    </section>
                  );
                })}
            {data && !data.selectedDocuments.some((p) => p.toLowerCase().includes(queueSearch.toLowerCase())) && (
              <p className="empty-search">No documents found.</p>
            )}
          </nav>
          <div className="queue-progress">
            <div>
              <span>Annotation progress</span>
              <strong>{overallPercentage}%</strong>
            </div>
            <div className="progress-track">
              <div style={{ width: `${overallPercentage}%` }} />
            </div>
            <p>
              {completedDocs} of {totalDocs} documents completed
            </p>
          </div>
        </aside>
        <main className="review-workspace">
          <div className="review-toolbar">
            <div>
              <span className="eyebrow">DOCUMENT REVIEW</span>
              <h2>
                <span className="capitalize">{currentCategory}</span>
                <span className="toolbar-slash">/</span>
                <span className="document-position">
                  Document {Math.max(1, activeIndex + 1)} of {totalDocs}
                </span>
              </h2>
            </div>
            <div className="review-actions">
              <button onClick={() => openFilePicker(currentCategory)}>
                <FolderSearch size={15} /> Choose PDFs
              </button>
              <button
                onClick={() => handleRandomizeCategory(currentCategory)}
                title="Replace the current selection with two random PDFs"
              >
                <Shuffle size={14} /> Resample
              </button>
            </div>
          </div>
          <div className="review-columns">
            {/* LEFT COLUMN: PDF Viewport */}
            <div className="pdf-panel">
              <div className="flex h-9 shrink-0 items-center justify-between px-2 mb-2">
                <div className="flex items-center gap-2 overflow-hidden mr-4">
                  <span className="rounded bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700 shadow-2xs border border-slate-200/80 shrink-0">
                    {currentCategory}
                  </span>
                  <span className="text-xs font-medium text-slate-700 truncate" title={selectedDocPath}>
                    {selectedDocPath.split("/").pop()}
                  </span>
                </div>

                <span className="pdf-page-title">
                  Page {selectedPage} of {visiblePageCount || (pageMetadataError ? "?" : "…")}
                </span>

                <div className="flex items-center gap-3 shrink-0">
                  <a
                    href={`/api/pdf?path=${encodeURIComponent(selectedDocPath)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline transition"
                    title="Open full PDF in a new tab"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open in tab</span>
                  </a>
                </div>
              </div>

              <div className="pdf-page-preview flex-1 w-full rounded-xl border border-slate-200 bg-white shadow-xs overflow-auto">
                {selectedDocPath ? (
                  pagePreviewError ? (
                    <div className="preview-fallback">
                      Page preview unavailable.{" "}
                      <button onClick={() => setPagePreviewErrorKey("")}>Retry preview</button> ·{" "}
                      <a href={`/api/pdf?path=${encodeURIComponent(selectedDocPath)}`} target="_blank" rel="noreferrer">
                        Open the PDF
                      </a>
                    </div>
                  ) : (
                    // A page rendered on demand by /api/pdf; next/image optimisation does not apply.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${selectedDocPath}-${selectedPage}`}
                      src={`/api/pdf?path=${encodeURIComponent(selectedDocPath)}&preview=true&page=${selectedPage}`}
                      alt={`Page ${selectedPage} of ${selectedDocPath.split("/").pop() || "PDF"}`}
                      onError={() => setPagePreviewErrorKey(pagePreviewKey)}
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">No PDF selected</div>
                )}
              </div>
              <div className="pdf-page-footer" aria-label="PDF page navigation">
                <div className="pdf-page-control">
                  <button
                    aria-label="Previous PDF page"
                    disabled={selectedPage <= 1}
                    onClick={() => setSelectedPage((page) => Math.max(1, page - 1))}
                  >
                    ‹
                  </button>
                  <label htmlFor="pdf-page-jump">Page</label>
                  <input
                    id="pdf-page-jump"
                    type="number"
                    min={1}
                    max={visiblePageCount || undefined}
                    value={selectedPage}
                    disabled={!visiblePageCount}
                    onChange={(event) =>
                      setSelectedPage(Math.max(1, Math.min(visiblePageCount || 1, Number(event.target.value) || 1)))
                    }
                  />
                  <span>of {visiblePageCount || (pageMetadataError ? "?" : "…")}</span>
                  <button
                    aria-label="Next PDF page"
                    disabled={!visiblePageCount || selectedPage >= visiblePageCount}
                    onClick={() => setSelectedPage((page) => Math.min(visiblePageCount, page + 1))}
                  >
                    ›
                  </button>
                </div>
                <span className="pdf-page-hint">
                  Page {selectedPage} of {visiblePageCount || (pageMetadataError ? "?" : "…")}
                </span>
              </div>
            </div>

            {/* RIGHT COLUMN: Annotation Canvas */}
            <div className="annotation-panel">
              <div className="annotation-heading">
                <div>
                  <span className="text-xs font-semibold text-slate-900">Annotation</span>
                  <p className="text-[11px] text-slate-400">Review the source and record verified values.</p>
                </div>

                <button
                  onClick={toggleCompleted}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                    activeAnnotation?.completed
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-2xs"
                      : "bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200/70"
                  }`}
                >
                  <CheckCircle2
                    className={`h-3.5 w-3.5 ${activeAnnotation?.completed ? "text-emerald-600" : "text-slate-400"}`}
                  />
                  <span>{activeAnnotation?.completed ? "Completed" : "Mark Complete"}</span>
                </button>
              </div>

              <nav className="workflow-tabs" aria-label="Page annotation workflow">
                {(["classification", "extraction", "summary"] as const).map((tab) => (
                  <button
                    key={tab}
                    className={workflowTab === tab ? "active" : ""}
                    aria-current={workflowTab === tab ? "page" : undefined}
                    onClick={() => setWorkflowTab(tab)}
                  >
                    {tab === "classification" ? "Classification" : tab === "extraction" ? "Extraction" : "Summary"}
                  </button>
                ))}
                <button className="workflow-export" onClick={handleExportPageOutput}>
                  Export JSONL
                </button>
              </nav>

              <div className="annotation-form flex-1 overflow-y-auto space-y-7">
                {workflowTab === "classification" && (
                  <section className="document-classification">
                    <div className="document-classification-heading">
                      <div>
                        <h3 className="section-title">Page classification</h3>
                        <p>
                          {visiblePageCount
                            ? `${activeAnnotation?.pageClassifications?.filter((item) => item.label).length || 0} of ${visiblePageCount} pages labeled`
                            : pageMetadataError
                              ? "Page count unavailable. Check that Poppler is installed."
                              : "Loading page count…"}
                        </p>
                      </div>
                      {!activeAnnotation?.documentClassificationReviewed &&
                        activeAnnotation?.documentClassification && (
                          <span className="classification-suggestion">Folder suggestion</span>
                        )}
                    </div>
                    <label htmlFor="document-classification-select">Whole PDF suggestion</label>
                    <div className="whole-document-classification">
                      <select
                        id="document-classification-select"
                        value={documentClassificationKey}
                        onChange={(event) => changeDocumentClassification(event.target.value)}
                      >
                        <option value="" disabled>
                          Choose a document type…
                        </option>
                        {DOCUMENT_CLASSIFICATIONS.map(({ key, label }) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!documentClassificationKey || !visiblePageCount}
                        onClick={() => applyClassificationRange(1, visiblePageCount, documentClassificationKey)}
                      >
                        Apply to all pages
                      </button>
                    </div>

                    <div className="classification-ranges">
                      <div className="classification-ranges-heading">
                        <strong>Page type ranges</strong>
                        <button type="button" onClick={() => setRangeEditorOpen((open) => !open)}>
                          {rangeEditorOpen ? "Close range editor" : "Edit page ranges"}
                        </button>
                      </div>
                      <div className="classification-range-list">
                        {classificationRanges.map((range) => {
                          const label =
                            PAGE_CLASSIFICATIONS.find((item) => item.key === range.label)?.label || "Unclassified";
                          return (
                            <button
                              type="button"
                              key={`${range.startPage}-${range.endPage}-${range.label}`}
                              onClick={() => {
                                setSelectedPage(range.startPage);
                                setRangeStart(range.startPage);
                                setRangeEnd(range.endPage);
                                setRangeLabel(range.label);
                              }}
                              className={`classification-range ${selectedPage >= range.startPage && selectedPage <= range.endPage ? "selected" : ""}`}
                            >
                              <span>
                                {range.startPage === range.endPage
                                  ? `Page ${range.startPage}`
                                  : `Pages ${range.startPage}–${range.endPage}`}
                              </span>
                              <strong>{label}</strong>
                            </button>
                          );
                        })}
                        {!classificationRanges.length && (
                          <p className="classification-empty">
                            Page labels will appear here after you classify a page or apply a range.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="single-page-classification">
                      <label htmlFor="page-type-select">Page {selectedPage} type</label>
                      <select
                        id="page-type-select"
                        value={currentPageClassification?.label || ""}
                        onChange={(event) => updatePageClassification({ label: event.target.value })}
                      >
                        <option value="">Unclassified</option>
                        {PAGE_CLASSIFICATIONS.map(({ key, label }) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        aria-label={`Evidence note for page ${selectedPage}`}
                        rows={2}
                        value={currentPageClassification?.note || ""}
                        onChange={(event) => updatePageClassification({ note: event.target.value })}
                        placeholder="Evidence note (optional)"
                      />
                      <button
                        className={`page-review-toggle ${currentPageClassification?.reviewed ? "is-reviewed" : ""}`}
                        aria-pressed={Boolean(currentPageClassification?.reviewed)}
                        disabled={!currentPageClassification?.label || currentPageClassification.label === "unclear"}
                        onClick={() => updatePageClassification({ reviewed: !currentPageClassification?.reviewed })}
                      >
                        <CheckCircle2 size={14} />{" "}
                        {currentPageClassification?.reviewed ? "Page reviewed" : "Mark page reviewed"}
                      </button>
                    </div>

                    {rangeEditorOpen && (
                      <div className="range-editor">
                        <p>
                          Apply one type to a continuous page range. Existing exceptions outside the range stay in
                          place.
                        </p>
                        <div className="range-editor-fields">
                          <label>
                            From{" "}
                            <input
                              type="number"
                              min={1}
                              max={visiblePageCount}
                              value={rangeStart}
                              onChange={(event) => setRangeStart(Number(event.target.value) || 0)}
                            />
                          </label>
                          <label>
                            To{" "}
                            <input
                              type="number"
                              min={1}
                              max={visiblePageCount}
                              value={rangeEnd}
                              onChange={(event) => setRangeEnd(Number(event.target.value) || 0)}
                            />
                          </label>
                          <label>
                            Type{" "}
                            <select value={rangeLabel} onChange={(event) => setRangeLabel(event.target.value)}>
                              <option value="">Choose…</option>
                              {PAGE_CLASSIFICATIONS.map(({ key, label }) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          disabled={
                            !rangeLabel ||
                            !visiblePageCount ||
                            rangeStart < 1 ||
                            rangeEnd < rangeStart ||
                            rangeEnd > visiblePageCount
                          }
                          onClick={() => applyClassificationRange(rangeStart, rangeEnd, rangeLabel)}
                        >
                          Apply to range
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {workflowTab === "extraction" && (
                  <section className="page-extraction-section">
                    <div className="workflow-section-heading">
                      <h3 className="section-title">Page extraction</h3>
                      <p>Page {selectedPage} · snake_case keys · missing values stay blank</p>
                    </div>
                    <div className="page-extraction-fields">
                      {pageExtractionKeys.map((key) => (
                        <div className="page-extraction-row" key={key}>
                          <label htmlFor={`page-extraction-${key}`}>
                            {currentFields.find((field) => toSnakeCase(field) === key) || key.replace(/_/g, " ")}
                          </label>
                          <input
                            id={`page-extraction-${key}`}
                            type="text"
                            value={currentPageAnnotation?.extraction?.[key] || ""}
                            onChange={(event) => handlePageExtractionChange(key, event.target.value)}
                          />
                          <button
                            type="button"
                            aria-label={`Remove field ${key}`}
                            onClick={() => removePageExtractionField(key)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div className="add-page-extraction-field">
                        <input
                          aria-label="New snake_case extraction key"
                          value={newExtractionKey}
                          onChange={(event) => setNewExtractionKey(event.target.value)}
                          placeholder="new_field_key"
                        />
                        <button type="button" onClick={addPageExtractionField}>
                          Add field
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {workflowTab === "summary" && (
                  <section className="page-summary-section">
                    <div className="workflow-section-heading">
                      <h3 className="section-title">Page summary</h3>
                      <p>Summary for page {selectedPage}</p>
                    </div>
                    <textarea
                      aria-label={`Summary for page ${selectedPage}`}
                      rows={9}
                      value={currentPageAnnotation?.summary || ""}
                      onChange={(event) => updatePageAnnotation({ summary: event.target.value })}
                      placeholder="Write a concise summary of this page…"
                    />
                    <span className="summary-word-count">
                      {currentPageAnnotation?.summary
                        ? `${currentPageAnnotation.summary.trim().split(/\s+/).filter(Boolean).length} words`
                        : "0 words"}
                    </span>
                  </section>
                )}

                <details className="legacy-reference">
                  <summary>Previous document reference</summary>
                  <p>These existing values stay at document scope and are not copied into page output.</p>
                  <dl>
                    {Object.entries(activeAnnotation?.extraction || {}).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <h4>Document summary</h4>
                  <p>{activeAnnotation?.summary || "No document summary"}</p>
                </details>
              </div>

              <div className="flex h-16 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6">
                <button
                  onClick={handlePrev}
                  disabled={activeIndex <= 0}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none shadow-2xs transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>Previous</span>
                </button>

                <div className="text-center text-[11px] text-slate-400 hidden sm:block">
                  <kbd className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                    ⌘+Enter
                  </kbd>{" "}
                  to advance
                </div>

                <button
                  onClick={handleNext}
                  disabled={activeIndex >= totalDocs - 1}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition"
                >
                  <span>Next Document</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </main>
        {/* Dialog: choose the two PDFs for a category */}
        {pickerCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4">
            <div className="flex h-[580px] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
              <div className="flex h-15 shrink-0 items-center justify-between border-b border-slate-200 px-6">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Choose PDFs for <span className="capitalize text-indigo-600">{pickerCategory}</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Select exactly 2 PDFs. Each may have 1–{MAX_PDF_PAGES} pages and must be 1 MB or smaller.
                  </p>
                </div>
                <button
                  onClick={() => setPickerCategory(null)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder={`Search ${pickerCatInfo?.count || 0} PDFs...`}
                    className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                  {fileSearchQuery && (
                    <button
                      onClick={() => setFileSearchQuery("")}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => void randomizeInsidePicker()}
                  disabled={selectionCheckPending}
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition shrink-0"
                >
                  <Shuffle className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Pick 2 at random</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
                {filteredPickerFiles.map((filePath) => {
                  const isChecked = tempSelectedFiles.includes(filePath);
                  const filename = filePath.split("/").pop();
                  const fileSize = fileMetadata[filePath]?.sizeBytes || findFileSize(filePath, categories);
                  const isOverSize = fileSize > MAX_PDF_BYTES;
                  const pageInfo = fileMetadata[filePath]?.pageCount;
                  const isAnnotated = Boolean(
                    data?.annotations[filePath]?.completed ||
                    Object.values(data?.annotations[filePath]?.extraction || {}).some((v) => v && v.trim().length > 0),
                  );

                  return (
                    <div
                      key={filePath}
                      onClick={() => void togglePickerFile(filePath)}
                      aria-disabled={isOverSize || (selectionCheckPending && !isChecked)}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border p-2.5 text-xs transition ${
                        isOverSize
                          ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60"
                          : isChecked
                            ? "border-indigo-600 bg-indigo-50/40 text-slate-900"
                            : "border-slate-200/80 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/70"
                      }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div
                          className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition ${
                            isChecked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                          }`}
                        >
                          {isChecked && <Check className="h-3 w-3" />}
                        </div>
                        <span className="truncate font-mono text-[11px]">{filename}</span>
                        <small className="picker-file-meta">
                          {isOverSize
                            ? "Over 1 MB · excluded"
                            : pageInfo
                              ? `${pageInfo} page${pageInfo === 1 ? "" : "s"} · ${formatBytes(fileSize)}`
                              : `${formatBytes(fileSize)} · page count checked on select`}
                        </small>
                      </div>

                      {isAnnotated && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                          Has Ground Truth
                        </span>
                      )}
                    </div>
                  );
                })}

                {filteredPickerFiles.length === 0 && (
                  <div className="py-12 text-center text-xs text-slate-400">
                    No files found matching &quot;{fileSearchQuery}&quot;
                  </div>
                )}
              </div>

              <div className="flex h-15 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50/70 px-6">
                <span className="text-xs font-medium text-slate-600">
                  Selected:{" "}
                  <strong className={tempSelectedFiles.length === 2 ? "text-indigo-600" : "text-amber-600"}>
                    {tempSelectedFiles.length} selected · {pickerTotalPages} pages in the whole set
                  </strong>
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPickerCategory(null)}
                    className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyFilePickerSelection}
                    disabled={tempSelectedFiles.length !== 2 || selectionCheckPending}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition"
                  >
                    <span>Apply Selection ({tempSelectedFiles.length})</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
