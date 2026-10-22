import { describe, expect, it } from "vitest";
import { parseTranslateOptions } from "@/lib/translation/options";

function form(fields: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("parseTranslateOptions", () => {
  it("reads the UI defaults", () => {
    expect(
      parseTranslateOptions(form({ tone: "Neutral", preserveBreaks: "true", maxChars: "42", removeSoundEffects: "true" }))
    ).toEqual({ tone: "Neutral", removeSoundEffects: true, preserveBreaks: true, maxChars: 42 });
  });

  it.each([
    ["Formal", "Formal"],
    ["Informal", "Informal"],
    ["Neutral", "Neutral"],
    ["formal", "Neutral"],
    ["Sarcastic", "Neutral"],
    ["", "Neutral"],
  ])("tone %j -> %s", (input, expected) => {
    expect(parseTranslateOptions(form({ tone: input })).tone).toBe(expected);
  });

  it("falls back to Neutral when tone is missing or a file", () => {
    expect(parseTranslateOptions(form({})).tone).toBe("Neutral");
    expect(parseTranslateOptions(form({ tone: new Blob(["Formal"]) })).tone).toBe("Neutral");
  });

  it.each(["true"])("flag %j is true", (value) => {
    const o = parseTranslateOptions(form({ removeSoundEffects: value, preserveBreaks: value }));
    expect([o.removeSoundEffects, o.preserveBreaks]).toEqual([true, true]);
  });

  it.each(["false", "TRUE", "1", "on", ""])("flag %j is false", (value) => {
    const o = parseTranslateOptions(form({ removeSoundEffects: value, preserveBreaks: value }));
    expect([o.removeSoundEffects, o.preserveBreaks]).toEqual([false, false]);
  });

  it("treats missing flags as false", () => {
    const o = parseTranslateOptions(form({}));
    expect([o.removeSoundEffects, o.preserveBreaks]).toEqual([false, false]);
  });

  it.each([
    ["42", 42],
    ["20", 20],
    ["80", 80],
    ["10", 20],
    ["-5", 20],
    ["100", 80],
    ["42.5", 42.5],
    ["abc", 42],
    ["Infinity", 42],
    ["", 20],
  ])("maxChars %j -> %d", (input, expected) => {
    expect(parseTranslateOptions(form({ maxChars: input })).maxChars).toBe(expected);
  });

  // Number(null) is 0, which is finite, so a missing field clamps to the minimum.
  it("maxChars missing -> 20 (legacy behaviour, not the UI default 42)", () => {
    expect(parseTranslateOptions(form({})).maxChars).toBe(20);
  });
});
