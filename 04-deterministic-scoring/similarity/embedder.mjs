/**
 * Sentence embeddings for semantic similarity. The default runs a small model locally through
 * transformers.js (ONNX), so scoring needs no API key and gives the same numbers on every run.
 * The model downloads once into `cacheDir`; after that, scoring works offline.
 *
 * Any object with `embed(texts) → Promise<number[][]>` (unit-length vectors) can stand in, which
 * is how the tests run without the model.
 */

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * @param {{ model: string, cacheDir: string }} options
 * @returns {{ model: string, embed: (texts: string[]) => Promise<number[][]> }}
 */
export function createLocalEmbedder({ model, cacheDir }) {
  let extractor;
  return {
    model,
    async embed(texts) {
      if (!extractor) {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.cacheDir = cacheDir;
        extractor = await pipeline("feature-extraction", model, { dtype: "fp32" });
      }
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return output.tolist();
    },
  };
}

/** Memoise embeddings by text: the same ground-truth value is compared against ten variants. */
export function withCache(embedder) {
  const cache = new Map();
  return {
    model: embedder.model,
    async embed(texts) {
      const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
      if (missing.length) {
        const vectors = await embedder.embed(missing);
        missing.forEach((t, i) => cache.set(t, vectors[i]));
      }
      return texts.map((t) => cache.get(t));
    },
  };
}
