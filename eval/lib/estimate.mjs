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
// The cached-input price is optional and only shown: estimates assume no
// cached input (full input price), while actual costs come from the app
// report, which prices cached input separately.
export function pricesFrom(env) {
  const n = (k) => (env[k] !== undefined && env[k] !== "" && Number.isFinite(Number(env[k])) && Number(env[k]) >= 0 ? Number(env[k]) : undefined);
  const inputPerMTok = n("OPENAI_PRICE_INPUT_PER_MTOK");
  const outputPerMTok = n("OPENAI_PRICE_OUTPUT_PER_MTOK");
  const cachedInputPerMTok = n("OPENAI_PRICE_CACHED_INPUT_PER_MTOK");
  if (inputPerMTok === undefined || outputPerMTok === undefined) return null;
  return { inputPerMTok, outputPerMTok, ...(cachedInputPerMTok === undefined ? {} : { cachedInputPerMTok }) };
}

// Whether a case with this estimated cost may start.
export function canStart({ spentUsd, nextEstimateUsd, budgetUsd, margin = DEFAULT_MARGIN }) {
  return spentUsd + nextEstimateUsd * margin <= budgetUsd;
}

// Cases in round-robin order across categories (id order within each), so
// any prefix of the list covers every category.
/**
 * @template {{ id: string, category: string }} T
 * @param {T[]} cases
 * @returns {T[]}
 */
export function roundRobin(cases) {
  const byCategory = new Map();
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }
  const queues = [...byCategory.values()];
  const out = [];
  for (let i = 0; out.length < cases.length; i++) for (const q of queues) if (q[i]) out.push(q[i]);
  return out;
}

// Stratified small sample: the first `size` cases of the round-robin order.
/**
 * @template {{ id: string, category: string }} T
 * @param {T[]} cases
 * @param {number} size
 * @returns {T[]}
 */
export function sampleCases(cases, size) {
  if (!size || size >= cases.length) return cases;
  return roundRobin(cases).slice(0, size);
}

// Run order: repetition, then cases round-robin across categories, then all
// modes for a case together — an early stop keeps categories and modes
// comparable.
export function orderRuns(cases, modes, repeat) {
  const runs = [];
  for (let rep = 1; rep <= repeat; rep++) {
    for (const c of roundRobin(cases)) for (const mode of modes) runs.push({ c, mode, rep });
  }
  return runs;
}

// Up-front check: does the whole plan, with the safety margin, fit the budget?
export function checkBudget({ totalUsd, budgetUsd, margin = DEFAULT_MARGIN }) {
  const requiredUsd = Math.round(totalUsd * margin * 1e6) / 1e6;
  return { fits: requiredUsd <= budgetUsd, requiredUsd };
}

// The most expensive single case if every chunk used all its attempts — the
// most a run can overshoot its budget, since a started case is not cut off.
export function worstCase(runs, maxAttemptsPerChunk) {
  const top = runs.reduce((best, r) => ((r.estimateUsd ?? 0) > (best?.estimateUsd ?? -1) ? r : best), null);
  if (!top) return null;
  return { caseId: top.c.id, mode: top.mode, usd: Math.round((top.estimateUsd ?? 0) * maxAttemptsPerChunk * 1e6) / 1e6 };
}

// What a finished case counts against the budget: its reported cost (or the
// estimate when none was reported) plus every retry at the estimated cost of
// one request — failed attempts report no tokens but may still be billed.
export function chargeFor({ reportedUsd, retries = 0, estimateUsd, estimateRequests }) {
  const perRequest = estimateRequests ? estimateUsd / estimateRequests : 0;
  return Math.round(((reportedUsd ?? estimateUsd) + retries * perRequest) * 1e6) / 1e6;
}
