import type { Cue } from "./parse";

// Writes cues in the given order. Cues keep their original numbers; only when
// some cue has no number is the whole output renumbered 1..N.
export function buildSrt(cues: Cue[]): string {
  const renumber = cues.some((c) => c.number === null);
  return cues
    .map(
      (c, i) =>
        `${renumber ? i + 1 : c.number}\n${c.start} --> ${c.end}\n${c.text.trim()}\n`
    )
    .join("\n");
}
