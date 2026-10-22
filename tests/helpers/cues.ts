import type { Cue } from "@/lib/srt/parse";

// A cue whose SRT number equals its id unless overridden.
export function cue(id: number, text: string, overrides: Partial<Cue> = {}): Cue {
  return { id, number: id, start: "00:00:01,000", end: "00:00:02,000", text, ...overrides };
}

// n cues "Line 1".."Line n" with ids and numbers 1..n.
export function cues(n: number): Cue[] {
  return Array.from({ length: n }, (_, i) => cue(i + 1, `Line ${i + 1}`));
}
