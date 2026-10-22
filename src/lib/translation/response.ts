import type { Cue } from "@/lib/srt/parse";

// The parts of a Responses API result that validation looks at.
export type ModelResponse = {
  output_text: string;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output?: ReadonlyArray<{ type: string; content?: ReadonlyArray<{ type: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
};

// Why a cue has no translation.
export type FailureReason =
  // The model declined; never retried or repaired.
  | "refusal"
  | "content-filter"
  // Technical or structural problems with the output.
  | "incomplete" // response cut off (e.g. max_output_tokens) or not completed
  | "invalid-json"
  | "invalid-shape" // valid JSON, but not { items: [...] }
  | "missing" // no item for the cue
  | "duplicate" // conflicting items for the cue
  | "empty" // empty translation for non-empty text
  // The request itself failed or was not sent.
  | "request-failed";

// Failures that a repair request may fix.
export const REPAIRABLE: ReadonlySet<FailureReason> = new Set([
  "incomplete",
  "invalid-json",
  "invalid-shape",
  "missing",
  "duplicate",
  "empty",
]);

export type ChunkValidation = {
  translations: Map<number, string>; // cue id -> translated text (trimmed)
  failed: Map<number, FailureReason>; // cue id -> reason
  unexpectedItems: number; // items for ids not in the chunk, or malformed items (ignored)
};

// Checks one response against the cues it was asked to translate. Only
// structure is checked: names, Latin text or text identical to the source are
// valid translations.
export function validateChunkResponse(cues: Cue[], response: ModelResponse): ChunkValidation {
  const result: ChunkValidation = { translations: new Map(), failed: new Map(), unexpectedItems: 0 };
  const failAll = (reason: FailureReason) => {
    for (const c of cues) result.failed.set(c.id, reason);
    return result;
  };

  const refused = response.output?.some((item) => item.content?.some((part) => part.type === "refusal"));
  if (refused) return failAll("refusal");
  if (response.status === "incomplete" && response.incomplete_details?.reason === "content_filter") {
    return failAll("content-filter");
  }
  if (response.status && response.status !== "completed") return failAll("incomplete");

  let json: unknown;
  try {
    json = JSON.parse(response.output_text);
  } catch {
    return failAll("invalid-json");
  }
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return failAll("invalid-shape");

  const ids = new Set(cues.map((c) => c.id));
  const seen = new Map<number, string[]>();
  for (const item of items) {
    const { index, text_he } = (item ?? {}) as { index?: unknown; text_he?: unknown };
    if (!Number.isInteger(index) || typeof text_he !== "string" || !ids.has(index as number)) {
      result.unexpectedItems++;
      continue;
    }
    seen.set(index as number, [...(seen.get(index as number) ?? []), text_he.trim()]);
  }

  for (const c of cues) {
    const texts = [...new Set(seen.get(c.id) ?? [])];
    if (texts.length === 0) result.failed.set(c.id, "missing");
    else if (texts.length > 1) result.failed.set(c.id, "duplicate");
    else if (texts[0] === "" && c.text.trim() !== "") result.failed.set(c.id, "empty");
    else result.translations.set(c.id, texts[0]);
  }
  return result;
}
