import type { Tone } from "@/lib/types";

export type GlossaryEntry = { term: string; translation: string };

export type Glossary = {
  entries: GlossaryEntry[];
  ignoredLines: number[]; // 1-based lines that are not "term = translation"
};

export const GLOSSARY_MAX_ENTRIES = 100;
export const GLOSSARY_MAX_CHARS = 4000;

export type TranslateOptions = {
  tone: Tone;
  removeSoundEffects: boolean;
  preserveBreaks: boolean;
  maxChars: number;
  glossary: Glossary;
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

  const glossaryRaw = form.get("glossary");
  const glossary = parseGlossary(typeof glossaryRaw === "string" ? glossaryRaw : "");

  return { tone, removeSoundEffects, preserveBreaks, maxChars, glossary };
}

// One "term = translation" per line (the first "=" separates them). Blank
// lines are skipped; other lines without a term or translation are ignored
// and reported. A repeated term keeps its last translation.
export function parseGlossary(text: string): Glossary {
  const byTerm = new Map<string, GlossaryEntry>();
  const ignoredLines: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const eq = line.indexOf("=");
    const term = eq < 0 ? "" : line.slice(0, eq).trim();
    const translation = eq < 0 ? "" : line.slice(eq + 1).trim();
    if (!term || !translation) {
      ignoredLines.push(i + 1);
      return;
    }
    const key = term.toLowerCase();
    byTerm.delete(key); // keep the order of the last occurrence
    byTerm.set(key, { term, translation });
  });
  return { entries: [...byTerm.values()], ignoredLines };
}

// Null when within limits, else the message for the client.
export function glossaryLimitError(text: string, glossary: Glossary): string | null {
  if (glossary.entries.length > GLOSSARY_MAX_ENTRIES) {
    return `Glossary has ${glossary.entries.length} entries; the maximum is ${GLOSSARY_MAX_ENTRIES}.`;
  }
  if (text.length > GLOSSARY_MAX_CHARS) {
    return `Glossary has ${text.length} characters; the maximum is ${GLOSSARY_MAX_CHARS}.`;
  }
  return null;
}
