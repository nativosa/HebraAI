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
//      A production build is used so the harness does not conflict with a
//      running `next dev` (which holds the .next/dev lock).
//   3. POSTs every fixture in fixtures/srt/ to /api/translate, with sound-effect
//      removal on and off, through the unmodified production route.
//   4. check: compares each result byte-for-byte with fixtures/legacy-baseline/,
//      then runs guard checks — current expectations kept separate from the
//      legacy baseline (e.g. the default file-size cap).
//      capture: writes the results there (refuses to overwrite without --overwrite).
//
// The legacy baseline records CURRENT behaviour, including known defects
// (see fixtures/KNOWN_DEFECTS.md). A match means "unchanged", not "correct".
// Logs contain only file names, sizes, hashes and structural diffs — never cue text.

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeOpenAI, FAKE_API_KEY } from "./fake-openai.mjs";
import { inspectSrt, compareStructure } from "./srt-structure.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "fixtures", "srt");
const BASELINE = join(ROOT, "fixtures", "legacy-baseline");
const PORT = Number(process.env.BASELINE_PORT) || 3123;
const HOST = "127.0.0.1";
const APP = `http://${HOST}:${PORT}`;

// Form fields mirror the UI defaults in src/app/page.tsx.
const VARIANTS = [
  { name: "sfx-on", removeSoundEffects: "true" },
  { name: "sfx-off", removeSoundEffects: "false" },
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

function startNext(baseURL) {
  const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const env = {
    ...process.env,
    // Explicit offline test mode: the only way the route accepts a custom
    // endpoint (loopback + fake key only; see src/lib/openai-client.ts).
    HEBRAAI_OFFLINE_TEST_MODE: "1",
    OPENAI_API_KEY: FAKE_API_KEY,
    OPENAI_BASE_URL: baseURL,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete env.NODE_ENV;
  delete env.MAX_FILE_SIZE_BYTES; // guard checks assume the default cap
  console.log("building (next build)…");
  try {
    execFileSync(process.execPath, [nextBin, "build"], { cwd: ROOT, env, stdio: "pipe" });
  } catch (err) {
    throw new Error(`next build failed:
${err.stdout ?? ""}${err.stderr ?? ""}`);
  }
  const child = spawn(process.execPath, [nextBin, "start", "-H", HOST, "-p", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, getLog: () => log };
}

function stopNext(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForServer(child, getLog, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${getLog()}`);
    try {
      const res = await fetch(`${APP}/`);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next start did not become ready in time:\n${getLog()}`);
}

async function runCase(fixture, variant) {
  const buf = readFileSync(join(FIXTURES, fixture));
  const fd = new FormData();
  fd.append("file", new File([buf], fixture, { type: "application/x-subrip" }));
  fd.append("tone", "Neutral");
  fd.append("preserveBreaks", "true");
  fd.append("maxChars", "42");
  fd.append("glossary", "");
  fd.append("removeSoundEffects", variant.removeSoundEffects);

  const res = await fetch(`${APP}/api/translate`, { method: "POST", body: fd });
  const body = await res.text();
  const base = `${fixture.replace(/\.srt$/, "")}.${variant.name}`;

  if (res.ok) {
    const complete = body
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .find((m) => m.type === "complete");
    if (complete) return { file: `${base}.srt`, content: Buffer.from(complete.content, "utf8") };
  }
  // Non-success outcomes are part of the baseline too (status + raw body).
  return { file: `${base}.result.txt`, content: Buffer.from(`HTTP ${res.status}\n${body}`, "utf8") };
}

// Current expectations that are not part of the legacy baseline.
async function runGuards() {
  const failures = [];
  const size = 600 * 1024;
  const fd = new FormData();
  fd.append("file", new File([Buffer.alloc(size, "a")], "too-big.srt"));
  const res = await fetch(`${APP}/api/translate`, { method: "POST", body: fd });
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
  if (mode === "capture" && existing.length > 0 && !overwrite) {
    console.error(
      `Refusing to overwrite ${existing.length} existing legacy baseline file(s).\n` +
        "Regeneration must be explicit: npm run baseline:capture -- --overwrite"
    );
    return 2;
  }
  if (mode === "check" && existing.length === 0) {
    console.error("No legacy baseline found. Capture one explicitly first.");
    return 2;
  }

  const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith(".srt")).sort();
  const fake = await startFakeOpenAI();
  const { child, getLog } = startNext(fake.baseURL);
  const results = [];
  let guardFailures = [];

  try {
    await waitForServer(child, getLog);
    for (const fixture of fixtures) {
      for (const variant of VARIANTS) results.push(await runCase(fixture, variant));
    }
    if (mode === "check") guardFailures = await runGuards();
  } finally {
    stopNext(child);
    await fake.close();
  }

  console.log(`fake OpenAI: ${fake.stats.requests} request(s) served, ${fake.stats.rejected} rejected`);
  if (fake.stats.rejected > 0 || fake.stats.requests === 0) {
    console.error("Unexpected fake-server traffic; aborting.");
    return 1;
  }

  if (mode === "capture") {
    if (existsSync(BASELINE)) rmSync(BASELINE, { recursive: true });
    mkdirSync(BASELINE, { recursive: true });
    for (const r of results) {
      writeFileSync(join(BASELINE, r.file), r.content);
      console.log(`captured  ${r.file}  (${r.content.length} B, ${sha(r.content)})`);
    }
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
  failures += guardFailures.length;
  console.log(
    failures
      ? `\n${failures} failure(s)`
      : `\nAll ${results.length} cases match the legacy baseline; guard checks pass.`
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
