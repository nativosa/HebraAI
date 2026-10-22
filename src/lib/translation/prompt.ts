import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Cue } from "@/lib/srt/parse";
import type { TranslateOptions } from "./options";

export function buildInstructions({
  tone,
  maxChars,
  preserveBreaks,
}: Pick<TranslateOptions, "tone" | "maxChars" | "preserveBreaks">): string {
  let instructions =
    "Translate English subtitles to natural, fluent Hebrew suitable for on-screen captions.\n" +
    "- Preserve meaning, intent, and tone; do not translate word-for-word if unnatural.\n";

  switch (tone) {
    case "Formal":
      instructions += "- Use formal, polite Hebrew register suitable for professional or official contexts.\n";
      break;
    case "Informal":
      instructions += "- Use informal, natural spoken Hebrew suitable for casual dialogue.\n";
      break;
    default:
      instructions += "- Use neutral conversational Hebrew suitable for everyday speech.\n";
  }

  instructions +=
    "- Translate/transliterate names, places, and brands into common Hebrew forms when appropriate.\n" +
    "- Maintain correct gender and plurality from context.\n" +
    "- Preserve numbers, punctuation, and symbols.\n";

  // FIX: actually append the maxChars instruction
  instructions += `- Keep each subtitle line at or below ${maxChars} characters.\n`;

  if (preserveBreaks) {
    instructions += "- Preserve original line breaks where possible; do not reflow text.\n";
  } else {
    instructions += "- You may reflow lines for readability while respecting the character limit.\n";
  }

  instructions +=
    "- Do NOT add explanations, comments, or extra text.\n" +
    "- Return ONLY valid JSON matching the requested schema.";

  return instructions;
}

// The Responses API request for one chunk of cues.
export function buildChunkRequest(instructions: string, cuesPart: Cue[]): ResponseCreateParamsNonStreaming {
  // The wire key stays "index" (unchanged prompt and schema); it carries the
  // cue's internal id, so cues sharing an SRT number stay distinct.
  const payload = cuesPart.map((c) => ({ index: c.id, text: c.text }));

  return {
    model: "gpt-5.2",
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Translate this JSON array of subtitle items.\n" +
              "Return a JSON object with key 'items' which is an array of {index, text_he}.\n\n" +
              JSON.stringify(payload),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "subtitle_translation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  text_he: { type: "string" },
                },
                required: ["index", "text_he"],
                additionalProperties: false,
              },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    },
  };
}
