// Manual edits and the exported SRT.

import { buildSrt } from "@/lib/srt/build";
import { parseSrt, type Cue } from "@/lib/srt/parse";
import type { Edits } from "./rows";

export type EditCheck =
  | { kind: "revert" } // empty: back to the model's text
  | { kind: "ok"; text: string }
  | { kind: "invalid"; message: string };

// Checks an edited subtitle text. Line endings become "\n" and whitespace
// around the whole text is dropped (the export trims it anyway); everything
// else, including line breaks, is kept as typed. Text that would change the
// SRT structure (a blank line, or a line read as a timing line) is
// rejected, never rewritten.
export function checkEdit(raw: string): EditCheck {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return { kind: "revert" };
  if (text.split("\n").some((line) => line.trim() === "")) {
    return { kind: "invalid", message: "Remove the empty line: in SRT a blank line ends the subtitle." };
  }
  // The text must read back as exactly this one cue.
  const parsed = parseSrt(buildSrt([{ id: 1, number: 1, start: "00:00:00,000", end: "00:00:01,000", text }]));
  const intact =
    parsed.cues.length === 1 && parsed.cues[0].text === text && !parsed.unparsed.length && !parsed.recovered.length;
  return intact
    ? { kind: "ok", text }
    : { kind: "invalid", message: 'A line looks like an SRT timing line ("-->"); change it so the file stays valid.' };
}

export type ExportOptions = {
  bom: boolean; // start the file with a UTF-8 byte order mark
  renumber: boolean; // number the cues 1..N instead of keeping their numbers
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { bom: false, renumber: false };

// The SRT to download or copy: every result cue in order, with the manual
// edits applied. With the default options and no edits this is exactly the
// server's `content`.
export function buildExport(cues: Cue[], edits: Edits, options: ExportOptions = DEFAULT_EXPORT_OPTIONS): string {
  const out = cues.map((c, i) => ({
    ...c,
    text: edits.get(c.id) ?? c.text,
    number: options.renumber ? i + 1 : c.number,
  }));
  return (options.bom ? "﻿" : "") + buildSrt(out);
}
