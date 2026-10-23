import { describe, expect, it } from "vitest";
import { exportName } from "@/lib/review/filename";
import { DEFAULT_PREFS, DEFAULT_SETTINGS, PREFS_KEY, loadPrefs, parsePrefs, savePrefs } from "@/lib/review/prefs";
import { unsavedWarning } from "@/lib/review/unsaved";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("preferences", () => {
  const settings = { ...DEFAULT_SETTINGS, mode: "context" as const, tone: "Formal" as const, maxChars: 35, glossary: "John = ג׳ון" };

  it("round-trips the allowed fields only; story notes are never stored", () => {
    const storage = memoryStorage();
    expect(savePrefs(storage, "dark", { ...settings, notes: "secret plot" }, { bom: true, renumber: false })).toBe(true);
    const stored = storage.data.get(PREFS_KEY)!;
    expect(stored).not.toContain("secret plot");
    expect(Object.keys(JSON.parse(stored).settings).sort()).toEqual(
      ["glossary", "maxChars", "mode", "preserveBreaks", "removeSoundEffects", "tone"]
    );
    expect(loadPrefs(storage)).toEqual({
      theme: "dark",
      settings: { mode: "context", tone: "Formal", preserveBreaks: true, maxChars: 35, glossary: "John = ג׳ון", removeSoundEffects: true },
      export: { bom: true, renumber: false },
    });
  });

  it("drops fields that are not settings", () => {
    const storage = memoryStorage();
    savePrefs(storage, "light", { ...settings, characters: "[...]", file: "x" } as typeof settings, DEFAULT_PREFS.export);
    expect(storage.data.get(PREFS_KEY)).not.toMatch(/characters|file/);
  });

  it("defaults for missing, corrupt or invalid data", () => {
    expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: "{not json" }))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: "[1,2]" }))).toEqual(DEFAULT_PREFS);
    expect(
      parsePrefs({
        theme: "neon",
        settings: { mode: "fast", tone: "formal", preserveBreaks: "yes", maxChars: 500, glossary: "x".repeat(4001), removeSoundEffects: 1 },
        export: { bom: "true", renumber: null },
      })
    ).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ settings: { maxChars: 42.5, preserveBreaks: false } }).settings).toMatchObject({
      maxChars: 42.5,
      preserveBreaks: false,
    });
  });

  it("storage errors are ignored", () => {
    const failing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadPrefs(failing)).toEqual(DEFAULT_PREFS);
    expect(savePrefs(failing, "dark", DEFAULT_SETTINGS, DEFAULT_PREFS.export)).toBe(false);
    expect(savePrefs(undefined, "dark", DEFAULT_SETTINGS, DEFAULT_PREFS.export)).toBe(false);
  });
});

describe("exportName", () => {
  it.each([
    ["Movie.srt", false, "Movie.he.srt"],
    ["Movie.en.srt", false, "Movie.he.srt"],
    ["Show.S01E02.ENG.SRT", false, "Show.S01E02.he.srt"],
    ["Movie.English.srt", true, "Movie.PARTIAL.he.srt"],
    ["The.Men.srt", false, "The.Men.he.srt"],
    ["a:b?.srt", false, "a_b_.he.srt"],
    [".srt", false, "translated.he.srt"],
    ["", true, "translated.PARTIAL.he.srt"],
    [null, false, "translated.he.srt"],
  ])("%j (partial %s) -> %s", (input, partial, expected) => {
    expect(exportName(input, partial)).toBe(expected);
  });
});

describe("unsavedWarning", () => {
  it("only when a result would be lost", () => {
    expect(unsavedWarning({ hasResult: false, hasEdits: false, exported: false })).toBeNull();
    expect(unsavedWarning({ hasResult: true, hasEdits: true, exported: true })).toBeNull();
    expect(unsavedWarning({ hasResult: true, hasEdits: false, exported: false })).toContain("not been downloaded or copied");
    expect(unsavedWarning({ hasResult: true, hasEdits: true, exported: false })).toContain("manual edits");
  });
});
