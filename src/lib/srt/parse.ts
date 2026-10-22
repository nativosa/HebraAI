export type Cue = {
  // Internal identity: 1..N in input order. Translation is matched by id only.
  id: number;
  // The cue's own number line, or null when it had none.
  number: number | null;
  start: string;
  end: string;
  text: string;
};

// Irregular input that was handled safely (the content is in the output).
export type RecoveredKind =
  | "missing-number" // timestamp without a number line
  | "duplicate-number" // number already used by an earlier cue
  | "dot-separator" // 00:00:01.000 instead of 00:00:01,000
  | "short-hour" // 0:00:01,000
  | "short-millis" // 00:00:01,5 (read as a fraction: 500 ms)
  | "missing-blank-line" // next cue starts without a blank line before it
  | "empty-cue"; // timestamp without text; nothing to translate, removed

// Input that could not be parsed safely; it is not in the output.
export type UnparsedKind =
  | "orphan-text" // text not attached to a timestamp (e.g. after a blank line inside a cue)
  | "invalid-timestamp"; // a "-->" line that is not a valid SRT timing line

export type ParseIssue<K> = { line: number; kind: K };
export type UnparsedBlock = ParseIssue<UnparsedKind> & { lines: number };

export type ParseResult = {
  cues: Cue[];
  recovered: ParseIssue<RecoveredKind>[];
  unparsed: UnparsedBlock[];
};

const STAMP = String.raw`(\d{1,2}):(\d{2}):(\d{2})([,.])(\d{1,3})`;
const TIMING = new RegExp(String.raw`^\s*${STAMP}\s*-->\s*${STAMP}(?:\s.*)?$`);
const NUMBER = /^\s*(\d+)\s*$/;

type Line = { n: number; text: string };

// Parses SRT text. Line numbers in issues are 1-based input lines.
export function parseSrt(srt: string): ParseResult {
  const lines = srt.replace(/^\uFEFF/, "").split(/\r?\n/).map((text, i) => ({ n: i + 1, text }));
  const result: ParseResult = { cues: [], recovered: [], unparsed: [] };
  const seenNumbers = new Set<number>();

  // Blocks of consecutive non-blank lines.
  const blocks: Line[][] = [];
  let current: Line[] = [];
  for (const line of lines) {
    if (line.text.trim() === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  for (const block of blocks) {
    const timings = block.map((l, i) => (TIMING.test(l.text) ? i : -1)).filter((i) => i >= 0);
    if (timings.length === 0) {
      const kind = block.some((l) => l.text.includes("-->")) ? "invalid-timestamp" : "orphan-text";
      result.unparsed.push({ line: block[0].n, lines: block.length, kind });
      continue;
    }

    // A number line directly above a timing line is that cue's number.
    const numberAbove = (at: number) => at > 0 && NUMBER.test(block[at - 1].text);

    // Lines before the first cue (other than its number) belong to no cue.
    const first = timings[0];
    const strayEnd = numberAbove(first) ? first - 1 : first;
    if (strayEnd > 0) result.unparsed.push({ line: block[0].n, lines: strayEnd, kind: "orphan-text" });

    // Each timing line starts a cue. More than one in a block means the blank
    // line between cues was missing; the next cue's number ends this cue's text.
    for (let t = 0; t < timings.length; t++) {
      const at = timings[t];
      const next = timings[t + 1];
      const textEnd = next === undefined ? block.length : numberAbove(next) ? next - 1 : next;
      const numberLine = numberAbove(at) ? block[at - 1] : null;
      if (t > 0) result.recovered.push({ line: (numberLine ?? block[at]).n, kind: "missing-blank-line" });
      addCue(result, seenNumbers, block[at], numberLine, block.slice(at + 1, textEnd));
    }
  }
  return result;
}

function addCue(result: ParseResult, seen: Set<number>, timing: Line, numberLine: Line | null, textLines: Line[]) {
  const m = timing.text.match(TIMING)!;
  const start = normalizeStamp(m.slice(1, 6), timing.n, result);
  const end = normalizeStamp(m.slice(6, 11), timing.n, result);

  if (textLines.length === 0) {
    result.recovered.push({ line: timing.n, kind: "empty-cue" });
    return;
  }

  let number: number | null = null;
  if (numberLine) {
    number = Number(numberLine.text.match(NUMBER)![1]);
    if (seen.has(number)) result.recovered.push({ line: numberLine.n, kind: "duplicate-number" });
    seen.add(number);
  } else {
    result.recovered.push({ line: timing.n, kind: "missing-number" });
  }

  const text = textLines.map((l) => l.text).join("\n").trim();
  result.cues.push({ id: result.cues.length + 1, number, start, end, text });
}

// [h, m, s, separator, ms] -> "HH:MM:SS,mmm"; records recovered irregularities once per line.
function normalizeStamp([h, m, s, sep, ms]: string[], line: number, result: ParseResult): string {
  const note = (kind: RecoveredKind) => {
    if (!result.recovered.some((r) => r.line === line && r.kind === kind)) result.recovered.push({ line, kind });
  };
  if (sep === ".") note("dot-separator");
  if (h.length === 1) note("short-hour");
  if (ms.length < 3) note("short-millis");
  return `${h.padStart(2, "0")}:${m}:${s},${ms.padEnd(3, "0")}`;
}
