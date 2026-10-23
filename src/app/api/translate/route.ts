import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { createOpenAIClient } from "@/lib/openai-client";
import { parseSrt } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { notesError, parseCharacters, type Character } from "@/lib/translation/characters";
import { formText, glossaryLimitError, parseTranslateOptions } from "@/lib/translation/options";
import { type StreamEvent, translateCues } from "@/lib/translation/pipeline";
import { buildContextInstructions, buildInstructions } from "@/lib/translation/prompt";
import { getMaxAttemptsPerChunk, getMaxFileSizeBytes, getPrices } from "@/lib/server-env";


export const runtime = "nodejs"; // ensure Node runtime (not Edge) for SDK compatibility

// Context mode: source cues sent before and after each chunk (read-only).
const CONTEXT_WINDOW = { before: 8, after: 4 };

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
  const { mode, removeSoundEffects, glossary } = options;

  const glossaryRaw = form.get("glossary");
  const glossaryError = glossaryLimitError(typeof glossaryRaw === "string" ? glossaryRaw : "", glossary);
  if (glossaryError) {
    return NextResponse.json({ error: glossaryError }, { status: 400 });
  }

  // Context mode: the reviewed character sheet and the notes.
  let characters: Character[] = [];
  if (options.mode === "context") {
    const sheet = parseCharacters(formText(form, "characters"));
    const inputError = "error" in sheet ? sheet.error : notesError(options.notes);
    if (inputError) {
      return NextResponse.json({ error: inputError }, { status: 400 });
    }
    characters = (sheet as { characters: Character[] }).characters;
  }

  // --- Build instructions (dynamic) ---
  const instructions =
    options.mode === "context" ? buildContextInstructions(options, characters) : buildInstructions(options);

  // --- Parse SRT ---
  const srtText = await file.text();
  const parsed = parseSrt(srtText);
  const cues = parsed.cues;

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

  // --- Cancellation: the browser disconnecting (req.signal) or cancelling the
  // response stream stops the job and aborts the OpenAI request in flight ---
  const abort = new AbortController();
  if (req.signal.aborted) abort.abort();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  // --- Translation with streaming progress (NDJSON) ---
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const context = {
          parse: { recovered: parsed.recovered, unparsed: parsed.unparsed },
          removedSoundEffectCues: cues.length - filteredCues.length,
          glossary: { entries: glossary.entries.length, ignoredLines: glossary.ignoredLines },
        };
        const options = {
          context,
          ...(mode === "context" ? { contextWindow: CONTEXT_WINDOW } : {}),
          maxAttemptsPerChunk: getMaxAttemptsPerChunk(),
          signal: abort.signal,
          prices: getPrices(),
        };
        const createResponse = (p: ResponseCreateParamsNonStreaming, o: { signal?: AbortSignal }) => client.responses.create(p, o);
        for await (const event of translateCues(createResponse, filteredCues, instructions, options)) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: errorMessage(error) });
      }
      if (!abort.signal.aborted) controller.close();
    },
    cancel() {
      abort.abort();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
