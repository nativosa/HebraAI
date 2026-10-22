#!/usr/bin/env node
// Captures golden values for the unit tests from the RUNNING app (offline test
// mode + fake OpenAI server, no OpenAI calls), so tests compare against
// observed behaviour instead of re-deriving it from the implementation.
//
//   node scripts/capture-golden.mjs --overwrite
//
// Writes tests/golden/legacy-golden.json:
//   - prompts: instructions sent for every option combination in PROMPT_VARIANTS
//   - request: the full Responses request body for basic.srt (UI defaults)
//   - streams: raw NDJSON response lines for basic.srt and the progress lines
//     for multi-chunk.srt
// Only synthetic fixture text is included. Regenerate only when a behaviour
// change is intended and reviewed.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { startFakeOpenAI } from "./fake-openai.mjs";
import { ROOT, UI_DEFAULT_FIELDS, PROMPT_VARIANTS, startApp, stopApp, waitForApp, postFixture } from "./app-server.mjs";

const OUT = join(ROOT, "tests", "golden", "legacy-golden.json");
const PORT = Number(process.env.BASELINE_PORT) || 3123;

async function main() {
  if (existsSync(OUT) && !process.argv.includes("--overwrite")) {
    console.error(`Refusing to overwrite ${OUT}. Regeneration must be explicit: --overwrite`);
    return 2;
  }
  const fake = await startFakeOpenAI();
  const { child, getLog } = startApp(fake.baseURL, PORT);
  const golden = { prompts: [], request: null, streams: {} };
  try {
    await waitForApp(child, getLog, PORT);
    for (const { name, fields } of PROMPT_VARIANTS) {
      const before = fake.requests.length;
      await postFixture(PORT, "basic.srt", fields);
      const sent = fake.requests.slice(before);
      if (sent.length !== 1) throw new Error(`${name}: expected 1 request, got ${sent.length}`);
      golden.prompts.push({ name, fields, instructions: sent[0].instructions });
    }

    const defaults = { ...UI_DEFAULT_FIELDS, removeSoundEffects: "false" };
    let before = fake.requests.length;
    const basic = await postFixture(PORT, "basic.srt", defaults);
    golden.request = { fixture: "basic.srt", fields: defaults, body: fake.requests[before] };
    golden.streams["basic.srt"] = { status: basic.status, lines: basic.body.split("\n").filter(Boolean) };

    before = fake.requests.length;
    const multi = await postFixture(PORT, "multi-chunk.srt", defaults);
    const lines = multi.body.split("\n").filter(Boolean);
    golden.streams["multi-chunk.srt"] = {
      status: multi.status,
      requestItemCounts: fake.requests.slice(before).map((b) => JSON.parse(b.input[0].content[0].text.split("\n\n")[1]).length),
      progressLines: lines.filter((l) => JSON.parse(l).type === "progress"),
      lastLineType: JSON.parse(lines.at(-1)).type,
    };
  } finally {
    stopApp(child);
    await fake.close();
  }
  if (fake.stats.rejected > 0) {
    console.error("Unexpected fake-server traffic; aborting.");
    return 1;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(golden, null, 2) + "\n");
  console.log(`captured ${golden.prompts.length} prompt variant(s), 1 request body, 2 stream(s) -> tests/golden/legacy-golden.json`);
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  }
);
