import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { translateCues, type StreamEvent } from "@/lib/translation/pipeline";
import { buildExport, checkEdit } from "@/lib/review/export";
import { cue } from "../helpers/cues";
import { readExpected, readSrtFixture } from "../helpers/fixtures";
import { itemsFor, stubModel } from "../helpers/stub-model";

async function finalEvent(name: string, sfx: boolean, model = stubModel()) {
  const parsed = parseSrt(readSrtFixture(name)).cues;
  const events: StreamEvent[] = [];
  for await (const e of translateCues(model.createResponse, sfx ? removeSoundEffectCues(parsed) : parsed, "instr")) {
    events.push(e);
  }
  const last = events.at(-1)!;
  if (last.type !== "complete" && last.type !== "partial") throw new Error(last.type);
  return last;
}

describe("buildExport", () => {
  const fixtures = ["basic", "crlf-bom", "duplicate-index", "multi-chunk", "multiline-italics", "quirks", "sfx-mixed"];

  it.each(fixtures.flatMap((f) => [[f, "on"], [f, "off"]]))(
    "%s (sound effects %s): without edits it equals the content and the expected file",
    async (name, sfx) => {
      const last = await finalEvent(`${name}.srt`, sfx === "on");
      expect(buildExport(last.cues, new Map())).toBe(last.content);
      expect(buildExport(last.cues, new Map())).toBe(readExpected(`${name}.sfx-${sfx}.srt`));
    }
  );

  it("partial result: equals the content", async () => {
    const last = await finalEvent("basic.srt", false, stubModel({ 1: itemsFor(1, 3, 4), 2: itemsFor() }));
    expect(last.type).toBe("partial");
    expect(buildExport(last.cues, new Map())).toBe(last.content);
  });

  it("applies edits by id, keeping order, numbers, timings and line breaks", () => {
    const cues = [cue(1, "א", { number: 7 }), cue(2, "ב", { number: 7, start: "00:00:05,000" }), cue(3, "ג", { number: 9 })];
    const out = buildExport(cues, new Map([[2, "שורה אחת\nשורה שתיים"]]));
    expect(out).toBe(
      "7\n00:00:01,000 --> 00:00:02,000\nא\n\n" +
        "7\n00:00:05,000 --> 00:00:02,000\nשורה אחת\nשורה שתיים\n\n" +
        "9\n00:00:01,000 --> 00:00:02,000\nג\n"
    );
  });

  it("edits of untranslated cues replace the kept English", () => {
    expect(buildExport([cue(1, "Hello")], new Map([[1, "שלום"]]))).toBe("1\n00:00:01,000 --> 00:00:02,000\nשלום\n");
  });

  it("options: renumber 1..N, UTF-8 BOM", () => {
    const cues = [cue(1, "א", { number: 5 }), cue(2, "ב", { number: 5 })];
    expect(buildExport(cues, new Map(), { bom: false, renumber: true })).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\nא\n\n2\n00:00:01,000 --> 00:00:02,000\nב\n"
    );
    const withBom = buildExport(cues, new Map(), { bom: true, renumber: false });
    expect(withBom.startsWith("﻿5\n")).toBe(true);
    expect(Buffer.from(withBom, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("an edited export reads back with the same cues", () => {
    const cues = [cue(1, "א"), cue(2, "ב"), cue(3, "ג")];
    const edits = new Map([[2, "<i>שלום</i>\n- מה?"]]);
    const parsed = parseSrt(buildExport(cues, edits));
    expect(parsed.cues.map((c) => c.text)).toEqual(["א", "<i>שלום</i>\n- מה?", "ג"]);
    expect(parsed.recovered).toEqual([]);
    expect(parsed.unparsed).toEqual([]);
  });
});

describe("checkEdit", () => {
  it("empty or whitespace reverts to the model's text", () => {
    expect(checkEdit("")).toEqual({ kind: "revert" });
    expect(checkEdit("  \n\t\r\n")).toEqual({ kind: "revert" });
  });

  it("keeps line breaks and inner text; normalises line endings and outer whitespace", () => {
    expect(checkEdit("שורה\r\nשנייה\rשלישית")).toEqual({ kind: "ok", text: "שורה\nשנייה\nשלישית" });
    expect(checkEdit("\n  שלום,  עולם  \n")).toEqual({ kind: "ok", text: "שלום,  עולם" });
    expect(checkEdit("<i>- 12</i>\n42")).toEqual({ kind: "ok", text: "<i>- 12</i>\n42" });
    expect(checkEdit("a -> b")).toEqual({ kind: "ok", text: "a -> b" });
  });

  it("rejects a blank line inside the text", () => {
    expect(checkEdit("שורה\n\nשורה")).toMatchObject({ kind: "invalid", message: expect.stringContaining("empty line") });
    expect(checkEdit("שורה\n   \nשורה").kind).toBe("invalid");
  });

  it("rejects a line read as a timing line", () => {
    for (const text of ["שלום\n00:00:01,000 --> 00:00:02,000", "5\n0:00:01.5 --> 0:00:02,000\nטקסט"]) {
      expect(checkEdit(text)).toMatchObject({ kind: "invalid", message: expect.stringContaining("timing line") });
    }
  });
});
