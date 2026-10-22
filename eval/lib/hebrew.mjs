// Small, deliberately simple Hebrew text helpers for evaluation checks.
// No morphological analysis: checks list the accepted and forbidden word
// forms explicitly, and matching only allows common one-letter prefixes.

const range = (from, to) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;

// Niqqud and cantillation marks (and the punctuation marks in that block),
// except maqaf, which separates words.
const MARKS = new RegExp(`[${range(0x591, 0x5bd)}${range(0x5bf, 0x5c7)}]`, "g");
const MAQAF = String.fromCharCode(0x5be);
// Direction marks and other invisible formatting characters.
const INVISIBLE = new RegExp(`[${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`, "g");
const GERESH = new RegExp(`[${String.fromCharCode(0x5f3)}\`´‘’]`, "g");
const GERSHAYIM = new RegExp(`[${String.fromCharCode(0x5f4)}“”״]`, "g");

export const HEBREW_LETTERS = range(0x5d0, 0x5ea);
const LETTER = `[${HEBREW_LETTERS}A-Za-z0-9]`;
// Prefixes that may precede a word: ו ה ב כ ל מ ש, up to four (e.g. "וכשה").
const PREFIX = `[${["ו", "ה", "ב", "כ", "ל", "מ", "ש"].join("")}]{0,4}`;

// Normalises text for matching: strips tags, niqqud and invisible marks,
// unifies geresh/gershayim and quotes, maqaf -> space, collapses spaces.
export function normalizeHebrew(text) {
  return String(text ?? "")
    .replace(/<\/?[^>]+>/g, " ")
    .normalize("NFC")
    .replace(MARKS, "")
    .replaceAll(MAQAF, " ")
    .replace(INVISIBLE, "")
    .replace(GERESH, "'")
    .replace(GERSHAYIM, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Allowed prefixes per check: "all" (default: up to four of ו ה ב כ ל מ ש),
// "ו" (only an optional "and" — for short verbs and imperatives, so חכה does
// not match מחכה) or "none".
const PREFIXES = { all: PREFIX, ו: "ו?", none: "" };

// Removes geresh/gershayim and quotes, so ג'ון and גון match each other
// (used for names, where they are punctuation-only spelling differences).
const withoutGeresh = (s) => s.replace(/['"]/g, "");

// True when `form` (a word or short phrase; may use simple regex syntax
// such as "עי?יפה" or "(את|אתה)") occurs as whole words in `text`, optionally
// after prefix letters.
export function containsForm(text, form, { prefixes = "all", ignoreGeresh = false } = {}) {
  const prepare = (s) => (ignoreGeresh ? withoutGeresh(normalizeHebrew(s)) : normalizeHebrew(s));
  const prefix = PREFIXES[prefixes];
  if (prefix === undefined) throw new Error(`unknown prefixes option ${prefixes}`);
  const pattern = new RegExp(`(?<!${LETTER})${prefix}(?:${prepare(form)})(?!${LETTER})`, "u");
  return pattern.test(prepare(text));
}

// True when `value` occurs anywhere in `text` after normalisation (no word
// boundaries) — for symbols and numbers such as "$" or "7:30".
export function containsText(text, value) {
  return normalizeHebrew(text).includes(normalizeHebrew(value));
}

export const PREFIX_OPTIONS = Object.keys(PREFIXES);

// True when the text contains at least one Hebrew letter.
export function hasHebrew(text) {
  return new RegExp(`[${HEBREW_LETTERS}]`).test(String(text ?? ""));
}
