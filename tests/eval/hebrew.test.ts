import { describe, expect, it } from "vitest";
import { containsForm, hasHebrew, normalizeHebrew } from "../../eval/lib/hebrew.mjs";

describe("normalizeHebrew", () => {
  it("strips niqqud and tags, unifies geresh, maqaf becomes a space", () => {
    expect(normalizeHebrew("וְאַתְּ עֲיֵפָה? <i>ג׳ון</i> בית־ספר")).toBe("ואת עיפה? ג'ון בית ספר");
  });

  it("unifies gershayim and quotes, collapses whitespace, lowercases Latin", () => {
    expect(normalizeHebrew("צה״ל  “OK”\n")).toBe('צה"ל "ok"');
  });

  it("removes direction marks", () => {
    expect(normalizeHebrew(`${String.fromCharCode(0x200f)}שלום${String.fromCharCode(0x200e)}`)).toBe("שלום");
  });
});

describe("containsForm", () => {
  it("matches whole words only", () => {
    expect(containsForm("אני עייפה מאוד", "עייפה")).toBe(true);
    expect(containsForm("אני עייפה מאוד", "עייף")).toBe(false);
    expect(containsForm("הם עייפים", "עייף")).toBe(false);
  });

  it("allows up to four prefix letters", () => {
    expect(containsForm("ועייפה", "עייפה")).toBe(true);
    expect(containsForm("כשאת באה", "את")).toBe(true);
    expect(containsForm("וכשהילד", "ילד")).toBe(true);
  });

  it("matches phrases and simple alternatives", () => {
    expect(containsForm("את באה איתנו?", "את באה")).toBe(true);
    expect(containsForm("אתה בא איתנו?", "(את|אתה) בא")).toBe(true);
    expect(containsForm("אני עיפה", "עי?יפה")).toBe(true);
  });

  it("ignores niqqud, geresh style and tags on both sides", () => {
    expect(containsForm("<i>ג׳ון</i> כאן", "ג'ון")).toBe(true);
    expect(containsForm("אַתְּ", "את")).toBe(true);
  });

  it("matches digits and times as whole tokens", () => {
    expect(containsForm("נפגש ב-7:30", "7:30")).toBe(true);
    expect(containsForm("בשעה 17:30", "7:30")).toBe(false);
  });
});

describe("hasHebrew", () => {
  it("detects Hebrew letters", () => {
    expect(hasHebrew("שלום")).toBe(true);
    expect(hasHebrew("OK 7:30")).toBe(false);
  });
});
