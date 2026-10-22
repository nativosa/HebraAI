import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { createOpenAIClient } from "@/lib/openai-client";
import { buildSrt } from "@/lib/srt/build";
import { parseSrt, type Cue } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";


export const runtime = "nodejs"; // ensure Node runtime (not Edge) for SDK compatibility

const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024; // 0.5 MB

function getMaxFileSizeBytes(): number {
  const n = Number(process.env.MAX_FILE_SIZE_BYTES);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_FILE_SIZE_BYTES;
}

const client = createOpenAIClient();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const form = await req.formData();

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected form-data field 'file' (SRT)" },
      { status: 400 }
    );
  }

  const maxFileSizeBytes = getMaxFileSizeBytes();
  if (file.size > maxFileSizeBytes) {
    return NextResponse.json(
      {
        error: "File too large",
        maxBytes: maxFileSizeBytes,
        receivedBytes: file.size,
      },
      { status: 413 }
    );
  }

  // --- Inputs (sanitize) ---
  const toneRaw = (form.get("tone") as string) || "Neutral";
  const tone = (toneRaw === "Formal" || toneRaw === "Informal" || toneRaw === "Neutral")
    ? toneRaw
    : "Neutral";

  const removeSoundEffects = form.get("removeSoundEffects") === "true";
  const preserveBreaks = form.get("preserveBreaks") === "true";

  const maxCharsRaw = Number(form.get("maxChars"));
  const maxChars = Number.isFinite(maxCharsRaw)
    ? Math.min(Math.max(maxCharsRaw, 20), 80)
    : 42;

  // --- Build instructions (dynamic) ---
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

  // --- Parse SRT ---
  const srtText = await file.text();
  const cues = parseSrt(srtText);

  if (cues.length === 0) {
    return NextResponse.json(
      { error: "Could not parse SRT (0 cues found)" },
      { status: 400 }
    );
  }

  // --- Filter cues ---
  let filteredCues = cues;

  if (removeSoundEffects) {
    filteredCues = removeSoundEffectCues(filteredCues);
  }

  if (filteredCues.length === 0) {
    return NextResponse.json(
      { error: "All cues were filtered out (check sound-effect rules)" },
      { status: 400 }
    );
  }

  // --- Chunking ---
  const cuesChunks = chunk(filteredCues, 60);

  // --- Translation loop with streaming progress ---
  const translated: Cue[] = [];
  const totalChunks = cuesChunks.length;
  
  // Create a readable stream for the translation
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let chunkIndex = 0; chunkIndex < cuesChunks.length; chunkIndex++) {
          const cuesPart = cuesChunks[chunkIndex];
          const payload = cuesPart.map((c) => ({ index: c.index, text: c.text }));

          const response = await client.responses.create({
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
          });

          let json: { items: { index: number; text_he: string }[] };
          try {
            json = JSON.parse(response.output_text);
          } catch {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "error",
                  message: "Model returned invalid JSON (unexpected).",
                  details: response.output_text?.slice(0, 500),
                }) + "\n"
              )
            );
            controller.close();
            return;
          }

          const map = new Map<number, string>(json.items.map((x) => [x.index, x.text_he]));

          for (const c of cuesPart) {
            const he = map.get(c.index);
            translated.push({
              ...c,
              text: (he ?? c.text).trim(),
            });
          }
          
          // Send progress update
          const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "progress",
                progress,
                currentChunk: chunkIndex + 1,
                totalChunks,
              }) + "\n"
            )
          );
        }

        // Sort translated cues by index to maintain order
        translated.sort((a, b) => a.index - b.index);
        const outSrt = buildSrt(translated);

        // Send final SRT content
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "complete",
              content: outSrt,
            }) + "\n"
          )
        );
        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "error",
              message: errorMessage(error),
            }) + "\n"
          )
        );
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
