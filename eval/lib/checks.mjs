// Deterministic checks on translated cues (no LLM judge, no exact strings).
//
//   { id, dimension, type: "anyOf",  cue, forms: [...], neutral?: [...] }
//        at least one form occurs. `neutral` lists gender-neutral phrasings
//        with the same meaning that are also accepted; such a pass is
//        reported as neutral (gender not expressed). Wrong-gender forms are
//        caught by a separate noneOf check, which neutral phrasings never
//        relax.
//   { id, dimension, type: "noneOf", cue, forms: [...] }  no form occurs (e.g. wrong gender)
//   { id, dimension, type: "sameGroup", cues: [...], groups: { name: [forms] }, allowNeutral? }
//        every cue uses forms of one group, and the same group in all cues
//        (consistency; either group may be right). With allowNeutral, a cue
//        using no group form (gender-neutral phrasing) is accepted and only
//        the gendered cues must agree.
//   { id, dimension, type: "preserve", cue, values: [...] }  every literal value is kept
//   { id, dimension, type: "anyText", cue, values: [...] }   at least one value occurs
//        anywhere (substring; for symbols such as "$" and spelled-out times)
//   { id, dimension, type: "translated", cues: [...] }      translated (not partial / missing)
//
// Form checks accept options:
//   prefixes: "all" (default) | "ו" | "none"  — prefix letters allowed before a form
//   ignoreGeresh: true — ignore geresh/gershayim and quotes (names: ג'ון = גון)
//
// `outputs` maps cue key -> translated text; `untranslated` is a Set of keys.
// A check on a missing or untranslated cue fails.

import { containsForm, containsText, hasHebrew, normalizeHebrew } from "./hebrew.mjs";

export function runCheck(check, outputs, untranslated = new Set()) {
  const text = (key) => (untranslated.has(key) ? undefined : outputs[key]);
  const missing = (keys) => keys.filter((k) => text(k) === undefined);
  const options = { prefixes: check.prefixes ?? "all", ignoreGeresh: check.ignoreGeresh ?? false };
  const has = (t, f) => containsForm(t, f, options);

  switch (check.type) {
    case "anyOf": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      if (check.forms.some((f) => has(t, f))) return { pass: true };
      if ((check.neutral ?? []).some((f) => has(t, f))) return { pass: true, neutral: true };
      return { pass: false, reason: "no accepted form" };
    }
    case "noneOf": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      return check.forms.some((f) => has(t, f)) ? { pass: false, reason: "forbidden form" } : { pass: true };
    }
    case "sameGroup": {
      if (missing(check.cues).length) return { pass: false, reason: "missing" };
      let common = null;
      for (const key of check.cues) {
        const groups = Object.entries(check.groups)
          .filter(([, forms]) => forms.some((f) => has(text(key), f)))
          .map(([name]) => name);
        if (groups.length === 0) {
          if (check.allowNeutral) continue;
          return { pass: false, reason: "no group form" };
        }
        common = common === null ? groups : common.filter((g) => groups.includes(g));
      }
      if (common === null) return { pass: true, group: "neutral", neutral: true };
      return common.length ? { pass: true, group: common.join("|") } : { pass: false, reason: "inconsistent groups" };
    }
    case "preserve": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      const n = normalizeHebrew(t);
      return check.values.every((v) => n.includes(normalizeHebrew(v))) ? { pass: true } : { pass: false, reason: "value lost" };
    }
    case "anyText": {
      const t = text(check.cue);
      if (t === undefined) return { pass: false, reason: "missing" };
      return check.values.some((v) => containsText(t, v)) ? { pass: true } : { pass: false, reason: "value lost" };
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
