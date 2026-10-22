import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reviewLegacyDiffs } from "../../scripts/legacy-diff.mjs";
import { changedCases } from "../../scripts/request-fingerprint.mjs";

describe("reviewLegacyDiffs", () => {
  it("passes when nothing differs and nothing is listed", () => {
    expect(reviewLegacyDiffs("output", [], {})).toEqual({ lines: [], failures: [] });
  });

  it("explains listed differences", () => {
    const r = reviewLegacyDiffs("output", ["a.srt"], { "a.srt": "D1: fixed" });
    expect(r.failures).toEqual([]);
    expect(r.lines).toEqual(["DIFF  output a.srt vs legacy — D1: fixed"]);
  });

  it("fails on an unlisted difference", () => {
    expect(reviewLegacyDiffs("output", ["a.srt"], {}).failures).toEqual(["output a.srt"]);
  });

  it("fails on a stale entry that no longer differs", () => {
    expect(reviewLegacyDiffs("requests", [], { "basic.sfx-on": "D2" }).failures).toEqual(["stale requests basic.sfx-on"]);
  });
});

describe("changedCases", () => {
  const fp = (items: number) => [{ items, sha256: { request: String(items) } }];

  it("lists changed, added and removed cases", () => {
    const legacy = { cases: { a: fp(1), b: fp(2), c: fp(3) } };
    const actual = { cases: { a: fp(1), b: fp(9), d: fp(4) } };
    expect(changedCases(legacy, actual)).toEqual(["b", "c", "d"]);
  });
});

describe("committed fixtures/expected/changes.json", () => {
  it("has a reason for every listed case", () => {
    const changes = JSON.parse(readFileSync("fixtures/expected/changes.json", "utf8"));
    expect(Object.keys(changes).sort()).toEqual(["outputs", "requests"]);
    for (const reason of [...Object.values(changes.outputs), ...Object.values(changes.requests)]) {
      expect(reason).toMatch(/^(D\d+|new)\b/);
    }
  });
});
