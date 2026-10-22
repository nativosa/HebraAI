import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { readGolden, readExpected, readSrtFixture } from "./helpers/fixtures";
import { itemsFor, stubModel } from "./helpers/stub-model";
import { parseSrt } from "@/lib/srt/parse";

// Test-only replacement of the OpenAI client module: the route's client sends
// every request to an in-process stub model. Production code is unchanged.
const model = vi.hoisted(() => ({ current: null as ReturnType<typeof stubModel> | null }));
vi.mock("@/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    responses: { create: (p: ResponseCreateParamsNonStreaming) => model.current!.createResponse(p) },
  }),
}));

const { POST } = await import("@/app/api/translate/route");
const golden = readGolden();
const UI_DEFAULTS = { tone: "Neutral", preserveBreaks: "true", maxChars: "42", glossary: "" };

beforeEach(() => {
  model.current = stubModel();
  vi.stubEnv("OPENAI_API_KEY", "test-key-not-used");
  vi.stubEnv("MAX_FILE_SIZE_BYTES", undefined);
  // Any real network access from the route would fail the test.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("network disabled in tests")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return POST(new Request("http://127.0.0.1/api/translate", { method: "POST", body: fd }));
}

const srtFile = (content: string | Uint8Array<ArrayBuffer>, name = "in.srt") => new File([content], name);
const fixtureFile = (name: string) => srtFile(readSrtFixture(name), name);
const ndjson = (body: string) => body.split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("POST /api/translate: request guards", () => {
  it("500 when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const res = await post({ file: fixtureFile("basic.srt") });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Missing OPENAI_API_KEY" });
  });

  it.each([
    ["missing", {}],
    ["a text field", { file: "1\n00:00:01,000 --> 00:00:02,000\nHi" }],
  ])("400 when file is %s", async (_label, fields) => {
    const res = await post(fields);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Expected form-data field 'file' (SRT)" });
  });

  it("413 above the default 512 KB cap", async () => {
    const res = await post({ file: srtFile(new Uint8Array(600 * 1024)) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "File too large", maxBytes: 524288, receivedBytes: 614400 });
  });

  it("uses MAX_FILE_SIZE_BYTES when valid", async () => {
    vi.stubEnv("MAX_FILE_SIZE_BYTES", "100");
    const res = await post({ file: srtFile(new Uint8Array(101)) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "File too large", maxBytes: 100, receivedBytes: 101 });
  });

  it.each(["abc", "0", "-1", "1.5"])("ignores invalid MAX_FILE_SIZE_BYTES %j", async (value) => {
    vi.stubEnv("MAX_FILE_SIZE_BYTES", value);
    const res = await post({ file: srtFile(new Uint8Array(600 * 1024)) });
    expect(await res.json()).toMatchObject({ maxBytes: 524288 });
  });

  it("400 when no cues can be parsed", async () => {
    const res = await post({ file: srtFile("not a subtitle file") });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Could not parse SRT (0 cues found)" });
  });

  it("400 when sound-effect removal leaves no cues", async () => {
    const res = await post({
      file: srtFile("1\n00:00:01,000 --> 00:00:02,000\n[music]\n\n2\n00:00:03,000 --> 00:00:04,000\n(laughs)\n"),
      removeSoundEffects: "true",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "All cues were filtered out (check sound-effect rules)" });
  });

  it("makes no model request when a guard rejects the upload", async () => {
    await post({ file: srtFile("not a subtitle file") });
    expect(model.current!.calls).toHaveLength(0);
  });
});

describe("POST /api/translate: streaming", () => {
  // Progress lines and content as captured in Stage 0; the final event now
  // also carries the report.
  it("streams the captured progress lines and content for basic.srt", async () => {
    const res = await post({ ...UI_DEFAULTS, removeSoundEffects: "false", file: fixtureFile("basic.srt") });
    expect(res.status).toBe(golden.streams["basic.srt"].status);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const body = await res.text();
    expect(body.endsWith("\n")).toBe(true);
    const captured: string[] = golden.streams["basic.srt"].lines;
    const lines = body.split("\n").filter(Boolean);
    expect(lines.slice(0, -1)).toEqual(captured.slice(0, -1));
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      ...JSON.parse(captured.at(-1)!),
      report: {
        cues: 4,
        translated: 4,
        untranslated: [],
        removedSoundEffectCues: 0,
        parse: { recovered: [], unparsed: [] },
      },
    });
  });

  it("reports recovered and unparsed input in the final event", async () => {
    const res = await post({ ...UI_DEFAULTS, removeSoundEffects: "false", file: fixtureFile("quirks.srt") });
    const final = ndjson(await res.text()).at(-1);
    expect(final.type).toBe("complete");
    expect(final.report.parse.unparsed).toEqual([{ line: 20, lines: 1, kind: "orphan-text" }]);
    expect(final.report.parse.recovered.map((r: { kind: string }) => r.kind)).toEqual([
      "dot-separator",
      "missing-number",
      "short-hour",
      "empty-cue",
    ]);
  });

  it("sends the captured instructions for the chosen options", async () => {
    const formal = golden.prompts.find((p: { name: string }) => p.name === "formal.breaks-off");
    await (await post({ ...formal.fields, file: fixtureFile("basic.srt") })).text();
    expect(model.current!.calls[0].instructions).toBe(formal.instructions);
  });

  it("LEGACY D11: ignores the glossary field", async () => {
    const neutral = golden.prompts.find((p: { name: string }) => p.name === "neutral.breaks-off");
    await (await post({ ...neutral.fields, glossary: "Gotham=גות'האם", file: fixtureFile("basic.srt") })).text();
    expect(model.current!.calls[0].instructions).toBe(neutral.instructions);
    expect(JSON.stringify(model.current!.calls[0])).not.toContain("Gotham");
  });

  // Offline counterpart of `npm run baseline:check`: every Stage 0 case,
  // through the route, with the fake server's echo translator.
  const fixtures = ["basic", "crlf-bom", "duplicate-index", "multi-chunk", "multiline-italics", "quirks", "sfx-mixed"];
  it.each(fixtures.flatMap((f) => [[f, "sfx-on"], [f, "sfx-off"]]))(
    "%s (%s) matches fixtures/expected",
    async (fixture, variant) => {
      const res = await post({
        ...UI_DEFAULTS,
        removeSoundEffects: String(variant === "sfx-on"),
        file: fixtureFile(`${fixture}.srt`),
      });
      const complete = ndjson(await res.text()).find((m) => m.type === "complete");
      expect(complete.content).toBe(readExpected(`${fixture}.${variant}.srt`));
    }
  );
});

describe("POST /api/translate: incomplete translations", () => {
  const file = () => fixtureFile("multi-chunk.srt"); // 150 cues -> 3 chunks
  const types = (events: { type: string }[]) => events.map((e) => e.type);

  it("invalid JSON in one chunk: all chunks processed, final event partial", async () => {
    model.current = stubModel({ 2: "not json" });
    const res = await post({ ...UI_DEFAULTS, file: file() });
    expect(res.status).toBe(200);
    const events = ndjson(await res.text());
    expect(types(events)).toEqual(["progress", "progress", "progress", "partial"]);
    expect(events.at(-1).report).toMatchObject({ cues: 150, translated: 90 });
    expect(events.at(-1).report.untranslated).toHaveLength(60);
    expect(model.current.calls).toHaveLength(3);
  });

  it.each(["{}", '{"items":{}}', "null"])("unexpected shape %j: partial, never complete", async (out) => {
    model.current = stubModel({ 2: out });
    const events = ndjson(await (await post({ ...UI_DEFAULTS, file: file() })).text());
    expect(events.at(-1).type).toBe("partial");
    expect(new Set(events.at(-1).report.untranslated.map((u: { reason: string }) => u.reason))).toEqual(
      new Set(["invalid-shape"])
    );
  });

  it("API error on the first chunk: one error event with the error message", async () => {
    model.current = stubModel({ 1: new Error("429 Rate limit") });
    const events = ndjson(await (await post({ ...UI_DEFAULTS, file: file() })).text());
    expect(types(events)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ type: "error", message: "429 Rate limit", report: { translated: 0 } });
  });

  it("never sends cue text in the report", async () => {
    model.current = stubModel({ 1: itemsFor() });
    const events = ndjson(await (await post({ ...UI_DEFAULTS, file: fixtureFile("basic.srt") })).text());
    const report = JSON.stringify(events.at(-1).report);
    for (const c of parseSrt(readSrtFixture("basic.srt")).cues) expect(report).not.toContain(c.text);
  });
});
