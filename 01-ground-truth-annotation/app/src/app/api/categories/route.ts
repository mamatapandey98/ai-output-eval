import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { DEFAULT_CATEGORIES, DEFAULT_SCHEMAS, DEFAULT_RECOMMENDED_DOCS } from "@/lib/constants";
import { DATA_DIR } from "@/lib/files";
import { CategoryInfo } from "@/lib/types";

// GET /api/categories: every category folder in the corpus, with its PDFs and their sizes.
export async function GET() {
  try {
    const categories: CategoryInfo[] = fs
      .readdirSync(DATA_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => {
        const files = fs
          .readdirSync(path.join(DATA_DIR, entry.name))
          .filter((file) => file.toLowerCase().endsWith(".pdf"))
          .sort();
        const filePaths = files.map((file) => `${entry.name}/${file}`);
        const fileSizes = Object.fromEntries(
          filePaths.map((file) => [file, fs.statSync(path.join(DATA_DIR, file)).size]),
        );
        return { name: entry.name, count: files.length, files: filePaths, fileSizes };
      });

    // The evaluated categories first, in their usual order, then the rest alphabetically.
    const rank = (name: string) => {
      const index = DEFAULT_CATEGORIES.indexOf(name);
      return index === -1 ? DEFAULT_CATEGORIES.length : index;
    };
    categories.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

    return NextResponse.json({
      categories,
      defaultCategories: DEFAULT_CATEGORIES,
      defaultSchemas: DEFAULT_SCHEMAS,
      defaultRecommendedDocs: DEFAULT_RECOMMENDED_DOCS,
    });
  } catch (error) {
    console.error(`Failed to read the data directory ${DATA_DIR}:`, error);
    return NextResponse.json({ error: `Failed to read the data directory (${DATA_DIR})` }, { status: 500 });
  }
}
