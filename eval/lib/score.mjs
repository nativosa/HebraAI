// Scoring: per check, per case (all checks pass), per category and dimension.
// Results hold ids, categories, dimensions, reasons and metrics only — never
// subtitle or model text.

import { runCheck } from "./checks.mjs";

// result: { status, outputs: { key: text }, untranslated: [keys], metrics? }
export function scoreCase(c, result) {
  const untranslated = new Set(result.untranslated ?? []);
  const checks = c.checks.map((check) => {
    const r = runCheck(check, result.outputs ?? {}, untranslated);
    return { id: check.id, dimension: check.dimension, pass: r.pass, ...(r.reason ? { reason: r.reason } : {}) };
  });
  return {
    caseId: c.id,
    category: c.category,
    status: result.status,
    pass: checks.every((x) => x.pass),
    checks,
    ...(result.metrics ? { metrics: result.metrics } : {}),
  };
}

const rate = (passed, total) => ({ passed, total, rate: total ? Math.round((passed / total) * 1000) / 1000 : null });

function group(items, keyOf) {
  const out = {};
  for (const item of items) (out[keyOf(item)] ??= []).push(item);
  return out;
}

const sumMetrics = (scores) =>
  scores.reduce(
    (m, s) => ({
      requests: m.requests + (s.metrics?.requests ?? 0),
      inputTokens: m.inputTokens + (s.metrics?.inputTokens ?? 0),
      outputTokens: m.outputTokens + (s.metrics?.outputTokens ?? 0),
      elapsedMs: m.elapsedMs + (s.metrics?.elapsedMs ?? 0),
      estimatedCostUsd: Math.round((m.estimatedCostUsd + (s.metrics?.estimatedCostUsd ?? 0)) * 1e6) / 1e6,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0, estimatedCostUsd: 0 }
  );

// Aggregates case scores of one mode.
export function summarize(scores) {
  const byCategory = Object.fromEntries(
    Object.entries(group(scores, (s) => s.category)).map(([k, v]) => [k, rate(v.filter((s) => s.pass).length, v.length)])
  );
  const checks = scores.flatMap((s) => s.checks);
  const byDimension = Object.fromEntries(
    Object.entries(group(checks, (c) => c.dimension)).map(([k, v]) => [k, rate(v.filter((c) => c.pass).length, v.length)])
  );
  return {
    cases: rate(scores.filter((s) => s.pass).length, scores.length),
    checks: rate(checks.filter((c) => c.pass).length, checks.length),
    byCategory,
    byDimension,
    statuses: Object.fromEntries(Object.entries(group(scores, (s) => s.status)).map(([k, v]) => [k, v.length])),
    metrics: sumMetrics(scores),
  };
}

// Baseline vs candidate: deltas per category/dimension and case-level changes.
export function compareRuns(baseline, candidate) {
  const before = Object.fromEntries(baseline.scores.map((s) => [s.caseId, s.pass]));
  const after = Object.fromEntries(candidate.scores.map((s) => [s.caseId, s.pass]));
  const shared = Object.keys(before).filter((id) => id in after).sort();
  const delta = (a = {}, b = {}) =>
    Object.fromEntries(
      [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map((k) => [
        k,
        { baseline: a[k]?.rate ?? null, candidate: b[k]?.rate ?? null, delta: a[k] && b[k] ? Math.round((b[k].rate - a[k].rate) * 1000) / 1000 : null },
      ])
    );
  const bs = summarize(baseline.scores);
  const cs = summarize(candidate.scores);
  return {
    baseline: baseline.label,
    candidate: candidate.label,
    cases: { baseline: bs.cases.rate, candidate: cs.cases.rate },
    byCategory: delta(bs.byCategory, cs.byCategory),
    byDimension: delta(bs.byDimension, cs.byDimension),
    regressions: shared.filter((id) => before[id] && !after[id]),
    improvements: shared.filter((id) => !before[id] && after[id]),
    metrics: { baseline: bs.metrics, candidate: cs.metrics },
  };
}
