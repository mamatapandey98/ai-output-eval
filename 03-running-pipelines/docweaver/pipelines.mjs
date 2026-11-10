/**
 * One DocWeaver pipeline per variant, found by name or created. Pipelines are named
 * "<namePrefix>-<variant.id>" so a re-run reuses them instead of piling up copies.
 */
import { PIPELINES_API, endpointFor } from "./contract.mjs";

const PAGE_SIZE = 100;

/** Pipeline payload fields a variant controls (create-payload shape in the pipelines module context). */
export function pipelinePayload(variant, namePrefix) {
  return {
    name: `${namePrefix}-${variant.id}`,
    description: `ai-output-eval variant ${variant.id}`,
    ocr_provider: variant.ocr_provider,
    parsing_method: variant.parsing_method,
    llm_model_provider: variant.llm_model_provider,
    llm_model: variant.llm_model,
    vlm_model_provider: variant.vlm_model_provider ?? null,
    vlm_model: variant.vlm_model ?? null,
  };
}

export async function listAllPipelines(client) {
  const all = [];
  for (let page = 1; ; page++) {
    const body = await client.get(endpointFor(PIPELINES_API.LIST), {
      query: { page, page_size: PAGE_SIZE },
    });
    const items = body?.data ?? [];
    all.push(...items);
    if (!body?.metadata?.has_next || items.length === 0) return all;
  }
}

/** The list endpoint nests models as { value, ... }; the create payload sends the bare value. */
function modelValue(field) {
  return field && typeof field === "object" ? field.value : (field ?? null);
}

/**
 * Differences between an existing pipeline and the variant it should implement.
 * @returns {string[]} human-readable mismatches; empty when they agree.
 */
export function configMismatches(pipeline, payload) {
  const actual = {
    ocr_provider: modelValue(pipeline.ocr_provider),
    parsing_method: modelValue(pipeline.parsing_method),
    llm_model: modelValue(pipeline.llm_model),
    vlm_model: modelValue(pipeline.vlm_model),
  };
  return Object.entries(actual)
    .filter(([key, value]) => (value ?? null) !== (payload[key] ?? null))
    .map(([key, value]) => `${key}: expected ${payload[key]}, found ${value}`);
}

/**
 * Check every variant against GET /pipelines/configs, so a typo in variants.json fails
 * before anything is created.
 * @returns {string[]} problems; empty when every variant is offered by the app.
 */
export async function validateVariants(client, variants) {
  const { data } = await client.get(endpointFor(PIPELINES_API.CONFIGS));
  const ocr = new Set(data.ocr_providers.map((o) => o.value));
  const llm = new Set(data.llm_providers.flatMap((p) => p.models.map((m) => `${p.value}|${m.value}`)));
  const vlm = new Set(data.vlm_providers.flatMap((p) => p.models.map((m) => `${p.value}|${m.value}`)));
  const problems = [];
  for (const v of variants) {
    if (!ocr.has(v.ocr_provider)) problems.push(`${v.id}: OCR provider ${v.ocr_provider} not offered`);
    if (!llm.has(`${v.llm_model_provider}|${v.llm_model}`)) problems.push(`${v.id}: LLM ${v.llm_model} not offered`);
    if (v.vlm_model && !vlm.has(`${v.vlm_model_provider}|${v.vlm_model}`)) {
      problems.push(`${v.id}: VLM ${v.vlm_model} not offered`);
    }
  }
  return problems;
}

/**
 * @returns {Promise<Record<string, { id: number, name: string, created: boolean }>>} variant id → pipeline.
 */
export async function ensureVariantPipelines(client, variants, { namePrefix, log = () => {} }) {
  const existing = await listAllPipelines(client);
  const byName = new Map(existing.map((p) => [p.name, p]));
  const result = {};
  for (const variant of variants) {
    const payload = pipelinePayload(variant, namePrefix);
    const found = byName.get(payload.name);
    if (found) {
      const mismatches = configMismatches(found, payload);
      if (mismatches.length) {
        throw new Error(`Pipeline "${payload.name}" exists with a different config: ${mismatches.join("; ")}`);
      }
      result[variant.id] = { id: found.id, name: found.name, created: false };
      log(`pipeline ${payload.name} → #${found.id} (reused)`);
      continue;
    }
    const body = await client.post(endpointFor(PIPELINES_API.CREATE), payload);
    result[variant.id] = {
      id: body.data.id,
      name: payload.name,
      created: true,
    };
    log(`pipeline ${payload.name} → #${body.data.id} (created)`);
  }
  return result;
}
