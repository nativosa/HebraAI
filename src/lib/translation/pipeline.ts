import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { errorMessage } from "@/lib/errors";
import { buildSrt } from "@/lib/srt/build";
import type { Cue } from "@/lib/srt/parse";
import { buildChunkRequest } from "./prompt";
import { FAILURE_LABELS, type TranslationReport } from "./report";
import { validateChunkResponse, type FailureReason, type ModelResponse } from "./response";

export const CHUNK_SIZE = 60;

// Sends one request to the model; the route passes the OpenAI client here.
export type CreateResponse = (params: ResponseCreateParamsNonStreaming) => Promise<ModelResponse>;

// Events streamed to the browser as NDJSON (one JSON object per line). The
// last event is exactly one of complete (every cue translated), partial (some
// cues translated, the rest kept in English) or error (nothing translated).
export type StreamEvent =
  | { type: "progress"; progress: number; currentChunk: number; totalChunks: number }
  | { type: "complete"; content: string; report: TranslationReport }
  | { type: "partial"; content: string; report: TranslationReport }
  | { type: "error"; message: string; report?: TranslationReport };

// Facts about the input that the final report carries through.
export type TranslateContext = Pick<TranslationReport, "parse" | "removedSoundEffectCues">;

const NO_CONTEXT: TranslateContext = { parse: { recovered: [], unparsed: [] }, removedSoundEffectCues: 0 };

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Translates the cues chunk by chunk (sequentially), yielding a progress event
// after each chunk and then one final event. A request that fails stops the
// job; chunks translated before it are kept.
export async function* translateCues(
  createResponse: CreateResponse,
  cues: Cue[],
  instructions: string,
  context: TranslateContext = NO_CONTEXT
): AsyncGenerator<StreamEvent> {
  const cuesChunks = chunk(cues, CHUNK_SIZE);
  const totalChunks = cuesChunks.length;
  const translations = new Map<number, string>();
  const failed = new Map<number, FailureReason>();
  let failure: string | undefined;

  for (let chunkIndex = 0; chunkIndex < cuesChunks.length; chunkIndex++) {
    const cuesPart = cuesChunks[chunkIndex];
    try {
      const response = await createResponse(buildChunkRequest(instructions, cuesPart));
      const result = validateChunkResponse(cuesPart, response);
      result.translations.forEach((text, id) => translations.set(id, text));
      result.failed.forEach((reason, id) => failed.set(id, reason));
    } catch (error) {
      failure = errorMessage(error);
      for (const c of cuesChunks.slice(chunkIndex).flat()) failed.set(c.id, "request-failed");
      break;
    }

    const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
    yield {
      type: "progress",
      progress,
      currentChunk: chunkIndex + 1,
      totalChunks,
    };
  }

  yield finalEvent(cues, translations, failed, failure, context);
}

function finalEvent(
  cues: Cue[],
  translations: Map<number, string>,
  failed: Map<number, FailureReason>,
  failure: string | undefined,
  context: TranslateContext
): StreamEvent {
  const report: TranslationReport = {
    cues: cues.length,
    translated: translations.size,
    untranslated: cues
      .filter((c) => failed.has(c.id))
      .map((c) => ({ id: c.id, number: c.number, start: c.start, end: c.end, reason: failed.get(c.id)! })),
    ...(failure === undefined ? {} : { failure }),
    ...context,
  };
  if (translations.size === 0) {
    const reason = report.untranslated[0]?.reason;
    const message = failure ?? `No cues were translated: ${reason ? FAILURE_LABELS[reason] : "unknown error"}.`;
    return { type: "error", message, report };
  }
  // Input order; untranslated cues keep their original (English) text.
  const content = buildSrt(cues.map((c) => ({ ...c, text: translations.get(c.id) ?? c.text })));
  return failed.size === 0 ? { type: "complete", content, report } : { type: "partial", content, report };
}
