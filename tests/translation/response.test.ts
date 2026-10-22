import { describe, expect, it } from "vitest";
import { applyChunkTranslation, parseChunkOutput, type ChunkTranslation } from "@/lib/translation/response";
import { cue } from "../helpers/cues";

describe("parseChunkOutput", () => {
  it("parses valid JSON", () => {
    expect(parseChunkOutput('{"items":[{"index":1,"text_he":"שלום"}]}')).toEqual({
      ok: true,
      json: { items: [{ index: 1, text_he: "שלום" }] },
    });
  });

  it.each(["", "not json", '{"items":[', "```json\n{}\n```"])("rejects invalid JSON %j", (out) => {
    expect(parseChunkOutput(out)).toEqual({ ok: false });
  });

  // Legacy: only JSON syntax is checked; the shape is not validated here.
  it("accepts valid JSON of any shape", () => {
    expect(parseChunkOutput("null")).toEqual({ ok: true, json: null });
    expect(parseChunkOutput("{}")).toEqual({ ok: true, json: {} });
  });
});

describe("applyChunkTranslation", () => {
  it("replaces each cue's text by index, keeping timing and cue order", () => {
    const cues = [cue(1, "Hello"), cue(2, "Bye")];
    const out = applyChunkTranslation(cues, {
      items: [
        { index: 2, text_he: "ביי" },
        { index: 1, text_he: "שלום" },
      ],
    });
    expect(out).toEqual([cue(1, "שלום"), cue(2, "ביי")]);
  });

  it("trims translated text", () => {
    expect(applyChunkTranslation([cue(1, "Hi")], { items: [{ index: 1, text_he: "  היי \n" }] })).toEqual([cue(1, "היי")]);
  });

  it("LEGACY D12: a cue without a translation silently keeps its English text", () => {
    expect(applyChunkTranslation([cue(1, "Hi"), cue(2, " Bye ")], { items: [{ index: 1, text_he: "היי" }] })).toEqual([
      cue(1, "היי"),
      cue(2, "Bye"),
    ]);
  });

  it("keeps an empty translation instead of falling back", () => {
    expect(applyChunkTranslation([cue(1, "Hi")], { items: [{ index: 1, text_he: "" }] })).toEqual([cue(1, "")]);
  });

  it("ignores items for unknown indices and uses the last duplicate item", () => {
    const json = {
      items: [
        { index: 1, text_he: "first" },
        { index: 9, text_he: "unknown" },
        { index: 1, text_he: "last" },
      ],
    };
    expect(applyChunkTranslation([cue(1, "Hi")], json)).toEqual([cue(1, "last")]);
  });

  it("does not match a string index to a numeric cue index", () => {
    const json = { items: [{ index: "1", text_he: "היי" }] } as unknown as ChunkTranslation;
    expect(applyChunkTranslation([cue(1, "Hi")], json)).toEqual([cue(1, "Hi")]);
  });

  it("D1 (fixed): cues sharing an SRT number are matched by id", () => {
    const json = {
      items: [
        { index: 2, text_he: "A" },
        { index: 3, text_he: "B" },
      ],
    };
    const input = [cue(2, "a", { number: 2 }), cue(3, "b", { number: 2 })];
    expect(applyChunkTranslation(input, json)).toEqual([cue(2, "A", { number: 2 }), cue(3, "B", { number: 2 })]);
  });

  // Malformed shapes are not validated (Stage 2 adds application errors);
  // they fail with a TypeError that the route reports as an error event.
  it.each([
    ["null", null],
    ["no items", {}],
    ["items not an array", { items: {} }],
    ["null item", { items: [null] }],
  ])("throws a TypeError for %s", (_label, json) => {
    expect(() => applyChunkTranslation([cue(1, "Hi")], json as unknown as ChunkTranslation)).toThrow(TypeError);
  });

  it("does not modify the input cues", () => {
    const cues = [cue(1, "Hi")];
    applyChunkTranslation(cues, { items: [{ index: 1, text_he: "היי" }] });
    expect(cues).toEqual([cue(1, "Hi")]);
  });
});
