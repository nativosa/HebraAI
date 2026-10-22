import type { Cue } from "./parse";

// Removes simple HTML tags but preserves the inner text.
// Example: "<i>(music)</i>" -> "(music)"
export function stripHtmlTags(input: string): string {
  return input.replace(/<\/?[^>]+>/g, "");
}

// Removes non-dialogue annotations anywhere in the line:
// - (...) blocks
// - [...] blocks
// - ♪...♪ blocks (musical cues)
export function stripNonDialogueMarkers(line: string): string {
  let s = line;

  // remove musical markers like ♪ ... ♪ (including the content)
  s = s.replace(/♪[^♪]*♪/g, "");

  // remove bracketed annotations anywhere
  s = s.replace(/\([^)]*\)/g, ""); // (whispers)
  s = s.replace(/\[[^\]]*\]/g, ""); // [music]

  return s;
}

// Cleans a cue's text to keep only dialogue.
// Returns cleaned text; may become empty.
export function toDialogueOnlyCueText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(stripHtmlTags)
    .map(stripNonDialogueMarkers)
    // normalize whitespace after removals
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

// Decide if the cleaned cue still contains "dialogue-like" characters.
// This keeps Hebrew/English letters and digits.
// If none remain, we treat it as non-dialogue and remove the cue entirely.
export function isDialogueLike(text: string): boolean {
  return /[A-Za-z\u0590-\u05FF0-9]/.test(text);
}

// Cleans every cue to dialogue only and drops cues with no dialogue left.
export function removeSoundEffectCues(cues: Cue[]): Cue[] {
  return cues
    .map((c) => {
      const cleaned = toDialogueOnlyCueText(c.text);
      return { ...c, text: cleaned };
    })
    .filter((c) => c.text.length > 0 && isDialogueLike(c.text));
}
