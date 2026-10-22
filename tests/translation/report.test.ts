import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { describeParseReport } from "@/lib/translation/report";
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
