import { describe, expect, it } from "vitest";
import { APIError } from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildChunkRequest, buildContextChunkRequest, buildContextInstructions, buildInstructions } from "@/lib/translation/prompt";
import { cue, cues } from "../helpers/cues";
import { hangingRequest, stubModel } from "../helpers/stub-model";

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

type ContextPayload = { context_before: string[]; items: { index: number; text: string }[]; context_after: string[] };

function payloadOf(params: ResponseCreateParamsNonStreaming): ContextPayload {
  const text = (params.input as { content: { text: string }[] }[])[0].content[0].text;
  return JSON.parse(text.slice(text.lastIndexOf("\n\n") + 2));
}

const WINDOW = { before: 8, after: 4 };
const base = { tone: "Neutral" as const, maxChars: 42, preserveBreaks: true, notes: "" };

describe("buildContextInstructions", () => {
  it("extends the classic instructions with Hebrew gender rules", () => {
    const text = buildContextInstructions(base);
    expect(text.startsWith(buildInstructions(base))).toBe(true);
    expect(text).toContain("Hebrew gender and number:");
    expect(text).toContain("prefer natural gender-neutral phrasing; otherwise use the masculine form");
    expect(text).not.toContain("Characters");
    expect(text).not.toContain("Notes about the story");
  });

  it("adds the character sheet and the notes", () => {
    const text = buildContextInstructions({ ...base, notes: "Dana and Alex are sisters." }, [
      { name: "Dana", hebrewName: "דנה", aliases: ["Danny"], gender: "female" },
      { name: "Alex", hebrewName: "", aliases: [], gender: "unknown" },
    ]);
    expect(text).toContain("\n- Dana => דנה (female; also called Danny)");
    expect(text).toContain("\n- Alex (unknown)");
    expect(text.endsWith("background only, do not translate):\nDana and Alex are sisters.")).toBe(true);
  });
});

describe("buildContextChunkRequest", () => {
  it("sends context cues as text only and the items with ids, with the classic schema", () => {
    const request = buildContextChunkRequest("instr", [cue(5, "Hi")], { before: [cue(4, "Before")], after: [cue(6, "After")] });
    expect(payloadOf(request)).toEqual({ context_before: ["Before"], items: [{ index: 5, text: "Hi" }], context_after: ["After"] });
    const classic = buildChunkRequest("instr", [cue(5, "Hi")]);
    expect(request.text).toEqual(classic.text);
    expect(request.model).toBe(classic.model);
    expect(request.instructions).toBe("instr");
  });
});

describe("translateCues: context mode", () => {
  it("sends 8 cues before and 4 after each chunk, clipped at the ends", async () => {
    const model = stubModel();
    const input = cues(130);
    const events = await collect(translateCues(model.createResponse, input, "instr", { contextWindow: WINDOW }));
    const texts = (from: number, to: number) => input.slice(from - 1, to).map((c) => c.text);
    expect(model.calls.map(payloadOf).map((p) => [p.context_before, p.items.length, p.context_after])).toEqual([
      [[], 60, texts(61, 64)],
      [texts(53, 60), 60, texts(121, 124)],
      [texts(113, 120), 10, []],
    ]);
    expect(events.at(-1)?.type).toBe("complete");
  });

  it("never takes a translation for a context cue from the wrong chunk", async () => {
    // The first answer also returns an item for cue 61 (context of chunk 1).
    const leak = JSON.stringify({
      items: [...cues(60).map((c) => ({ index: c.id, text_he: `HE${c.id}` })), { index: 61, text_he: "LEAK" }],
    });
    const model = stubModel({ 1: leak });
    const events = await collect(translateCues(model.createResponse, cues(61), "instr", { contextWindow: WINDOW }));
    const last = events.at(-1) as Extract<StreamEvent, { type: "complete" }>;
    expect(last.type).toBe("complete");
    expect(last.content).not.toContain("LEAK");
    expect(last.content).toContain("[HE] Line 61");
  });

  it("repairs missing cues with the same context", async () => {
    const model = stubModel({ 1: JSON.stringify({ items: [{ index: 1, text_he: "HE1" }] }) });
    await collect(translateCues(model.createResponse, cues(3), "instr", { contextWindow: WINDOW }));
    expect(model.calls).toHaveLength(2);
    expect(payloadOf(model.calls[1]).items.map((i) => i.index)).toEqual([2, 3]);
    expect(payloadOf(model.calls[1]).context_before).toEqual([]);
  });

  it("keeps the retry budget and cancellation", async () => {
    const busy = new APIError(503, { message: "busy" }, "busy", new Headers());
    const model = stubModel({ 1: busy, 2: busy });
    const events = await collect(
      translateCues(model.createResponse, cues(2), "instr", { contextWindow: WINDOW, maxAttemptsPerChunk: 2, sleep: async () => {} })
    );
    expect(model.calls).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("error");

    const abort = new AbortController();
    const hanging = stubModel({ 1: hangingRequest });
    const gen = translateCues(hanging.createResponse, cues(2), "instr", { contextWindow: WINDOW, signal: abort.signal });
    const pending = collect(gen);
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    expect(await pending).toEqual([]);
  });
});
