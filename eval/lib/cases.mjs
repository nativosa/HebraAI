// Evaluation cases: loading, validation, expansion and SRT generation.
//
// A case file (*.json) holds one case or an array of cases:
// {
//   "id": "spk-001", "category": "speaker-gender",
//   "description": "English description of what is tested",
//   "settings": { "removeSoundEffects": false, ... }   // optional form settings
//   "input": { "glossary": "..." }                        // optional user inputs
//   "oracle": { "characters": [ { "name", "gender", "aliases", "hebrewName" } ] },
//   "cues": [ { "text": "...", "key": "t1", "gapBefore": 30 }, { "filler": 20 } ],
//   "checks": [ ... see checks.mjs ... ],
//   "reference": { "t1": "correct Hebrew" },   // passes every check
//   "wrong": { "t1": "incorrect Hebrew" },      // fails exactly `wrongFails`
//   "wrongFails": ["check-id", ...]
// }
// Only `settings`, `input` and (in oracle modes) `oracle.characters` may
// reach a translation request; see request.mjs.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const CATEGORIES = [
  "speaker-gender",
  "addressee-gender",
  "plural-group",
  "speaker-addressee",
  "ambiguous",
  "alternating-unlabeled",
  "names",
  "cross-chunk",
  "sdh-labels",
  "meaning",
];

export const DIMENSIONS = [
  "speaker-gender",
  "addressee-gender",
  "number",
  "consistency",
  "names",
  "meaning",
  "completeness",
];

export const CHECK_TYPES = ["anyOf", "noneOf", "sameGroup", "preserve", "translated"];
const SETTINGS = ["tone", "preserveBreaks", "maxChars", "removeSoundEffects"];
const INPUTS = ["glossary"];
const ORACLE_CHARACTER_FIELDS = ["name", "gender", "aliases", "hebrewName"];
const GENDERS = ["male", "female", "unknown"];

// Neutral English lines used to pad scenes (no people, no gender).
export const FILLER_LINES = [
  "The rain has stopped.",
  "Look at the sky.",
  "The train is late again.",
  "It's getting dark outside.",
  "The coffee is cold.",
  "Listen to that wind.",
  "The streets are empty tonight.",
  "That clock is always wrong.",
  "The shop opens at nine.",
  "The bridge is closed for repairs.",
  "Snow is coming this weekend.",
  "The bus stop is over there.",
];

const SECONDS_PER_CUE = 3;

// Loads every case under `dir` (recursively, *.json); throws with all problems.
export function loadCases(dir) {
  const files = listJson(dir);
  const cases = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const c of Array.isArray(data) ? data : [data]) cases.push({ ...c, file: relative(dir, file) });
  }
  const problems = validateCases(cases);
  if (problems.length) throw new Error(`Invalid evaluation cases:\n- ${problems.join("\n- ")}`);
  return cases.map(expandCase);
}

function listJson(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return listJson(path);
      return name.endsWith(".json") ? [path] : [];
    });
}

// Returns a list of problems (empty when all cases are valid).
export function validateCases(cases) {
  const problems = [];
  const ids = new Set();
  for (const c of cases) {
    const where = `${c.id ?? "?"}${c.file ? ` (${c.file})` : ""}`;
    const p = (msg) => problems.push(`${where}: ${msg}`);
    if (!c.id || typeof c.id !== "string") p("missing id");
    else if (ids.has(c.id)) p("duplicate id");
    ids.add(c.id);
    if (!CATEGORIES.includes(c.category)) p(`unknown category ${c.category}`);
    for (const k of Object.keys(c.settings ?? {})) if (!SETTINGS.includes(k)) p(`unknown setting ${k}`);
    for (const k of Object.keys(c.input ?? {})) if (!INPUTS.includes(k)) p(`unknown input ${k}`);
    for (const ch of c.oracle?.characters ?? []) {
      for (const k of Object.keys(ch)) if (!ORACLE_CHARACTER_FIELDS.includes(k)) p(`oracle character field ${k} not allowed`);
      if (!ch.name) p("oracle character without name");
      if (!GENDERS.includes(ch.gender)) p(`oracle character ${ch.name}: gender ${ch.gender}`);
    }
    if (!Array.isArray(c.cues) || c.cues.length === 0) {
      p("no cues");
      continue;
    }
    const keys = new Set();
    for (const cue of c.cues) {
      if ("filler" in cue) {
        if (!Number.isInteger(cue.filler) || cue.filler < 1) p("filler must be a positive integer");
        continue;
      }
      if (typeof cue.text !== "string" || !cue.text.trim()) p("cue without text");
      if (cue.key !== undefined) {
        if (keys.has(cue.key)) p(`duplicate cue key ${cue.key}`);
        keys.add(cue.key);
      }
    }
    if (!Array.isArray(c.checks) || c.checks.length === 0) p("no checks");
    const checkIds = new Set();
    for (const check of c.checks ?? []) {
      if (!check.id || checkIds.has(check.id)) p(`missing or duplicate check id ${check.id}`);
      checkIds.add(check.id);
      if (!CHECK_TYPES.includes(check.type)) p(`check ${check.id}: unknown type ${check.type}`);
      if (!DIMENSIONS.includes(check.dimension)) p(`check ${check.id}: unknown dimension ${check.dimension}`);
      for (const key of checkKeys(check)) if (!keys.has(key)) p(`check ${check.id}: unknown cue key ${key}`);
      for (const form of checkForms(check)) {
        try {
          new RegExp(form, "u");
        } catch {
          p(`check ${check.id}: invalid form ${form}`);
        }
      }
    }
    for (const key of Object.keys(c.reference ?? {})) if (!keys.has(key)) p(`reference for unknown key ${key}`);
    for (const key of Object.keys(c.wrong ?? {})) if (!keys.has(key)) p(`wrong for unknown key ${key}`);
    if (!c.reference) p("no reference");
    if (!c.wrong || !Array.isArray(c.wrongFails) || c.wrongFails.length === 0) p("no wrong output / wrongFails");
    for (const id of c.wrongFails ?? []) if (!checkIds.has(id)) p(`wrongFails: unknown check ${id}`);
  }
  return problems;
}

export function checkKeys(check) {
  return check.cues ?? (check.cue ? [check.cue] : []);
}

function checkForms(check) {
  if (check.forms) return check.forms;
  if (check.groups) return Object.values(check.groups).flat();
  return [];
}

// Expands fillers into numbered cues with timings; keeps the original case.
export function expandCase(c) {
  const cues = [];
  let t = 1;
  let filler = 0;
  for (const cue of c.cues) {
    const items = "filler" in cue
      ? Array.from({ length: cue.filler }, () => ({ text: FILLER_LINES[filler++ % FILLER_LINES.length] }))
      : [cue];
    for (const item of items) {
      t += item.gapBefore ?? 0;
      cues.push({ number: cues.length + 1, key: item.key, text: item.text, start: t, end: t + SECONDS_PER_CUE - 0.5 });
      t += SECONDS_PER_CUE;
    }
  }
  const numberByKey = Object.fromEntries(cues.filter((x) => x.key).map((x) => [x.key, x.number]));
  return { ...c, expandedCues: cues, numberByKey };
}

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

export function caseToSrt(expanded) {
  return expanded.expandedCues.map((c) => `${c.number}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
}
