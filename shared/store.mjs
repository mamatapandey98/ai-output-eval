/**
 * One folder per evaluation run:
 *   runs/<runId>/manifest.json                        documents, variants, pipelines, settings
 *   runs/<runId>/raw/<doc>__<variant>__<job>.json     DocWeaver outcome of one task
 *   runs/<runId>/scores/<doc>__<variant>__<job>.json  score of that outcome against ground truth
 *   runs/<runId>/report.{json,md,html}
 * Every step skips work whose file already exists, so an interrupted run resumes.
 */
import fs from "node:fs";
import path from "node:path";

export function newRunId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

export class RunStore {
  constructor(runsDir, runId) {
    this.runId = runId;
    this.dir = path.join(runsDir, runId);
  }

  static latest(runsDir) {
    if (!fs.existsSync(runsDir)) return null;
    const ids = fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(runsDir, d.name, "manifest.json")))
      .map((d) => d.name)
      .sort();
    return ids.length ? new RunStore(runsDir, ids.at(-1)) : null;
  }

  path(...parts) {
    return path.join(this.dir, ...parts);
  }

  write(rel, value) {
    const file = this.path(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    // Write-then-rename so a crash never leaves a half-written file that resume would trust.
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
    return file;
  }

  read(rel) {
    return JSON.parse(fs.readFileSync(this.path(rel), "utf8"));
  }

  has(rel) {
    return fs.existsSync(this.path(rel));
  }

  static key(documentId, variantId, job) {
    return `${documentId}__${variantId}__${job}`;
  }

  rawFile(documentId, variantId, job) {
    return `raw/${RunStore.key(documentId, variantId, job)}.json`;
  }

  scoreFile(documentId, variantId, job) {
    return `scores/${RunStore.key(documentId, variantId, job)}.json`;
  }
}
