import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { readPageCount, resolveDataPath } from "@/lib/files";

// GET /api/pdf?path=<category/file.pdf>            the PDF itself
// GET /api/pdf?path=...&metadata=true              { pageCount, sizeBytes }
// GET /api/pdf?path=...&preview=true&page=<n>      one page rendered as PNG
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get("path");
  if (!requestedPath) return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });

  let absolutePath: string;
  try {
    absolutePath = resolveDataPath(requestedPath, { pdfOnly: true });
  } catch {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (!fs.existsSync(absolutePath)) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const stat = fs.statSync(absolutePath);

  if (searchParams.get("metadata") === "true") {
    try {
      return NextResponse.json({ pageCount: readPageCount(absolutePath), sizeBytes: stat.size });
    } catch {
      return NextResponse.json({ error: "Unable to read PDF metadata" }, { status: 422 });
    }
  }

  if (searchParams.get("preview") === "true") {
    const page = Number(searchParams.get("page"));
    if (!Number.isInteger(page) || page < 1)
      return NextResponse.json({ error: "Invalid PDF page number" }, { status: 400 });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-preview-"));
    const outputPrefix = path.join(tempDir, "page");
    try {
      execFileSync(
        "pdftoppm",
        [
          "-f",
          String(page),
          "-l",
          String(page),
          "-singlefile",
          "-png",
          "-scale-to",
          "1400",
          absolutePath,
          outputPrefix,
        ],
        { maxBuffer: 20 * 1024 * 1024, timeout: 15_000 },
      );
      const png = fs.readFileSync(`${outputPrefix}.png`);
      return new NextResponse(png, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "Unable to render this PDF page" }, { status: 422 });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return new NextResponse(fs.readFileSync(absolutePath), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size.toString(),
      "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(absolutePath))}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
