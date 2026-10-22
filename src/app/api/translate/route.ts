import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { createOpenAIClient } from "@/lib/openai-client";
import { parseSrt } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { parseTranslateOptions } from "@/lib/translation/options";
import { type StreamEvent, translateCues } from "@/lib/translation/pipeline";
import { buildInstructions } from "@/lib/translation/prompt";


export const runtime = "nodejs"; // ensure Node runtime (not Edge) for SDK compatibility

const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024; // 0.5 MB

function getMaxFileSizeBytes(): number {
  const n = Number(process.env.MAX_FILE_SIZE_BYTES);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_FILE_SIZE_BYTES;
}

const client = createOpenAIClient();

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

  // --- Translation with streaming progress (NDJSON) ---
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        for await (const event of translateCues((p) => client.responses.create(p), filteredCues, instructions)) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: errorMessage(error) });
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
