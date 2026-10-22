#!/usr/bin/env node
// Offline regression harness. Makes NO OpenAI calls.
//
//   npm run baseline:check                    # verify; never writes any file
//   npm run baseline:capture -- --overwrite   # explicit regeneration of fixtures/expected/ only
//
// How it works:
//   1. Starts a local fake Responses API (scripts/fake-openai.mjs).
//   2. Runs `next build` then `next start` on 127.0.0.1:${BASELINE_PORT:-3123}
//      in explicit offline test mode (HEBRAAI_OFFLINE_TEST_MODE=1), with
//      OPENAI_BASE_URL pointing at the fake and a fake API key (process env
//      overrides .env.local, so the real key is never loaded into this server).
//      See scripts/app-server.mjs.
//   3. POSTs every fixture in fixtures/srt/ to /api/translate, with sound-effect
//      removal on and off; then fixtures/srt/basic.srt with every prompt option
//      combination.
//   4. check:
//      - each SRT result must equal fixtures/expected/ byte-for-byte, and the
//        fingerprints of every request sent must equal fixtures/expected/requests.json;
//      - every result and request is also compared with the immutable Stage 0
//        references (fixtures/legacy-baseline/, fixtures/legacy-requests.json):
//        a difference is allowed only if fixtures/expected/changes.json lists
//        the case with its reason (defect id); unlisted or stale entries fail;
//      - guard checks (e.g. the default file-size cap) and the reliability
//        scenarios in scripts/scenarios.mjs (scripted fake-server faults).
//      capture: writes fixtures/expected/ (refuses without --overwrite). The
//      legacy references are never written.
//
// Logs contain only file names, sizes, hashes and structural diffs — never cue text.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { startFakeOpenAI } from "./fake-openai.mjs";
import { inspectSrt, compareStructure } from "./srt-structure.mjs";
import { buildFingerprintFile, changedCases, compareFingerprints } from "./request-fingerprint.mjs";
import { reviewLegacyDiffs } from "./legacy-diff.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import {
  ROOT,
  FIXTURES,
  UI_DEFAULT_FIELDS,
  PROMPT_VARIANTS,
  appUrl,
  startApp,
  stopApp,
  waitForApp,
  postFixture,
} from "./app-server.mjs";

const LEGACY = join(ROOT, "fixtures", "legacy-baseline");
const LEGACY_REQUESTS = join(ROOT, "fixtures", "legacy-requests.json");
const EXPECTED = join(ROOT, "fixtures", "expected");
const EXPECTED_REQUESTS = join(EXPECTED, "requests.json");
const CHANGES = join(EXPECTED, "changes.json");
const PORT = Number(process.env.BASELINE_PORT) || 3123;

const VARIANTS = [
  { name: "sfx-on", removeSoundEffects: "true" },
  { name: "sfx-off", removeSoundEffects: "false" },
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const outputFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".srt") || f.endsWith(".result.txt")) : [];

async function runCase(fixture, variant) {
  const { ok, status, body } = await postFixture(PORT, fixture, {
    ...UI_DEFAULT_FIELDS,
    removeSoundEffects: variant.removeSoundEffects,
  });
  const base = `${fixture.replace(/\.srt$/, "")}.${variant.name}`;

  if (ok) {
    const final = body
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .find((m) => m.type === "complete");
    if (final) return { name: base, file: `${base}.srt`, content: Buffer.from(final.content, "utf8") };
  }
  // Any other outcome is part of the expectations too (status + raw body).
  return { name: base, file: `${base}.result.txt`, content: Buffer.from(`HTTP ${status}\n${body}`, "utf8") };
}

// Records the request bodies the fake server received while `fn` ran.
// Cases run one at a time and each awaits the full response stream, so every
// request is attributed to exactly one case, in the order it was sent.
async function recordRequests(fake, requestsByCase, name, fn) {
  const start = fake.requests.length;
  const result = await fn();
  requestsByCase[name] = fake.requests.slice(start);
  return result;
}

// Current expectations that are not part of the regression references.
async function runGuards() {
  const failures = [];
  const size = 600 * 1024;
  const fd = new FormData();
  fd.append("file", new File([Buffer.alloc(size, "a")], "too-big.srt"));
  const res = await fetch(`${appUrl(PORT)}/api/translate`, { method: "POST", body: fd });
  const body = await res.json().catch(() => null);
  const ok =
    res.status === 413 &&
    body?.error === "File too large" &&
    body?.maxBytes === 512 * 1024 &&
    body?.receivedBytes === size;
  console.log(`${ok ? "PASS" : "FAIL"}  guard: ${size} B upload -> HTTP ${res.status} ${JSON.stringify(body)}`);
  if (!ok) failures.push("size cap");
  return failures;
}

// Runs each scripted fault scenario: the fake server's answers are scripted
// per request of the scenario (1-based); the echo is restored afterwards.
async function runScenarios(fake) {
  const failures = [];
  for (const s of SCENARIOS) {
    let count = 0;
    fake.setResponder((body, n) => s.responder(body, n, ++count));
    const before = fake.requests.length;
    let problem;
    try {
      const { body } = await postFixture(PORT, s.fixture, { ...UI_DEFAULT_FIELDS, removeSoundEffects: "false" });
      const events = body.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
      problem = s.check(events, fake.requests.length - before);
    } catch (err) {
      problem = err?.message ?? String(err);
    } finally {
      fake.setResponder(null);
    }
    console.log(`${problem ? "FAIL" : "PASS"}  scenario: ${s.name}${problem ? ` — ${problem}` : ""}`);
    if (problem) failures.push(s.name);
  }
  return failures;
}

// Cancellation through the real server and SDK. Every fake answer is delayed
// so an OpenAI request is in flight when the browser cancels. The app must
// abort that request (the fake server sees its connection closed before
// answering) and send no further request.
//   - before-response: Next sends the response headers only with the first
//     event, so cancelling during chunk 1 aborts the fetch itself (req.signal);
//   - mid-stream: cancelling after the first progress event cancels the
//     response stream while chunk 2 is in flight.
async function runCancelChecks(fake) {
  const failures = [];
  for (const mode of ["before-response", "mid-stream"]) {
    fake.setResponder(() => ({ delayMs: 1500 }));
    const before = fake.requests.length;
    const closedBefore = fake.stats.closedEarly;
    const expectedSent = mode === "before-response" ? 1 : 2;
    let problem = null;
    try {
      const fd = new FormData();
      fd.append("file", new File([readFileSync(join(FIXTURES, "multi-chunk.srt"))], "multi-chunk.srt"));
      for (const [k, v] of Object.entries({ ...UI_DEFAULT_FIELDS, removeSoundEffects: "false" })) fd.append(k, v);
      const ac = new AbortController();
      const pending = fetch(`${appUrl(PORT)}/api/translate`, { method: "POST", body: fd, signal: ac.signal });
      if (mode === "before-response") {
        for (let i = 0; i < 100 && fake.requests.length === before; i++) await new Promise((r) => setTimeout(r, 50));
        ac.abort();
        await pending.catch(() => {});
      } else {
        const reader = (await pending).body.getReader();
        await reader.read(); // first progress event (chunk 1 done, chunk 2 in flight)
        ac.abort();
        await reader.cancel().catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 3000));
      const sent = fake.requests.length - before;
      const closed = fake.stats.closedEarly - closedBefore;
      if (sent !== expectedSent || closed !== 1) {
        problem = `${sent} request(s) sent, ${closed} aborted in flight (expected ${expectedSent} and 1)`;
      }
    } catch (err) {
      problem = err?.message ?? String(err);
    } finally {
      fake.setResponder(null);
    }
    console.log(
      `${problem ? "FAIL" : "PASS"}  cancel (${mode}): job stopped, OpenAI request in flight aborted, no further requests${problem ? ` — ${problem}` : ""}`
    );
    if (problem) failures.push(`cancel ${mode}`);
  }
  return failures;
}

// Compares results with the immutable legacy references; every difference
// must be explained in changes.json and every explanation must still apply.
function checkAgainstLegacy(results, fingerprints, changes) {
  const differing = new Set();
  for (const r of results) {
    const legacyPath = join(LEGACY, r.file);
    if (!existsSync(legacyPath) || !readFileSync(legacyPath).equals(r.content)) differing.add(r.file);
  }
  const produced = new Set(results.map((r) => r.file));
  for (const f of outputFiles(LEGACY)) if (!produced.has(f)) differing.add(f);

  const reviews = [
    reviewLegacyDiffs("output", [...differing], changes.outputs),
    reviewLegacyDiffs("requests", changedCases(readJson(LEGACY_REQUESTS), fingerprints), changes.requests),
  ];
  for (const r of reviews) for (const line of r.lines) console.log(line);
  const failures = reviews.flatMap((r) => r.failures);
  if (!failures.length) console.log(`PASS  legacy differences: all explained in fixtures/expected/changes.json`);
  return failures;
}

async function main() {
  const mode = process.argv[2] ?? "check";
  const overwrite = process.argv.includes("--overwrite");
  if (mode !== "check" && mode !== "capture") {
    console.error("Usage: baseline.mjs [check | capture --overwrite]");
    return 2;
  }
  const existing = outputFiles(EXPECTED);
  if (mode === "capture" && (existing.length > 0 || existsSync(EXPECTED_REQUESTS)) && !overwrite) {
    console.error(
      `Refusing to overwrite fixtures/expected/ (${existing.length} file(s)).\n` +
        "Regeneration must be explicit: npm run baseline:capture -- --overwrite"
    );
    return 2;
  }
  if (mode === "check" && (existing.length === 0 || !existsSync(EXPECTED_REQUESTS) || !existsSync(CHANGES))) {
    console.error("fixtures/expected/ is incomplete. Capture it explicitly first.");
    return 2;
  }

  const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith(".srt")).sort();
  const fake = await startFakeOpenAI();
  const { child, getLog } = startApp(fake.baseURL, PORT);
  const results = [];
  const requestsByCase = {};
  let guardFailures = [];

  try {
    await waitForApp(child, getLog, PORT);
    for (const fixture of fixtures) {
      for (const variant of VARIANTS) {
        const name = `${fixture.replace(/\.srt$/, "")}.${variant.name}`;
        results.push(await recordRequests(fake, requestsByCase, name, () => runCase(fixture, variant)));
      }
    }
    for (const { name, fields } of PROMPT_VARIANTS) {
      await recordRequests(fake, requestsByCase, `prompt.${name}`, () => postFixture(PORT, "basic.srt", fields));
    }
    if (mode === "check") {
      guardFailures = [...(await runGuards()), ...(await runScenarios(fake)), ...(await runCancelChecks(fake))];
    }
  } finally {
    stopApp(child);
    await fake.close();
  }

  console.log(`fake OpenAI: ${fake.stats.requests} request(s) served, ${fake.stats.rejected} rejected`);
  if (fake.stats.rejected > 0 || fake.stats.requests === 0) {
    console.error("Unexpected fake-server traffic; aborting.");
    return 1;
  }
  const fingerprints = buildFingerprintFile(requestsByCase);

  if (mode === "capture") {
    mkdirSync(EXPECTED, { recursive: true });
    for (const f of existing) if (!results.some((r) => r.file === f)) console.log(`note      ${f} is no longer produced; delete it`);
    for (const r of results) {
      writeFileSync(join(EXPECTED, r.file), r.content);
      console.log(`captured  ${r.file}  (${r.content.length} B, ${sha(r.content)})`);
    }
    writeFileSync(EXPECTED_REQUESTS, JSON.stringify(fingerprints, null, 2) + "\n");
    console.log(`captured  request fingerprints for ${Object.keys(fingerprints.cases).length} case(s)`);
    return 0;
  }

  let failures = 0;
  const produced = new Set(results.map((r) => r.file));
  for (const r of results) {
    const path = join(EXPECTED, r.file);
    if (!existsSync(path)) {
      failures++;
      console.log(`FAIL  ${r.file}  (no expected file)`);
      continue;
    }
    const expected = readFileSync(path);
    if (expected.equals(r.content)) {
      console.log(`PASS  ${r.file}  (${sha(r.content)})`);
      continue;
    }
    failures++;
    console.log(`FAIL  ${r.file}  bytes differ: expected ${sha(expected)}, got ${sha(r.content)}`);
    if (r.file.endsWith(".srt")) {
      const diffs = compareStructure(inspectSrt(expected), inspectSrt(r.content));
      console.log(diffs.length ? diffs.map((d) => `      ${d}`).join("\n") : "      structure identical (text differs)");
    }
  }
  for (const f of existing) {
    if (!produced.has(f)) {
      failures++;
      console.log(`FAIL  ${f}  (expected file no longer produced)`);
    }
  }

  const requestCount = Object.values(fingerprints.cases).reduce((n, c) => n + c.length, 0);
  const fpDiffs = compareFingerprints(readJson(EXPECTED_REQUESTS), fingerprints);
  if (fpDiffs.length) {
    failures += fpDiffs.length;
    for (const d of fpDiffs) console.log(`FAIL  request fingerprint: ${d}`);
  } else {
    console.log(
      `PASS  request fingerprints: ${requestCount} request(s) in ${Object.keys(fingerprints.cases).length} case(s) identical`
    );
  }

  failures += checkAgainstLegacy(results, fingerprints, readJson(CHANGES)).length;
  failures += guardFailures.length;
  console.log(
    failures
      ? `\n${failures} failure(s)`
      : `\nAll ${results.length} cases match fixtures/expected/; request fingerprints, legacy differences, guard checks and scenarios pass.`
  );
  return failures ? 1 : 0;
}

main().then(
  (code) => (process.exitCode = code),
  (err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  }
);
