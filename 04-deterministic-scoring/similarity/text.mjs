/**
 * Text normalisation and lexical similarity for comparing an extracted or classified value with
 * its ground truth. Everything here is deterministic and dependency-free.
 */

/** Flatten any JSON value into comparable text: arrays and objects become "a; b; c". */
export function valueToText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join("; ");
  if (typeof value === "object") return Object.values(value).map(valueToText).filter(Boolean).join("; ");
  return String(value);
}

/** Lowercase, unify quotes and dashes, collapse whitespace, trim surrounding punctuation. */
export function normalizeText(value) {
  return valueToText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:'"]+|[\s.,;:'"]+$/g, "");
}

export function tokens(text) {
  return normalizeText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Word-level F1 over token multisets — order-insensitive word overlap. */
export function tokenF1(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const counts = new Map();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of tb) {
    const n = counts.get(t);
    if (n) {
      overlap++;
      counts.set(t, n - 1);
    }
  }
  if (!overlap) return 0;
  const precision = overlap / tb.length;
  const recall = overlap / ta.length;
  return (2 * precision * recall) / (precision + recall);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Character-level similarity: 1 − edit distance / longer length, on normalised text. */
export function charSimilarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  const longest = Math.max(na.length, nb.length);
  return longest === 0 ? 1 : 1 - levenshtein(na, nb) / longest;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_LIKE = new RegExp(
  `^(\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{1,4}|(${MONTHS})[a-z]*\\.? \\d{1,2},? \\d{2,4}|\\d{1,2} (${MONTHS})[a-z]*\\.?,? \\d{2,4})$`,
);

/** ISO date (YYYY-MM-DD) for a value that is only a date; null otherwise. Month-first for d/m/y. */
export function canonicalDate(value) {
  const text = normalizeText(value);
  if (!DATE_LIKE.test(text)) return null;
  let m = text.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return iso(expandYear(Number(m[3])), Number(m[1]), Number(m[2]));
  const namedFirst = text.match(/^([a-z]+)\.? (\d{1,2}),? (\d{2,4})$/);
  const namedLast = text.match(/^(\d{1,2}) ([a-z]+)\.?,? (\d{2,4})$/);
  const named = namedFirst
    ? { month: namedFirst[1], day: Number(namedFirst[2]), year: Number(namedFirst[3]) }
    : namedLast
      ? { month: namedLast[2], day: Number(namedLast[1]), year: Number(namedLast[3]) }
      : null;
  if (!named) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.findIndex((prefix) => named.month.startsWith(prefix)) + 1;
  return month ? iso(expandYear(named.year), month, named.day) : null;
}

/** Canonicalize common written and RFC-style date-times without dropping timezone data. */
export function canonicalDateTime(value) {
  let text = normalizeText(value)
    .replace(/\bat\b/g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const months = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const pattern = new RegExp(
    `^(?:(?:[a-z]{3,9})\\s+)?(?:(\\d{1,2})\\s+([a-z]{3,9})|([a-z]{3,9})\\s+(\\d{1,2}))\\s+(\\d{4})\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(am|pm)?(?:\\s+([a-z]{2,5}|[+-]\\d{2}:?\\d{2}))?$`,
  );
  const match = text.match(pattern);
  if (!match) return null;
  const day = Number(match[1] ?? match[4]);
  const monthText = (match[2] ?? match[3]).slice(0, 3);
  const month = months[monthText];
  const year = Number(match[5]);
  let hour = Number(match[6]);
  const minute = Number(match[7]);
  const second = Number(match[8] ?? 0);
  const meridiem = match[9];
  const zone = match[10] ?? "";
  if (!month || minute > 59 || second > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  const date = iso(year, month, day);
  if (!date) return null;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${zone ? ` ${zone.toUpperCase()}` : ""}`;
}

/** Canonicalize an explicit year range, including shortened ending years (2014–15). */
export function canonicalFiscalPeriod(value) {
  const text = normalizeText(value);
  const match = text.match(/\b(19\d{2}|20\d{2})\s*[-–/]\s*(\d{2}|19\d{2}|20\d{2})\b/);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  if (end < start || end > start + 1) return null;
  return `${start}-${end}`;
}

function expandYear(y) {
  return y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
}

function iso(y, mo, d) {
  const daysInMonth = mo >= 1 && mo <= 12 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The numbers a value mentions, canonicalised ("$1,250.00" → "1250"), sorted. Dates are reduced
 * to their ISO form first so "12/18/2013" and "Dec 18, 2013" agree.
 */
export function numberSignature(value) {
  const date = canonicalDate(value);
  if (date) return [date];
  const found = normalizeText(value).match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found.map((n) => String(Number(n.replace(/,/g, "")))).sort();
}

/**
 * Canonical form used for the exact-match shortcut: a date, a bare number/amount, or normalised
 * text with punctuation removed.
 */
export function canonicalValue(value) {
  const date = canonicalDate(value);
  if (date) return `date:${date}`;
  const text = normalizeText(value);
  const amount = text.replace(/^[$€£¥]\s?|\s?(usd|eur|gbp)$/g, "");
  if (/^-?[\d,]+(\.\d+)?$/.test(amount)) return `num:${Number(amount.replace(/,/g, ""))}`;
  return `text:${tokens(text).join(" ")}`;
}
