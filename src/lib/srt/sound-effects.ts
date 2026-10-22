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
// Nested groups are removed innermost first, so "(a (b) c)" disappears
// completely; an unmatched bracket is left as text.
export function stripNonDialogueMarkers(line: string): string {
  let s = line;

  // remove musical markers like ♪ ... ♪ (including the content)
  s = s.replace(/♪[^♪]*♪/g, "");

  // remove bracketed annotations anywhere
  let previous;
  do {
    previous = s;
    s = s.replace(/\([^()]*\)/g, ""); // (whispers)
    s = s.replace(/\[[^[\]]*\]/g, ""); // [music]
  } while (s !== previous);

  return s;
}

const TAG = /<\/?[^>]+>/g;

// Removes formatting tag pairs that enclose nothing but whitespace.
function removeEmptyTags(s: string): string {
  let previous;
  do {
    previous = s;
    s = s.replace(/<([a-z]+)\b[^>]*>\s*<\/\1>/gi, "");
  } while (s !== previous);
  return s;
}

// Collapses whitespace left by removals, also just inside tags.
function tidy(line: string): string {
  return line
    .replace(/\s{2,}/g, " ")
    .replace(/(<[^/>][^>]*>)\s+/g, "$1")
    .replace(/\s+(<\/[^>]+>)/g, "$1")
    .trim();
}

// Cleans a cue's text to keep only dialogue. Formatting tags around the
// remaining dialogue are kept; tags of removed lines move to the
// neighbouring kept line (opening tags to the next, closing tags to the
// previous) so pairs stay intact. Returns cleaned text; may become empty.
export function toDialogueOnlyCueText(text: string): string {
  const lines = removeEmptyTags(
    text
      .split(/\r?\n/)
      .map((l) => stripNonDialogueMarkers(l.trim()))
      .join("\n")
  ).split("\n");

  const kept: string[] = [];
  let pendingOpen = "";
  for (const raw of lines) {
    const line = tidy(raw);
    if (!line) continue;
    if (stripHtmlTags(line).trim()) {
      kept.push(pendingOpen + line);
      pendingOpen = "";
      continue;
    }
    // Only tags are left on this line.
    for (const tag of line.match(TAG) ?? []) {
      if (tag.startsWith("</") && kept.length) kept[kept.length - 1] += tag;
      else pendingOpen += tag;
    }
  }
  if (pendingOpen && kept.length) kept[kept.length - 1] += pendingOpen;

  return removeEmptyTags(kept.map(tidy).join("\n")).trim();
}

// Decide if the cleaned cue still contains "dialogue-like" characters.
// This keeps Hebrew/English letters and digits.
// If none remain, we treat it as non-dialogue and remove the cue entirely.
export function isDialogueLike(text: string): boolean {
  return /[A-Za-z\u0590-\u05FF0-9]/.test(text);
}

// Cleans every cue to dialogue only and drops cues with no dialogue left
// (tags alone do not count as dialogue).
export function removeSoundEffectCues(cues: Cue[]): Cue[] {
  return cues
    .map((c) => {
      const cleaned = toDialogueOnlyCueText(c.text);
      return { ...c, text: cleaned };
    })
    .filter((c) => c.text.length > 0 && isDialogueLike(stripHtmlTags(c.text)));
}
