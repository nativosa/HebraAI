// Deterministic checks on translated cues (no LLM judge, no exact strings).
//
//   { id, dimension, type: "anyOf",  cue, forms: [...] }  at least one form occurs
//   { id, dimension, type: "noneOf", cue, forms: [...] }  no form occurs (e.g. wrong gender)
//   { id, dimension, type: "sameGroup", cues: [...], groups: { name: [forms] } }
//        every cue uses forms of one group, and the same group in all cues
//        (consistency; either group may be right)
//   { id, dimension, type: "preserve", cue, values: [...] }  literal values kept (numbers, times, names)
//   { id, dimension, type: "translated", cues: [...] }      translated (not partial / missing)
//
// `outputs` maps cue key -> translated text; `untranslated` is a Set of keys.
// A check on a missing or untranslated cue fails.

import { containsForm, hasHebrew, normalizeHebrew } from "./hebrew.mjs";

export function runCheck(check, outputs, untranslated = new Set()) {
  const text = (key) => (untranslated.has(key) ? undefined : outputs[key]);
  const missing = (keys) => keys.filter((k) => text(k) === undefined);

  switch (check.type) {
    case "anyOf": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      return check.forms.some((f) => containsForm(t, f)) ? { pass: true } : { pass: false, reason: "no accepted form" };
    }
    case "noneOf": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      return check.forms.some((f) => containsForm(t, f)) ? { pass: false, reason: "forbidden form" } : { pass: true };
    }
    case "sameGroup": {
      if (missing(check.cues).length) return { pass: false, reason: "missing" };
      let common = null;
      for (const key of check.cues) {
        const groups = Object.entries(check.groups)
          .filter(([, forms]) => forms.some((f) => containsForm(text(key), f)))
          .map(([name]) => name);
        if (groups.length === 0) return { pass: false, reason: "no group form" };
        common = common === null ? groups : common.filter((g) => groups.includes(g));
      }
      return common.length ? { pass: true, group: common.join("|") } : { pass: false, reason: "inconsistent groups" };
    }
    case "preserve": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      const n = normalizeHebrew(t);
      return check.values.every((v) => n.includes(normalizeHebrew(v))) ? { pass: true } : { pass: false, reason: "value lost" };
    }
    case "translated": {
      const keys = check.cues ?? [check.cue];
      if (missing(keys).length) return { pass: false, reason: "missing" };
      return keys.every((k) => hasHebrew(text(k))) ? { pass: true } : { pass: false, reason: "no Hebrew" };
    }
    default:
      return { pass: false, reason: `unknown check type ${check.type}` };
  }
}
