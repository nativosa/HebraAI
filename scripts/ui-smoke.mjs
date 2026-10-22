#!/usr/bin/env node
// Browser smoke test of the real UI. Makes NO OpenAI calls.
//
//   npm run ui:smoke
//
// Builds and starts the app in explicit offline test mode against the local
// fake OpenAI server (scripts/app-server.mjs, scripts/fake-openai.mjs), then
// drives a headless Chrome over the DevTools protocol with Node's built-in
// WebSocket (no extra dependencies):
//   1. successful translation: preview and "Download SRT" file
//   2. partial translation: warning, counts, timings, "Download Partial SRT"
//   3. cancel while an OpenAI request is in flight: cancelled state, no late
//      result, in-flight request aborted, no further requests
//   4. a new translation after cancelling completes
//
// Requires Google Chrome or Chromium (or Edge). Set CHROME_PATH to use a
// specific browser binary. Uses a free local port and a throw-away browser
// profile in the OS temp directory; everything is removed afterwards.
// Exit code: 0 all checks passed, 1 a check failed or an error occurred,
// 2 no browser found.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { echoItems, startFakeOpenAI } from "./fake-openai.mjs";
import { FIXTURES, ROOT, appUrl, startApp, stopApp, waitForApp } from "./app-server.mjs";

const TIMEOUT_MS = 5 * 60_000; // whole run
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- browser discovery ---------------------------------------------------------

function findChrome() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const env = process.env;
  const candidates = {
    win32: [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap((base) => [
        join(base, "Google", "Chrome", "Application", "chrome.exe"),
        join(base, "Chromium", "Application", "chrome.exe"),
        join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]),
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
  }[process.platform] ?? [];
  const onPath = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"].flatMap(
    (name) => (env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, name))
  );
  return [...candidates, ...onPath].find((p) => existsSync(p)) ?? null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  } else {
    child.kill("SIGKILL");
  }
}

// --- checks ------------------------------------------------------------------

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

// --- DevTools protocol --------------------------------------------------------

async function connectToPage(chromeDir) {
  // Chrome writes its debugging port to DevToolsActivePort (--remote-debugging-port=0).
  const portFile = join(chromeDir, "profile", "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  let targets = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === "page"); i++) {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    if (!targets.some((t) => t.type === "page")) await sleep(100);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target in Chrome");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cannot connect to Chrome")), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, cdp, pageErrors };
}

// --- the test ----------------------------------------------------------------

async function run(state) {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("No Chrome/Chromium/Edge found. Install Google Chrome or set CHROME_PATH to the browser binary.");
    return 2;
  }
  console.log(`browser: ${chromePath}`);

  // Fake OpenAI with switchable behaviour per scenario.
  let mode = "echo";
  state.fake = await startFakeOpenAI();
  const fake = state.fake;
  fake.setResponder((body) => {
    if (mode === "partial") return { items: echoItems(body).items.filter((i) => i.index !== 2) };
    if (mode === "delay") return { delayMs: 3000 };
    return undefined; // echo
  });

  const appPort = await freePort();
  const app = startApp(fake.baseURL, appPort);
  state.app = app.child;
  await waitForApp(app.child, app.getLog, appPort);

  state.dir = mkdtempSync(join(tmpdir(), "hebraai-ui-smoke-"));
  const downloads = join(state.dir, "downloads");
  state.chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(state.dir, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1400,1000",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const { ws, cdp, pageErrors } = await connectToPage(state.dir);
  state.ws = ws;

  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`page evaluation failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  };
  const text = () => evaluate("document.body.innerText");
  const waitFor = async (label, predicate, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await sleep(100);
    }
    check(false, `timed out waiting for: ${label}`);
    return false;
  };
  const buttonState = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === ${JSON.stringify(label)});
      return b ? (b.disabled ? "disabled" : "enabled") : "missing";
    })()`);
  // Clicks the enabled button whose visible text is exactly `label` (as a user gesture).
  const click = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === ${JSON.stringify(label)});
      if (!b) return "missing";
      if (b.disabled) return "disabled";
      b.click();
      return "clicked";
    })()`);
  const enPreview = () => evaluate(`(document.querySelectorAll("pre")[0]?.innerText ?? "").trim()`);
  const hePreview = () => evaluate(`(document.querySelectorAll("pre")[1]?.innerText ?? "").trim()`);
  const upload = async (fixture) => {
    const { result } = await cdp("Runtime.evaluate", { expression: 'document.querySelector("input[type=file]")' });
    await cdp("DOM.setFileInputFiles", { objectId: result.objectId, files: [join(FIXTURES, fixture)] });
  };
  const waitDownload = async (name) => {
    const path = join(downloads, name);
    for (let i = 0; i < 100; i++) {
      if (existsSync(path) && !readdirSync(downloads).some((f) => f.endsWith(".crdownload"))) return readFileSync(path, "utf8");
      await sleep(100);
    }
    return null;
  };
  const expected = (name) => readFileSync(join(ROOT, "fixtures", "expected", name), "utf8");

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("DOM.enable");
  await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await cdp("Page.navigate", { url: `${appUrl(appPort)}/` });
  await waitFor("page loaded", async () => (await text()).includes("Translate to Hebrew"));
  // The page is prerendered; wait until React has hydrated the file input.
  await waitFor("page hydrated", () =>
    evaluate('Object.keys(document.querySelector("input[type=file]") ?? {}).some((k) => k.startsWith("__reactProps"))')
  );

  // 1. Successful translation, preview and download.
  console.log("\n# 1. Successful translation (basic.srt)");
  mode = "echo";
  await upload("basic.srt");
  await waitFor("EN preview", async () => (await enPreview()).includes("Hello there."));
  check((await click("Translate to Hebrew")) === "clicked", "Translate clicked");
  await waitFor("done", async () => (await text()).includes("Done. Review the preview"));
  check((await hePreview()) === expected("basic.sfx-on.srt").trim(), "HE preview shows the translated SRT");
  check(!(await text()).includes("Partial translation"), "no partial warning");
  check((await buttonState("Download SRT")) === "enabled", "button reads 'Download SRT'");
  await click("Download SRT");
  check((await waitDownload("translated.he.srt")) === expected("basic.sfx-on.srt"), "downloaded translated.he.srt equals the expected output");

  // 2. Partial translation.
  console.log("\n# 2. Partial translation (cue 2 always missing)");
  mode = "partial";
  check((await click("Translate to Hebrew")) === "clicked", "Translate clicked");
  await waitFor("partial result", async () => (await text()).includes("Partial result."));
  const t2 = await text();
  check(t2.includes("Partial translation"), "partial warning panel shown");
  check(t2.includes("Translated 3 of 4 cues. 1 cue was not translated and kept in English."), "translated/untranslated counts");
  check(t2.includes("#2 · 00:00:03,500 → 00:00:05,200 · missing from the model's answer"), "untranslated cue number, timing and reason");
  check((await buttonState("Download Partial SRT")) === "enabled", "button reads 'Download Partial SRT'");
  check((await buttonState("Download SRT")) === "missing", "no plain 'Download SRT' button");
  await click("Download Partial SRT");
  const partial = await waitDownload("translated.he.PARTIAL.srt");
  check(partial?.includes("2\n00:00:03,500 --> 00:00:05,200\nAre you coming with us tonight?\n") ?? false, "partial file keeps cue 2 in English");
  check((partial?.match(/\[HE\]/g) ?? []).length === 3, "partial file has the 3 translated cues");

  // 3. Cancellation while an OpenAI request is in flight.
  console.log("\n# 3. Cancellation (multi-chunk.srt, every answer delayed 3 s)");
  mode = "delay";
  await upload("multi-chunk.srt");
  await waitFor("new file loaded", async () => !(await text()).includes("Partial translation"));
  const requestsBefore = fake.requests.length;
  const closedBefore = fake.stats.closedEarly;
  check((await click("Translate to Hebrew")) === "clicked", "Translate clicked");
  await waitFor("Cancel button visible", async () => (await buttonState("Cancel")) === "enabled");
  await waitFor("first request in flight", async () => fake.requests.length > requestsBefore, 10_000);
  check((await click("Cancel")) === "clicked", "Cancel clicked while a request is in flight");
  await waitFor("cancelled state", async () => (await text()).includes("Cancelled. Nothing was kept."), 5_000);
  check((await buttonState("Cancel")) === "missing", "Cancel button gone");
  check((await buttonState("Translate to Hebrew")) === "enabled", "Translate button enabled again");
  check((await text()).includes("may still be billed"), "billing note shown");
  await sleep(7_000); // longer than two delayed answers
  const t3 = await text();
  check(t3.includes("Cancelled. Nothing was kept.") && !t3.includes("Done. Review"), "no late completion appeared");
  check((await hePreview()) === "Translate to see Hebrew output here.", "HE preview stays empty");
  check((await buttonState("Download SRT")) === "disabled", "download disabled");
  const sent = fake.requests.length - requestsBefore;
  const aborted = fake.stats.closedEarly - closedBefore;
  check(sent === 1, "no further OpenAI request after Cancel", `${sent} sent`);
  check(aborted === 1, "in-flight request aborted", `${aborted} closed early`);

  // 4. A new translation after cancelling.
  console.log("\n# 4. Recovery: new translation after cancel");
  mode = "echo";
  check((await click("Translate to Hebrew")) === "clicked", "Translate clicked");
  await waitFor("done", async () => (await text()).includes("Done. Review the preview"), 30_000);
  const t4 = await text();
  check(!t4.includes("Cancelled.") && !t4.includes("Partial translation"), "cancelled note cleared, no partial");
  check((await hePreview()) === expected("multi-chunk.sfx-on.srt").trim(), "HE preview shows the full translation");
  rmSync(join(downloads, "translated.he.srt"), { force: true });
  await click("Download SRT");
  check((await waitDownload("translated.he.srt")) === expected("multi-chunk.sfx-on.srt"), "downloaded file equals the expected output");

  check(pageErrors.length === 0, "no page exceptions or console errors", pageErrors.join(" | ").slice(0, 300));
  check(fake.stats.rejected === 0, "fake server rejected no request");
  return failures ? 1 : 0;
}

// --- cleanup, always ---------------------------------------------------------

const state = {};
let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    state.ws?.close();
  } catch {
    /* ignore */
  }
  killTree(state.chrome);
  if (state.app) stopApp(state.app);
  await state.fake?.close().catch(() => {});
  if (state.dir) {
    try {
      rmSync(state.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (err) {
      console.error(`could not remove ${state.dir}: ${err.message}`);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    console.error(`\n${signal}: stopping`);
    await cleanup();
    process.exit(1);
  });
}

const watchdog = setTimeout(async () => {
  console.error(`\nui-smoke timed out after ${TIMEOUT_MS / 1000} s`);
  await cleanup();
  process.exit(1);
}, TIMEOUT_MS);

let code = 1;
try {
  code = await run(state);
} catch (err) {
  check(false, "unexpected error", err?.message ?? String(err));
  code = 1;
} finally {
  clearTimeout(watchdog);
  await cleanup();
}
if (state.fake) {
  console.log(`\nfake OpenAI: ${state.fake.stats.requests} request(s), ${state.fake.stats.rejected} rejected, ${state.fake.stats.closedEarly} aborted in flight`);
}
if (code === 0 && failures === 0) console.log("\nAll browser checks passed.");
else if (code !== 2) console.log(`\n${failures} failure(s)`);
process.exitCode = code === 0 && failures > 0 ? 1 : code;
