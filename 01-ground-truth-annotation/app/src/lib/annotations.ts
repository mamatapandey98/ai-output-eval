import { FALLBACK_FIELDS } from "@/lib/constants";
import { DocumentAnnotation } from "@/lib/types";

/** An empty annotation for a newly selected PDF: every schema field present, all blank. */
export function blankAnnotation(
  docPath: string,
  category: string,
  fields: string[] = FALLBACK_FIELDS,
): DocumentAnnotation {
  return {
    relativePath: docPath,
    category,
    filename: docPath.split("/").pop() || "",
    extraction: Object.fromEntries(fields.map((field) => [field, ""])),
    summary: "",
    completed: false,
    updatedAt: new Date().toISOString(),
  };
}
