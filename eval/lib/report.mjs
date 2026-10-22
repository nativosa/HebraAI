// Evaluation reports: JSON for machines, Markdown for people. Both contain
// ids, categories, dimensions, check results and metrics only — never
// subtitle text or model output (the dataset may be private).

import { compareRuns, summarize } from "./score.mjs";

/**
 * @param {{ label: string, mode: string, dataset: string, scores: object[], repeat?: number,
 *   estimate?: object, budget?: object, stoppedEarly?: boolean }} run
 */
export function buildRunReport({ label, mode, dataset, scores, repeat = 1, estimate, budget, stoppedEarly = false }) {
  return {
    label,
    mode,
    dataset,
    createdAt: new Date().toISOString(),
    repeat,
    ...(estimate ? { estimate } : {}),
    ...(budget ? { budget } : {}),
    stoppedEarly,
    summary: summarize(scores),
    scores,
  };
}

const pct = (x) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(1)} %`);
const signed = (x) => (x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pt`);

export function runMarkdown(report) {
  const s = report.summary;
  const lines = [
    `# Evaluation: ${report.label}`,
    "",
    `Mode \`${report.mode}\` · dataset \`${report.dataset}\` · ${s.cases.total} case runs · ${report.createdAt}`,
    report.stoppedEarly ? "\n**Stopped early: spending budget reached.**" : "",
    "",
    `Cases passed: **${s.cases.passed}/${s.cases.total} (${pct(s.cases.rate)})** · checks: ${s.checks.passed}/${s.checks.total} (${pct(s.checks.rate)})`,
    "",
    "| Category | Passed | Rate |",
    "|---|---|---|",
    ...Object.entries(s.byCategory).map(([k, v]) => `| ${k} | ${v.passed}/${v.total} | ${pct(v.rate)} |`),
    "",
    "| Dimension | Passed | Rate |",
    "|---|---|---|",
    ...Object.entries(s.byDimension).map(([k, v]) => `| ${k} | ${v.passed}/${v.total} | ${pct(v.rate)} |`),
    "",
    `Requests ${s.metrics.requests} · input tokens ${s.metrics.inputTokens} · output tokens ${s.metrics.outputTokens} · ` +
      `time ${(s.metrics.elapsedMs / 1000).toFixed(1)} s` +
      (s.metrics.estimatedCostUsd ? ` · estimated cost $${s.metrics.estimatedCostUsd.toFixed(4)}` : ""),
    "",
    `Failed cases: ${report.scores.filter((x) => !x.pass).map((x) => x.caseId).join(", ") || "none"}`,
    "",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

export function compareMarkdown(baseline, candidate) {
  const c = compareRuns(baseline, candidate);
  const table = (title, rows) => [
    `| ${title} | ${c.baseline} | ${c.candidate} | Δ |`,
    "|---|---|---|---|",
    ...Object.entries(rows).map(([k, v]) => `| ${k} | ${pct(v.baseline)} | ${pct(v.candidate)} | ${signed(v.delta)} |`),
  ];
  const m = c.metrics;
  return [
    `# ${c.candidate} vs ${c.baseline}`,
    "",
    `Cases passed: ${pct(c.cases.baseline)} → ${pct(c.cases.candidate)}`,
    "",
    ...table("Category", c.byCategory),
    "",
    ...table("Dimension", c.byDimension),
    "",
    `**Regressions (pass → fail):** ${c.regressions.join(", ") || "none"}`,
    "",
    `**Improvements (fail → pass):** ${c.improvements.join(", ") || "none"}`,
    "",
    "| Metric | " + c.baseline + " | " + c.candidate + " |",
    "|---|---|---|",
    ...["requests", "inputTokens", "outputTokens", "elapsedMs", "estimatedCostUsd"].map(
      (k) => `| ${k} | ${m.baseline[k]} | ${m.candidate[k]} |`
    ),
    "",
    "Automatic checks cover grammatical form only. Review meaning preservation and natural Hebrew manually " +
      "(e.g. with --save-outputs) before concluding that a mode is better.",
    "",
  ].join("\n");
}
