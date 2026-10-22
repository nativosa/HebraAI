import type { Tone } from "@/lib/types";

export type TranslateOptions = {
  tone: Tone;
  removeSoundEffects: boolean;
  preserveBreaks: boolean;
  maxChars: number;
};

// Reads and sanitizes the translation options from the request form.
export function parseTranslateOptions(form: FormData): TranslateOptions {
  const toneRaw = (form.get("tone") as string) || "Neutral";
  const tone = (toneRaw === "Formal" || toneRaw === "Informal" || toneRaw === "Neutral")
    ? toneRaw
    : "Neutral";

  const removeSoundEffects = form.get("removeSoundEffects") === "true";
  const preserveBreaks = form.get("preserveBreaks") === "true";

  const maxCharsRaw = Number(form.get("maxChars"));
  const maxChars = Number.isFinite(maxCharsRaw)
    ? Math.min(Math.max(maxCharsRaw, 20), 80)
    : 42;

  return { tone, removeSoundEffects, preserveBreaks, maxChars };
}
