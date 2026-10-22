// Builds the translation request for a case and mode.
//
// Only the case's `settings`, `input` and — in the oracle mode only — the
// verified character facts (name, gender, aliases, Hebrew spelling) can reach
// a request. References, wrong outputs, checks and expected forms never do,
// and there are no per-cue speaker assignments anywhere in a case.

import { caseToSrt } from "./cases.mjs";

// Modes the evaluation knows. `supported: false` modes are rejected by the
// runner until the app implements them (Stage 3, after Checkpoint A).
export const MODES = {
  classic: { supported: true, description: "current translation (Stage 2), default" },
  context: { supported: false, description: "read-only cross-chunk context + v2 prompt" },
  "context+chars": { supported: false, description: "context + automatic character pre-pass" },
  "context+oracle": { supported: false, description: "context + verified character sheet (upper bound of the review step)" },
};

// UI defaults (src/app/page.tsx), except sound-effect removal, which is off
// unless a case needs it, so cues are not filtered.
const DEFAULT_SETTINGS = { tone: "Neutral", preserveBreaks: true, maxChars: 42, removeSoundEffects: false };

// Verified character facts for the oracle mode: an explicit whitelist.
export function oracleCharacters(c) {
  return (c.oracle?.characters ?? []).map(({ name, gender, aliases, hebrewName }) => ({
    name,
    gender,
    aliases: aliases ?? [],
    ...(hebrewName ? { hebrewName } : {}),
  }));
}

export function buildRequest(c, mode) {
  if (!(mode in MODES)) throw new Error(`unknown mode ${mode}`);
  const s = { ...DEFAULT_SETTINGS, ...c.settings };
  /** @type {Record<string, string>} */
  const fields = {
    tone: s.tone,
    preserveBreaks: String(s.preserveBreaks),
    maxChars: String(s.maxChars),
    removeSoundEffects: String(s.removeSoundEffects),
    glossary: c.input?.glossary ?? "",
  };
  if (mode !== "classic") fields.mode = "context";
  if (mode === "context+chars") fields.analyzeCharacters = "true";
  if (mode === "context+oracle") fields.characters = JSON.stringify(oracleCharacters(c));
  return { fields, srt: caseToSrt(c), fileName: `${c.id}.srt` };
}
