import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt/parse";
import { parseTranslateOptions } from "@/lib/translation/options";
import { buildChunkRequest, buildInstructions } from "@/lib/translation/prompt";
import { readGolden, readSrtFixture } from "../helpers/fixtures";

// Expected values were captured from the running app before the refactor
// (scripts/capture-golden.mjs), not derived from the implementation.
const golden = readGolden() as {
  prompts: { name: string; fields: Record<string, string>; instructions: string }[];
  request: { fixture: string; fields: Record<string, string>; body: unknown };
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("buildInstructions (golden)", () => {
  it("covers every captured option combination", () => {
    expect(golden.prompts.map((p) => p.name)).toEqual([
      "neutral.breaks-on",
      "neutral.breaks-off",
      "formal.breaks-on",
      "formal.breaks-off",
      "informal.breaks-on",
      "informal.breaks-off",
      "unknown-tone",
      "maxchars-missing",
      "maxchars-nan",
      "maxchars-low",
      "maxchars-high",
      "maxchars-fraction",
    ]);
  });

  it.each(golden.prompts.map((p) => [p.name, p] as const))("%s", (_name, p) => {
    expect(buildInstructions(parseTranslateOptions(form(p.fields)))).toBe(p.instructions);
  });
});

describe("buildChunkRequest (golden)", () => {
  const { fixture, fields, body } = golden.request;
  const request = buildChunkRequest(
    buildInstructions(parseTranslateOptions(form(fields))),
    parseSrt(readSrtFixture(fixture))
  );

  it("equals the request body the app sent for basic.srt", () => {
    expect(request).toEqual(body);
  });

  it("serializes with the same key order", () => {
    expect(JSON.stringify(request)).toBe(JSON.stringify(body));
  });
});

describe("buildChunkRequest", () => {
  const cues = [
    { index: 3, start: "00:00:01,000", end: "00:00:02,000", text: "Line one\nline two" },
    { index: 9, start: "00:00:03,000", end: "00:00:04,000", text: 'Say "hi"' },
  ];

  it("sends only index and text of each cue, in order, after a blank line", () => {
    const request = buildChunkRequest("instr", cues);
    const content = (request.input as { content: { text: string }[] }[])[0].content[0].text;
    const [, json] = content.split("\n\n");
    expect(JSON.parse(json)).toEqual([
      { index: 3, text: "Line one\nline two" },
      { index: 9, text: 'Say "hi"' },
    ]);
    expect(request.instructions).toBe("instr");
  });

  it("does not modify the cues", () => {
    const copy = structuredClone(cues);
    buildChunkRequest("instr", cues);
    expect(cues).toEqual(copy);
  });
});
