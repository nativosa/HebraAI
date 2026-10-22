// Shared helpers for the offline harness scripts: build and start the app in
// explicit offline test mode against the local fake OpenAI server, and POST
// subtitle files to /api/translate. Makes NO OpenAI calls.

import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_API_KEY } from "./fake-openai.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES = join(ROOT, "fixtures", "srt");
const HOST = "127.0.0.1";

// Form fields mirror the UI defaults in src/app/page.tsx.
export const UI_DEFAULT_FIELDS = {
  tone: "Neutral",
  preserveBreaks: "true",
  maxChars: "42",
  glossary: "",
};

// Option combinations sent with fixtures/srt/basic.srt to cover every branch
// of the instructions (tone, line breaks, maxChars parsing). Used for request
// fingerprints and the prompt golden file; `undefined` omits the field.
const PROMPT_BASE = { ...UI_DEFAULT_FIELDS, removeSoundEffects: "false" };
export const PROMPT_VARIANTS = [
  ["neutral.breaks-on", {}],
  ["neutral.breaks-off", { preserveBreaks: "false" }],
  ["formal.breaks-on", { tone: "Formal" }],
  ["formal.breaks-off", { tone: "Formal", preserveBreaks: "false" }],
  ["informal.breaks-on", { tone: "Informal" }],
  ["informal.breaks-off", { tone: "Informal", preserveBreaks: "false" }],
  ["unknown-tone", { tone: "Sarcastic" }],
  ["maxchars-missing", { maxChars: undefined }],
  ["maxchars-nan", { maxChars: "abc" }],
  ["maxchars-low", { maxChars: "10" }],
  ["maxchars-high", { maxChars: "100" }],
  ["maxchars-fraction", { maxChars: "42.5" }],
  // Stage 2 (D11): glossary sent with the instructions.
  ["glossary", { glossary: "John = ג׳ון\nFBI = FBI" }],
  ["glossary-ignored-lines", { glossary: "John = ג׳ון\nno separator\n= x" }],
].map(([name, fields]) => ({ name, fields: { ...PROMPT_BASE, ...fields } }));

export function appUrl(port) {
  return `http://${HOST}:${port}`;
}

// A production build is used so the harness does not conflict with a running
// `next dev` (which holds the .next/dev lock).
export function startApp(baseURL, port) {
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
  const child = spawn(process.execPath, [nextBin, "start", "-H", HOST, "-p", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, getLog: () => log };
}

export function stopApp(child) {
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

export async function waitForApp(child, getLog, port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${getLog()}`);
    try {
      const res = await fetch(`${appUrl(port)}/`);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next start did not become ready in time:\n${getLog()}`);
}

// POSTs a fixture with the given form fields (undefined values are omitted)
// and returns the HTTP status and raw body once the stream has finished.
export async function postFixture(port, fixture, fields) {
  const buf = readFileSync(join(FIXTURES, fixture));
  const fd = new FormData();
  fd.append("file", new File([buf], fixture, { type: "application/x-subrip" }));
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  const res = await fetch(`${appUrl(port)}/api/translate`, { method: "POST", body: fd });
  return { ok: res.ok, status: res.status, body: await res.text() };
}
