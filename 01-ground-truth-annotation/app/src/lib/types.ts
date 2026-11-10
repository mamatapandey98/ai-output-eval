export interface ExtractionField {
  name: string;
  value: string;
}

export interface DocumentAnnotation {
  relativePath: string;
  category: string;
  filename: string;
  extraction: Record<string, string>; // fieldName -> value
  summary: string;
  documentClassification?: string;
  documentClassificationReviewed?: boolean;
  documentSegments?: DocumentSegment[];
  pageClassifications?: PageClassification[];
  pageAnnotations?: PageAnnotation[];
  pageExtractionKeys?: string[];
  excludedPageExtractionKeys?: string[];
  completed: boolean;
  updatedAt: string;
}

export interface DocumentSegment {
  id: string;
  startPage: number;
  endPage: number;
  label: string;
  title?: string;
}

export interface PageClassification {
  page: number;
  label: string;
  reviewed?: boolean;
  note?: string;
}

export interface PageAnnotation {
  page: number;
  extraction: Record<string, string>;
  summary: string;
  reviewed?: boolean;
}

export interface GroundTruthData {
  updatedAt: string;
  categorySchemas: Record<string, string[]>; // categoryName -> [5 field names]
  selectedCategories: string[];
  selectedDocuments: string[]; // relative paths of the 10 selected documents (2 per category)
  annotations: Record<string, DocumentAnnotation>; // relativePath -> annotation
}

export interface CategoryInfo {
  name: string;
  count: number;
  files: string[];
  fileSizes: Record<string, number>;
}
