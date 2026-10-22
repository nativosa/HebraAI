import { describe, expect, it } from "vitest";
import type { Cue } from "@/lib/srt/parse";
import { parseSrt } from "@/lib/srt/parse";
import { CHUNK_SIZE, chunk, translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildChunkRequest } from "@/lib/translation/prompt";
import { readGolden, readLegacyBaseline, readSrtFixture } from "../helpers/fixtures";
import { itemsSent, stubModel } from "../helpers/stub-model";

const golden = readGolden();

function cues(n: number): Cue[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    start: "00:00:01,000",
    end: "00:00:02,000",
    text: `Line ${i + 1}`,
  }));
}

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
  it("basic.srt produces the captured NDJSON lines", async () => {
    const events = await collect(
      translateCues(stubModel().createResponse, parseSrt(readSrtFixture("basic.srt")), "instr")
    );
    expect(lines(events)).toEqual(golden.streams["basic.srt"].lines);
  });

  it("multi-chunk.srt produces the captured requests, progress lines and baseline SRT", async () => {
    const model = stubModel();
    const events = await collect(
      translateCues(model.createResponse, parseSrt(readSrtFixture("multi-chunk.srt")), "instr")
    );
    const g = golden.streams["multi-chunk.srt"];
    expect(model.calls.map((p) => itemsSent(p).length)).toEqual(g.requestItemCounts);
    expect(lines(events.filter((e) => e.type === "progress"))).toEqual(g.progressLines);
    expect(events.at(-1)).toEqual({ type: "complete", content: readLegacyBaseline("multi-chunk.sfx-off.srt") });
  });

  it("LEGACY D1: duplicate-index.srt reproduces the baseline collision", async () => {
    const events = await collect(
      translateCues(stubModel().createResponse, parseSrt(readSrtFixture("duplicate-index.srt")), "instr")
    );
    expect(events.at(-1)).toEqual({ type: "complete", content: readLegacyBaseline("duplicate-index.sfx-off.srt") });
  });
});

describe("translateCues: output order", () => {
  it("sorts translated cues by index across chunks", async () => {
    const input = [3, 1, 2].map((i) => ({ index: i, start: `00:00:0${i},000`, end: `00:00:0${i},500`, text: `L${i}` }));
    const events = await collect(translateCues(stubModel().createResponse, input, "instr"));
    expect(events.at(-1)).toEqual({
      type: "complete",
      content:
        "1\n00:00:01,000 --> 00:00:01,500\n[HE] L1\n\n" +
        "2\n00:00:02,000 --> 00:00:02,500\n[HE] L2\n\n" +
        "3\n00:00:03,000 --> 00:00:03,500\n[HE] L3\n",
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
