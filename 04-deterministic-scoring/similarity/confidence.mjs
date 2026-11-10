/**
 * Confidence that a predicted value matches its ground truth, on a 0–1 scale:
 *
 *   confidence = w_cos · cosine′ + w_word · wordF1 + w_char · charSimilarity
 *
 * where cosine′ rescales embedding cosine so that `cosineFloor` (the similarity of unrelated
 * text for the chosen model) maps to 0. Short-circuits and guards keep it honest:
 *   - same canonical value (case, punctuation, date or amount formatting aside) → 1
 *   - one side empty → 0 ("missing" or "hallucinated"); both empty → 1 ("agreed-empty")
 *   - typed numeric fields (amounts, dates, IDs, periods) differ → capped at
 *     `numericMismatchCap`; free-text fields can contain additional dates or numbers without
 *     triggering a hard conflict cap.
 */
import { cosine } from "./embedder.mjs";
import {
  canonicalDate,
  canonicalDateTime,
  canonicalFiscalPeriod,
  canonicalValue,
  charSimilarity,
  normalizeText,
  numberSignature,
  tokenF1,
} from "./text.mjs";

function verdictFor(confidence, settings) {
  if (confidence >= settings.matchThreshold) return "match";
  if (confidence >= settings.partialThreshold) return "partial";
  return "mismatch";
}

const round3 = (n) => Math.round(n * 1000) / 1000;

function moneySignature(value) {
  let text = normalizeText(value);
  // Totals often have a text-only note in parentheses, such as “(Balanced Budget)”. Compare
  // the stated amount without accepting a suffix that introduces another number/currency.
  text = text.replace(/\s*\([^()]*\)\s*$/, (suffix) => (/[\d$€£₹]/.test(suffix) ? suffix : ""));
  const currencies = [
    [/\b(?:usd|us dollars?)\b|\$/, "USD"],
    [/\b(?:eur|euros?)\b|€/, "EUR"],
    [/\b(?:gbp|pounds?)\b|£/, "GBP"],
    [/\b(?:inr|rupees?)\b|₹/, "INR"],
    [/\b(?:cad|canadian dollars?)\b/, "CAD"],
    [/\b(?:aud|australian dollars?)\b/, "AUD"],
  ];
  const found = currencies.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
  if (found.length > 1) return null;
  for (const [pattern] of currencies) text = text.replace(pattern, " ");
  const numeric = text.replace(/[\s,]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(numeric)) return null;
  return { currency: found[0] ?? null, amount: Number(numeric) };
}

function canonicalByline(value) {
  return normalizeText(value)
    .replace(/^by\s+/, "")
    .replace(/\s+of\s+(?:the\s+)?[^,]+$/, "")
    .replace(/[.,]+$/, "")
    .trim();
}

function canonicalContactName(value) {
  return normalizeText(value)
    .replace(/\s*<[^<>\s]+@[^<>\s]+>\s*/g, " ")
    .replace(/\s*\([^()]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contactEmails(value) {
  return normalizeText(value).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/g) ?? [];
}

function contactsMatch(expected, predicted) {
  const expectedName = canonicalContactName(expected);
  const predictedName = canonicalContactName(predicted);
  if (expectedName && predictedName && expectedName === predictedName) return true;
  const predictedEmails = new Set(contactEmails(predicted));
  return contactEmails(expected).some((email) => predictedEmails.has(email));
}

function canonicalPublication(value) {
  return normalizeText(value).replace(/^the\s+/, "");
}

/**
 * Score many (expected, predicted) pairs with one embedding call.
 *
 * @param {{ expected: unknown, predicted: unknown }[]} pairs
 * @param {{ embed: (texts: string[]) => Promise<number[][]> }} embedder
 * @param {{ weights: { cosine: number, word: number, char: number }, cosineFloor: number,
 *           matchThreshold: number, partialThreshold: number, numericMismatchCap: number }} settings
 * @returns {Promise<object[]>} one result per pair, in order.
 */
export async function scorePairs(pairs, embedder, settings) {
  const prepared = pairs.map(({ expected, predicted, field }) => ({
    e: normalizeText(expected),
    p: normalizeText(predicted),
    fieldName: String(field?.name ?? "").toLowerCase(),
    fieldType: String(field?.type ?? "").toLowerCase(),
    allowEmbedding: field?.useEmbeddings !== false,
  }));
  const needsEmbedding = prepared.filter(
    ({ e, p, allowEmbedding }) => allowEmbedding && e && p && canonicalValue(e) !== canonicalValue(p),
  );
  const texts = [...new Set(needsEmbedding.flatMap(({ e, p }) => [e, p]))];
  const vectors = texts.length && embedder ? await embedder.embed(texts) : [];
  const vectorOf = new Map(texts.map((t, i) => [t, vectors[i]]));
  const { weights, cosineFloor } = settings;
  const weightSum = weights.cosine + weights.word + weights.char;

  return prepared.map(({ e, p, fieldName, fieldType, allowEmbedding }) => {
    if (!e && !p) return { confidence: 1, verdict: "agreed-empty", method: "empty" };
    if (!p) return { confidence: 0, verdict: "missing", method: "empty" };
    if (!e) return { confidence: 0, verdict: "hallucinated", method: "empty" };
    const dateField = /date|time/.test(fieldType) || /\b(date|time|period ending|reporting period)\b/.test(fieldName);
    const moneyField =
      /currency|money|amount/.test(fieldType) ||
      /\b(amount|total|subtotal|tax|price|cost|balance|fee|payment|budget|revenue|expenditure)\b/.test(fieldName);
    const idField = /\b(id|number|code|identifier|invoice|account|reference|po)\b/.test(fieldName);
    const expectedMoney = moneyField ? moneySignature(e) : null;
    const predictedMoney = moneyField ? moneySignature(p) : null;
    const zeroBalanceDash = Boolean(
      moneyField &&
      /balance|surplus|deficit|difference/.test(fieldName) &&
      expectedMoney?.amount === 0 &&
      /^[-–—]+$/.test(p),
    );
    const expectedDateTime = dateField ? canonicalDateTime(e) : null;
    const predictedDateTime = dateField ? canonicalDateTime(p) : null;
    const fiscalPeriodField = /fiscal year|year\s*\/\s*period|\bperiod\b/.test(fieldName);
    const expectedFiscalPeriod = fiscalPeriodField ? canonicalFiscalPeriod(e) : null;
    const predictedFiscalPeriod = fiscalPeriodField ? canonicalFiscalPeriod(p) : null;
    const contactField = /\b(from|to|sender|recipient)\b/.test(fieldName);
    const bylineField = /\b(author|byline)\b/.test(fieldName);
    const publicationField = /publication source|publication organization/.test(fieldName);
    const expectedZone = expectedDateTime?.split(" ")[1] ?? null;
    const predictedZone = predictedDateTime?.split(" ")[1] ?? null;
    const sameDateTime = Boolean(
      expectedDateTime &&
      predictedDateTime &&
      expectedDateTime.split(" ")[0] === predictedDateTime.split(" ")[0] &&
      (!expectedZone || !predictedZone || expectedZone === predictedZone),
    );
    const dateTimeConflict = Boolean(expectedDateTime && predictedDateTime && !sameDateTime);
    const sameAmount = Boolean(expectedMoney && predictedMoney && expectedMoney.amount === predictedMoney.amount);
    const explicitCurrencyConflict = Boolean(
      sameAmount &&
      expectedMoney.currency &&
      predictedMoney.currency &&
      expectedMoney.currency !== predictedMoney.currency,
    );
    const currencyOmitted = Boolean(
      sameAmount && expectedMoney.currency !== predictedMoney.currency && !explicitCurrencyConflict,
    );
    const exact = zeroBalanceDash
      ? true
      : expectedFiscalPeriod && predictedFiscalPeriod
        ? expectedFiscalPeriod === predictedFiscalPeriod
        : contactField
          ? contactsMatch(e, p)
          : bylineField && canonicalByline(e) && canonicalByline(p)
            ? canonicalByline(e) === canonicalByline(p)
            : publicationField && canonicalPublication(e) && canonicalPublication(p)
              ? canonicalPublication(e) === canonicalPublication(p)
              : expectedDateTime && predictedDateTime
                ? sameDateTime
                : dateField && canonicalDate(e) && canonicalDate(p)
                  ? canonicalDate(e) === canonicalDate(p)
                  : expectedMoney && predictedMoney
                    ? sameAmount && !explicitCurrencyConflict
                    : canonicalValue(e) === canonicalValue(p);
    if (exact) {
      const method = e === p ? "exact" : "normalized";
      const normalization = zeroBalanceDash
        ? "zero-balance-dash"
        : expectedFiscalPeriod && predictedFiscalPeriod
          ? "fiscal-period-range-format"
          : contactField && contactsMatch(e, p)
            ? "contact-name-or-exact-email"
            : bylineField && canonicalByline(e) === canonicalByline(p)
              ? "byline-format"
              : publicationField && canonicalPublication(e) === canonicalPublication(p)
                ? "publication-article"
                : expectedDateTime && predictedDateTime
                  ? expectedZone !== predictedZone
                    ? "date-time-format-timezone-unspecified"
                    : "date-time-format"
                  : dateField && canonicalDate(e) && canonicalDate(p)
                    ? "date-format"
                    : expectedMoney && predictedMoney
                      ? currencyOmitted
                        ? "amount-currency-unspecified-on-one-side"
                        : "currency-amount-format"
                      : method === "normalized"
                        ? "case-spacing-or-punctuation"
                        : undefined;
      return { confidence: 1, verdict: "match", method, ...(normalization && { normalization }) };
    }

    const word = tokenF1(e, p);
    const char = charSimilarity(e, p);
    // The configured embedding model is optional. In offline scoring, explicitly report the
    // deterministic lexical fallback instead of attempting an implicit model download.
    const vectorE = allowEmbedding ? vectorOf.get(e) : null;
    const vectorP = allowEmbedding ? vectorOf.get(p) : null;
    const hasEmbedding = Boolean(vectorE && vectorP);
    const rawCosine = hasEmbedding ? cosine(vectorE, vectorP) : null;
    const cos = hasEmbedding ? Math.min(1, Math.max(0, (rawCosine - cosineFloor) / (1 - cosineFloor))) : null;
    let confidence = hasEmbedding
      ? (weights.cosine * cos + weights.word * word + weights.char * char) / weightSum
      : 0.7 * word + 0.3 * char;

    const ne = numberSignature(e);
    const np = numberSignature(p);
    const strictNumericField = dateField || moneyField || idField || fiscalPeriodField;
    const numericMismatch = dateTimeConflict
      ? true
      : moneyField && expectedMoney && predictedMoney
        ? !sameAmount || explicitCurrencyConflict
        : idField
          ? /\d/.test(e) && /\d/.test(p) && canonicalValue(e) !== canonicalValue(p)
          : strictNumericField && ne.length > 0 && np.length > 0 && ne.join("|") !== np.join("|");
    if (numericMismatch) confidence = Math.min(confidence, settings.numericMismatchCap);

    return {
      confidence: round3(confidence),
      verdict: verdictFor(confidence, settings),
      method: hasEmbedding ? "embedding+lexical" : "lexical-only",
      ...(hasEmbedding && { cosine: round3(rawCosine) }),
      word: round3(word),
      char: round3(char),
      ...(!hasEmbedding && { limitation: "lexical overlap is not a semantic paraphrase judge" }),
      ...(numericMismatch && { numericMismatch: true }),
    };
  });
}
