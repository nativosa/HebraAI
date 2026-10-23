import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildRows, effectiveText, filterRows, rowCounts, type ReviewResult } from "@/lib/review/rows";
import { cue } from "../helpers/cues";
import { readSrtFixture } from "../helpers/fixtures";
import { itemsFor, stubModel } from "../helpers/stub-model";

const source = [cue(1, "Hello"), cue(2, "[music]"), cue(3, "Come here"), cue(4, "Bye")];
const result: ReviewResult = {
  cues: [cue(1, "שלום"), cue(3, "Come here"), cue(4, "ביי")],
  untranslated: [{ id: 3, number: 3, start: "00:00:01,000", end: "00:00:02,000", reason: "missing" }],
};

describe("buildRows", () => {
  it("is pending before a result", () => {
    expect(buildRows(source).map((r) => [r.status, r.output])).toEqual([
      ["pending", null],
      ["pending", null],
      ["pending", null],
      ["pending", null],
    ]);
  });

  it("joins the result by id: translated, untranslated with its reason, removed", () => {
    expect(buildRows(source, result)).toEqual([
      { id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", en: "Hello", output: "שלום", status: "translated" },
      { id: 2, number: 2, start: "00:00:01,000", end: "00:00:02,000", en: "[music]", output: null, status: "removed" },
      {
        id: 3,
        number: 3,
        start: "00:00:01,000",
        end: "00:00:02,000",
        en: "Come here",
        output: "Come here",
        status: "untranslated",
        reason: "missing",
      },
      { id: 4, number: 4, start: "00:00:01,000", end: "00:00:02,000", en: "Bye", output: "ביי", status: "translated" },
    ]);
  });

  it("keeps cues sharing or lacking a number apart (real pipeline result)", async () => {
    for (const name of ["duplicate-index.srt", "quirks.srt", "sfx-mixed.srt"]) {
      const parsed = parseSrt(readSrtFixture(name)).cues;
      const events: StreamEvent[] = [];
      for await (const e of translateCues(stubModel().createResponse, removeSoundEffectCues(parsed), "instr")) events.push(e);
      const last = events.at(-1)!;
      if (last.type !== "complete") throw new Error(last.type);
      const rows = buildRows(parsed, { cues: last.cues, untranslated: last.report.untranslated });
      expect(rows.map((r) => r.id)).toEqual(parsed.map((c) => c.id));
      for (const r of rows.filter((r) => r.status === "translated")) {
        expect(r.output).toBe(last.cues.find((c) => c.id === r.id)!.text);
      }
      expect(rows.filter((r) => r.status === "removed").length).toBe(parsed.length - last.cues.length);
    }
  });

  it("a partial result marks the failed cues", async () => {
    const parsed = parseSrt(readSrtFixture("basic.srt")).cues;
    const model = stubModel({ 1: itemsFor(1, 3, 4), 2: itemsFor() });
    const events: StreamEvent[] = [];
    for await (const e of translateCues(model.createResponse, parsed, "instr")) events.push(e);
    const last = events.at(-1)!;
    if (last.type !== "partial") throw new Error(last.type);
    const rows = buildRows(parsed, { cues: last.cues, untranslated: last.report.untranslated });
    expect(rows.map((r) => r.status)).toEqual(["translated", "untranslated", "translated", "translated"]);
    expect(rows[1].output).toBe(parsed[1].text);
  });
});

describe("filterRows and rowCounts", () => {
  const rows = buildRows(source, result);
  const edits = new Map([[4, "להתראות"]]);
  const ids = (f: Parameters<typeof filterRows>[1], q = "") => filterRows(rows, f, q, edits).map((r) => r.id);

  it("filters by status and edits; removed rows only under 'removed'", () => {
    expect(ids("all")).toEqual([1, 3, 4]);
    expect(ids("untranslated")).toEqual([3]);
    expect(ids("edited")).toEqual([4]);
    expect(ids("removed")).toEqual([2]);
    expect(rowCounts(rows, edits)).toEqual({ all: 3, untranslated: 1, edited: 1, removed: 1 });
  });

  it("searches English and the current Hebrew, case-insensitively", () => {
    expect(ids("all", "  HELLO ")).toEqual([1]);
    expect(ids("all", "שלום")).toEqual([1]);
    expect(ids("all", "להתראות")).toEqual([4]); // the edit, not the model text
    expect(ids("all", "ביי")).toEqual([]);
    expect(ids("untranslated", "hello")).toEqual([]);
    expect(ids("removed", "music")).toEqual([2]);
  });

  it("never changes the rows", () => {
    const before = JSON.stringify(rows);
    ids("edited", "x");
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("effectiveText prefers the edit", () => {
    expect(effectiveText(rows[3], edits)).toBe("להתראות");
    expect(effectiveText(rows[0], edits)).toBe("שלום");
    expect(effectiveText(rows[1], edits)).toBeNull();
  });
});
