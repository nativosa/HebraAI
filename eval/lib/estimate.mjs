// Pre-run estimates and the per-run spending budget for real evaluations.
//
// Estimates are deliberately conservative and are NOT billing limits: the
// API reports actual usage only after a request, requests in flight and
// retries can still be billed, and reasoning-token use is not known in
// advance.

// About 4 characters per token for English JSON; 3 is used to over-estimate.
export const CHARS_PER_INPUT_TOKEN = 3;
// Hebrew output tokenizes less efficiently; 2 characters per token.
export const CHARS_PER_OUTPUT_TOKEN = 2;
// Per-item JSON overhead in the answer ({"index":n,"text_he":"..."}).
export const OUTPUT_TOKENS_PER_ITEM = 12;
// Extra output tokens for possible reasoning, as a fraction of the output.
export const REASONING_ALLOWANCE = 1.0;
// A case is started only if spent + estimate * margin fits the budget.
export const DEFAULT_BUDGET_USD = 0.5;
export const DEFAULT_MARGIN = 1.5;

// One planned API request: the exact request JSON length and the source
// text it asks to translate.
export function estimateRequest({ requestChars, sourceChars, items }) {
  return {
    requests: 1,
    inputTokens: Math.ceil(requestChars / CHARS_PER_INPUT_TOKEN),
    outputTokens: Math.ceil((sourceChars / CHARS_PER_OUTPUT_TOKEN + items * OUTPUT_TOKENS_PER_ITEM) * (1 + REASONING_ALLOWANCE)),
  };
}

export function addEstimates(a, b) {
  return {
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export const NO_ESTIMATE = { requests: 0, inputTokens: 0, outputTokens: 0 };

// USD for an estimate or actual usage; prices are USD per 1M tokens.
export function costUsd({ inputTokens, outputTokens }, prices) {
  return Math.round(inputTokens * prices.inputPerMTok + outputTokens * prices.outputPerMTok) / 1e6;
}

// Reads OPENAI_PRICE_* from an env object; null unless input and output are set.
export function pricesFrom(env) {
  const n = (k) => (env[k] !== undefined && env[k] !== "" && Number.isFinite(Number(env[k])) && Number(env[k]) >= 0 ? Number(env[k]) : undefined);
  const inputPerMTok = n("OPENAI_PRICE_INPUT_PER_MTOK");
  const outputPerMTok = n("OPENAI_PRICE_OUTPUT_PER_MTOK");
  return inputPerMTok === undefined || outputPerMTok === undefined ? null : { inputPerMTok, outputPerMTok };
}

// Whether a case with this estimated cost may start.
export function canStart({ spentUsd, nextEstimateUsd, budgetUsd, margin = DEFAULT_MARGIN }) {
  return spentUsd + nextEstimateUsd * margin <= budgetUsd;
}

// Stratified small sample: up to `size` cases, taken round-robin across
// categories in id order, so every category is represented.
/**
 * @template {{ id: string, category: string }} T
 * @param {T[]} cases
 * @param {number} size
 * @returns {T[]}
 */
export function sampleCases(cases, size) {
  if (!size || size >= cases.length) return cases;
  const byCategory = new Map();
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }
  const queues = [...byCategory.values()];
  const picked = [];
  for (let i = 0; picked.length < size; i++) {
    const before = picked.length;
    for (const q of queues) if (q[i] && picked.length < size) picked.push(q[i]);
    if (picked.length === before) break;
  }
  return picked;
}
