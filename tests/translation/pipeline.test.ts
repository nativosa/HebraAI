import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { CHUNK_SIZE, DEFAULT_MAX_ATTEMPTS_PER_CHUNK, chunk, translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildChunkRequest } from "@/lib/translation/prompt";
import { cue, cues } from "../helpers/cues";
import { readGolden, readExpected, readSrtFixture } from "../helpers/fixtures";
import { incompleteResponse, itemsFor, itemsSent, refusalResponse, stubModel } from "../helpers/stub-model";

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
      translateCues(stubModel().createResponse, cues(3), "instr", { context: { parse, removedSoundEffectCues: 2 } })
    );
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      report: { cues: 3, translated: 3, removedSoundEffectCues: 2, parse },
    });
  });
});

describe("translateCues: validation and partial results", () => {
  const final = (events: StreamEvent[]) => events.at(-1)!;

  it("complete only when every cue is translated", async () => {
    const events = await collect(translateCues(stubModel().createResponse, cues(3), "instr"));
    expect(final(events)).toMatchObject({ type: "complete", report: { cues: 3, translated: 3, untranslated: [] } });
  });

  it("D12 (fixed): a cue still missing after repair makes the result partial; it keeps its English text", async () => {
    const model = stubModel({ 1: itemsFor(1, 3), 2: itemsFor() });
    const events = await collect(translateCues(model.createResponse, cues(3), "instr"));
    expect(final(events)).toEqual({
      type: "partial",
      content:
        "1\n00:00:01,000 --> 00:00:02,000\nHE1\n\n" +
        "2\n00:00:01,000 --> 00:00:02,000\nLine 2\n\n" +
        "3\n00:00:01,000 --> 00:00:02,000\nHE3\n",
      report: {
        cues: 3,
        translated: 2,
        untranslated: [{ id: 2, number: 2, start: "00:00:01,000", end: "00:00:02,000", reason: "missing" }],
        requests: 2,
        repairs: 1,
        removedSoundEffectCues: 0,
        parse: { recovered: [], unparsed: [] },
      },
    });
  });

  it("an invalid chunk does not stop later chunks", async () => {
    const model = stubModel({ 2: "Sorry, I can't do that." });
    const events = await collect(translateCues(model.createResponse, cues(150), "instr", { maxAttemptsPerChunk: 1 }));
    expect(events.filter((e) => e.type === "progress").map((e) => e.progress)).toEqual([33, 67, 100]);
    const last = final(events);
    expect(last.type).toBe("partial");
    if (last.type !== "partial") return;
    expect(last.report.translated).toBe(90);
    expect(last.report.untranslated.map((u) => u.id)).toEqual(cues(150).slice(60, 120).map((c) => c.id));
    expect(new Set(last.report.untranslated.map((u) => u.reason))).toEqual(new Set(["invalid-json"]));
    expect(model.calls).toHaveLength(3);
  });

  it("refusal and content filter mark cues untranslated with the reason", async () => {
    const model = stubModel({ 1: refusalResponse, 2: incompleteResponse("content_filter") });
    const last = final(await collect(translateCues(model.createResponse, cues(130), "instr")));
    expect(last.type).toBe("partial");
    if (last.type !== "partial") return;
    const reasons = last.report.untranslated.map((u) => u.reason);
    expect(reasons.filter((r) => r === "refusal")).toHaveLength(60);
    expect(reasons.filter((r) => r === "content-filter")).toHaveLength(60);
    expect(last.report.translated).toBe(10);
  });

  it("error, with the report, when nothing was translated", async () => {
    const last = final(await collect(translateCues(stubModel({ 1: refusalResponse }).createResponse, cues(2), "instr")));
    expect(last).toMatchObject({
      type: "error",
      message: "No cues were translated: the model refused.",
      report: { cues: 2, translated: 0 },
    });
  });

  it("an API error stops the job and keeps the chunks already translated", async () => {
    const model = stubModel({ 2: new Error("429 Rate limit") });
    const events = await collect(translateCues(model.createResponse, cues(150), "instr"));
    expect(events.filter((e) => e.type === "progress")).toHaveLength(1);
    const last = final(events);
    expect(last.type).toBe("partial");
    if (last.type !== "partial") return;
    expect(last.report).toMatchObject({ translated: 60, failure: "429 Rate limit" });
    expect(last.report.untranslated).toHaveLength(90);
    expect(new Set(last.report.untranslated.map((u) => u.reason))).toEqual(new Set(["request-failed"]));
    expect(model.calls).toHaveLength(2);
  });

  it("an API error on the first chunk is an error event with its message", async () => {
    const last = final(await collect(translateCues(stubModel({ 1: new Error("401 Unauthorized") }).createResponse, cues(2), "instr")));
    expect(last).toMatchObject({ type: "error", message: "401 Unauthorized", report: { translated: 0 } });
  });
});

describe("translateCues: selective repair", () => {
  const final = (events: StreamEvent[]) => events.at(-1)!;
  const run = async (outputs: Parameters<typeof stubModel>[0], n: number, maxAttemptsPerChunk?: number) => {
    const model = stubModel(outputs);
    const events = await collect(translateCues(model.createResponse, cues(n), "instr", { maxAttemptsPerChunk }));
    return { model, last: final(events) };
  };
  const sizes = (model: ReturnType<typeof stubModel>) => model.calls.map((p) => itemsSent(p).length);

  it("re-sends only the missing cues, in the same request format", async () => {
    const { model, last } = await run({ 1: itemsFor(1, 3) }, 3);
    expect(last).toMatchObject({ type: "complete", report: { requests: 2, repairs: 1, translated: 3 } });
    expect(itemsSent(model.calls[1])).toEqual([{ index: 2, text: "Line 2" }]);
    expect(model.calls[1].instructions).toBe(model.calls[0].instructions);
  });

  it.each([
    ["invalid JSON", "not json"],
    ["wrong shape", "{}"],
    ["incomplete answer", incompleteResponse("max_output_tokens")],
  ] as const)("a wholly unusable answer (%s) is repaired in two halves", async (_label, reply) => {
    const { model, last } = await run({ 1: reply }, 60);
    expect(sizes(model)).toEqual([60, 30, 30]);
    expect(last).toMatchObject({ type: "complete", report: { requests: 3, repairs: 2 } });
  });

  it.each([
    ["refusal", refusalResponse],
    ["content filter", incompleteResponse("content_filter")],
  ] as const)("a %s is never repaired", async (_label, reply) => {
    const { model, last } = await run({ 1: reply }, 3);
    expect(model.calls).toHaveLength(1);
    expect(last).toMatchObject({ type: "error", report: { requests: 1, repairs: 0 } });
  });

  it("repairs once only: cues still failing after the repair stay untranslated", async () => {
    const { model, last } = await run({ 1: itemsFor(1), 2: itemsFor(2) }, 3);
    expect(model.calls).toHaveLength(2);
    expect(last.type).toBe("partial");
    if (last.type === "partial") expect(last.report.untranslated.map((u) => [u.id, u.reason])).toEqual([[3, "missing"]]);
  });

  it("an empty or conflicting translation is repaired", async () => {
    const reply = JSON.stringify({ items: [{ index: 1, text_he: "" }, { index: 2, text_he: "A" }, { index: 2, text_he: "B" }] });
    const { model, last } = await run({ 1: reply }, 2);
    expect(itemsSent(model.calls[1]).map((i) => i.index)).toEqual([1, 2]);
    expect(last.type).toBe("complete");
  });
});

describe("translateCues: per-chunk request budget", () => {
  const final = (events: StreamEvent[]) => events.at(-1)!;

  it("defaults to 6 attempts per chunk", () => {
    expect(DEFAULT_MAX_ATTEMPTS_PER_CHUNK).toBe(6);
  });

  it("budget 1: no repair, the cue stays untranslated", async () => {
    const model = stubModel({ 1: itemsFor(1) });
    const last = final(await collect(translateCues(model.createResponse, cues(2), "instr", { maxAttemptsPerChunk: 1 })));
    expect(model.calls).toHaveLength(1);
    expect(last).toMatchObject({ type: "partial", report: { requests: 1, repairs: 0, translated: 1 } });
  });

  it("budget 2: only the first half of a failed chunk is repaired", async () => {
    const model = stubModel({ 1: "not json" });
    const last = final(await collect(translateCues(model.createResponse, cues(10), "instr", { maxAttemptsPerChunk: 2 })));
    expect(model.calls.map((p) => itemsSent(p).length)).toEqual([10, 5]);
    expect(last.type).toBe("partial");
    if (last.type !== "partial") return;
    expect(last.report.untranslated.map((u) => [u.id, u.reason])).toEqual([6, 7, 8, 9, 10].map((id) => [id, "invalid-json"]));
  });

  it("the budget applies per chunk, not per job", async () => {
    const model = stubModel({ 1: itemsFor(...Array.from({ length: 59 }, (_, i) => i + 1)), 3: itemsFor(...Array.from({ length: 9 }, (_, i) => i + 61)) });
    const last = final(await collect(translateCues(model.createResponse, cues(70), "instr", { maxAttemptsPerChunk: 2 })));
    expect(model.calls.map((p) => itemsSent(p).length)).toEqual([60, 1, 10, 1]);
    expect(last).toMatchObject({ type: "complete", report: { requests: 4, repairs: 2 } });
  });

  it("budget 0 sends nothing", async () => {
    const model = stubModel();
    const last = final(await collect(translateCues(model.createResponse, cues(2), "instr", { maxAttemptsPerChunk: 0 })));
    expect(model.calls).toHaveLength(0);
    expect(last).toMatchObject({ type: "error", report: { requests: 0 } });
  });
});
