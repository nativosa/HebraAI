import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { CHUNK_SIZE, chunk, translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildChunkRequest } from "@/lib/translation/prompt";
import { cue, cues } from "../helpers/cues";
import { readGolden, readExpected, readSrtFixture } from "../helpers/fixtures";
import { itemsSent, stubModel } from "../helpers/stub-model";

const golden = readGolden();


async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

// Serialised exactly as the route writes NDJSON lines.
const lines = (events: StreamEvent[]) => events.map((e) => JSON.stringify(e));

describe("chunk", () => {
  it("splits into consecutive slices of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 60)).toEqual([]);
  });

  it("uses chunks of 60 cues", () => {
    expect(CHUNK_SIZE).toBe(60);
  });
});

describe("translateCues: chunk boundaries", () => {
  it.each([
    [1, [1], [100]],
    [59, [59], [100]],
    [60, [60], [100]],
    [61, [60, 1], [50, 100]],
    [120, [60, 60], [50, 100]],
    [121, [60, 60, 1], [33, 67, 100]],
  ])("%d cues -> requests of %j, progress %j", async (n, sizes, progress) => {
    const model = stubModel();
    const events = await collect(translateCues(model.createResponse, cues(n), "instr"));

    expect(model.calls.map((p) => itemsSent(p).length)).toEqual(sizes);
    expect(events.filter((e) => e.type === "progress").map((e) => e.progress)).toEqual(progress);
    expect(events.at(-1)?.type).toBe("complete");
    expect(events).toHaveLength(sizes.length + 1);
  });

  it("sends each chunk's cues, in order, with the given instructions", async () => {
    const model = stubModel();
    const input = cues(61);
    await collect(translateCues(model.createResponse, input, "instr"));
    expect(model.calls).toEqual([buildChunkRequest("instr", input.slice(0, 60)), buildChunkRequest("instr", input.slice(60))]);
  });

  it("sends requests one at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const inner = stubModel();
    const createResponse: typeof inner.createResponse = async (p) => {
      maxActive = Math.max(maxActive, ++active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return inner.createResponse(p);
    };
    await collect(translateCues(createResponse, cues(150), "instr"));
    expect(maxActive).toBe(1);
  });
});

describe("translateCues: golden streams from the running app", () => {
  // Stage 2 adds a report to the final event; progress lines and the SRT
  // content are unchanged from the captured stream.
  it("basic.srt produces the captured progress lines and content", async () => {
    const events = await collect(
      translateCues(stubModel().createResponse, parseSrt(readSrtFixture("basic.srt")).cues, "instr")
    );
    const captured = golden.streams["basic.srt"].lines.map((l: string) => JSON.parse(l));
    expect(lines(events.slice(0, -1))).toEqual(golden.streams["basic.srt"].lines.slice(0, -1));
    expect(events.at(-1)).toMatchObject({ type: "complete", content: captured.at(-1).content });
  });

  it("multi-chunk.srt produces the captured requests, progress lines and baseline SRT", async () => {
    const model = stubModel();
    const events = await collect(
      translateCues(model.createResponse, parseSrt(readSrtFixture("multi-chunk.srt")).cues, "instr")
    );
    const g = golden.streams["multi-chunk.srt"];
    expect(model.calls.map((p) => itemsSent(p).length)).toEqual(g.requestItemCounts);
    expect(lines(events.filter((e) => e.type === "progress"))).toEqual(g.progressLines);
    expect(events.at(-1)).toMatchObject({ type: "complete", content: readExpected("multi-chunk.sfx-off.srt") });
  });

  it("D1 (fixed): cues sharing a number keep their own translations", async () => {
    const events = await collect(
      translateCues(stubModel().createResponse, parseSrt(readSrtFixture("duplicate-index.srt")).cues, "instr")
    );
    const content = readExpected("duplicate-index.sfx-off.srt");
    expect(events.at(-1)).toMatchObject({ type: "complete", content });
    expect(content).toContain("2\n00:00:02,500 --> 00:00:03,500\n[HE] Second line.\n");
    expect(content).toContain("2\n00:00:04,000 --> 00:00:05,000\n[HE] A different second line.\n");
  });
});

describe("translateCues: output order and report", () => {
  it("keeps the input order, even when numbers are out of order", async () => {
    const input = [3, 1, 2].map((n, i) =>
      cue(i + 1, `L${n}`, { number: n, start: `00:00:0${n},000`, end: `00:00:0${n},500` })
    );
    const events = await collect(translateCues(stubModel().createResponse, input, "instr"));
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      content:
        "3\n00:00:03,000 --> 00:00:03,500\n[HE] L3\n\n" +
        "1\n00:00:01,000 --> 00:00:01,500\n[HE] L1\n\n" +
        "2\n00:00:02,000 --> 00:00:02,500\n[HE] L2\n",
    });
  });

  it("reports counts and carries the input context", async () => {
    const parse = { recovered: [{ line: 9, kind: "missing-number" as const }], unparsed: [] };
    const events = await collect(
      translateCues(stubModel().createResponse, cues(3), "instr", { parse, removedSoundEffectCues: 2 })
    );
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      report: { cues: 3, translated: 3, removedSoundEffectCues: 2, parse },
    });
  });
});

describe("translateCues: malformed model output", () => {
  it("invalid JSON in chunk 2 -> one progress event, an error event, then stops", async () => {
    const model = stubModel({ 2: "Sorry, I can't do that." });
    const events = await collect(translateCues(model.createResponse, cues(150), "instr"));
    expect(events).toEqual([
      { type: "progress", progress: 33, currentChunk: 1, totalChunks: 3 },
      { type: "error", message: "Model returned invalid JSON (unexpected).", details: "Sorry, I can't do that." },
    ]);
    expect(model.calls).toHaveLength(2);
  });

  it("truncates details to the first 500 characters", async () => {
    const events = await collect(translateCues(stubModel({ 1: "x".repeat(600) }).createResponse, cues(1), "instr"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", details: "x".repeat(500) });
  });

  it("omits details when the output text is missing", async () => {
    const events = await collect(translateCues(stubModel({ 1: undefined }).createResponse, cues(1), "instr"));
    expect(lines(events)).toEqual(['{"type":"error","message":"Model returned invalid JSON (unexpected)."}']);
  });

  it.each([
    ["no items", "{}"],
    ["items not an array", '{"items":{}}'],
    ["null", "null"],
  ])("valid JSON with an unexpected shape (%s) throws after earlier progress, and stops", async (_label, out) => {
    const model = stubModel({ 2: out });
    const events: StreamEvent[] = [];
    await expect(async () => {
      for await (const e of translateCues(model.createResponse, cues(150), "instr")) events.push(e);
    }).rejects.toThrow(TypeError);
    expect(events).toEqual([{ type: "progress", progress: 33, currentChunk: 1, totalChunks: 3 }]);
    expect(model.calls).toHaveLength(2);
  });

  it("propagates an API error and stops", async () => {
    const model = stubModel({ 1: new Error("429 Rate limit") });
    const events: StreamEvent[] = [];
    await expect(async () => {
      for await (const e of translateCues(model.createResponse, cues(150), "instr")) events.push(e);
    }).rejects.toThrow("429 Rate limit");
    expect(events).toEqual([]);
    expect(model.calls).toHaveLength(1);
  });
});
