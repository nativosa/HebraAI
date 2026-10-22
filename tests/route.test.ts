import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { readGolden, readExpected, readSrtFixture } from "./helpers/fixtures";
import { stubModel } from "./helpers/stub-model";

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
  it("streams the captured NDJSON for basic.srt", async () => {
    const res = await post({ ...UI_DEFAULTS, removeSoundEffects: "false", file: fixtureFile("basic.srt") });
    expect(res.status).toBe(golden.streams["basic.srt"].status);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const body = await res.text();
    expect(body.endsWith("\n")).toBe(true);
    expect(body.split("\n").filter(Boolean)).toEqual(golden.streams["basic.srt"].lines);
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

describe("POST /api/translate: malformed model output", () => {
  const file = () => fixtureFile("multi-chunk.srt"); // 150 cues -> 3 chunks

  it("invalid JSON: progress so far, one error event with details, no completion", async () => {
    model.current = stubModel({ 2: "not json" });
    const res = await post({ ...UI_DEFAULTS, file: file() });
    expect(res.status).toBe(200);
    expect(ndjson(await res.text())).toEqual([
      { type: "progress", progress: 33, currentChunk: 1, totalChunks: 3 },
      { type: "error", message: "Model returned invalid JSON (unexpected).", details: "not json" },
    ]);
    expect(model.current.calls).toHaveLength(2);
  });

  it.each(["{}", '{"items":{}}', "null"])(
    "unexpected shape %j: one error event with a message, no completion",
    async (out) => {
      model.current = stubModel({ 2: out });
      const events = ndjson(await (await post({ ...UI_DEFAULTS, file: file() })).text());
      expect(events.map((e) => e.type)).toEqual(["progress", "error"]);
      expect(Object.keys(events[1])).toEqual(["type", "message"]);
      expect(typeof events[1].message).toBe("string");
      expect(events[1].message.length).toBeGreaterThan(0);
      expect(model.current.calls).toHaveLength(2);
    }
  );

  it("API error: one error event with the error message, no completion", async () => {
    model.current = stubModel({ 1: new Error("429 Rate limit") });
    const events = ndjson(await (await post({ ...UI_DEFAULTS, file: file() })).text());
    expect(events).toEqual([{ type: "error", message: "429 Rate limit" }]);
  });
});
