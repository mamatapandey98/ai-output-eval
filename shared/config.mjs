/**
 * Loads eval.config.json and the files it points at. Relative paths resolve against the
 * project root, so commands work from any working directory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_NAMES } from "../01-ground-truth-annotation/ground-truth.mjs";

export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CONFIG = path.join(PROJECT_DIR, "config/eval.config.json");

const PATH_KEYS = [
  "credentialsFile",
  "dataDir",
  "groundTruthFile",
  "variantsFile",
  "runsDir",
  "evidenceDir",
  "screensDir",
  "cacheDir",
];

export function resolveFromProject(p) {
  return path.isAbsolute(p) ? p : path.join(PROJECT_DIR, p);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadConfig(configPath = DEFAULT_CONFIG) {
  const config = readJson(configPath);
  for (const key of PATH_KEYS) if (config[key]) config[key] = resolveFromProject(config[key]);
  const unknownJobs = (config.jobs ?? []).filter((j) => !JOB_NAMES.includes(j));
  if (!config.jobs?.length || unknownJobs.length) {
    throw new Error(
      `config.jobs must list some of ${JOB_NAMES.join(", ")}${unknownJobs.length ? ` (unknown: ${unknownJobs.join(", ")})` : ""}`,
    );
  }
  return config;
}

export function loadVariants(config) {
  const { variants } = readJson(config.variantsFile);
  const ids = new Set();
  for (const v of variants) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(v.id)) throw new Error(`variant id "${v.id}" must be kebab-case`);
    if (ids.has(v.id)) throw new Error(`duplicate variant id "${v.id}"`);
    ids.add(v.id);
  }
  return variants;
}

/**
 * DocWeaver credentials: DW_EMAIL / DW_PASSWORD (from .env or the shell). Optionally,
 * `credentialsFile` in the config may point at a gitignored JSON file of { username, password }.
 * Nothing secret lives in this repo.
 */
export function loadCredentials(config) {
  if (process.env.DW_EMAIL && process.env.DW_PASSWORD) {
    return { email: process.env.DW_EMAIL, password: process.env.DW_PASSWORD };
  }
  if (!config.credentialsFile || !fs.existsSync(config.credentialsFile)) {
    throw new Error(
      `no DocWeaver credentials: set DW_EMAIL/DW_PASSWORD in .env${config.credentialsFile ? ` or create ${config.credentialsFile}` : ""}`,
    );
  }
  const env = readJson(config.credentialsFile);
  return { email: env.username, password: env.password };
}
