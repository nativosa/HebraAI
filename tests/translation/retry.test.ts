import { describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { decideRetry, sleep } from "@/lib/translation/retry";

// SDK errors as the OpenAI client throws them (status, body.error, headers).
const apiError = (status: number, headers: Record<string, string> = {}, code?: string) =>
  APIError.generate(status, { error: { message: "x", code } }, undefined, new Headers(headers));

const noJitter = () => 0.5; // factor 1.0

describe("decideRetry: temporary failures", () => {
  it.each([408, 409, 429, 500, 502, 503, 504])("HTTP %d is retried", (status) => {
    expect(decideRetry(apiError(status), 1, noJitter)).toEqual({ retry: true, delayMs: 1000, reason: `HTTP ${status}` });
  });

  it("connection errors and timeouts are retried", () => {
    expect(decideRetry(new APIConnectionError({ message: "reset" }), 1, noJitter)).toMatchObject({
      retry: true,
      reason: "connection error",
    });
    expect(decideRetry(new APIConnectionTimeoutError(), 1, noJitter)).toMatchObject({ retry: true, reason: "timeout" });
  });

  it("backs off exponentially, capped at 20 s", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => (decideRetry(apiError(500), n, noJitter) as { delayMs: number }).delayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 20000,
    ]);
  });

  it("varies the delay by at most ±20 %", () => {
    expect((decideRetry(apiError(500), 2, () => 0) as { delayMs: number }).delayMs).toBe(1600);
    expect((decideRetry(apiError(500), 2, () => 1) as { delayMs: number }).delayMs).toBe(2400);
  });

  it("honours retry-after-ms and retry-after (seconds or date), capped at 60 s", () => {
    const delay = (h: Record<string, string>) => (decideRetry(apiError(429, h), 1, noJitter) as { delayMs: number }).delayMs;
    expect(delay({ "retry-after-ms": "250" })).toBe(250);
    expect(delay({ "retry-after": "3" })).toBe(3000);
    expect(delay({ "retry-after": "600" })).toBe(60000);
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    expect(delay({ "retry-after": "Thu, 01 Jan 2026 00:00:05 GMT" })).toBe(5000);
    vi.useRealTimers();
    expect(delay({ "retry-after": "soon" })).toBe(1000);
  });
});

describe("decideRetry: permanent failures", () => {
  it.each([400, 401, 403, 404, 422])("HTTP %d is not retried", (status) => {
    expect(decideRetry(apiError(status), 1)).toEqual({ retry: false, reason: `HTTP ${status}` });
  });

  it("quota exhaustion (429 insufficient_quota) is not retried", () => {
    expect(decideRetry(apiError(429, {}, "insufficient_quota"), 1)).toEqual({ retry: false, reason: "quota exceeded" });
  });

  it("cancellation and non-API errors are not retried", () => {
    expect(decideRetry(new APIUserAbortError(), 1)).toEqual({ retry: false, reason: "cancelled" });
    expect(decideRetry(new TypeError("bug"), 1)).toEqual({ retry: false, reason: "unexpected error" });
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const p = sleep(1000).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects as soon as the signal aborts", async () => {
    const ac = new AbortController();
    const p = sleep(60_000, ac.signal);
    ac.abort(new Error("cancelled"));
    await expect(p).rejects.toThrow("cancelled");
  });

  it("rejects immediately for an aborted signal", async () => {
    await expect(sleep(10, AbortSignal.abort(new Error("gone")))).rejects.toThrow("gone");
  });
});
