import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { readSrtFixture } from "./helpers/fixtures";
import { hangingRequest, stubModel } from "./helpers/stub-model";

// Same test-only client replacement as tests/route.test.ts.
const model = vi.hoisted(() => ({ current: null as ReturnType<typeof stubModel> | null }));
vi.mock("@/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    responses: {
      create: (p: ResponseCreateParamsNonStreaming, o?: { signal?: AbortSignal }) => model.current!.createResponse(p, o ?? {}),
    },
  }),
}));

const translate = (await import("@/app/api/translate/route")).POST;
const characters = (await import("@/app/api/characters/route")).POST;

beforeEach(() => {
  model.current = stubModel();
  vi.stubEnv("OPENAI_API_KEY", "test-key-not-used");
  vi.stubEnv("MAX_FILE_SIZE_BYTES", undefined);
  for (const k of ["INPUT", "CACHED_INPUT", "OUTPUT"]) vi.stubEnv(`OPENAI_PRICE_${k}_PER_MTOK`, undefined);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("network disabled in tests")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function form(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}
const post = (route: typeof translate, fields: Record<string, string | File>, signal?: AbortSignal) =>
  route(new Request("http://127.0.0.1/api", { method: "POST", body: form(fields), signal }));

const basic = () => new File([readSrtFixture("basic.srt")], "basic.srt");
const LABELLED = "1\n00:00:01,000 --> 00:00:02,000\nMARY: Hi.\n\n2\n00:00:03,000 --> 00:00:04,000\n(JOHN) Hello.\n";
const sheet = JSON.stringify([{ name: "John", hebrewName: "ג׳ון", aliases: [], gender: "male" }]);

describe("POST /api/translate: context mode", () => {
  it("sends the context instructions and the character sheet", async () => {
    const res = await post(translate, { file: basic(), mode: "context", characters: sheet, notes: "A test." });
    const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(events.at(-1).type).toBe("complete");
    const instructions = model.current!.calls[0].instructions as string;
    expect(instructions).toContain("Hebrew gender and number:");
    expect(instructions).toContain("- John => ג׳ון (male)");
    expect(instructions).toContain("A test.");
  });

  it("ignores characters and notes in classic mode", async () => {
    await post(translate, { file: basic(), characters: sheet, notes: "A test." });
    expect(model.current!.calls[0].instructions).not.toContain("John");
  });

  it.each([
    [{ characters: "[{" }, "Characters must be a JSON array."],
    [{ characters: '[{"name":"A","gender":"x"}]' }, 'Character "A": gender must be male, female or unknown.'],
    [{ notes: "x".repeat(4001) }, "Notes have 4001 characters; the maximum is 4000."],
  ])("400 for invalid context input %#", async (fields, error) => {
    const res = await post(translate, { file: basic(), mode: "context", ...fields });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(model.current!.calls).toHaveLength(0);
  });
});

describe("POST /api/characters", () => {
  it("analyses the cues before sound-effect removal and returns the sheet", async () => {
    model.current = stubModel({
      1: JSON.stringify({
        characters: [{ name: "Mary", hebrewName: "מרי", aliases: [], gender: "female", confidence: "high", evidence: [1, 7] }],
      }),
    });
    const res = await post(characters, { file: new File([LABELLED], "a.srt"), notes: "Drama." });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      characters: [{ name: "Mary", gender: "female", confidence: "high", evidence: [1] }],
      analyzedCues: 2,
      totalCues: 2,
      requests: 1,
    });
    const text = JSON.stringify(model.current!.calls[0].input);
    expect(text).toContain("(JOHN) Hello.");
    expect(text).toContain("Drama.");
  });

  it("applies the same guards as /api/translate", async () => {
    vi.stubEnv("MAX_FILE_SIZE_BYTES", "10");
    expect((await post(characters, { file: basic() })).status).toBe(413);
    vi.stubEnv("MAX_FILE_SIZE_BYTES", undefined);
    expect((await post(characters, { file: new File(["nothing"], "a.srt") })).status).toBe(400);
    expect((await post(characters, { file: basic(), notes: "x".repeat(4001) })).status).toBe(400);
    expect((await post(characters, {})).status).toBe(400);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    expect((await post(characters, { file: basic() })).status).toBe(500);
    expect(model.current!.calls).toHaveLength(0);
  });

  it("502 with a message when no usable answer comes back", async () => {
    model.current = stubModel({ 1: "x", 2: "x", 3: "x" });
    const res = await post(characters, { file: basic() });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Character analysis failed: the answer was not a valid character list." });
  });

  it("aborts the request in flight when the browser disconnects", async () => {
    model.current = stubModel({ 1: hangingRequest });
    const abort = new AbortController();
    const pending = post(characters, { file: basic() }, abort.signal);
    await vi.waitFor(() => expect(model.current!.calls).toHaveLength(1));
    abort.abort();
    expect((await pending).status).toBe(499);
    expect(model.current!.signals[0]?.aborted).toBe(true);
  });
});
