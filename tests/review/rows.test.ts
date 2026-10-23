import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildRows, effectiveText, filterRows, rowCounts, soundEffectIds, type ReviewResult } from "@/lib/review/rows";
import { cue } from "../helpers/cues";
import { readSrtFixture } from "../helpers/fixtures";
import { itemsFor, stubModel } from "../helpers/stub-model";

const source = [cue(1, "Hello"), cue(2, "[music]"), cue(3, "Come here"), cue(4, "Bye")];
const result: ReviewResult = {
  cues: [cue(1, "שלום"), cue(3, "Come here"), cue(4, "ביי")],
  untranslated: [{ id: 3, number: 3, start: "00:00:01,000", end: "00:00:02,000", reason: "missing" }],
  soundEffectIds: new Set([2]),
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

  it("a cue missing from the result is 'removed' only if the sound-effect filter excluded it", () => {
    const rows = buildRows(source, { ...result, soundEffectIds: new Set() });
    expect(rows[1]).toMatchObject({ id: 2, status: "missing", output: null });
    expect(filterRows(rows, "untranslated", "", new Map()).map((r) => r.id)).toEqual([2, 3]);
    expect(filterRows(rows, "removed", "", new Map())).toEqual([]);
    expect(rowCounts(rows, new Map())).toEqual({ all: 4, untranslated: 2, edited: 0, removed: 0, missing: 1 });
  });

  it("soundEffectIds: the cues the filter excludes, only if the count matches the server's", () => {
    const parsed = parseSrt(readSrtFixture("sfx-mixed.srt")).cues;
    const excluded = parsed.filter((c) => !removeSoundEffectCues(parsed).some((k) => k.id === c.id)).map((c) => c.id);
    expect(excluded.length).toBeGreaterThan(0);
    expect([...soundEffectIds(parsed, true, excluded.length)]).toEqual(excluded);
    expect(soundEffectIds(parsed, true, excluded.length + 1).size).toBe(0);
    expect(soundEffectIds(parsed, false, 0).size).toBe(0);
  });

  it("keeps cues sharing or lacking a number apart (real pipeline result)", async () => {
    for (const name of ["duplicate-index.srt", "quirks.srt", "sfx-mixed.srt"]) {
      const parsed = parseSrt(readSrtFixture(name)).cues;
      const sent = removeSoundEffectCues(parsed);
      const context = { parse: { recovered: [], unparsed: [] }, removedSoundEffectCues: parsed.length - sent.length, glossary: { entries: 0, ignoredLines: [] } };
      const events: StreamEvent[] = [];
      for await (const e of translateCues(stubModel().createResponse, sent, "instr", { context })) events.push(e);
      const last = events.at(-1)!;
      if (last.type !== "complete") throw new Error(last.type);
      const ids = soundEffectIds(parsed, true, last.report.removedSoundEffectCues);
      const rows = buildRows(parsed, { cues: last.cues, untranslated: last.report.untranslated, soundEffectIds: ids });
      expect(rows.some((r) => r.status === "missing")).toBe(false);
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
    const rows = buildRows(parsed, { cues: last.cues, untranslated: last.report.untranslated, soundEffectIds: new Set() });
    expect(rows.map((r) => r.status)).toEqual(["translated", "untranslated", "translated", "translated"]);
    expect(rows[1].output).toBe(parsed[1].text);
  });
});

describe("filterRows and rowCounts", () => {
  const rows = buildRows(source, result);
  const edits = new Map([[4, "להתראות"]]);
  const ids = (f: Parameters<typeof filterRows>[1], q = "") => filterRows(rows, f, q, edits).map((r) => r.id);

  it("filters by status and edits; 'all' includes removed rows", () => {
    expect(ids("all")).toEqual([1, 2, 3, 4]);
    expect(ids("untranslated")).toEqual([3]);
    expect(ids("edited")).toEqual([4]);
    expect(ids("removed")).toEqual([2]);
    expect(rowCounts(rows, edits)).toEqual({ all: 4, untranslated: 1, edited: 1, removed: 1, missing: 0 });
  });

  it("searches English and the current Hebrew, case-insensitively", () => {
    expect(ids("all", "  HELLO ")).toEqual([1]);
    expect(ids("all", "שלום")).toEqual([1]);
    expect(ids("all", "להתראות")).toEqual([4]); // the edit, not the model text
    expect(ids("all", "ביי")).toEqual([]);
    expect(ids("untranslated", "hello")).toEqual([]);
    expect(ids("removed", "music")).toEqual([2]);
  });

  it("a manually translated cue no longer counts as untranslated", () => {
    const manual = new Map([[3, "בוא הנה"]]);
    expect(filterRows(rows, "untranslated", "", manual)).toEqual([]);
    expect(rowCounts(rows, manual)).toMatchObject({ untranslated: 0, edited: 1 });
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
