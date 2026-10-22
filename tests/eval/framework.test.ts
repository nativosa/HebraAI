import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { caseToSrt, expandCase, validateCases } from "../../eval/lib/cases.mjs";
import { runCheck } from "../../eval/lib/checks.mjs";
import { buildRunReport, compareMarkdown, runMarkdown } from "../../eval/lib/report.mjs";
import { buildRequest, oracleCharacters } from "../../eval/lib/request.mjs";
import { compareRuns, scoreCase, summarize } from "../../eval/lib/score.mjs";

const base = {
  id: "t-1",
  category: "speaker-gender",
  description: "test",
  cues: [{ text: "Dana, you look exhausted." }, { key: "a", text: "I'm tired." }],
  checks: [{ id: "fem", dimension: "speaker-gender", type: "anyOf", cue: "a", forms: ["עייפה"] }],
  reference: { a: "אני עייפה." },
  wrong: { a: "אני עייף." },
  wrongFails: ["fem"],
};

describe("runCheck", () => {
  const out = { a: "אני עייפה, תודה.", b: "את באה ב-7:30?", c: "אתה בא?" };

  it("anyOf / noneOf", () => {
    expect(runCheck({ type: "anyOf", cue: "a", forms: ["עייף", "עייפה"] }, out)).toEqual({ pass: true });
    expect(runCheck({ type: "anyOf", cue: "a", forms: ["עייף"] }, out)).toEqual({ pass: false, reason: "no accepted form" });
    expect(runCheck({ type: "noneOf", cue: "a", forms: ["עייף"] }, out)).toEqual({ pass: true });
    expect(runCheck({ type: "noneOf", cue: "a", forms: ["עייפה"] }, out)).toEqual({ pass: false, reason: "forbidden form" });
  });

  it("sameGroup requires one shared group across cues", () => {
    const groups = { fem: ["את באה"], masc: ["אתה בא"] };
    expect(runCheck({ type: "sameGroup", cues: ["b", "b"], groups }, out)).toEqual({ pass: true, group: "fem" });
    expect(runCheck({ type: "sameGroup", cues: ["b", "c"], groups }, out)).toEqual({ pass: false, reason: "inconsistent groups" });
    expect(runCheck({ type: "sameGroup", cues: ["a"], groups }, out)).toEqual({ pass: false, reason: "no group form" });
  });

  it("preserve and translated", () => {
    expect(runCheck({ type: "preserve", cue: "b", values: ["7:30"] }, out)).toEqual({ pass: true });
    expect(runCheck({ type: "preserve", cue: "b", values: ["8:30"] }, out)).toEqual({ pass: false, reason: "value lost" });
    expect(runCheck({ type: "translated", cues: ["a", "b"] }, out)).toEqual({ pass: true });
    expect(runCheck({ type: "translated", cue: "x" }, { x: "OK" })).toEqual({ pass: false, reason: "no Hebrew" });
  });

  it("fails every check type on a missing or untranslated cue", () => {
    for (const check of [
      { type: "anyOf", cue: "a", forms: ["עייפה"] },
      { type: "noneOf", cue: "a", forms: ["עייף"] },
      { type: "sameGroup", cues: ["a"], groups: { g: ["עייפה"] } },
      { type: "preserve", cue: "a", values: [] },
      { type: "translated", cues: ["a"] },
    ]) {
      expect(runCheck(check, out, new Set(["a"]))).toEqual({ pass: false, reason: "missing" });
      expect(runCheck(check, {})).toEqual({ pass: false, reason: "missing" });
    }
  });
});

describe("validateCases", () => {
  it("accepts a valid case", () => {
    expect(validateCases([base])).toEqual([]);
  });

  it.each([
    ["unknown category", { category: "x" }, "unknown category x"],
    ["unknown setting", { settings: { model: "gpt-4" } }, "unknown setting model"],
    ["unknown input", { input: { characters: [] } }, "unknown input characters"],
    ["oracle speaker field", { oracle: { characters: [{ name: "Dana", gender: "female", speaks: ["a"] }] } }, "oracle character field speaks not allowed"],
    ["oracle gender", { oracle: { characters: [{ name: "Dana", gender: "f" }] } }, "gender f"],
    ["unknown key", { checks: [{ id: "x", dimension: "names", type: "anyOf", cue: "zz", forms: ["א"] }], wrongFails: ["x"] }, "unknown cue key zz"],
    ["invalid form", { checks: [{ id: "x", dimension: "names", type: "anyOf", cue: "a", forms: ["(("] }], wrongFails: ["x"] }, "invalid form"],
    ["unknown dimension", { checks: [{ id: "x", dimension: "style", type: "anyOf", cue: "a", forms: ["א"] }], wrongFails: ["x"] }, "unknown dimension"],
    ["wrongFails unknown", { wrongFails: ["nope"] }, "wrongFails: unknown check nope"],
    ["no wrong", { wrong: undefined }, "no wrong output"],
  ])("rejects %s", (_label, patch, message) => {
    expect(validateCases([{ ...base, ...patch }]).join("\n")).toContain(message);
  });

  it("rejects duplicate case ids", () => {
    expect(validateCases([base, base]).join("\n")).toContain("duplicate id");
  });
});

describe("expandCase / caseToSrt", () => {
  const c = expandCase({ ...base, cues: [{ text: "A" }, { filler: 3 }, { key: "a", text: "B", gapBefore: 20 }] });

  it("numbers cues after expanding fillers and maps keys", () => {
    expect(c.expandedCues.map((x: { number: number }) => x.number)).toEqual([1, 2, 3, 4, 5]);
    expect(c.numberByKey).toEqual({ a: 5 });
  });

  it("produces SRT the app parses without irregularities, with the scene gap", () => {
    const parsed = parseSrt(caseToSrt(c));
    expect(parsed.recovered).toEqual([]);
    expect(parsed.unparsed).toEqual([]);
    expect(parsed.cues.map((x) => x.number)).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.cues[3].start).toBe("00:00:10,000");
    expect(parsed.cues[4].start).toBe("00:00:33,000");
  });
});

describe("buildRequest", () => {
  const oracle = { ...base, oracle: { characters: [{ name: "Dana", gender: "female", hebrewName: "דנה" }] } };

  it("classic sends only settings, glossary and the SRT", () => {
    const r = buildRequest(expandCase(oracle), "classic");
    expect(Object.keys(r.fields).sort()).toEqual(["glossary", "maxChars", "preserveBreaks", "removeSoundEffects", "tone"]);
    expect(r.fields.removeSoundEffects).toBe("false");
  });

  it("only the oracle mode carries verified character facts", () => {
    expect(buildRequest(expandCase(oracle), "context").fields).not.toHaveProperty("characters");
    expect(buildRequest(expandCase(oracle), "context+chars").fields).not.toHaveProperty("characters");
    expect(JSON.parse(buildRequest(expandCase(oracle), "context+oracle").fields.characters)).toEqual([
      { name: "Dana", gender: "female", aliases: [], hebrewName: "דנה" },
    ]);
  });

  it("never includes references, wrong outputs or checks", () => {
    for (const mode of ["classic", "context", "context+chars", "context+oracle"]) {
      const sent = JSON.stringify(buildRequest(expandCase(oracle), mode));
      for (const secret of ["אני עייפה.", "אני עייף.", "עייפה", "wrongFails", "reference"]) expect(sent).not.toContain(secret);
    }
  });

  it("whitelists oracle character fields", () => {
    const sneaky = { ...base, oracle: { characters: [{ name: "Dana", gender: "female", note: "speaks cue 2" }] } };
    expect(oracleCharacters(sneaky)).toEqual([{ name: "Dana", gender: "female", aliases: [] }]);
  });

  it("rejects unknown modes", () => {
    expect(() => buildRequest(expandCase(base), "magic")).toThrow("unknown mode");
  });
});

describe("scoring and reports", () => {
  const c = expandCase(base);
  const pass = scoreCase(c, { status: "complete", outputs: { a: "אני עייפה" }, metrics: { requests: 1, inputTokens: 10, outputTokens: 5, elapsedMs: 100, estimatedCostUsd: 0.001 } });
  const fail = scoreCase({ ...c, id: "t-2" }, { status: "partial", outputs: {}, untranslated: ["a"], metrics: { requests: 2, inputTokens: 20, outputTokens: 0, elapsedMs: 50 } });

  it("scores a case as passed only when every check passes", () => {
    expect(pass).toMatchObject({ caseId: "t-1", pass: true, checks: [{ id: "fem", pass: true }] });
    expect(fail).toMatchObject({ caseId: "t-2", pass: false, checks: [{ id: "fem", pass: false, reason: "missing" }] });
  });

  it("summarizes rates and metrics per category and dimension", () => {
    expect(summarize([pass, fail])).toEqual({
      cases: { passed: 1, total: 2, rate: 0.5 },
      checks: { passed: 1, total: 2, rate: 0.5 },
      byCategory: { "speaker-gender": { passed: 1, total: 2, rate: 0.5 } },
      byDimension: { "speaker-gender": { passed: 1, total: 2, rate: 0.5 } },
      statuses: { complete: 1, partial: 1 },
      metrics: { requests: 3, inputTokens: 30, outputTokens: 5, elapsedMs: 150, estimatedCostUsd: 0.001 },
    });
  });

  it("lists regressions and improvements by case id", () => {
    const passT2 = { ...fail, pass: true };
    const failT1 = { ...pass, pass: false };
    const cmp = compareRuns({ label: "classic", scores: [pass, fail] }, { label: "context", scores: [failT1, passT2] });
    expect(cmp.regressions).toEqual(["t-1"]);
    expect(cmp.improvements).toEqual(["t-2"]);
  });

  it("reports contain no subtitle or model text", () => {
    const report = buildRunReport({ label: "x", mode: "classic", dataset: "synthetic", scores: [pass, fail] });
    const all = JSON.stringify(report) + runMarkdown(report) + compareMarkdown(report, report);
    for (const text of ["אני עייפה", "I'm tired", "Dana, you look"]) expect(all).not.toContain(text);
  });
});

describe("runCheck: sameGroup with allowNeutral", () => {
  const groups = { m: ["עייף"], f: ["עייפה"] };
  const check = { type: "sameGroup", cues: ["a", "b", "c"], groups, allowNeutral: true };

  it("accepts neutral cues and requires the gendered ones to agree", () => {
    expect(runCheck(check, { a: "אני עייפה", b: "אין לי כוח", c: "ועדיין עייפה" })).toEqual({ pass: true, group: "f" });
    expect(runCheck(check, { a: "אני עייפה", b: "אין לי כוח", c: "אני עייף" })).toEqual({ pass: false, reason: "inconsistent groups" });
  });

  it("passes when every cue is neutral", () => {
    expect(runCheck(check, { a: "אין לי כוח", b: "די", c: "נמאס" })).toEqual({ pass: true, group: "neutral" });
  });

  it("still fails on missing cues", () => {
    expect(runCheck(check, { a: "אין לי כוח" })).toEqual({ pass: false, reason: "missing" });
  });
});
