import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { describeParseReport, describePartial } from "@/lib/translation/report";
import { readSrtFixture } from "../helpers/fixtures";

describe("describeParseReport", () => {
  it("is empty for a clean file", () => {
    expect(describeParseReport({ recovered: [], unparsed: [] })).toEqual([]);
  });

  it("lists unparsed content first, then recovered irregularities, with line numbers", () => {
    const { recovered, unparsed } = parseSrt(readSrtFixture("quirks.srt"));
    expect(describeParseReport({ recovered, unparsed })).toEqual([
      "Not translated — could not be parsed (text not attached to a timestamp): line 20.",
      "Recovered 1 cue(s) without a number line (line 9).",
      "Recovered 1 timestamp(s) with '.' before milliseconds, normalised to ',' (line 6).",
      "Recovered 1 timestamp(s) with a one-digit hour, normalised (line 13).",
      "Recovered 1 empty cue(s) removed (line 23).",
    ]);
  });

  it("abbreviates long line lists", () => {
    const recovered = [1, 5, 9, 13, 17, 21, 25].map((line) => ({ line, kind: "missing-number" as const }));
    expect(describeParseReport({ recovered, unparsed: [] })).toEqual([
      "Recovered 7 cue(s) without a number line (lines 1, 5, 9, 13, 17, …).",
    ]);
  });
});

describe("describePartial", () => {
  const base = { removedSoundEffectCues: 0, parse: { recovered: [], unparsed: [] } };
  const u = (id: number, number: number | null, reason: "missing" | "refusal") => ({
    id,
    number,
    start: "00:00:01,000",
    end: "00:00:02,000",
    reason,
  });

  it("states counts and lists number, timing and reason per untranslated cue", () => {
    const report = { ...base, cues: 3, translated: 1, untranslated: [u(2, 2, "missing"), u(3, null, "refusal")] };
    expect(describePartial(report)).toEqual({
      headline: "Translated 1 of 3 cues. 2 cues were not translated and kept in English.",
      rows: [
        "#2 · 00:00:01,000 → 00:00:02,000 · missing from the model's answer",
        "#(cue 3) · 00:00:01,000 → 00:00:02,000 · the model refused",
      ],
      more: 0,
    });
  });

  it("mentions the error that stopped the job and limits the rows", () => {
    const untranslated = Array.from({ length: 25 }, (_, i) => u(i + 1, i + 1, "missing"));
    const s = describePartial({ ...base, cues: 30, translated: 5, untranslated, failure: "429 Rate limit" }, 20);
    expect(s.headline).toBe(
      "Translated 5 of 30 cues. 25 cues were not translated and kept in English. Stopped by an error: 429 Rate limit"
    );
    expect(s.rows).toHaveLength(20);
    expect(s.more).toBe(5);
  });
});
