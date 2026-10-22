import type { ParseIssue, RecoveredKind, UnparsedBlock, UnparsedKind } from "@/lib/srt/parse";

// Summary sent with the final stream event. Contains counts, line numbers,
// cue numbers and timings only — never subtitle text.
export type TranslationReport = {
  cues: number; // cues sent for translation
  translated: number;
  removedSoundEffectCues: number;
  parse: { recovered: ParseIssue<RecoveredKind>[]; unparsed: UnparsedBlock[] };
};

const RECOVERED: Record<RecoveredKind, string> = {
  "missing-number": "cue(s) without a number line",
  "duplicate-number": "repeated cue number(s), kept as separate cues",
  "dot-separator": "timestamp(s) with '.' before milliseconds, normalised to ','",
  "short-hour": "timestamp(s) with a one-digit hour, normalised",
  "short-millis": "timestamp(s) with fewer than 3 millisecond digits, normalised",
  "missing-blank-line": "cue(s) not separated by a blank line",
  "empty-cue": "empty cue(s) removed",
};

const UNPARSED: Record<UnparsedKind, string> = {
  "orphan-text": "text not attached to a timestamp",
  "invalid-timestamp": "invalid timing line",
};

const lineList = (lines: number[]) =>
  lines.length > 5 ? `lines ${lines.slice(0, 5).join(", ")}, …` : `line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}`;

// Human-readable notes about the input file for the UI.
export function describeParseReport(parse: TranslationReport["parse"]): string[] {
  const notes: string[] = [];
  for (const [kind, label] of Object.entries(UNPARSED) as [UnparsedKind, string][]) {
    const blocks = parse.unparsed.filter((u) => u.kind === kind);
    if (blocks.length) {
      notes.push(`Not translated — could not be parsed (${label}): ${lineList(blocks.map((b) => b.line))}.`);
    }
  }
  for (const [kind, label] of Object.entries(RECOVERED) as [RecoveredKind, string][]) {
    const issues = parse.recovered.filter((r) => r.kind === kind);
    if (issues.length) notes.push(`Recovered ${issues.length} ${label} (${lineList(issues.map((i) => i.line))}).`);
  }
  return notes;
}
