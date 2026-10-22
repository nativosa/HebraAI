import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { parseSrt } from "@/lib/srt/parse";
import { readSrtFixture } from "../helpers/fixtures";

const TS = "00:00:01,000 --> 00:00:02,000";

describe("parseSrt: valid input", () => {
  it("parses id, number, timestamps and text", () => {
    expect(parseSrt(`1\n00:00:01,000 --> 00:00:02,500\nHello.\n`)).toEqual({
      cues: [{ id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,500", text: "Hello." }],
      recovered: [],
      unparsed: [],
    });
  });

  it("assigns ids in input order, independent of the numbers", () => {
    const { cues } = parseSrt(`7\n${TS}\nA\n\n3\n${TS}\nB\n`);
    expect(cues.map((c) => [c.id, c.number])).toEqual([
      [1, 7],
      [2, 3],
    ]);
  });

  it("keeps multi-line text joined with \\n", () => {
    const { cues } = parseSrt(readSrtFixture("multiline-italics.srt"));
    expect(cues.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(cues[0].text).toBe("I never thought I'd see\nyou here again.");
    expect(cues[1].text).toBe("<i>Neither did I.</i>");
    expect(cues[2].text).toBe("- Are you ready?\n- Almost.");
  });

  it("handles CRLF line endings and a UTF-8 BOM without reporting them", () => {
    const raw = readSrtFixture("crlf-bom.srt");
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    const normalized = raw.slice(1).replace(/\r\n/g, "\n");
    expect(parseSrt(raw)).toEqual(parseSrt(normalized));
    expect(parseSrt(raw).recovered).toEqual([]);
    expect(parseSrt(raw).cues.some((c) => c.text.includes("\r"))).toBe(false);
  });

  it("accepts text after the end timestamp (positions) and surrounding whitespace", () => {
    expect(parseSrt("  3  \n 00:00:01,000-->00:00:02,000 X1:10 \nHi\n").cues).toEqual([
      { id: 1, number: 3, start: "00:00:01,000", end: "00:00:02,000", text: "Hi" },
    ]);
  });

  it("splits cues on any run of blank lines", () => {
    const { cues } = parseSrt(`1\n${TS}\nA\n\n\n\n2\n${TS}\nB`);
    expect(cues.map((c) => c.text)).toEqual(["A", "B"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseSrt("")).toEqual({ cues: [], recovered: [], unparsed: [] });
    expect(parseSrt("\n\n  \n")).toEqual({ cues: [], recovered: [], unparsed: [] });
  });
});

describe("parseSrt: recovered irregularities", () => {
  it("normalises '.' separators, one-digit hours and short milliseconds", () => {
    expect(parseSrt("1\n0:00:07.5 --> 0:00:08,25\nHi\n")).toEqual({
      cues: [{ id: 1, number: 1, start: "00:00:07,500", end: "00:00:08,250", text: "Hi" }],
      recovered: [
        { line: 2, kind: "dot-separator" },
        { line: 2, kind: "short-hour" },
        { line: 2, kind: "short-millis" },
      ],
      unparsed: [],
    });
  });

  it("keeps a cue without a number line (number null)", () => {
    expect(parseSrt(`${TS}\nNo number.\n`)).toEqual({
      cues: [{ id: 1, number: null, start: "00:00:01,000", end: "00:00:02,000", text: "No number." }],
      recovered: [{ line: 1, kind: "missing-number" }],
      unparsed: [],
    });
  });

  it("reports repeated numbers and keeps the cues separate", () => {
    const r = parseSrt(readSrtFixture("duplicate-index.srt"));
    expect(r.cues.map((c) => [c.id, c.number])).toEqual([
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
    ]);
    expect(r.recovered).toEqual([{ line: 9, kind: "duplicate-number" }]);
  });

  it("splits cues that are not separated by a blank line", () => {
    const r = parseSrt(`1\n${TS}\nA\n2\n${TS}\nB\n`);
    expect(r.cues.map((c) => [c.number, c.text])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
    expect(r.recovered).toEqual([{ line: 4, kind: "missing-blank-line" }]);
  });

  it("removes an empty cue and reports it", () => {
    const r = parseSrt(`1\n${TS}\n\n2\n${TS}\nB\n`);
    expect(r.cues.map((c) => c.number)).toEqual([2]);
    expect(r.recovered).toEqual([{ line: 2, kind: "empty-cue" }]);
  });
});

describe("parseSrt: unparsed content", () => {
  it("reports text before the first cue", () => {
    const r = parseSrt(`WEBVTT\n\n1\n${TS}\nHi\n`);
    expect(r.cues).toHaveLength(1);
    expect(r.unparsed).toEqual([{ line: 1, lines: 1, kind: "orphan-text" }]);
  });

  it("reports stray lines above a cue's number in the same block", () => {
    const r = parseSrt(`Hello\nthere\n1\n${TS}\nA\n`);
    expect(r.cues.map((c) => c.text)).toEqual(["A"]);
    expect(r.unparsed).toEqual([{ line: 1, lines: 2, kind: "orphan-text" }]);
  });

  it("reports an invalid timing line with its block instead of guessing", () => {
    const r = parseSrt(`1\n00:00:01 --> 00:00:02\nHi\n\n2\n${TS}\nB\n`);
    expect(r.cues.map((c) => c.text)).toEqual(["B"]);
    expect(r.unparsed).toEqual([{ line: 1, lines: 3, kind: "invalid-timestamp" }]);
  });

  it("rejects timestamps with more than 3 millisecond digits", () => {
    expect(parseSrt(`1\n00:00:01,0000 --> 00:00:02,000\nHi\n`).unparsed).toEqual([
      { line: 1, lines: 3, kind: "invalid-timestamp" },
    ]);
  });
});

// Known defects D1-D6 (fixtures/KNOWN_DEFECTS.md), now fixed or reported.
describe("parseSrt: quirks.srt", () => {
  const r = parseSrt(readSrtFixture("quirks.srt"));

  it("keeps every cue with text, in order", () => {
    expect(r.cues.map((c) => [c.id, c.number, c.start, c.end, c.text])).toEqual([
      [1, 1, "00:00:01,000", "00:00:02,000", "Normal cue."],
      [2, 2, "00:00:03,000", "00:00:04,000", "Dot-separated timestamps."],
      [3, null, "00:00:05,000", "00:00:06,000", "Cue without a number line."],
      [4, 4, "00:00:07,000", "00:00:08,000", "Single-digit hour."],
      [5, 5, "00:00:09,000", "00:00:10,000", "Text before a blank line"],
      [6, 7, "00:00:13,000", "00:00:14,000", "Last normal cue."],
    ]);
  });

  it("D2 (fixed): accepts '.' separators", () => {
    expect(r.recovered).toContainEqual({ line: 6, kind: "dot-separator" });
  });

  it("D3 (fixed): keeps a cue without a number line", () => {
    expect(r.recovered).toContainEqual({ line: 9, kind: "missing-number" });
  });

  it("D4 (fixed): accepts a one-digit hour", () => {
    expect(r.recovered).toContainEqual({ line: 13, kind: "short-hour" });
  });

  it("D5 (fixed): reports text after a blank line inside a cue instead of dropping it silently", () => {
    expect(r.unparsed).toEqual([{ line: 20, lines: 1, kind: "orphan-text" }]);
  });

  it("D6 (fixed): reports the empty cue it removes", () => {
    expect(r.recovered).toContainEqual({ line: 23, kind: "empty-cue" });
  });

  it("reports nothing else", () => {
    expect(r.recovered).toHaveLength(4);
  });
});

// Every non-blank input line that is not a number or timing line must end up
// in a cue's text or inside a reported unparsed block — nothing is lost silently.
describe("parseSrt: no silent content loss", () => {
  const fixtures = readdirSync("fixtures/srt").filter((f) => f.endsWith(".srt"));

  it.each(fixtures)("%s", (name) => {
    const raw = readSrtFixture(name);
    const { cues, unparsed } = parseSrt(raw);
    const inUnparsed = (n: number) => unparsed.some((u) => n >= u.line && n < u.line + u.lines);
    raw
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .forEach((text, i) => {
        const t = text.trim();
        if (!t || /^\d+$/.test(t) || t.includes("-->")) return;
        expect(cues.some((c) => c.text.includes(t)) || inUnparsed(i + 1), `line ${i + 1}`).toBe(true);
      });
  });
});
