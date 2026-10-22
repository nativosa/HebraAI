import { describe, expect, it } from "vitest";
import { REPAIRABLE, validateChunkResponse, type ModelResponse } from "@/lib/translation/response";
import { cue } from "../helpers/cues";
import { incompleteResponse, refusalResponse } from "../helpers/stub-model";

const two = [cue(1, "Hello"), cue(2, "Bye")];
const out = (output_text: string): ModelResponse => ({ output_text, status: "completed" });
const items = (...it: (object | null)[]) => out(JSON.stringify({ items: it }));

function check(cues: ReturnType<typeof cue>[], response: ModelResponse) {
  const r = validateChunkResponse(cues, response);
  return { translations: Object.fromEntries(r.translations), failed: Object.fromEntries(r.failed), unexpected: r.unexpectedItems };
}

describe("validateChunkResponse: complete answers", () => {
  it("maps translations by id, in any item order, trimmed", () => {
    expect(check(two, items({ index: 2, text_he: " ביי " }, { index: 1, text_he: "שלום\n" }))).toEqual({
      translations: { 1: "שלום", 2: "ביי" },
      failed: {},
      unexpected: 0,
    });
  });

  it("accepts names, Latin text and text identical to the source", () => {
    const cues = [cue(1, "OK"), cue(2, "FBI"), cue(3, "Netflix and chill")];
    const r = check(cues, items({ index: 1, text_he: "OK" }, { index: 2, text_he: "FBI" }, { index: 3, text_he: "Netflix וצ׳יל" }));
    expect(r.failed).toEqual({});
    expect(Object.keys(r.translations)).toHaveLength(3);
  });

  it("accepts an exact duplicate item", () => {
    expect(check([cue(1, "Hi")], items({ index: 1, text_he: "היי" }, { index: 1, text_he: "היי " })).failed).toEqual({});
  });

  it("accepts a response without status (treated as completed)", () => {
    expect(check([cue(1, "Hi")], { output_text: JSON.stringify({ items: [{ index: 1, text_he: "היי" }] }) }).failed).toEqual({});
  });

  it("D1 (fixed): cues sharing an SRT number are matched by id", () => {
    const cues = [cue(2, "a", { number: 2 }), cue(3, "b", { number: 2 })];
    expect(check(cues, items({ index: 2, text_he: "A" }, { index: 3, text_he: "B" })).translations).toEqual({ 2: "A", 3: "B" });
  });
});

describe("validateChunkResponse: per-cue problems", () => {
  it("D12 (fixed): a missing item is reported, not filled with English", () => {
    expect(check(two, items({ index: 1, text_he: "שלום" }))).toEqual({
      translations: { 1: "שלום" },
      failed: { 2: "missing" },
      unexpected: 0,
    });
  });

  it("conflicting duplicate items fail that cue", () => {
    expect(check(two, items({ index: 1, text_he: "A" }, { index: 1, text_he: "B" }, { index: 2, text_he: "C" })).failed).toEqual({
      1: "duplicate",
    });
  });

  it("an empty translation of non-empty text fails that cue", () => {
    expect(check(two, items({ index: 1, text_he: "  " }, { index: 2, text_he: "C" })).failed).toEqual({ 1: "empty" });
  });

  it("ignores and counts items for unknown ids or with a wrong type", () => {
    const r = check(
      two,
      items(
        { index: 1, text_he: "A" },
        { index: 2, text_he: "B" },
        { index: 9, text_he: "x" },
        { index: "1", text_he: "x" },
        { index: 1.5, text_he: "x" },
        { index: 1, text_he: 5 },
        null
      )
    );
    expect(r).toEqual({ translations: { 1: "A", 2: "B" }, failed: {}, unexpected: 5 });
  });
});

describe("validateChunkResponse: whole-chunk problems", () => {
  it.each([
    ["invalid JSON", out("Sorry, I can't do that."), "invalid-json"],
    ["truncated JSON", out('{"items":[{"index":1'), "invalid-json"],
    ["null", out("null"), "invalid-shape"],
    ["no items", out("{}"), "invalid-shape"],
    ["items not an array", out('{"items":{}}'), "invalid-shape"],
    ["incomplete (max_output_tokens)", incompleteResponse("max_output_tokens"), "incomplete"],
    ["failed status", { output_text: "", status: "failed" }, "incomplete"],
    ["content filter", incompleteResponse("content_filter"), "content-filter"],
    ["refusal", refusalResponse, "refusal"],
  ] as const)("%s -> every cue %s", (_label, response, reason) => {
    expect(check(two, response as ModelResponse)).toEqual({
      translations: {},
      failed: { 1: reason, 2: reason },
      unexpected: 0,
    });
  });

  it("a refusal wins even when the text looks valid", () => {
    const r = { ...refusalResponse, output_text: JSON.stringify({ items: [{ index: 1, text_he: "x" }] }) };
    expect(check([cue(1, "Hi")], r).failed).toEqual({ 1: "refusal" });
  });
});

describe("REPAIRABLE", () => {
  it("covers technical and structural failures only", () => {
    expect([...REPAIRABLE].sort()).toEqual(["duplicate", "empty", "incomplete", "invalid-json", "invalid-shape", "missing"]);
    for (const r of ["refusal", "content-filter", "request-failed"] as const) expect(REPAIRABLE.has(r)).toBe(false);
  });
});
