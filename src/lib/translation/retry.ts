import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";

// Retries of one request after temporary failures (on top of the first try).
export const MAX_RETRIES_PER_REQUEST = 3;
const BASE_DELAY_MS = 1000;
const MAX_BACKOFF_MS = 20_000;
const MAX_RETRY_AFTER_MS = 60_000;

export type RetryDecision = { retry: true; delayMs: number; reason: string } | { retry: false; reason: string };

// Decides whether a failed request is worth repeating. Temporary: timeouts,
// connection errors, 408, 409, 429 (except quota exhaustion) and 5xx.
// Everything else (other 4xx, quota, cancellation, non-API errors) is
// permanent. `retry` is the 1-based number of the retry that would follow.
export function decideRetry(error: unknown, retry: number, random: () => number = Math.random): RetryDecision {
  if (error instanceof APIUserAbortError) return { retry: false, reason: "cancelled" };
  if (error instanceof APIConnectionError) {
    return backoff(retry, random, error instanceof APIConnectionTimeoutError ? "timeout" : "connection error");
  }
  if (!(error instanceof APIError) || error.status === undefined) return { retry: false, reason: "unexpected error" };

  const { status } = error;
  if (status === 429 && error.code === "insufficient_quota") return { retry: false, reason: "quota exceeded" };
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    const after = retryAfterMs(error.headers);
    return after === null ? backoff(retry, random, `HTTP ${status}`) : { retry: true, delayMs: after, reason: `HTTP ${status}` };
  }
  return { retry: false, reason: `HTTP ${status}` };
}

// 1 s, 2 s, 4 s, ... (capped), each varied by ±20 %.
function backoff(retry: number, random: () => number, reason: string): RetryDecision {
  const base = Math.min(BASE_DELAY_MS * 2 ** (retry - 1), MAX_BACKOFF_MS);
  return { retry: true, delayMs: Math.round(base * (0.8 + 0.4 * random())), reason };
}

// retry-after-ms (milliseconds) or retry-after (seconds or HTTP date), capped.
function retryAfterMs(headers: Headers | undefined): number | null {
  const ms = Number(headers?.get("retry-after-ms"));
  if (headers?.get("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  const value = headers?.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, MAX_RETRY_AFTER_MS) : null;
}

// Waits `ms`; rejects early if the signal aborts.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
