import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { buildSrt } from "@/lib/srt/build";
import type { Cue } from "@/lib/srt/parse";
import { buildChunkRequest } from "./prompt";
import { applyChunkTranslation, parseChunkOutput } from "./response";

export const CHUNK_SIZE = 60;

// Sends one request to the model; the route passes the OpenAI client here.
export type CreateResponse = (params: ResponseCreateParamsNonStreaming) => Promise<{ output_text: string }>;

// Events streamed to the browser as NDJSON (one JSON object per line).
export type StreamEvent =
  | { type: "progress"; progress: number; currentChunk: number; totalChunks: number }
  | { type: "complete"; content: string }
  | { type: "error"; message: string; details?: string };

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Translates the cues chunk by chunk (sequentially), yielding a progress event
// after each chunk and finally the complete SRT. Output that is not valid JSON
// yields an error event and stops. Any other failure (API error, unexpected
// response shape) is thrown to the caller.
export async function* translateCues(
  createResponse: CreateResponse,
  cues: Cue[],
  instructions: string
): AsyncGenerator<StreamEvent> {
  const cuesChunks = chunk(cues, CHUNK_SIZE);
  const translated: Cue[] = [];
  const totalChunks = cuesChunks.length;

  for (let chunkIndex = 0; chunkIndex < cuesChunks.length; chunkIndex++) {
    const cuesPart = cuesChunks[chunkIndex];
    const response = await createResponse(buildChunkRequest(instructions, cuesPart));

    const parsed = parseChunkOutput(response.output_text);
    if (!parsed.ok) {
      yield {
        type: "error",
        message: "Model returned invalid JSON (unexpected).",
        details: response.output_text?.slice(0, 500),
      };
      return;
    }

    translated.push(...applyChunkTranslation(cuesPart, parsed.json));

    const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
    yield {
      type: "progress",
      progress,
      currentChunk: chunkIndex + 1,
      totalChunks,
    };
  }

  // Sort translated cues by index to maintain order
  translated.sort((a, b) => a.index - b.index);
  yield {
    type: "complete",
    content: buildSrt(translated),
  };
}
