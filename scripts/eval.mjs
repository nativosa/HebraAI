#!/usr/bin/env node
// Translation-quality evaluation runner.
//
//   npm run eval:estimate [-- options]   plan only: cases, modes, requests, tokens, cost
//   npm run eval:offline  [-- options]   full run against the local fake OpenAI server (free)
//   npm run eval:real     [-- options]   REAL OpenAI run: needs HEBRAAI_REAL_EVAL=1, prices,
//                                        and an explicit confirmation; spending budget enforced
//   npm run eval:compare -- <baseline.json> <candidate.json>
//
// Options:
//   --modes classic[,…]      modes to run (only implemented modes are accepted)
//   --cases <ids|categories> comma-separated case ids or categories
//   --sample <n>             stratified small sample across categories
//   --repeat <n>             runs per case and mode (1-5, default 1)
//   --cases-dir <dir>        dataset directory (default eval/cases/synthetic); e.g. a
//                            private set under fixtures/private/ (git-ignored)
//   --budget-usd <x>         per-run spending budget for real runs (default 0.50)
//   --margin <x>             safety factor on each case's estimate (default 1.5)
//   --save-outputs           also write model outputs to fixtures/private/eval-outputs/
//                            (git-ignored) for manual review of meaning and naturalness
//   --yes                    skip the interactive prompt (real runs still need HEBRAAI_REAL_EVAL=1)
//
// Reports (eval/results/, git-ignored) and console output contain case ids,
// categories, check results and metrics only — never subtitle or model text.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "node:net";
import { startFakeOpenAI } from "./fake-openai.mjs";
import { ROOT, appUrl, startApp, stopApp, waitForApp } from "./app-server.mjs";
import { CATEGORIES, loadCases } from "../eval/lib/cases.mjs";
import { DEFAULT_BUDGET_USD, DEFAULT_MARGIN, NO_ESTIMATE, addEstimates, canStart, costUsd, pricesFrom, sampleCases } from "../eval/lib/estimate.mjs";
import { planCase } from "../eval/lib/plan.mjs";
import { buildRunReport, compareMarkdown, runMarkdown } from "../eval/lib/report.mjs";
import { MODES, buildRequest } from "../eval/lib/request.mjs";
import { scoreCase } from "../eval/lib/score.mjs";

const OFFLINE_PRICES = { OPENAI_PRICE_INPUT_PER_MTOK: "1", OPENAI_PRICE_OUTPUT_PER_MTOK: "4" }; // fake run only

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    modes: { type: "string", default: "classic" },
    cases: { type: "string" },
    sample: { type: "string" },
    repeat: { type: "string", default: "1" },
    "cases-dir": { type: "string", default: "eval/cases/synthetic" },
    "budget-usd": { type: "string" },
    margin: { type: "string" },
    "save-outputs": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

// --- app modules (TypeScript, loaded with Node's type stripping) -------------

async function loadAppModules() {
  const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
  return {
    ...(await mod("src/lib/srt/parse.ts")),
    ...(await mod("src/lib/srt/sound-effects.ts")),
    ...(await mod("src/lib/translation/options.ts")),
    ...(await mod("src/lib/translation/prompt.ts")),
  };
}

// --- selection and plan -----------------------------------------------------------

function selectCases() {
  const dir = resolve(ROOT, opts["cases-dir"]);
  if (!existsSync(dir)) fail(`No dataset at ${opts["cases-dir"]}`);
  let cases = loadCases(dir);
  if (opts.cases) {
    const wanted = new Set(opts.cases.split(",").map((s) => s.trim()));
    cases = cases.filter((c) => wanted.has(c.id) || wanted.has(c.category));
  }
  if (opts.sample) cases = sampleCases(cases, Number(opts.sample));
  if (!cases.length) fail("No cases selected.");
  const rel = relative(ROOT, dir).replaceAll("\\", "/");
  const dataset = rel.startsWith("fixtures/private") ? "private" : basename(dir);
  return { cases, dataset };
}

function selectModes() {
  const modes = opts.modes.split(",").map((m) => m.trim());
  for (const m of modes) {
    if (!(m in MODES)) fail(`Unknown mode ${m}. Known: ${Object.keys(MODES).join(", ")}`);
    if (!MODES[m].supported) fail(`Mode ${m} is not implemented yet (${MODES[m].description}).`);
  }
  return modes;
}

function makePlan(cases, modes, repeat, app, prices) {
  const runs = [];
  for (const mode of modes) {
    for (let rep = 1; rep <= repeat; rep++) {
      for (const c of cases) {
        const estimate = planCase(c, mode, app);
        runs.push({ c, mode, rep, estimate, estimateUsd: prices ? costUsd(estimate, prices) : null });
      }
    }
  }
  const total = runs.map((r) => r.estimate).reduce(addEstimates, NO_ESTIMATE);
  return { runs, total, totalUsd: prices ? costUsd(total, prices) : null };
}

function printPlan({ cases, dataset, modes, repeat, plan, prices, budgetUsd, margin, real, enforceBudget }) {
  const perCategory = CATEGORIES.map((k) => [k, cases.filter((c) => c.category === k).length])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const usd = (x) => (x === null ? "n/a (no prices configured)" : `$${x.toFixed(4)}`);
  console.log(
    [
      "",
      `Evaluation plan (${real ? "REAL OpenAI API" : "offline / estimate"})`,
      `  dataset:   ${dataset} - ${cases.length} cases (${perCategory})`,
      `  modes:     ${modes.join(", ")}   repeat: ${repeat}`,
      `  requests:  ~${plan.total.requests} (translation; character analysis: 0 - not part of these modes)`,
      `  tokens:    ~${plan.total.inputTokens} input, ~${plan.total.outputTokens} output (conservative estimate)`,
      `  cost:      ${plan.totalUsd === null ? usd(null) : `~${usd(plan.totalUsd)} translation + $0.0000 character analysis`}` +
        (prices ? `  (prices: $${prices.inputPerMTok}/1M input, $${prices.outputPerMTok}/1M output)` : ""),
      enforceBudget
        ? `  budget:    $${budgetUsd.toFixed(2)} per run; a case starts only if spent + estimate x ${margin} fits; otherwise the run stops`
        : "",
      "",
      "  Estimates are not a billing limit: actual usage is known only after each request,",
      "  and requests in flight, repairs and retries may still be billed.",
      "",
    ]
      .filter((l) => l !== "")
      .join("\n")
  );
}

// --- running -------------------------------------------------------------------

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

async function runCase(port, app, c, mode) {
  const { fields, srt, fileName } = buildRequest(c, mode);
  const form = new FormData();
  form.append("file", new File([srt], fileName, { type: "application/x-subrip" }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${appUrl(port)}/api/translate`, { method: "POST", body: form });
  const body = await res.text();
  if (!res.ok) return { status: `http-${res.status}`, outputs: {}, untranslated: [], metrics: { requests: 0 } };
  const final = body.split("\n").filter(Boolean).map((l) => JSON.parse(l)).at(-1) ?? {};
  const keyOf = Object.fromEntries(Object.entries(c.numberByKey).map(([k, n]) => [n, k]));
  const outputs = {};
  if (final.content) for (const cue of app.parseSrt(final.content).cues) if (keyOf[cue.number]) outputs[keyOf[cue.number]] = cue.text;
  const r = final.report;
  return {
    status: final.type ?? "no-result",
    outputs,
    untranslated: (r?.untranslated ?? []).map((u) => keyOf[u.number]).filter(Boolean),
    metrics: {
      requests: r?.requests ?? 0,
      inputTokens: r?.usage?.inputTokens ?? 0,
      outputTokens: r?.usage?.outputTokens ?? 0,
      elapsedMs: r?.elapsedMs ?? 0,
      ...(r?.estimatedCostUsd !== undefined ? { estimatedCostUsd: r.estimatedCostUsd } : {}),
    },
  };
}

async function execute({ dataset, modes, repeat, plan, budgetUsd, margin, real, app }) {
  let fake = null;
  const savedEnv = { ...process.env };
  if (!real) {
    fake = await startFakeOpenAI();
    Object.assign(process.env, OFFLINE_PRICES); // inherited by the app child only for this run
  }
  const port = await freePort();
  const { child, getLog } = startApp(fake?.baseURL, port, { real });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(ROOT, "eval", "results", `${stamp}-${real ? "real" : "offline"}`);
  const outDir = join(ROOT, "fixtures", "private", "eval-outputs", basename(runDir));
  const scoresByMode = Object.fromEntries(modes.map((m) => [m, []]));
  // Budget enforced for real runs, and offline when --budget-usd is given
  // (fake prices), so the scheduling can be tested for free.
  const enforceBudget = real || opts["budget-usd"] !== undefined;
  let spentUsd = 0;
  let plannedRequests = 0;
  let stoppedEarly = false;
  const skipped = [];
  try {
    await waitForApp(child, getLog, port);
    for (const [i, run] of plan.runs.entries()) {
      const nextUsd = run.estimateUsd ?? 0;
      // Once a case does not fit, nothing more is scheduled.
      if (enforceBudget && !canStart({ spentUsd, nextEstimateUsd: nextUsd, budgetUsd, margin })) {
        stoppedEarly = true;
        skipped.push(...plan.runs.slice(i).map((r) => `${r.mode}:${r.c.id}#${r.rep}`));
        break;
      }
      plannedRequests += run.estimate.requests;
      const result = await runCase(port, app, run.c, run.mode);
      spentUsd += result.metrics.estimatedCostUsd ?? nextUsd;
      const score = { ...scoreCase(run.c, result), mode: run.mode, rep: run.rep };
      scoresByMode[run.mode].push(score);
      console.log(`${score.pass ? "PASS" : "FAIL"}  ${run.mode} ${run.c.id}${repeat > 1 ? ` #${run.rep}` : ""}  [${result.status}]`);
      if (opts["save-outputs"]) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, `${run.mode}-${run.c.id}-${run.rep}.json`), JSON.stringify({ caseId: run.c.id, mode: run.mode, outputs: result.outputs }, null, 2));
      }
    }
  } finally {
    stopApp(child);
    if (fake) await fake.close();
    process.env = savedEnv;
  }

  mkdirSync(runDir, { recursive: true });
  const reports = modes.map((mode) =>
    buildRunReport({
      label: `${mode}${real ? "" : " (offline)"}`,
      mode,
      dataset,
      scores: scoresByMode[mode],
      repeat,
      estimate: { ...plan.total, usd: plan.totalUsd },
      ...(enforceBudget ? { budget: { usd: budgetUsd, margin, spentUsd: Math.round(spentUsd * 1e6) / 1e6, skipped } } : {}),
      stoppedEarly,
    })
  );
  for (const r of reports) {
    writeFileSync(join(runDir, `${r.mode}.json`), JSON.stringify(r, null, 2) + "\n");
    writeFileSync(join(runDir, `${r.mode}.md`), runMarkdown(r));
  }
  console.log(`\nReports: ${relative(ROOT, runDir)}${opts["save-outputs"] ? `\nOutputs (private): ${relative(ROOT, outDir)}` : ""}`);
  if (stoppedEarly) console.log(`Stopped early: spending budget reached; ${skipped.length} case run(s) not started.`);
  for (const r of reports) {
    const s = r.summary;
    console.log(`${r.label}: ${s.cases.passed}/${s.cases.total} cases, ${s.metrics.requests} requests, ${s.metrics.inputTokens}/${s.metrics.outputTokens} tokens, ~$${s.metrics.estimatedCostUsd.toFixed(4)}`);
  }
  return { reports, fake, plannedRequests, stoppedEarly };
}

// Offline self-checks of the plumbing (the fake translator fails quality checks by design).
function verifyOffline({ reports, fake, plannedRequests, plan, cases }) {
  const problems = [];
  const scores = reports.flatMap((r) => r.scores);
  const notComplete = scores.filter((s) => s.status !== "complete").map((s) => s.caseId);
  if (notComplete.length) problems.push(`not complete: ${notComplete.join(", ")}`);
  if (fake.stats.rejected) problems.push(`fake server rejected ${fake.stats.rejected} request(s)`);
  const requests = scores.reduce((n, s) => n + (s.metrics?.requests ?? 0), 0);
  if (requests !== plannedRequests) problems.push(`planned ${plannedRequests} requests, sent ${requests}`);
  const ran = new Set(scores.map((s) => `${s.mode}:${s.caseId}:${s.rep}`));
  const plannedInput = plan.runs.filter((r) => ran.has(`${r.mode}:${r.c.id}:${r.rep}`)).reduce((n, r) => n + r.estimate.inputTokens, 0);
  const actualInput = scores.reduce((n, s) => n + (s.metrics?.inputTokens ?? 0), 0);
  if (actualInput > plannedInput) problems.push(`input estimate ${plannedInput} below fake usage ${actualInput}`);
  const dump = JSON.stringify(reports) + reports.map(runMarkdown).join("");
  const leaked = cases.flatMap((c) => c.expandedCues.map((x) => x.text)).filter((t) => t.length > 12 && dump.includes(t));
  if (leaked.length || dump.includes("[HE]")) problems.push("subtitle or model text found in a report");
  for (const p of problems) console.log(`FAIL  offline check: ${p}`);
  if (!problems.length) console.log("PASS  offline checks: all cases complete, requests as planned, estimate covers usage, reports text-free");
  return problems.length ? 1 : 0;
}

// --- real-run guards ------------------------------------------------------------

function envLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function confirmReal(plan, budgetUsd) {
  if (opts.yes) return true;
  if (!process.stdin.isTTY) fail("Real evaluation needs an interactive confirmation (or --yes).");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `Start a REAL evaluation with ~${plan.total.requests} requests (~$${plan.totalUsd.toFixed(4)}, budget $${budgetUsd.toFixed(2)})? Type "yes" to start: `
  );
  rl.close();
  return answer.trim() === "yes";
}

// --- main ------------------------------------------------------------------------

async function main() {
  const command = positionals[0];
  if (command === "compare") {
    const [a, b] = positionals.slice(1);
    if (!a || !b) fail("Usage: npm run eval:compare -- <baseline.json> <candidate.json>");
    const md = compareMarkdown(JSON.parse(readFileSync(a, "utf8")), JSON.parse(readFileSync(b, "utf8")));
    console.log(md);
    writeFileSync(b.replace(/\.json$/, "") + `.vs-${basename(a, ".json")}.md`, md);
    return 0;
  }
  if (!["estimate", "offline", "real"].includes(command)) fail("Usage: eval.mjs estimate|offline|real|compare [options]");

  const real = command === "real";
  const repeat = Number(opts.repeat);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) fail("--repeat must be 1-5");
  const budgetUsd = opts["budget-usd"] !== undefined ? Number(opts["budget-usd"]) : DEFAULT_BUDGET_USD;
  const margin = opts.margin !== undefined ? Number(opts.margin) : DEFAULT_MARGIN;
  if (!(budgetUsd > 0) || !(margin >= 1)) fail("--budget-usd must be > 0 and --margin >= 1");

  const { cases, dataset } = selectCases();
  const modes = selectModes();
  const app = await loadAppModules();
  const prices = command === "offline" ? pricesFrom(OFFLINE_PRICES) : pricesFrom({ ...envLocal(), ...process.env });
  const plan = makePlan(cases, modes, repeat, app, prices);
  printPlan({ cases, dataset, modes, repeat, plan, prices, budgetUsd, margin, real, enforceBudget: real || opts["budget-usd"] !== undefined });

  if (command === "estimate") return 0;
  if (real) {
    if (process.env.HEBRAAI_REAL_EVAL !== "1") fail("Refusing: set HEBRAAI_REAL_EVAL=1 to allow a real (paid) evaluation.");
    if (!prices) fail("Refusing: set OPENAI_PRICE_INPUT_PER_MTOK and OPENAI_PRICE_OUTPUT_PER_MTOK so the budget can be enforced.");
    if (!(process.env.OPENAI_API_KEY || envLocal().OPENAI_API_KEY)) fail("Refusing: no OPENAI_API_KEY in the environment or .env.local.");
    if (!(await confirmReal(plan, budgetUsd))) fail("Cancelled.");
  }
  const result = await execute({ cases, dataset, modes, repeat, plan, prices, budgetUsd, margin, real, app });
  return real ? 0 : verifyOffline({ ...result, plan, cases });
}

main().then(
  (code) => (process.exitCode = code),
  (err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  }
);
