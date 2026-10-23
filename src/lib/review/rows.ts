// Rows of the subtitle review: the input file's cues joined with the
// translation result by internal cue id. Derived data only; the page keeps
// the parsed input, the result and the manual edits, nothing else.

import type { Cue } from "@/lib/srt/parse";
import type { UntranslatedCue } from "@/lib/translation/report";
import type { FailureReason } from "@/lib/translation/response";

// pending: no result yet. removed: not sent for translation (sound-effect
// removal) and not exported.
export type RowStatus = "pending" | "translated" | "untranslated" | "removed";

export type ReviewRow = {
  id: number;
  number: number | null;
  start: string;
  end: string;
  en: string; // the input file's text
  // The result's text: the translation, or the English kept for an
  // untranslated cue. null for pending and removed rows.
  output: string | null;
  status: RowStatus;
  reason?: FailureReason; // untranslated rows
};

export type ReviewResult = { cues: Cue[]; untranslated: UntranslatedCue[] };

// Manual edits by cue id. A cue without an entry uses the result's text.
export type Edits = ReadonlyMap<number, string>;

export function buildRows(source: Cue[], result?: ReviewResult): ReviewRow[] {
  const output = new Map(result?.cues.map((c) => [c.id, c.text]));
  const failed = new Map(result?.untranslated.map((u) => [u.id, u.reason]));
  return source.map((c): ReviewRow => {
    const row = { id: c.id, number: c.number, start: c.start, end: c.end, en: c.text };
    if (!result) return { ...row, output: null, status: "pending" };
    if (!output.has(c.id)) return { ...row, output: null, status: "removed" };
    const reason = failed.get(c.id);
    return reason
      ? { ...row, output: output.get(c.id)!, status: "untranslated", reason }
      : { ...row, output: output.get(c.id)!, status: "translated" };
  });
}

// The text the export uses for a row.
export function effectiveText(row: ReviewRow, edits: Edits): string | null {
  return edits.get(row.id) ?? row.output;
}

// all: every row except removed ones.
export type RowFilter = "all" | "untranslated" | "edited" | "removed";

export function rowCounts(rows: ReviewRow[], edits: Edits): Record<RowFilter, number> {
  const counts = { all: 0, untranslated: 0, edited: 0, removed: 0 };
  for (const r of rows) {
    if (r.status === "removed") counts.removed++;
    else counts.all++;
    if (r.status === "untranslated") counts.untranslated++;
    if (edits.has(r.id)) counts.edited++;
  }
  return counts;
}

// Rows to show for a filter and a search query (case-insensitive, in the
// English and the current Hebrew text). Display only: the export always
// uses every result cue.
export function filterRows(rows: ReviewRow[], filter: RowFilter, query: string, edits: Edits): ReviewRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    const shown =
      filter === "removed"
        ? r.status === "removed"
        : r.status !== "removed" &&
          (filter === "all" ||
            (filter === "untranslated" && r.status === "untranslated") ||
            (filter === "edited" && edits.has(r.id)));
    if (!shown || !q) return shown;
    return r.en.toLowerCase().includes(q) || (effectiveText(r, edits) ?? "").toLowerCase().includes(q);
  });
}
