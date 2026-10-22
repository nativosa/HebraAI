import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { readSrtFixture } from "../helpers/fixtures";

describe("parseSrt", () => {
  it("parses index, timestamps and text", () => {
    expect(parseSrt("1\n00:00:01,000 --> 00:00:02,500\nHello.\n")).toEqual([
      { index: 1, start: "00:00:01,000", end: "00:00:02,500", text: "Hello." },
    ]);
  });

  it("keeps multi-line text joined with \\n and trims it", () => {
    const cues = parseSrt(readSrtFixture("multiline-italics.srt"));
    expect(cues.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    expect(cues[0].text).toBe("I never thought I'd see\nyou here again.");
    expect(cues[1].text).toBe("<i>Neither did I.</i>");
    expect(cues[2].text).toBe("- Are you ready?\n- Almost.");
  });

  it("handles CRLF line endings and a UTF-8 BOM", () => {
    const raw = readSrtFixture("crlf-bom.srt");
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    expect(raw).toContain("\r\n");
    const normalized = raw.slice(1).replace(/\r\n/g, "\n");
    expect(parseSrt(raw)).toEqual(parseSrt(normalized));
    expect(parseSrt(raw)[0].index).toBe(1);
    expect(parseSrt(raw).some((c) => c.text.includes("\r"))).toBe(false);
  });

  it("ignores anything after the end timestamp and surrounding whitespace", () => {
    expect(parseSrt("  3  \n 00:00:01,000-->00:00:02,000 X1:10 \nHi\n")).toEqual([
      { index: 3, start: "00:00:01,000", end: "00:00:02,000", text: "Hi" },
    ]);
  });

  it("splits cues on any run of blank lines", () => {
    const cues = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nA\n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nB");
    expect(cues.map((c) => c.text)).toEqual(["A", "B"]);
  });

  it("keeps duplicate indices as separate cues", () => {
    expect(parseSrt(readSrtFixture("duplicate-index.srt")).map((c) => c.index)).toEqual([1, 2, 2, 3]);
  });

  it("returns no cues for empty or non-SRT input", () => {
    expect(parseSrt("")).toEqual([]);
    expect(parseSrt("just some text\nwithout timestamps\nat all")).toEqual([]);
  });

  // Known defects, pinned as current behaviour (fixtures/KNOWN_DEFECTS.md).
  // Stage 2 inverts these expectations; they must not be "fixed" in Stage 1.
  describe("legacy behaviour (quirks.srt)", () => {
    const cues = parseSrt(readSrtFixture("quirks.srt"));

    it("keeps only cues 1, 5 and 7", () => {
      expect(cues.map((c) => c.index)).toEqual([1, 5, 7]);
    });

    it("LEGACY D2: drops a cue with '.' millisecond separators", () => {
      expect(cues.some((c) => c.start === "00:00:03.000" || c.index === 2)).toBe(false);
    });

    it("LEGACY D3: drops a cue without a number line", () => {
      expect(cues.some((c) => c.start === "00:00:05,000")).toBe(false);
    });

    it("LEGACY D4: drops a cue with a single-digit hour", () => {
      expect(cues.some((c) => c.index === 4)).toBe(false);
    });

    it("LEGACY D5: loses text after a blank line inside a cue", () => {
      expect(cues.find((c) => c.index === 5)?.text).toBe("Text before a blank line");
    });

    it("LEGACY D6: silently drops a cue with empty text", () => {
      expect(cues.some((c) => c.index === 6)).toBe(false);
    });
  });
});
