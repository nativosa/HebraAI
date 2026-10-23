import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { createOpenAIClient } from "@/lib/openai-client";
import { getMaxFileSizeBytes, getPrices } from "@/lib/server-env";
import { parseSrt } from "@/lib/srt/parse";
import { analyzeCharacters, notesError } from "@/lib/translation/characters";
import { formText } from "@/lib/translation/options";

export const runtime = "nodejs";

const client = createOpenAIClient();

// Optional character analysis before a context-mode translation: one request
// over the subtitle text (sound-effect lines and speaker labels included, as
// they are evidence). Returns the sheet for the user to review.
export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected form-data field 'file' (SRT)" }, { status: 400 });
  }
  const maxFileSizeBytes = getMaxFileSizeBytes();
  if (file.size > maxFileSizeBytes) {
    return NextResponse.json(
      { error: "File too large", maxBytes: maxFileSizeBytes, receivedBytes: file.size },
      { status: 413 }
    );
  }

  const notes = formText(form, "notes").trim();
  const error = notesError(notes);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const cues = parseSrt(await file.text()).cues;
  if (cues.length === 0) {
    return NextResponse.json({ error: "Could not parse SRT (0 cues found)" }, { status: 400 });
  }

  // The browser disconnecting aborts the request in flight.
  try {
    const createResponse = (p: ResponseCreateParamsNonStreaming, o: { signal?: AbortSignal }) => client.responses.create(p, o);
    const result = await analyzeCharacters(createResponse, cues, notes, { signal: req.signal, prices: getPrices() });
    return NextResponse.json(result);
  } catch (err) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
