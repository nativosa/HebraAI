import { describe, expect, it } from "vitest";
import { buildSrt } from "@/lib/srt/build";
import { parseSrt } from "@/lib/srt/parse";
import { cue } from "../helpers/cues";
import { readExpected, readSrtFixture } from "../helpers/fixtures";

describe("buildSrt", () => {
  it("writes index, timing line and text, separated by one blank line", () => {
    const out = buildSrt([
      { id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "A" },
      { id: 2, number: 2, start: "00:00:03,000", end: "00:00:04,000", text: "B\nC" },
    ]);
    expect(out).toBe("1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\nC\n");
  });

  it("trims cue text and writes LF without BOM", () => {
    const out = buildSrt([{ id: 1, number: 7, start: "00:00:01,000", end: "00:00:02,000", text: "  padded \n" }]);
    expect(out).toBe("7\n00:00:01,000 --> 00:00:02,000\npadded\n");
  });

  it("keeps original numbers, including duplicates and gaps", () => {
    const out = buildSrt([cue(1, "A", { number: 4 }), cue(2, "B", { number: 4 }), cue(3, "C", { number: 9 })]);
    expect(out.split("\n\n").map((b) => b.split("\n")[0])).toEqual(["4", "4", "9"]);
  });

  it("renumbers 1..N when any cue has no number", () => {
    const out = buildSrt([cue(1, "A", { number: 4 }), cue(2, "B", { number: null }), cue(3, "C", { number: 9 })]);
    expect(out.split("\n\n").map((b) => b.split("\n")[0])).toEqual(["1", "2", "3"]);
  });

  it("returns an empty string for no cues", () => {
    expect(buildSrt([])).toBe("");
  });

  it("LEGACY D9: does not preserve the input BOM or CRLF", () => {
    const out = buildSrt(parseSrt(readSrtFixture("crlf-bom.srt")).cues);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out).not.toContain("\r");
  });

  // The expected outputs were produced by the app with the fake translator,
  // which prefixes each text with "[HE] ". Rebuilding them from the parsed
  // baseline must reproduce the files byte-for-byte.
  it.each([
    "basic.sfx-off.srt",
    "crlf-bom.sfx-off.srt",
    "duplicate-index.sfx-off.srt",
    "multi-chunk.sfx-off.srt",
    "multiline-italics.sfx-off.srt",
    "quirks.sfx-off.srt",
    "sfx-mixed.sfx-on.srt",
  ])("round-trips expected output %s", (name) => {
    const baseline = readExpected(name);
    expect(buildSrt(parseSrt(baseline).cues)).toBe(baseline);
  });
});
