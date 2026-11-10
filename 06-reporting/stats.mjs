export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values) {
  return quantile(values, 0.5);
}

/** Median absolute deviation. */
export function mad(values) {
  const m = median(values);
  return m === null ? null : median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust z-score: (x - median) / (1.4826 · MAD). 1.4826 scales MAD to σ for normal data.
 * Returns null when MAD is 0 (most values identical) — callers fall back to an absolute gap.
 */
export function robustZ(value, values) {
  const spread = mad(values);
  if (!spread) return null;
  return (value - median(values)) / (1.4826 * spread);
}

export function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
