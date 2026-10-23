#!/usr/bin/env node
// Browser smoke test of the real UI. Makes NO OpenAI calls.
//
//   npm run ui:smoke
//   SMOKE_SCREENSHOTS=<dir> npm run ui:smoke   (also saves screenshots)
//
// Builds and starts the app in explicit offline test mode against the local
// fake OpenAI server (scripts/app-server.mjs, scripts/fake-openai.mjs), then
// drives a headless Chrome over the DevTools protocol with Node's built-in
// WebSocket (no extra dependencies):
//   1. successful translation: cue-aligned review, default download unchanged
//   2. editing (line breaks, invalid edits, Esc, keyboard), search, filters,
//      revert, export with a filter active, unsaved-work dialog, copy
//   3. partial translation: untranslated cues, filter, manual translation,
//      partial download
//   4. export options: UTF-8 BOM, renumbering
//   5. cancel while an OpenAI request is in flight: cancelled state, export
//      disabled, no late result, in-flight request aborted, no further requests
//   6. a new translation after cancelling; saving keeps the scroll position
//   7. context mode: character analysis (cancelled, then completed), edited
//      sheet and notes sent with the context-mode translation request
//   8. themes: dark, system (following the OS setting live)
//   9. persistence across a reload (theme, settings, hidden panel), nothing
//      private stored, beforeunload with unexported edits, accessible names
//  10. mobile layout: no horizontal scrolling, stacked cues
//
// Requires Google Chrome or Chromium (or Edge). Set CHROME_PATH to use a
// specific browser binary. Uses a free local port and a throw-away browser
// profile in the OS temp directory; everything is removed afterwards.
// Exit code: 0 all checks passed, 1 a check failed or an error occurred,
// 2 no browser found.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  const dialogs = []; // JavaScript dialogs (e.g. beforeunload), all accepted
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Page.javascriptDialogOpening") {
      dialogs.push({ type: msg.params.type });
      cdp("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
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
  return { ws, cdp, pageErrors, dialogs };
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
  const origin = appUrl(appPort);

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
  const { ws, cdp, pageErrors, dialogs } = await connectToPage(state.dir);
  state.ws = ws;

  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`page evaluation failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
    return r.result.value;
  };
  const text = () => evaluate("document.body?.innerText ?? ''");
  const waitFor = async (label, predicate, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await sleep(100);
    }
    check(false, `timed out waiting for: ${label}`);
    return false;
  };
  // In-page helper: the first *visible* element matching a selector.
  const VISIBLE = `const visible = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0);`;
  const buttonState = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.getClientRects().length && x.innerText.trim() === ${JSON.stringify(label)});
      return b ? (b.disabled ? "disabled" : "enabled") : "missing";
    })()`);
  // Clicks the visible button whose text is exactly `label` (as a user gesture).
  const click = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.getClientRects().length && x.innerText.trim() === ${JSON.stringify(label)});
      if (!b) return "missing";
      if (b.disabled) return "disabled";
      b.click();
      return "clicked";
    })()`);
  // Clicks the first visible element matching `selector`.
  const clickSel = (selector) =>
    evaluate(`(() => { ${VISIBLE}
      const el = visible(${JSON.stringify(selector)});
      if (!el) return "missing";
      if (el.disabled) return "disabled";
      el.click();
      return "clicked";
    })()`);
  const stateOf = (selector) =>
    evaluate(`(() => { ${VISIBLE} const el = visible(${JSON.stringify(selector)}); return el ? (el.disabled ? "disabled" : "enabled") : "missing"; })()`);
  // Sets an input, textarea or select the way React notices (value setter + event).
  const setValue = (selector, value) =>
    evaluate(`(() => { ${VISIBLE}
      const el = visible(${JSON.stringify(selector)});
      if (!el) return "missing";
      const proto = { SELECT: HTMLSelectElement, TEXTAREA: HTMLTextAreaElement }[el.tagName] ?? HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      return "set";
    })()`);
  const key = async (keyName, modifiers = 0) => {
    const codes = { Enter: 13, Escape: 27 };
    const base = { key: keyName, code: keyName, windowsVirtualKeyCode: codes[keyName], modifiers };
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(keyName === "Enter" && !modifiers ? { text: "\r" } : {}) });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  // Rows shown in the review: [{ id, status, edited, en, he }].
  const rows = () =>
    evaluate(`[...document.querySelectorAll("[data-rows] > [data-cue-id]")].map((r) => {
      const edit = r.querySelector("[data-edit]");
      const he = edit ? [...edit.childNodes].filter((n) => !(n.classList && n.classList.contains("sr-only"))).map((n) => n.textContent).join("") : null;
      return { id: Number(r.dataset.cueId), status: r.dataset.status, edited: r.dataset.edited === "true", en: r.querySelector("[lang=en]")?.textContent, he };
    })`);
  const upload = async (fixture) => {
    const { result } = await cdp("Runtime.evaluate", { expression: 'document.querySelector("input[type=file]")' });
    await cdp("DOM.setFileInputFiles", { objectId: result.objectId, files: [join(FIXTURES, fixture)] });
  };
  const waitDownload = async (name) => {
    const path = join(downloads, name);
    for (let i = 0; i < 100; i++) {
      if (existsSync(path) && !readdirSync(downloads).some((f) => f.endsWith(".crdownload"))) return readFileSync(path);
      await sleep(100);
    }
    return null;
  };
  const download = async (name) => {
    rmSync(join(downloads, name), { force: true });
    const clicked = await clickSel('[data-action="download"]');
    check(clicked === "clicked", `Download clicked (${name})`, clicked);
    const bytes = await waitDownload(name);
    check(bytes !== null, `downloaded ${name}`);
    return bytes;
  };
  const expected = (name) => readFileSync(join(ROOT, "fixtures", "expected", name), "utf8");
  const outcome = () => evaluate(`document.querySelector("[data-outcome]")?.dataset.outcome ?? null`);
  const screenshot = async (name) => {
    if (!process.env.SMOKE_SCREENSHOTS) return;
    await sleep(400); // let colour transitions finish
    const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(process.env.SMOKE_SCREENSHOTS, `${name}.png`), Buffer.from(data, "base64"));
  };
  const loadPage = async () => {
    await cdp("Page.navigate", { url: `${origin}/` });
    await waitFor("page loaded", async () => (await text()).includes("Translate to Hebrew"));
    // The page is prerendered; wait until React has hydrated the file input.
    await waitFor("page hydrated", () =>
      evaluate('Object.keys(document.querySelector("input[type=file]") ?? {}).some((k) => k.startsWith("__reactProps"))')
    );
  };
  const translate = async (label = "Translate to Hebrew") => {
    const r = await click(label);
    check(r === "clicked", `${label} clicked`, r);
  };

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("DOM.enable");
  await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await cdp("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await loadPage();

  // 1. Successful translation, cue-aligned review and download.
  console.log("\n# 1. Successful translation (basic.srt)");
  mode = "echo";
  check((await buttonState("Translate to Hebrew")) === "disabled", "Translate disabled without a file");
  check((await text()).includes("Choose an .srt file to see its subtitles here."), "empty review state");
  await upload("basic.srt");
  await waitFor("English cues listed", async () => (await rows()).length === 4);
  let r1 = await rows();
  check(r1.every((r) => r.status === "pending") && r1[0].en === "Hello there.", "cues listed by id before translating", JSON.stringify(r1[0]));
  check((await text()).includes("basic.srt") && (await text()).includes("4 cues"), "file name and cue count shown");
  check((await stateOf('[data-action="download"]')) === "disabled" && (await stateOf('[data-action="copy"]')) === "disabled", "export disabled before a result");
  await translate();
  await waitFor("complete", async () => (await outcome()) === "complete");
  r1 = await rows();
  check(r1.map((r) => r.he).join("|") === "[HE] Hello there.|[HE] Are you coming with us tonight?|[HE] I'm tired, but I'll come.|[HE] Thanks, it's 7:30, don't be late!", "Hebrew aligned with each English cue");
  check(r1.every((r) => r.status === "translated"), "all cues translated");
  check((await text()).includes("Translation complete"), "complete status shown");
  check(
    await evaluate(`[...document.querySelectorAll("[data-edit][lang=he]")].every((e) => e.getAttribute("dir") === "rtl")`),
    "Hebrew cells are dir=rtl lang=he"
  );
  check(
    await evaluate(`[...document.querySelectorAll("[data-cue-id] [lang=en]")].every((e) => e.getAttribute("dir") === "ltr")`),
    "English cells are dir=ltr lang=en"
  );
  check((await download("basic.he.srt"))?.toString("utf8") === expected("basic.sfx-on.srt"), "basic.he.srt equals the expected output (default export unchanged)");
  await screenshot("1-complete-light");

  // 2. Editing, search and filters.
  console.log("\n# 2. Editing, search and filters");
  await setValue('input[type="search"]', "coming");
  await waitFor("search applied", async () => (await rows()).length === 1);
  check((await rows())[0]?.id === 2, "search finds the cue in English");
  check((await evaluate(`document.querySelector("[data-cue-id] mark")?.textContent`)) === "coming", "match highlighted");
  // Edit while the search is active.
  check((await clickSel('[data-cue-id="2"] [data-edit]')) === "clicked", "editor opened on cue 2");
  await waitFor("editor shown", () => evaluate(`!!document.querySelector('[data-cue-id="2"] textarea')`));
  check((await evaluate(`document.activeElement?.tagName`)) === "TEXTAREA", "editor focused");
  check((await evaluate(`document.querySelector('[data-cue-id="2"] textarea').getAttribute("dir")`)) === "rtl", "editor is RTL");
  await setValue('[data-cue-id="2"] textarea', "אתם באים איתנו הלילה?\nשורה שנייה");
  check((await clickSel('[data-action="save-edit"]')) === "clicked", "Save clicked");
  await waitFor("edit saved", async () => (await rows())[0]?.edited === true);
  check((await rows())[0].he === "אתם באים איתנו הלילה?\nשורה שנייה", "edited text kept with its line break");
  check((await evaluate(`document.activeElement?.hasAttribute("data-edit")`)) === true, "focus back on the cue after saving");
  await setValue('input[type="search"]', "באים");
  await waitFor("Hebrew search", async () => (await rows()).map((r) => r.id).join() === "2");
  check(true, "search finds the edited Hebrew text");
  await setValue('input[type="search"]', "");

  // Invalid edit: rejected, not rewritten; Esc cancels.
  await clickSel('[data-cue-id="3"] [data-edit]');
  await waitFor("editor on cue 3", () => evaluate(`!!document.querySelector('[data-cue-id="3"] textarea')`));
  await setValue('[data-cue-id="3"] textarea', "שורה\n\nשורה");
  await clickSel('[data-action="save-edit"]');
  await waitFor("invalid edit message", async () => (await text()).includes("Remove the empty line"));
  check(await evaluate(`!!document.querySelector('[data-cue-id="3"] textarea')`), "editor stays open on an invalid edit");
  await key("Escape");
  await waitFor("editor closed with Esc", () => evaluate(`!document.querySelector('[data-cue-id="3"] textarea')`));
  check(!(await rows()).find((r) => r.id === 3).edited, "cancelled edit not applied");
  check((await evaluate(`document.activeElement?.closest("[data-cue-id]")?.dataset.cueId`)) === "3", "focus returns to the cue after Esc");
  // Keyboard: Enter on the focused cue opens the editor, Ctrl+Enter saves.
  await key("Enter");
  await waitFor("editor opened with Enter", () => evaluate(`!!document.querySelector('[data-cue-id="3"] textarea')`));
  await setValue('[data-cue-id="3"] textarea', "אני עייפה, אבל אבוא.");
  await key("Enter", 2 /* Ctrl */);
  await waitFor("saved with Ctrl+Enter", async () => (await rows()).find((r) => r.id === 3)?.edited === true);
  check(true, "keyboard edit saved");

  // Filters: edited; the export ignores the filter.
  check((await clickSel('[data-filter="edited"]')) === "clicked", "Edited filter selected");
  await waitFor("edited filter", async () => (await rows()).map((r) => r.id).join() === "2,3");
  check(true, "Edited filter shows the 2 edited cues");
  const edited = (await download("basic.he.srt"))?.toString("utf8") ?? "";
  check((edited.match(/-->/g) ?? []).length === 4, "export with a filter active still has all 4 cues");
  check(
    edited ===
      expected("basic.sfx-on.srt")
        .replace("[HE] Are you coming with us tonight?", "אתם באים איתנו הלילה?\nשורה שנייה")
        .replace("[HE] I'm tired, but I'll come.", "אני עייפה, אבל אבוא."),
    "export applies the edits, keeps numbers, timings and line breaks"
  );
  await clickSel('[data-filter="all"]');
  // Revert.
  await clickSel('[data-cue-id="3"] [aria-label="Revert #3"]');
  await waitFor("reverted", async () => !(await rows()).find((r) => r.id === 3).edited);
  check((await rows()).find((r) => r.id === 3).he === "[HE] I'm tired, but I'll come.", "Revert restores the model text");

  // Unsaved work: translating again asks first; "Keep it" keeps everything.
  await translate("Translate again");
  await waitFor("confirmation dialog", () => evaluate(`!!document.querySelector("dialog[open]")`));
  check((await text()).includes("manual edits have not been exported"), "dialog warns about unexported edits");
  await click("Keep it");
  await waitFor("dialog closed", () => evaluate(`!document.querySelector("dialog[open]")`));
  check((await rows()).find((r) => r.id === 2).edited, "edits kept after 'Keep it'");
  // Copy counts as export.
  check((await clickSel('[data-action="copy"]')) === "clicked", "Copy clicked");
  await waitFor("copied", async () => (await buttonState("Copied")) !== "missing", 5000);
  // The OS clipboard may convert line endings (CRLF on Windows).
  const clip = (await evaluate("navigator.clipboard.readText()")).replace(/\r\n/g, "\n");
  check(clip.includes("אתם באים איתנו הלילה?\nשורה שנייה") && (clip.match(/-->/g) ?? []).length === 4, "clipboard holds the edited SRT", JSON.stringify(clip).slice(0, 200));
  check((await text()).includes("not exported yet") === false, "copy marks the result as exported");
  await screenshot("2-edited-light");

  // 3. Partial translation: untranslated cues, filter, manual translation, partial download.
  console.log("\n# 3. Partial translation (cue 2 always missing)");
  mode = "partial";
  await translate("Translate again");
  check(!(await evaluate(`!!document.querySelector("dialog[open]")`)), "no dialog after the result was copied");
  await waitFor("partial result", async () => (await outcome()) === "partial");
  const t3 = await text();
  check(t3.includes("Partial translation") && t3.includes("Translated 3 of 4 cues. 1 cue was not translated and kept in English."), "partial status and counts");
  check(t3.includes("1 cue was not translated"), "partial banner in the review");
  const r3 = await rows();
  check(r3.find((r) => r.id === 2)?.status === "untranslated" && t3.includes("Kept in English · missing from the model's answer"), "untranslated cue marked with its reason");
  check(r3.every((r) => !r.edited), "edits of the previous result discarded");
  await click("Show untranslated");
  await waitFor("untranslated filter", async () => (await rows()).map((r) => r.id).join() === "2");
  check(true, "Show untranslated filters to cue 2");
  const partial1 = (await download("basic.PARTIAL.he.srt"))?.toString("utf8") ?? "";
  check(partial1.includes("2\n00:00:03,500 --> 00:00:05,200\nAre you coming with us tonight?\n"), "partial file keeps cue 2 in English");
  check((partial1.match(/\[HE\]/g) ?? []).length === 3, "partial file has the 3 translated cues");
  await click("Translate manually");
  await waitFor("editor for untranslated cue", () => evaluate(`document.querySelector('[data-cue-id="2"] textarea')?.value === ""`));
  await setValue('[data-cue-id="2"] textarea', "אתם באים איתנו הלילה?");
  await clickSel('[data-action="save-edit"]');
  // Translated by hand, the cue leaves the Untranslated filter.
  await waitFor("manual translation saved", async () => (await rows()).length === 0);
  await clickSel('[data-filter="all"]');
  check((await rows()).find((r) => r.id === 2)?.edited === true, "manual translation saved as an edit");
  const partial2 = (await download("basic.PARTIAL.he.srt"))?.toString("utf8") ?? "";
  check(partial2.includes("2\n00:00:03,500 --> 00:00:05,200\nאתם באים איתנו הלילה?\n") && !partial2.includes("Are you coming"), "manual translation replaces the kept English");
  const chip = (await evaluate(`document.querySelector('[data-filter="untranslated"]').innerText`)).replace(/\s+/g, " ");
  check(chip === "Untranslated 0", "a manually translated cue no longer counts as untranslated", chip);
  await clickSel('[data-filter="all"]');
  await screenshot("3-partial-light");

  // 4. Export options: BOM and renumbering (duplicate cue numbers).
  console.log("\n# 4. Export options (duplicate-index.srt)");
  mode = "echo";
  await upload("duplicate-index.srt");
  await waitFor("new file listed", async () => (await rows()).length === 4 && (await rows())[1].en === "Second line.");
  check(!(await evaluate(`!!document.querySelector("dialog[open]")`)), "no dialog: the partial result was downloaded");
  await translate();
  await waitFor("complete", async () => (await outcome()) === "complete");
  const plain = (await download("duplicate-index.he.srt"))?.toString("utf8");
  check(plain === expected("duplicate-index.sfx-on.srt"), "default export keeps the duplicate numbers");
  await clickSel('[data-export-options] summary');
  await waitFor("options open", () => evaluate(`document.querySelector("[data-export-options]").open`));
  await clickSel('[data-export-options] input[type=checkbox]:nth-of-type(1)');
  await evaluate(`document.querySelectorAll("[data-export-options] input[type=checkbox]")[1].click()`);
  const bytes = await download("duplicate-index.he.srt");
  check(bytes?.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ?? false, "BOM option writes EF BB BF");
  const numbers = (bytes?.toString("utf8").replace(/^﻿/, "") ?? "").split("\n\n").map((b) => b.split("\n")[0]);
  check(numbers.join() === "1,2,3,4", "renumber option numbers the cues 1..N", numbers.join());
  await evaluate(`document.querySelectorAll("[data-export-options] input[type=checkbox]").forEach((c) => c.checked && c.click())`);
  check((await download("duplicate-index.he.srt"))?.toString("utf8") === plain, "options off again: default export");
  await key("Escape");
  await waitFor("options closed with Esc", () => evaluate(`!document.querySelector("[data-export-options]").open`));

  // 5. Cancellation while an OpenAI request is in flight.
  console.log("\n# 5. Cancellation (multi-chunk.srt, every answer delayed 3 s)");
  mode = "delay";
  await upload("multi-chunk.srt");
  await waitFor("new file listed", async () => (await rows()).length === 150);
  const requestsBefore = fake.requests.length;
  const closedBefore = fake.stats.closedEarly;
  await translate();
  await waitFor("Cancel button visible", async () => (await buttonState("Cancel")) === "enabled");
  await waitFor("first request in flight", async () => fake.requests.length > requestsBefore, 10_000);
  check((await stateOf('[data-action="download"]')) === "disabled" && (await stateOf('[data-action="copy"]')) === "disabled", "Copy and Download disabled while translating");
  check(await evaluate(`!!document.querySelector('[role=progressbar][aria-valuenow]')`), "progress bar shown");
  await screenshot("5-progress-light");
  check((await click("Cancel")) === "clicked", "Cancel clicked while a request is in flight");
  await waitFor("cancelled state", async () => (await outcome()) === "cancelled", 5_000);
  check((await buttonState("Cancel")) === "missing", "Cancel button gone");
  check((await buttonState("Translate to Hebrew")) === "enabled", "Translate button enabled again");
  check((await text()).includes("may still be billed"), "billing note shown");
  await sleep(7_000); // longer than two delayed answers
  check((await outcome()) === "cancelled", "no late completion appeared");
  check((await rows()).every((r) => r.status === "pending"), "no Hebrew shown");
  check((await stateOf('[data-action="download"]')) === "disabled", "download disabled");
  const sent = fake.requests.length - requestsBefore;
  const aborted = fake.stats.closedEarly - closedBefore;
  check(sent === 1, "no further OpenAI request after Cancel", `${sent} sent`);
  check(aborted === 1, "in-flight request aborted", `${aborted} closed early`);

  // 6. A new translation after cancelling; saving an edit keeps the scroll position.
  console.log("\n# 6. Recovery and scroll position");
  mode = "echo";
  await translate();
  await waitFor("complete", async () => (await outcome()) === "complete", 30_000);
  check((await text()).includes("Cancelled.") === false, "cancelled note cleared");
  const multi = (await download("multi-chunk.he.srt"))?.toString("utf8");
  check(multi === expected("multi-chunk.sfx-on.srt"), "full translation downloaded");
  await evaluate(`document.querySelector('[data-cue-id="90"]').scrollIntoView({ block: "center" })`);
  await sleep(300);
  const top = () => evaluate(`Math.round(document.querySelector('[data-cue-id="90"]').getBoundingClientRect().top)`);
  const before = await top();
  await clickSel('[data-cue-id="90"] [data-edit]');
  await waitFor("editor on cue 90", () => evaluate(`!!document.querySelector('[data-cue-id="90"] textarea')`));
  await setValue('[data-cue-id="90"] textarea', "שורה ערוכה");
  await clickSel('[data-action="save-edit"]');
  await waitFor("saved", async () => (await rows()).find((r) => r.id === 90)?.edited === true);
  await sleep(200);
  const after = await top();
  check(Math.abs(after - before) <= 2, "saving keeps the scroll position", `${before} -> ${after}`);
  await download("multi-chunk.he.srt");

  // 7. Context mode: analyse characters (and cancel), edit the sheet, translate.
  console.log("\n# 7. Context mode with character review (sfx-mixed.srt)");
  await upload("sfx-mixed.srt");
  await waitFor("new file listed", async () => (await rows()).length === 8);
  check((await clickSel('input[name="mode"][value="context"]')) === "clicked", "Context-aware mode selected");
  await waitFor("character review shown", async () => (await buttonState("Analyze characters")) === "enabled");
  check((await setValue('[aria-label="Story notes"]', "Smoke test notes.")) === "set", "story notes entered");

  mode = "delay";
  let before7 = fake.requests.length;
  const closedBefore7 = fake.stats.closedEarly;
  check((await click("Analyze characters")) === "clicked", "Analyze clicked");
  await waitFor("analysis request in flight", async () => fake.requests.length > before7, 10_000);
  check((await click("Cancel analysis")) === "clicked", "analysis cancelled while in flight");
  await waitFor("analysis request aborted", async () => fake.stats.closedEarly > closedBefore7, 10_000);
  await sleep(3_500);
  check(!(await text()).includes("character found"), "no late analysis result");

  mode = "echo";
  before7 = fake.requests.length;
  check((await click("Analyze characters")) === "clicked", "Analyze clicked again");
  await waitFor("analysis done", async () => (await text()).includes("1 character found"));
  const analysisBody = fake.requests[before7];
  const analysisText = analysisBody?.input?.[0]?.content?.[0]?.text ?? "";
  check(analysisBody?.text?.format?.name === "character_sheet", "one analysis request sent", `${fake.requests.length - before7} sent`);
  check(analysisText.includes("JOHN: (sighs) Fine.") && analysisText.includes("[music playing]"), "analysis sees cues before sound-effect removal");
  check(analysisText.includes("Smoke test notes."), "analysis receives the notes");
  await clickSel("[data-analysis-details] summary");
  await waitFor("details open", async () => (await text()).includes("low confidence"));
  check((await text()).includes("low confidence") && (await text()).includes("cues #5"), "confidence and evidence (as cue numbers) shown on demand");
  check((await setValue('tr[data-character="John"] [aria-label="Gender"]', "male")) === "set", "gender edited");
  check((await setValue('tr[data-character="John"] [aria-label="Hebrew name"]', "ג׳ון")) === "set", "Hebrew name edited");

  before7 = fake.requests.length;
  await translate();
  await waitFor("complete", async () => (await outcome()) === "complete", 30_000);
  const contextBodies = fake.requests.slice(before7);
  const instructions = contextBodies[0]?.instructions ?? "";
  check(contextBodies.length === 1, "one translation request", `${contextBodies.length} sent`);
  check(instructions.includes("Hebrew gender and number:"), "context instructions sent");
  check(instructions.includes("- John => ג׳ון (male)"), "edited character sheet sent");
  check(instructions.includes("Smoke test notes."), "notes sent with the translation");
  check((contextBodies[0]?.input?.[0]?.content?.[0]?.text ?? "").includes('"context_before":[]'), "context payload sent");
  const r7 = await rows();
  check(r7.filter((r) => r.status === "removed").map((r) => r.id).join() === "1,2,3,6", "sound-effect cues shown as removed (not exported)", JSON.stringify(r7.map((r) => r.status)));
  check(!r7.some((r) => r.status === "missing"), "no unexpected missing cues");
  await clickSel('[data-filter="removed"]');
  await waitFor("removed filter", async () => (await rows()).map((r) => r.id).join() === "1,2,3,6");
  await clickSel('[data-filter="all"]');
  check((await download("sfx-mixed.he.srt"))?.toString("utf8") === expected("sfx-mixed.sfx-on.srt"), "context result downloaded");

  // 8. Themes.
  console.log("\n# 8. Themes");
  const theme = () => evaluate("document.documentElement.dataset.theme");
  const bodyBg = () => evaluate("getComputedStyle(document.body).backgroundColor");
  check((await theme()) === "light", "System theme resolves to light (light system setting)");
  await clickSel('[data-theme-option="dark"]');
  await waitFor("dark theme", async () => (await theme()) === "dark");
  check((await bodyBg()) === "rgb(13, 16, 22)", "dark background applied", await bodyBg());
  await screenshot("8-dark");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await clickSel('[data-theme-option="system"]');
  await waitFor("system -> dark", async () => (await theme()) === "dark");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await waitFor("system follows the change live", async () => (await theme()) === "light");
  check(true, "System theme follows the operating system setting");
  await clickSel('[data-theme-option="dark"]');

  // 9. Persistence and unsaved-work protection across a reload.
  console.log("\n# 9. Persistence");
  await clickSel('input[name="mode"][value="classic"]');
  await setValue("select", "Formal");
  await setValue('input[type="number"]', "35");
  await setValue('[aria-label="Glossary"]', "John = ג׳ון");
  check((await click("Hide panel")) === "clicked", "workflow panel hidden");
  await waitFor("panel hidden", () => evaluate(`document.getElementById("workflow").getClientRects().length === 0`));
  const wide = await evaluate(`document.querySelector("[aria-label='Subtitle review']").getBoundingClientRect().width`);
  check(wide > 1200, "review uses the full width", String(wide));
  // An unexported edit: reloading asks first (beforeunload).
  await clickSel('[data-cue-id="4"] [data-edit]');
  await setValue('[data-cue-id="4"] textarea', "עריכה שלא נשמרה לקובץ");
  await clickSel('[data-action="save-edit"]');
  const dialogsBefore = dialogs.length;
  await loadPage();
  check(dialogs.slice(dialogsBefore).some((d) => d.type === "beforeunload"), "leaving with unexported edits asks first");
  check((await theme()) === "dark", "dark theme restored before hydration");
  check(await evaluate(`document.getElementById("workflow").getClientRects().length === 0`), "panel stays hidden");
  await click("Show panel");
  check((await evaluate(`document.querySelector("select").value`)) === "Formal", "tone restored");
  check((await evaluate(`document.querySelector('input[type="number"]').value`)) === "35", "max chars restored");
  check((await evaluate(`document.querySelector('[aria-label="Glossary"]').value`)) === "John = ג׳ון", "glossary restored");
  check((await evaluate(`document.querySelector('input[name="mode"]:checked').value`)) === "classic", "mode restored");
  const storage = await evaluate(`JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`);
  check(Object.keys(JSON.parse(storage)).join() === "hebraai.prefs.v1", "only the preferences key is stored");
  check(!/Hello there|Smoke test notes|\[HE\]|JOHN|עריכה/.test(storage), "no subtitles, notes or edits stored");
  check((await rows()).length === 0, "no subtitle content restored after reload");
  // Accessibility: every visible control has an accessible name.
  const unnamed = await evaluate(`[...document.querySelectorAll("button, input, select, textarea, summary")]
    .filter((e) => e.getClientRects().length && e.type !== "file")
    .filter((e) => !(e.getAttribute("aria-label") || e.labels?.length || e.innerText?.trim() || e.title || e.getAttribute("aria-labelledby")))
    .map((e) => e.outerHTML.slice(0, 80))`);
  check(unnamed.length === 0, "all visible controls have an accessible name", unnamed.join(" | "));
  check(
    await evaluate(`(() => { const i = document.querySelector("input[type=file]"); return i.tabIndex >= 0 && getComputedStyle(i).display !== "none"; })()`),
    "file input reachable with the keyboard"
  );
  await clickSel('[data-theme-option="light"]');

  // 10. Mobile layout.
  console.log("\n# 10. Mobile layout (390 x 844)");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await loadPage();
  await upload("basic.srt");
  await waitFor("cues listed", async () => (await rows()).length === 4);
  await translate();
  await waitFor("complete", async () => (await outcome()) === "complete");
  check((await evaluate("document.documentElement.scrollWidth")) <= 390, "no horizontal scrolling", String(await evaluate("document.documentElement.scrollWidth")));
  const stacked = await evaluate(`(() => {
    const row = document.querySelector('[data-cue-id="1"]');
    const en = row.querySelector("[lang=en]").getBoundingClientRect();
    const he = row.querySelector("[data-edit]").getBoundingClientRect();
    return he.top >= en.bottom - 1;
  })()`);
  check(stacked, "English and Hebrew stacked in each cue");
  check(await evaluate(`document.getElementById("translation-settings").hidden`), "settings collapsed to a summary");
  check((await stateOf('[data-action="download"]')) === "enabled", "download available in the bottom bar");
  await screenshot("10-mobile");
  await cdp("Emulation.clearDeviceMetricsOverride");

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
