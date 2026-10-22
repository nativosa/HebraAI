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

  it("removes nested groups completely (innermost first)", () => {
    expect(stripNonDialogueMarkers("(a (b) c)")).toBe("");
    expect(stripNonDialogueMarkers("Hi ([music] la) there")).toBe("Hi  there");
  });

  it("leaves an unmatched bracket as text instead of eating the line", () => {
    expect(stripNonDialogueMarkers("Wait (I mean, now")).toBe("Wait (I mean, now");
    expect(stripNonDialogueMarkers("Go) on (now)")).toBe("Go) on ");
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

  // D7: documented policy (fixtures/KNOWN_DEFECTS.md), unchanged in Stage 2:
  // inline effects, parenthetical speaker labels and lyrics are removed.
  it("D7 (policy): strips parentheticals inside dialogue and speaker labels", () => {
    expect(toDialogueOnlyCueText("I said (whispers) come here.")).toBe("I said come here.");
    expect(toDialogueOnlyCueText("(Mary) You're late.")).toBe("You're late.");
    expect(toDialogueOnlyCueText("♪ Oh, my love ♪")).toBe("");
  });

  it("D8 (fixed): keeps formatting tags around dialogue", () => {
    expect(toDialogueOnlyCueText("<i>Neither did I.</i>")).toBe("<i>Neither did I.</i>");
    expect(toDialogueOnlyCueText("<i>She told me</i> you were\nleaving for good.")).toBe(
      "<i>She told me</i> you were\nleaving for good."
    );
    expect(toDialogueOnlyCueText('<font color="#ff0">(sighs) Fine.</font>')).toBe('<font color="#ff0">Fine.</font>');
  });

  it("removes tags left empty and the space inside them", () => {
    expect(toDialogueOnlyCueText("Hello <i>(sighs)</i> there")).toBe("Hello there");
    expect(toDialogueOnlyCueText("<i>(whispers) Come here</i>")).toBe("<i>Come here</i>");
    expect(toDialogueOnlyCueText("<b><i>[thud]</i></b>")).toBe("");
  });

  it("moves the tags of a removed line to the neighbouring line", () => {
    expect(toDialogueOnlyCueText("<i>[music]\nHello</i>")).toBe("<i>Hello</i>");
    expect(toDialogueOnlyCueText("<i>Hello\n[music]</i>")).toBe("<i>Hello</i>");
    expect(toDialogueOnlyCueText("<i>[music]\nHello\n[thud]</i>")).toBe("<i>Hello</i>");
  });

  it("does not treat '<' in dialogue as a tag", () => {
    expect(toDialogueOnlyCueText("I <3 you (laughs)")).toBe("I <3 you");
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

  it("drops a cue that is one nested annotation", () => {
    const cue = { id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "(a (b) c)" };
    expect(removeSoundEffectCues([cue])).toEqual([]);
  });

  it("drops a cue whose remainder is only formatting tags", () => {
    const cue = { id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "<i>[door slams]</i>" };
    expect(removeSoundEffectCues([cue])).toEqual([]);
  });

  it("does not modify the input cues", () => {
    const cues = [{ id: 1, number: 1, start: "00:00:01,000", end: "00:00:02,000", text: "Hi (sighs)" }];
    removeSoundEffectCues(cues);
    expect(cues[0].text).toBe("Hi (sighs)");
  });
});
