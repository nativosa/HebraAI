import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { createOpenAIClient } from "@/lib/openai-client";
import { buildSrt } from "@/lib/srt/build";
import { parseSrt, type Cue } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { parseTranslateOptions } from "@/lib/translation/options";
import { buildChunkRequest, buildInstructions } from "@/lib/translation/prompt";


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
  const options = parseTranslateOptions(form);
  const { removeSoundEffects } = options;

  // --- Build instructions (dynamic) ---
  const instructions = buildInstructions(options);

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
          const response = await client.responses.create(buildChunkRequest(instructions, cuesPart));

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
