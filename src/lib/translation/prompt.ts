import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Cue } from "@/lib/srt/parse";
import type { Character } from "./characters";
import type { Glossary, TranslateOptions } from "./options";

export function buildInstructions({
  tone,
  maxChars,
  preserveBreaks,
  glossary,
}: Pick<TranslateOptions, "tone" | "maxChars" | "preserveBreaks"> & { glossary?: Glossary }): string {
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

  // Added only when the user supplied a glossary; otherwise the instructions
  // are unchanged.
  if (glossary?.entries.length) {
    instructions +=
      "\n- Use these glossary translations for the listed terms:" +
      glossary.entries.map((e) => `\n  - ${e.term} => ${e.translation}`).join("");
  }

  return instructions;
}

// Context mode: the classic instructions plus Hebrew gender and number rules,
// the optional character sheet and the user's notes about the story.
export function buildContextInstructions(
  options: Pick<TranslateOptions, "tone" | "maxChars" | "preserveBreaks" | "notes"> & { glossary?: Glossary },
  characters: Character[] = []
): string {
  let instructions =
    buildInstructions(options) +
    "\n\nHebrew gender and number:\n" +
    "- First-person forms (verbs, adjectives) follow the speaker's gender; second-person forms and imperatives follow the addressee's gender and number.\n" +
    "- Identify speakers and addressees from speaker labels (e.g. \"MARY:\"), names, forms of address and the neighbouring subtitles.\n" +
    "- Several addressees: plural (masculine plural for mixed or unknown groups, feminine plural only for all-female groups).\n" +
    "- When a gender is unknown, prefer natural gender-neutral phrasing; otherwise use the masculine form. Keep each person's gender consistent.\n" +
    "- Never invent names or genders. Keep the Hebrew spelling of each name consistent.";

  if (characters.length) {
    instructions +=
      "\n\nCharacters (checked by the user; use these genders and Hebrew spellings):" +
      characters
        .map((c) => {
          const hebrew = c.hebrewName ? ` => ${c.hebrewName}` : "";
          const aliases = c.aliases.length ? `; also called ${c.aliases.join(", ")}` : "";
          return `\n- ${c.name}${hebrew} (${c.gender}${aliases})`;
        })
        .join("");
  }
  if (options.notes) {
    instructions += "\n\nNotes about the story from the user (background only, do not translate):\n" + options.notes;
  }
  return instructions;
}

// The Responses API request for one chunk of cues (classic mode).
export function buildChunkRequest(instructions: string, cuesPart: Cue[]): ResponseCreateParamsNonStreaming {
  // The wire key stays "index" (unchanged prompt and schema); it carries the
  // cue's internal id, so cues sharing an SRT number stay distinct.
  const payload = cuesPart.map((c) => ({ index: c.id, text: c.text }));

  return chunkRequest(
    instructions,
    "Translate this JSON array of subtitle items.\n" +
      "Return a JSON object with key 'items' which is an array of {index, text_he}.\n\n" +
      JSON.stringify(payload)
  );
}

// Context mode: the chunk's items plus neighbouring source cues, which are
// sent without ids so they can never be returned as translations.
export function buildContextChunkRequest(
  instructions: string,
  cuesPart: Cue[],
  { before, after }: { before: Cue[]; after: Cue[] }
): ResponseCreateParamsNonStreaming {
  const payload = {
    context_before: before.map((c) => c.text),
    items: cuesPart.map((c) => ({ index: c.id, text: c.text })),
    context_after: after.map((c) => c.text),
  };

  return chunkRequest(
    instructions,
    "Translate the subtitle items in 'items'. 'context_before' and 'context_after' are the neighbouring " +
      "subtitles, for understanding only: do not translate them.\n" +
      "Return a JSON object with key 'items' which is an array of {index, text_he}, one per item.\n\n" +
      JSON.stringify(payload)
  );
}

function chunkRequest(instructions: string, text: string): ResponseCreateParamsNonStreaming {
  return {
    model: "gpt-5.2",
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text,
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
