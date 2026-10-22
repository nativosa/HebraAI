import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import {
  isDialogueLike,
  removeSoundEffectCues,
  stripHtmlTags,
  stripNonDialogueMarkers,
  toDialogueOnlyCueText,
} from "@/lib/srt/sound-effects";
import { readExpected, readSrtFixture } from "../helpers/fixtures";

describe("stripHtmlTags", () => {
  it("removes tags and keeps their inner text", () => {
    expect(stripHtmlTags("<i>(music)</i>")).toBe("(music)");
    expect(stripHtmlTags('<font color="red">Hi</font> <b>there</b>')).toBe("Hi there");
  });
});

describe("stripNonDialogueMarkers", () => {
  it("removes (...), [...] and ♪...♪ blocks anywhere in the line", () => {
    expect(stripNonDialogueMarkers("[music] Hello (sighs) ♪ la la ♪ world")).toBe(" Hello   world");
  });

  it("removes only up to the first closing parenthesis", () => {
    expect(stripNonDialogueMarkers("(a (b) c)")).toBe(" c)");
  });
});

describe("toDialogueOnlyCueText", () => {
  it("drops lines that are only sound effects", () => {
    expect(toDialogueOnlyCueText("[phone rings]\nWho is it?")).toBe("Who is it?");
  });

  it("collapses whitespace left by removals", () => {
    expect(toDialogueOnlyCueText("Hello   (x)   world")).toBe("Hello world");
  });

  it("returns an empty string when nothing is left", () => {
    expect(toDialogueOnlyCueText("<i>[door slams]</i>")).toBe("");
    expect(toDialogueOnlyCueText("♪ Oh, my love ♪")).toBe("");
  });

  it("LEGACY D7: strips parentheticals inside dialogue and speaker labels", () => {
    expect(toDialogueOnlyCueText("I said (whispers) come here.")).toBe("I said come here.");
    expect(toDialogueOnlyCueText("(Mary) You're late.")).toBe("You're late.");
  });

  it("LEGACY D8: removes formatting tags", () => {
    expect(toDialogueOnlyCueText("<i>Neither did I.</i>")).toBe("Neither did I.");
  });
});

describe("isDialogueLike", () => {
  it("accepts Latin letters, Hebrew letters and digits", () => {
    expect(isDialogueLike("ok")).toBe(true);
    expect(isDialogueLike("שלום")).toBe(true);
    expect(isDialogueLike("42")).toBe(true);
  });

  it("rejects punctuation and symbols only", () => {
    expect(isDialogueLike("... ♪ -- )")).toBe(false);
    expect(isDialogueLike("")).toBe(false);
  });
});

describe("removeSoundEffectCues", () => {
  it("matches the expected output for sfx-mixed.srt (texts, timings, LEGACY D10 numbering gaps)", () => {
    const filtered = removeSoundEffectCues(parseSrt(readSrtFixture("sfx-mixed.srt")).cues);
    // Expected output cues minus the fake translator's prefix; the surviving
    // cues' ids are their input positions, which equal their numbers here.
    const baseline = parseSrt(readExpected("sfx-mixed.sfx-on.srt")).cues.map((c) => ({
      ...c,
      id: c.number!,
      text: c.text.replace(/^\[HE\] /, ""),
    }));
    expect(filtered).toEqual(baseline);
    expect(filtered.map((c) => c.number)).toEqual([4, 5, 7, 8]);
  });

  it("drops a cue whose remainder has no dialogue characters", () => {
    const cue = { id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "(gasps) ... [thud] !" };
    expect(removeSoundEffectCues([cue])).toEqual([]);
  });

  it("keeps the leftover of nested parentheses when it contains letters", () => {
    const cue = { id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "(a (b) c)" };
    expect(removeSoundEffectCues([cue])).toEqual([{ ...cue, text: "c)" }]);
  });

  it("does not modify the input cues", () => {
    const cues = [{ id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "Hi (sighs)" }];
    removeSoundEffectCues(cues);
    expect(cues[0].text).toBe("Hi (sighs)");
  });
});
