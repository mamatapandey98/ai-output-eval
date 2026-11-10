export const DEFAULT_CATEGORIES = ["invoice", "letter", "email", "budget", "news article"];

export const MAX_PDF_PAGES = 15;
export const MAX_PDF_BYTES = 1_048_576;
export const RESERVED_PAGE_OUTPUT_KEYS = ["pg_no", "document_type", "generation_response"] as const;

export const PAGE_CLASSIFICATIONS = [
  { key: "invoice", label: "Invoice" },
  { key: "letter", label: "Letter" },
  { key: "email", label: "Email" },
  { key: "memo", label: "Memo" },
  { key: "budget", label: "Budget" },
  { key: "news_article", label: "News Article" },
  { key: "scientific_publication", label: "Scientific Publication" },
  { key: "report", label: "Report" },
  { key: "form", label: "Form" },
  { key: "table", label: "Table" },
  { key: "cover", label: "Cover Page" },
  { key: "blank", label: "Blank Page" },
  { key: "other", label: "Other" },
  { key: "unclear", label: "Unclear" },
] as const;

export const DOCUMENT_CLASSIFICATIONS = [
  { key: "invoice", label: "Invoice" },
  { key: "letter", label: "Letter" },
  { key: "email", label: "Email" },
  { key: "memo", label: "Memo" },
  { key: "budget", label: "Budget" },
  { key: "news_article", label: "News Article" },
  { key: "scientific_publication", label: "Scientific Publication" },
  { key: "report", label: "Report" },
  { key: "form", label: "Form" },
  { key: "other", label: "Other" },
  { key: "unclear", label: "Unclear" },
] as const;

export const DEFAULT_SCHEMAS: Record<string, string[]> = {
  invoice: ["Invoice Number", "Invoice Date", "Vendor / Seller Name", "Total Amount", "Due Date"],
  letter: [
    "Letter Date",
    "Sender Name / Organization",
    "Recipient Name / Organization",
    "Subject / Reference",
    "Main Purpose / Request",
  ],
  memo: ["Memo Date", "To (Recipient)", "From (Sender)", "Subject / Re", "Key Objective / Directive"],
  email: ["Date / Time", "From (Sender)", "To (Recipient)", "Subject", "Core Message / Action Item"],
  "scientific publication": [
    "Document Title",
    "Primary Authors",
    "Publication / Journal Year",
    "DOI or Affiliation",
    "Key Research Finding / Conclusion",
  ],
  budget: [
    "Fiscal Year / Period",
    "Organization / Department Name",
    "Total Budget / Revenue",
    "Total Expenditure / Costs",
    "Net Balance / Surplus / Deficit",
  ],
  "news article": [
    "Headline / Title",
    "Author / Byline",
    "Publication Date",
    "Publication Source / Organization",
    "Primary Subject / Topic",
  ],
};

export const DEFAULT_RECOMMENDED_DOCS: Record<string, string[]> = {
  budget: ["budget/1165158-encore-budget-fy15.pdf", "budget/1165040-singleton-budget.pdf"],
  "news article": [
    "news article/3903433-Consumer-Alert-Newspaper.pdf",
    "news article/2071912-conservative-groups-push-development-missoulan.pdf",
  ],
  invoice: ["invoice/5978221-Sprout-Invoice.pdf", "invoice/20694747-invoice.pdf"],
  letter: ["letter/1009064-letter-from-gov-terry-mcauliffe.pdf", "letter/1004917-mayors-letter.pdf"],
  email: ["email/3862260-Kloor-on-Nature-Article.pdf", "email/3892423-RE-your-Forbes-article.pdf"],
};

// Placeholder field names for a category that has no schema yet.
export const FALLBACK_FIELDS = ["Field 1", "Field 2", "Field 3", "Field 4", "Field 5"];
