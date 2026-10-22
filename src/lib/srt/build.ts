import type { Cue } from "./parse";

export function buildSrt(cues: Cue[]): string {
  return cues
    .map(
      (c) =>
        `${c.index}\n${c.start} --> ${c.end}\n${c.text.trim()}\n`
    )
    .join("\n");
}
