import { describe, expect, it } from "vitest";
import { glossaryLimitError, parseGlossary, parseTranslateOptions } from "@/lib/translation/options";

function form(fields: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("parseTranslateOptions", () => {
  it("reads the UI defaults", () => {
    expect(
      parseTranslateOptions(form({ tone: "Neutral", preserveBreaks: "true", maxChars: "42", removeSoundEffects: "true" }))
    ).toEqual({
      mode: "classic",
      tone: "Neutral",
      removeSoundEffects: true,
      preserveBreaks: true,
      maxChars: 42,
      glossary: { entries: [], ignoredLines: [] },
      characters: [],
      notes: "",
    });
  });

  it("reads the mode, characters and notes", () => {
    expect(parseTranslateOptions(form({ mode: "context" })).mode).toBe("context");
    expect(parseTranslateOptions(form({ mode: "Context" })).mode).toBe("classic");
    expect(parseTranslateOptions(form({ mode: new Blob(["context"]) })).mode).toBe("classic");
    const o = parseTranslateOptions(
      form({ characters: JSON.stringify([{ name: " Dana ", hebrewName: "דנה", aliases: [], gender: "female" }]), notes: " a heist film " })
    );
    expect(o.characters).toEqual([{ name: "Dana", hebrewName: "דנה", aliases: [], gender: "female" }]);
    expect(o.notes).toBe("a heist film");
    expect(parseTranslateOptions(form({ characters: "not json" })).characters).toEqual([]);
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

describe("parseGlossary", () => {
  it("reads one 'term = translation' per line, trimmed", () => {
    expect(parseGlossary("John = ג׳ון\r\n  FBI=FBI  \n")).toEqual({
      entries: [
        { term: "John", translation: "ג׳ון" },
        { term: "FBI", translation: "FBI" },
      ],
      ignoredLines: [],
    });
  });

  it("splits at the first '=' only", () => {
    expect(parseGlossary("E = mc2 = energy").entries).toEqual([{ term: "E", translation: "mc2 = energy" }]);
  });

  it("skips blank lines and reports lines without a term or translation", () => {
    expect(parseGlossary("\nJohn\n= x\ny =\n\nok = כן")).toEqual({
      entries: [{ term: "ok", translation: "כן" }],
      ignoredLines: [2, 3, 4],
    });
  });

  it("keeps the last translation of a repeated term (case-insensitive)", () => {
    expect(parseGlossary("John = א\nFBI = FBI\njohn = ב").entries).toEqual([
      { term: "FBI", translation: "FBI" },
      { term: "john", translation: "ב" },
    ]);
  });

  it("is empty for an empty or missing field", () => {
    expect(parseGlossary("")).toEqual({ entries: [], ignoredLines: [] });
    expect(parseTranslateOptions(form({})).glossary).toEqual({ entries: [], ignoredLines: [] });
  });
});

describe("glossaryLimitError", () => {
  it("accepts up to 100 entries and 4,000 characters", () => {
    const text = Array.from({ length: 100 }, (_, i) => `t${i} = x`).join("\n");
    expect(glossaryLimitError(text, parseGlossary(text))).toBeNull();
    expect(glossaryLimitError("a = " + "x".repeat(3996), parseGlossary("a = x"))).toBeNull();
  });

  it("rejects more entries or characters", () => {
    const many = Array.from({ length: 101 }, (_, i) => `t${i} = x`).join("\n");
    expect(glossaryLimitError(many, parseGlossary(many))).toBe("Glossary has 101 entries; the maximum is 100.");
    expect(glossaryLimitError("x".repeat(4001), parseGlossary(""))).toBe("Glossary has 4001 characters; the maximum is 4000.");
  });
});
