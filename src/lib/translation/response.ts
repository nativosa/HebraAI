import type { Cue } from "@/lib/srt/parse";

// Shape requested from the model by the json_schema in prompt.ts. The output
// is not validated against it here (legacy behaviour): an unexpected shape
// throws when it is used in applyChunkTranslation.
export type ChunkTranslation = { items: { index: number; text_he: string }[] };

export type ParsedChunkOutput = { ok: true; json: ChunkTranslation } | { ok: false };

export function parseChunkOutput(outputText: string): ParsedChunkOutput {
  let json: ChunkTranslation;
  try {
    json = JSON.parse(outputText);
  } catch {
    return { ok: false };
  }
  return { ok: true, json };
}

// Applies the model's translations to the chunk's cues, matched by cue id
// (sent as "index").
// A cue without a translation keeps its original text (legacy fallback).
export function applyChunkTranslation(cuesPart: Cue[], json: ChunkTranslation): Cue[] {
  const map = new Map<number, string>(json.items.map((x) => [x.index, x.text_he]));

  const translated: Cue[] = [];
  for (const c of cuesPart) {
    const he = map.get(c.id);
    translated.push({
      ...c,
      text: (he ?? c.text).trim(),
    });
  }
  return translated;
}
