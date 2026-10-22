import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { describeGlossary, describeParseReport, describePartial, describeUsage, estimateCostUsd } from "@/lib/translation/report";
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
  const base = {
    requests: 1,
    repairs: 0,
    retries: 0,
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    elapsedMs: 0,
    removedSoundEffectCues: 0,
    glossary: { entries: 0, ignoredLines: [] },
    parse: { recovered: [], unparsed: [] },
  };
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

describe("describeGlossary", () => {
  it("is silent without a glossary", () => {
    expect(describeGlossary({ entries: 0, ignoredLines: [] })).toEqual([]);
  });

  it("states the terms sent and the ignored lines", () => {
    expect(describeGlossary({ entries: 2, ignoredLines: [3] })).toEqual([
      "Glossary: 2 term(s) sent with the instructions.",
      'Glossary line 3 ignored: expected "term = translation".',
    ]);
  });
});

describe("estimateCostUsd", () => {
  it("prices cached input separately and falls back to the input price", () => {
    const u = { inputTokens: 2_000_000, cachedInputTokens: 1_000_000, outputTokens: 500_000, reasoningTokens: 100_000 };
    expect(estimateCostUsd(u, { inputPerMTok: 1, cachedInputPerMTok: 0.1, outputPerMTok: 4 })).toBe(3.1);
    expect(estimateCostUsd(u, { inputPerMTok: 1, outputPerMTok: 4 })).toBe(4);
  });
});

describe("describeUsage", () => {
  const base = {
    cues: 1,
    translated: 1,
    untranslated: [],
    repairs: 0,
    retries: 0,
    removedSoundEffectCues: 0,
    glossary: { entries: 0, ignoredLines: [] },
    parse: { recovered: [], unparsed: [] },
    usage: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 678, reasoningTokens: 0 },
    elapsedMs: 12345,
  };

  it("shows requests, tokens and time", () => {
    expect(describeUsage({ ...base, requests: 3 })).toBe("3 requests · 12,345 input / 678 output tokens · 12.3 s");
  });

  it("adds the cost estimate when present", () => {
    expect(describeUsage({ ...base, requests: 1, estimatedCostUsd: 0.00421 })).toBe(
      "1 request · 12,345 input / 678 output tokens · 12.3 s · ~$0.0042 (estimate)"
    );
  });
});
