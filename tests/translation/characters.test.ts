import { describe, expect, it } from "vitest";
import { APIError } from "openai";
import {
  MAX_ANALYSIS_CHARS,
  MAX_CHARACTERS,
  analysisCues,
  analyzeCharacters,
  buildCharactersRequest,
  notesError,
  parseCharacters,
  validateCharactersResponse,
} from "@/lib/translation/characters";
import { cue, cues } from "../helpers/cues";
import { hangingRequest, refusalResponse, stubModel } from "../helpers/stub-model";

const dana = { name: "Dana", hebrewName: "דנה", aliases: ["Danny"], gender: "female" };

describe("parseCharacters", () => {
  it("accepts a valid sheet, trims names and drops rows without a name", () => {
    const raw = JSON.stringify([{ ...dana, name: " Dana\n" }, { name: "", gender: "male" }, { name: "Tom", gender: "male" }]);
    expect(parseCharacters(raw)).toEqual({
      characters: [dana, { name: "Tom", hebrewName: "", aliases: [], gender: "male" }],
    });
    expect(parseCharacters("")).toEqual({ characters: [] });
  });

  it.each([
    ["not json", "Characters must be a JSON array."],
    ['{"name":"x"}', "Characters must be a JSON array."],
    ['[{"name":"Dana","gender":"woman"}]', 'Character "Dana": gender must be male, female or unknown.'],
    [JSON.stringify([{ name: "x".repeat(61), gender: "male" }]), `Character "${"x".repeat(60)}": names are limited to 60 characters.`],
    [JSON.stringify([{ name: "A", gender: "male", aliases: ["1", "2", "3", "4", "5", "6"] }]), 'Character "A": at most 5 aliases.'],
    [JSON.stringify(Array.from({ length: MAX_CHARACTERS + 1 }, (_, i) => ({ name: `C${i}`, gender: "male" }))), "At most 50 characters."],
  ])("rejects %s", (raw, error) => {
    expect(parseCharacters(raw)).toEqual({ error });
  });

  it("limits notes", () => {
    expect(notesError("x".repeat(4000))).toBeNull();
    expect(notesError("x".repeat(4001))).toBe("Notes have 4001 characters; the maximum is 4000.");
  });
});

describe("character analysis request and validation", () => {
  it("sends cue ids and text, and the notes", () => {
    const request = buildCharactersRequest([cue(1, "MARY: Hi"), cue(2, "Hello")], "A drama.");
    const text = (request.input as { content: { text: string }[] }[])[0].content[0].text;
    expect(text.startsWith("Notes about the story from the user:\nA drama.\n\n")).toBe(true);
    expect(JSON.parse(text.slice(text.lastIndexOf("\n\n") + 2))).toEqual([
      { n: 1, text: "MARY: Hi" },
      { n: 2, text: "Hello" },
    ]);
    expect(request.model).toBe("gpt-5.2");
  });

  it("limits the analysed text", () => {
    const long = [cue(1, "x".repeat(MAX_ANALYSIS_CHARS - 10)), cue(2, "y".repeat(20)), cue(3, "z")];
    expect(analysisCues(long).map((c) => c.id)).toEqual([1]);
  });

  it("drops unknown evidence numbers and invalid characters", () => {
    const answer = {
      characters: [
        { ...dana, confidence: "high", evidence: [1, 99, 1] },
        { name: "Bad", hebrewName: "", aliases: [], gender: "other", confidence: "low", evidence: [] },
      ],
    };
    expect(validateCharactersResponse({ output_text: JSON.stringify(answer), status: "completed" }, cues(3))).toEqual([
      { ...dana, confidence: "high", evidence: [1] },
    ]);
    expect(validateCharactersResponse({ output_text: "nope" }, cues(1))).toBeNull();
    expect(validateCharactersResponse(refusalResponse, cues(1))).toBeNull();
  });
});

describe("analyzeCharacters", () => {
  const good = JSON.stringify({ characters: [{ ...dana, confidence: "medium", evidence: [2] }] });

  it("returns the sheet with usage and counts", async () => {
    const model = stubModel({ 1: { output_text: good, usage: { input_tokens: 100, output_tokens: 20 } } });
    let t = 0;
    const result = await analyzeCharacters(model.createResponse, cues(3), "", {
      now: () => (t += 50),
      prices: { inputPerMTok: 1, outputPerMTok: 10 },
    });
    expect(result).toMatchObject({ characters: [{ name: "Dana", evidence: [2] }], analyzedCues: 3, totalCues: 3, requests: 1, elapsedMs: 50 });
    expect(result.usage.inputTokens).toBe(100);
    expect(result.estimatedCostUsd).toBe(0.0003);
  });

  it("asks again after an unusable answer or a temporary error, within the attempt limit", async () => {
    const busy = new APIError(503, { message: "busy" }, "busy", new Headers());
    const model = stubModel({ 1: "not json", 2: busy, 3: good });
    const result = await analyzeCharacters(model.createResponse, cues(3), "", { sleep: async () => {} });
    expect(result.requests).toBe(3);

    const failing = stubModel({ 1: "x", 2: "x", 3: "x", 4: good });
    await expect(analyzeCharacters(failing.createResponse, cues(3), "")).rejects.toThrow("Character analysis failed");
    expect(failing.calls).toHaveLength(3);
  });

  it("does not repeat permanent errors and stops when cancelled", async () => {
    const denied = new APIError(401, { message: "no" }, "no", new Headers());
    const model = stubModel({ 1: denied });
    await expect(analyzeCharacters(model.createResponse, cues(1), "")).rejects.toBe(denied);
    expect(model.calls).toHaveLength(1);

    const abort = new AbortController();
    const hanging = stubModel({ 1: hangingRequest });
    const pending = analyzeCharacters(hanging.createResponse, cues(1), "", { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toThrow();
    expect(hanging.calls).toHaveLength(1);
  });
});
