import OpenAI from "openai";

// The only endpoint used outside the offline test harness. Passed explicitly
// so an inherited OPENAI_BASE_URL can never redirect requests (or the key).
export const OFFICIAL_OPENAI_BASE_URL = "https://api.openai.com/v1";

// Offline test mode (scripts/baseline.mjs) is the only way to change the endpoint.
// It must be requested explicitly, and then only a loopback URL and the fake key
// below are accepted, so a real key cannot reach a custom endpoint.
export const OFFLINE_TEST_MODE_ENV = "HEBRAAI_OFFLINE_TEST_MODE";
// Must match FAKE_API_KEY in scripts/fake-openai.mjs.
export const OFFLINE_TEST_API_KEY = "sk-offline-fake-key-not-real";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);

type Env = Record<string, string | undefined>;

export function resolveOpenAIOptions(env: Env = process.env): { apiKey?: string; baseURL: string } {
  const apiKey = env.OPENAI_API_KEY;
  if (env[OFFLINE_TEST_MODE_ENV] !== "1") {
    return { apiKey, baseURL: OFFICIAL_OPENAI_BASE_URL };
  }

  // Fail closed: misconfigured test mode never falls back to a real endpoint.
  if (apiKey !== OFFLINE_TEST_API_KEY) {
    throw new Error(`${OFFLINE_TEST_MODE_ENV}=1 requires the offline fake API key`);
  }
  let url: URL;
  try {
    url = new URL(env.OPENAI_BASE_URL ?? "");
  } catch {
    throw new Error(`${OFFLINE_TEST_MODE_ENV}=1 requires OPENAI_BASE_URL to be a loopback http URL`);
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error(`${OFFLINE_TEST_MODE_ENV}=1 requires OPENAI_BASE_URL to be a loopback http URL`);
  }
  return { apiKey, baseURL: url.href };
}

// Per-attempt request timeout. The SDK's own retries are off: the translation
// pipeline retries temporary failures itself (src/lib/translation/retry.ts)
// within its per-chunk request budget.
export const REQUEST_TIMEOUT_MS = 120_000;

export function createOpenAIClient(env: Env = process.env): OpenAI {
  return new OpenAI({ ...resolveOpenAIOptions(env), maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
}
