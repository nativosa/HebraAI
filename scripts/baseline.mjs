#!/usr/bin/env node
// Offline legacy-regression harness. Makes NO OpenAI calls.
//
//   npm run baseline:check                    # verify; never writes baseline files
//   npm run baseline:capture -- --overwrite   # explicit regeneration only
//
// How it works:
//   1. Starts a local fake Responses API (scripts/fake-openai.mjs).
//   2. Runs `next build` then `next start` on 127.0.0.1:${BASELINE_PORT:-3123}
//      in explicit offline test mode (HEBRAAI_OFFLINE_TEST_MODE=1), with
//      OPENAI_BASE_URL pointing at the fake and a fake API key (process env
//      overrides .env.local, so the real key is never loaded into this server).
//      See scripts/app-server.mjs.
//   3. POSTs every fixture in fixtures/srt/ to /api/translate, with sound-effect
//      removal on and off, through the unmodified production route; then
//      fixtures/srt/basic.srt with every prompt option combination.
//   4. check: compares each SRT result byte-for-byte with fixtures/legacy-baseline/,
//      compares fingerprints of every request the app sent to the fake server
//      with fixtures/legacy-requests.json (model, instructions, input, schema;
//      hashes only), then runs guard checks — current expectations kept separate
//      from the legacy baseline (e.g. the default file-size cap).
//      capture: writes the SRT results and request fingerprints (refuses to
//      overwrite without --overwrite).
//
// The legacy baseline records CURRENT behaviour, including known defects
// (see fixtures/KNOWN_DEFECTS.md). A match means "unchanged", not "correct".
// Logs contain only file names, sizes, hashes and structural diffs — never cue text.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { startFakeOpenAI } from "./fake-openai.mjs";
import { inspectSrt, compareStructure } from "./srt-structure.mjs";
import { buildFingerprintFile, compareFingerprints } from "./request-fingerprint.mjs";
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

const BASELINE = join(ROOT, "fixtures", "legacy-baseline");
const FINGERPRINTS = join(ROOT, "fixtures", "legacy-requests.json");
const PORT = Number(process.env.BASELINE_PORT) || 3123;

const VARIANTS = [
  { name: "sfx-on", removeSoundEffects: "true" },
  { name: "sfx-off", removeSoundEffects: "false" },
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

async function runCase(fixture, variant) {
  const { ok, status, body } = await postFixture(PORT, fixture, {
    ...UI_DEFAULT_FIELDS,
    removeSoundEffects: variant.removeSoundEffects,
  });
  const base = `${fixture.replace(/\.srt$/, "")}.${variant.name}`;

  if (ok) {
    const complete = body
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .find((m) => m.type === "complete");
    if (complete) return { name: base, file: `${base}.srt`, content: Buffer.from(complete.content, "utf8") };
  }
  // Non-success outcomes are part of the baseline too (status + raw body).
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

// Current expectations that are not part of the legacy baseline.
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

async function main() {
  const mode = process.argv[2] ?? "check";
  const overwrite = process.argv.includes("--overwrite");
  if (mode !== "check" && mode !== "capture") {
    console.error("Usage: baseline.mjs [check | capture --overwrite]");
    return 2;
  }
  const existing = existsSync(BASELINE) ? readdirSync(BASELINE).filter((f) => !f.startsWith(".")) : [];
  if (mode === "capture" && (existing.length > 0 || existsSync(FINGERPRINTS)) && !overwrite) {
    console.error(
      `Refusing to overwrite the existing legacy baseline (${existing.length} file(s)) / request fingerprints.\n` +
        "Regeneration must be explicit: npm run baseline:capture -- --overwrite"
    );
    return 2;
  }
  if (mode === "check" && (existing.length === 0 || !existsSync(FINGERPRINTS))) {
    console.error("No legacy baseline or request fingerprints found. Capture them explicitly first.");
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
    if (mode === "check") guardFailures = await runGuards();
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
    if (existsSync(BASELINE)) rmSync(BASELINE, { recursive: true });
    mkdirSync(BASELINE, { recursive: true });
    for (const r of results) {
      writeFileSync(join(BASELINE, r.file), r.content);
      console.log(`captured  ${r.file}  (${r.content.length} B, ${sha(r.content)})`);
    }
    writeFileSync(FINGERPRINTS, JSON.stringify(fingerprints, null, 2) + "\n");
    console.log(`captured  request fingerprints for ${Object.keys(fingerprints.cases).length} case(s)`);
    return 0;
  }

  let failures = 0;
  const produced = new Set(results.map((r) => r.file));
  for (const r of results) {
    const path = join(BASELINE, r.file);
    if (!existsSync(path)) {
      failures++;
      console.log(`FAIL  ${r.file}  (no baseline file)`);
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
      console.log(`FAIL  ${f}  (baseline file no longer produced)`);
    }
  }

  const requestCount = Object.values(fingerprints.cases).reduce((n, c) => n + c.length, 0);
  const fpDiffs = compareFingerprints(JSON.parse(readFileSync(FINGERPRINTS, "utf8")), fingerprints);
  if (fpDiffs.length) {
    failures += fpDiffs.length;
    for (const d of fpDiffs) console.log(`FAIL  request fingerprint: ${d}`);
  } else {
    console.log(
      `PASS  request fingerprints: ${requestCount} request(s) in ${Object.keys(fingerprints.cases).length} case(s) identical`
    );
  }

  failures += guardFailures.length;
  console.log(
    failures
      ? `\n${failures} failure(s)`
      : `\nAll ${results.length} cases match the legacy baseline; request fingerprints and guard checks pass.`
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
