import { DEFAULT_MAX_ATTEMPTS_PER_CHUNK } from "@/lib/translation/pipeline";
import type { TokenPrices } from "@/lib/translation/report";

// Server settings read from the environment, shared by the API routes.

const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024; // 0.5 MB

export function getMaxFileSizeBytes(): number {
  const n = Number(process.env.MAX_FILE_SIZE_BYTES);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_FILE_SIZE_BYTES;
}

// Limit on API requests per 60-cue chunk (first request, repairs, retries).
export function getMaxAttemptsPerChunk(): number {
  const n = Number(process.env.MAX_ATTEMPTS_PER_CHUNK);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_MAX_ATTEMPTS_PER_CHUNK;
}

// Optional prices (USD per 1M tokens) for the cost estimate in the report.
export function getPrices(): TokenPrices | undefined {
  const price = (name: string) => {
    const n = Number(process.env[name]);
    return process.env[name] && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const inputPerMTok = price("OPENAI_PRICE_INPUT_PER_MTOK");
  const outputPerMTok = price("OPENAI_PRICE_OUTPUT_PER_MTOK");
  if (inputPerMTok === undefined || outputPerMTok === undefined) return undefined;
  return { inputPerMTok, outputPerMTok, cachedInputPerMTok: price("OPENAI_PRICE_CACHED_INPUT_PER_MTOK") };
}
