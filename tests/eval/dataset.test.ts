import { describe, expect, it } from "vitest";
import { CATEGORIES, loadCases } from "../../eval/lib/cases.mjs";
import { HEBREW_LETTERS, containsForm } from "../../eval/lib/hebrew.mjs";
import { buildRequest } from "../../eval/lib/request.mjs";
import { scoreCase } from "../../eval/lib/score.mjs";

// The synthetic dataset validates itself: every case's hand-written reference
// must pass all of its checks, and its deliberately wrong output must fail
// exactly the checks listed in wrongFails. This catches broken forms and
// checks without any API call.
const cases = loadCases("eval/cases/synthetic");

const MINIMUM: Record<string, number> = {
  "speaker-gender": 14,
  "addressee-gender": 14,
  "plural-group": 10,
  "speaker-addressee": 8,
  ambiguous: 8,
  "alternating-unlabeled": 6,
  names: 8,
  "cross-chunk": 8,
  "sdh-labels": 4,
  meaning: 6,
};

const failing = (c: (typeof cases)[number], outputs: Record<string, string>) =>
  scoreCase(c, { status: "complete", outputs })
    .checks.filter((x: { pass: boolean }) => !x.pass)
    .map((x: { id: string }) => x.id)
    .sort();

describe("synthetic evaluation dataset", () => {
  it("has 80+ cases covering every category", () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    for (const category of CATEGORIES) {
      expect(cases.filter((c) => c.category === category).length, category).toBeGreaterThanOrEqual(MINIMUM[category]);
    }
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s: reference passes, wrong fails exactly wrongFails", (_id, c) => {
    expect(failing(c, c.reference)).toEqual([]);
    expect(failing(c, c.wrong)).toEqual([...c.wrongFails].sort());
  });

  it.each(cases.filter((c) => c.accepted).map((c) => [c.id, c] as const))("%s: every accepted alternative passes", (_id, c) => {
    for (const outputs of c.accepted) expect(failing(c, outputs)).toEqual([]);
  });

  it("every neutral alternative is exercised by an accepted output", () => {
    for (const c of cases) {
      for (const check of c.checks.filter((k: { neutral?: string[] }) => k.neutral)) {
        const viaNeutral = (c.accepted ?? []).some((outputs: Record<string, string>) =>
          scoreCase(c, { status: "complete", outputs }).checks.some((r: { id: string; neutral?: boolean }) => r.id === check.id && r.neutral)
        );
        expect(viaNeutral, `${c.id} ${check.id}`).toBe(true);
      }
    }
  });

  it("neutral alternatives contain no form forbidden for the same cue", () => {
    for (const c of cases) {
      for (const any of c.checks.filter((k: { neutral?: string[] }) => k.neutral)) {
        for (const none of c.checks.filter((k: { type: string; cue?: string }) => k.type === "noneOf" && k.cue === any.cue)) {
          for (const n of any.neutral) {
            for (const f of none.forms) expect(containsForm(n, f, { prefixes: none.prefixes ?? "all" }), `${c.id}: ${n} / ${f}`).toBe(false);
          }
        }
      }
    }
  });

  it("classic and context requests carry no Hebrew except the user's glossary", () => {
    const hebrew = new RegExp(`[${HEBREW_LETTERS}]`);
    for (const c of cases) {
      for (const mode of ["classic", "context", "context+chars"]) {
        const { fields, srt } = buildRequest(c, mode);
        const sent = JSON.stringify({ ...fields, glossary: "" }) + srt;
        expect(hebrew.test(sent), `${c.id} ${mode}`).toBe(false);
      }
    }
  });

  it("oracle requests add only verified character facts", () => {
    for (const c of cases.filter((x) => x.oracle)) {
      const sheet = JSON.parse(buildRequest(c, "context+oracle").fields.characters);
      for (const ch of sheet) expect(Object.keys(ch).sort()).toEqual(expect.arrayContaining(["aliases", "gender", "name"]));
      const sent = JSON.stringify(sheet);
      for (const text of [...Object.values(c.reference), ...Object.values(c.wrong)] as string[]) {
        expect(sent.includes(text), c.id).toBe(false);
      }
    }
  });

  it("cross-chunk targets start a later 60-cue chunk than their evidence", () => {
    for (const c of cases.filter((x) => x.category === "cross-chunk")) {
      const targets = Object.values(c.numberByKey) as number[];
      expect(Math.min(...targets), c.id).toBeGreaterThan(60);
      const evidence = c.expandedCues.filter((x: { number: number; key?: string; text: string }) => !x.key && x.number <= 60 && x.number > 50);
      expect(evidence.length, c.id).toBeGreaterThan(0);
    }
  });

  it("alternating unlabeled dialogue never assigns speakers", () => {
    for (const c of cases.filter((x) => x.category === "alternating-unlabeled")) {
      expect(c.checks.some((k: { dimension: string }) => k.dimension === "attribution"), c.id).toBe(true);
      const unlabeled = c.expandedCues.filter((x: { key?: string }) => x.key);
      for (const cue of unlabeled) expect(cue.text, c.id).not.toMatch(/^[A-Z][A-Z .']+:|^\(/);
    }
  });
});
