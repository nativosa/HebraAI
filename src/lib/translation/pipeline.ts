import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { errorMessage } from "@/lib/errors";
import { buildSrt } from "@/lib/srt/build";
import type { Cue } from "@/lib/srt/parse";
import { buildChunkRequest } from "./prompt";
import { FAILURE_LABELS, type TranslationReport } from "./report";
import { REPAIRABLE, validateChunkResponse, type FailureReason, type ModelResponse } from "./response";
import { MAX_RETRIES_PER_REQUEST, decideRetry, sleep as defaultSleep } from "./retry";

export const CHUNK_SIZE = 60;

// Default limit on API requests per chunk: the first request, repairs and
// (transient-error) retries all count.
export const DEFAULT_MAX_ATTEMPTS_PER_CHUNK = 6;

// Sends one request to the model; the route passes the OpenAI client here.
// Aborting the signal must abort the request.
export type CreateResponse = (
  params: ResponseCreateParamsNonStreaming,
  options: { signal?: AbortSignal }
) => Promise<ModelResponse>;

// Events streamed to the browser as NDJSON (one JSON object per line). The
// last event is exactly one of complete (every cue translated), partial (some
// cues translated, the rest kept in English) or error (nothing translated) —
// unless the job is cancelled, which ends it without a final event.
export type StreamEvent =
  | { type: "progress"; progress: number; currentChunk: number; totalChunks: number }
  // A request failed temporarily and will be repeated after delayMs.
  | { type: "retry"; chunk: number; attempt: number; delayMs: number; reason: string }
  | { type: "complete"; content: string; report: TranslationReport }
  | { type: "partial"; content: string; report: TranslationReport }
  | { type: "error"; message: string; report?: TranslationReport };

// Facts about the input that the final report carries through.
export type TranslateContext = Pick<TranslationReport, "parse" | "removedSoundEffectCues">;

export type TranslateOptions = {
  context?: TranslateContext;
  maxAttemptsPerChunk?: number;
  // Cancels the job: no further chunks, requests, retries or repairs; the
  // request in flight is aborted.
  signal?: AbortSignal;
  // Injected in tests for deterministic retries.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

// Thrown inside the job once its signal is aborted.
class Cancelled extends Error {}

const NO_CONTEXT: TranslateContext = { parse: { recovered: [], unparsed: [] }, removedSoundEffectCues: 0 };

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Failures that make the whole answer unusable (rather than single cues).
const WHOLE_ANSWER_FAILURES: ReadonlySet<FailureReason> = new Set(["invalid-json", "invalid-shape", "incomplete"]);

// Shared state of one translation job.
type Job = {
  createResponse: CreateResponse;
  instructions: string;
  maxAttempts: number;
  signal?: AbortSignal;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
  translations: Map<number, string>;
  failed: Map<number, FailureReason>;
  requests: number;
  repairs: number;
  retries: number;
};

// Translates the cues chunk by chunk (sequentially), yielding a progress event
// after each chunk and then one final event. A request that fails stops the
// job; chunks translated before it are kept.
export async function* translateCues(
  createResponse: CreateResponse,
  cues: Cue[],
  instructions: string,
  {
    context = NO_CONTEXT,
    maxAttemptsPerChunk = DEFAULT_MAX_ATTEMPTS_PER_CHUNK,
    signal,
    sleep = defaultSleep,
    random = Math.random,
  }: TranslateOptions = {}
): AsyncGenerator<StreamEvent> {
  const cuesChunks = chunk(cues, CHUNK_SIZE);
  const totalChunks = cuesChunks.length;
  const job: Job = {
    createResponse,
    instructions,
    maxAttempts: maxAttemptsPerChunk,
    signal,
    sleep,
    random,
    translations: new Map(),
    failed: new Map(),
    requests: 0,
    repairs: 0,
    retries: 0,
  };
  let failure: string | undefined;

  for (let chunkIndex = 0; chunkIndex < cuesChunks.length; chunkIndex++) {
    if (signal?.aborted) return;
    try {
      yield* translateChunk(job, cuesChunks[chunkIndex], chunkIndex + 1);
    } catch (error) {
      if (error instanceof Cancelled || signal?.aborted) return;
      failure = errorMessage(error);
      for (const c of cuesChunks.slice(chunkIndex).flat()) {
        if (!job.translations.has(c.id) && !job.failed.has(c.id)) job.failed.set(c.id, "request-failed");
      }
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

  if (signal?.aborted) return;
  yield finalEvent(cues, job, failure, context);
}

// One chunk: a request for all its cues, then (budget permitting) one repair
// round for cues with technical or structural failures. Refusals and
// content-filter results are never repaired. Every request, including
// retries after temporary errors, counts against the chunk's budget. A
// request that still fails is thrown.
async function* translateChunk(job: Job, cues: Cue[], chunkNumber: number): AsyncGenerator<StreamEvent> {
  let budget = job.maxAttempts;

  async function* send(subset: Cue[]): AsyncGenerator<StreamEvent> {
    const params = buildChunkRequest(job.instructions, subset);
    for (let retry = 1; ; retry++) {
      if (job.signal?.aborted) throw new Cancelled();
      budget--;
      job.requests++;
      let response: ModelResponse;
      try {
        response = await job.createResponse(params, { signal: job.signal });
      } catch (error) {
        if (job.signal?.aborted) throw new Cancelled();
        const decision = decideRetry(error, retry, job.random);
        if (!decision.retry || retry > MAX_RETRIES_PER_REQUEST || budget < 1) throw error;
        job.retries++;
        yield { type: "retry", chunk: chunkNumber, attempt: retry, delayMs: decision.delayMs, reason: decision.reason };
        try {
          await job.sleep(decision.delayMs, job.signal);
        } catch {
          throw new Cancelled();
        }
        continue;
      }
      if (job.signal?.aborted) throw new Cancelled();
      const result = validateChunkResponse(subset, response);
      result.translations.forEach((text, id) => {
        job.translations.set(id, text);
        job.failed.delete(id);
      });
      result.failed.forEach((reason, id) => job.failed.set(id, reason));
      return;
    }
  }

  if (budget < 1) {
    for (const c of cues) job.failed.set(c.id, "request-failed");
    return;
  }
  yield* send(cues);

  const repairable = cues.filter((c) => REPAIRABLE.has(job.failed.get(c.id)!));
  if (repairable.length === 0) return;

  // When the whole answer was unusable, ask again in two halves (smaller
  // answers are less likely to be cut off); otherwise only the failed cues.
  const wholeChunkFailed = cues.length > 1 && cues.every((c) => WHOLE_ANSWER_FAILURES.has(job.failed.get(c.id)!));
  const groups = wholeChunkFailed ? chunk(repairable, Math.ceil(repairable.length / 2)) : [repairable];
  for (const group of groups) {
    if (budget < 1 || job.signal?.aborted) break;
    job.repairs++;
    yield* send(group);
  }
}

function finalEvent(cues: Cue[], job: Job, failure: string | undefined, context: TranslateContext): StreamEvent {
  const { translations, failed } = job;
  const report: TranslationReport = {
    cues: cues.length,
    translated: translations.size,
    untranslated: cues
      .filter((c) => failed.has(c.id))
      .map((c) => ({ id: c.id, number: c.number, start: c.start, end: c.end, reason: failed.get(c.id)! })),
    requests: job.requests,
    repairs: job.repairs,
    retries: job.retries,
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
