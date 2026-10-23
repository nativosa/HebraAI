import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Cue } from "@/lib/srt/parse";
import type { CreateResponse } from "./pipeline";
import { NO_USAGE, addUsage, estimateCostUsd, type TokenPrices, type TokenUsage } from "./report";
import type { ModelResponse } from "./response";
import { MAX_RETRIES_PER_REQUEST, decideRetry, sleep as defaultSleep } from "./retry";

// A character sheet: who appears in the subtitles, their gender and the
// Hebrew spelling of their name. Produced by the optional analysis, reviewed
// by the user and sent with context-mode translations.

export const GENDERS = ["male", "female", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];
export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export type Character = { name: string; hebrewName: string; aliases: string[]; gender: Gender };

// As returned by the analysis; confidence and evidence are shown to the user
// only and are not sent with translations.
export type AnalyzedCharacter = Character & { confidence: Confidence; evidence: number[] };

export const MAX_CHARACTERS = 50;
export const MAX_NAME_CHARS = 60;
export const MAX_ALIASES = 5;
export const MAX_NOTES_CHARS = 4000;
// The analysis sends at most this much subtitle text (about 50k tokens);
// later cues are left out and the result says so.
export const MAX_ANALYSIS_CHARS = 200_000;
const MAX_EVIDENCE = 5;

// One line, trimmed: names end up inside the instructions.
const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

// Validates a sheet sent by the browser. Rows without a name are dropped.
export function parseCharacters(raw: string): { characters: Character[] } | { error: string } {
  if (!raw.trim()) return { characters: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "Characters must be a JSON array." };
  }
  if (!Array.isArray(value)) return { error: "Characters must be a JSON array." };

  const characters: Character[] = [];
  for (const item of value) {
    const { name, hebrewName, aliases, gender } = (item ?? {}) as Record<string, unknown>;
    const c: Character = {
      name: clean(name),
      hebrewName: clean(hebrewName),
      aliases: Array.isArray(aliases) ? aliases.map(clean).filter(Boolean) : [],
      gender: gender as Gender,
    };
    if (!c.name) continue;
    if (!GENDERS.includes(c.gender)) return { error: `Character "${c.name}": gender must be male, female or unknown.` };
    if ([c.name, c.hebrewName, ...c.aliases].some((s) => s.length > MAX_NAME_CHARS)) {
      return { error: `Character "${c.name.slice(0, MAX_NAME_CHARS)}": names are limited to ${MAX_NAME_CHARS} characters.` };
    }
    if (c.aliases.length > MAX_ALIASES) return { error: `Character "${c.name}": at most ${MAX_ALIASES} aliases.` };
    characters.push(c);
  }
  if (characters.length > MAX_CHARACTERS) return { error: `At most ${MAX_CHARACTERS} characters.` };
  return { characters };
}

export function notesError(notes: string): string | null {
  return notes.length > MAX_NOTES_CHARS ? `Notes have ${notes.length} characters; the maximum is ${MAX_NOTES_CHARS}.` : null;
}

const INSTRUCTIONS =
  "You read English subtitles and list the characters, so that a translator can use the correct Hebrew gender forms.\n" +
  "- List people who speak, are spoken to or are referred to by name. Merge spellings and nicknames of the same person into aliases.\n" +
  "- gender: male or female only with evidence (speaker labels such as \"MARY:\", pronouns such as he/she, titles such as Mr./Mrs., family roles such as mom/brother, or the user's notes); otherwise unknown. Never guess from the name alone or from which lines are near each other.\n" +
  "- confidence: high when the evidence is explicit, medium when inferred, low otherwise.\n" +
  "- evidence: up to 5 subtitle numbers (n) that show the gender or identity.\n" +
  "- hebrewName: the usual Hebrew spelling of the name.\n" +
  "- Return ONLY valid JSON matching the requested schema.";

const SCHEMA = {
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          hebrewName: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          gender: { type: "string", enum: [...GENDERS] },
          confidence: { type: "string", enum: [...CONFIDENCES] },
          evidence: { type: "array", items: { type: "number" } },
        },
        required: ["name", "hebrewName", "aliases", "gender", "confidence", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["characters"],
  additionalProperties: false,
};

// The cues sent for analysis (in order, up to MAX_ANALYSIS_CHARS of text).
export function analysisCues(cues: Cue[]): Cue[] {
  let chars = 0;
  const out: Cue[] = [];
  for (const c of cues) {
    chars += c.text.length;
    if (chars > MAX_ANALYSIS_CHARS) break;
    out.push(c);
  }
  return out;
}

export function buildCharactersRequest(cues: Cue[], notes: string): ResponseCreateParamsNonStreaming {
  const payload = cues.map((c) => ({ n: c.id, text: c.text }));
  return {
    model: "gpt-5.2",
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              (notes ? `Notes about the story from the user:\n${notes}\n\n` : "") +
              "List the characters in these subtitles (n = subtitle number).\n\n" +
              JSON.stringify(payload),
          },
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "character_sheet", strict: true, schema: SCHEMA } },
  };
}

// Checks the model's answer; null when it is unusable. Evidence numbers that
// are not among the analysed cues are dropped; characters that are not
// valid are skipped.
export function validateCharactersResponse(response: ModelResponse, cues: Cue[]): AnalyzedCharacter[] | null {
  if (response.output?.some((item) => item.content?.some((part) => part.type === "refusal"))) return null;
  if (response.status && response.status !== "completed") return null;
  let json: unknown;
  try {
    json = JSON.parse(response.output_text);
  } catch {
    return null;
  }
  const items = (json as { characters?: unknown } | null)?.characters;
  if (!Array.isArray(items)) return null;

  const ids = new Set(cues.map((c) => c.id));
  const out: AnalyzedCharacter[] = [];
  for (const item of items) {
    const raw = (item ?? {}) as Record<string, unknown>;
    const parsed = parseCharacters(JSON.stringify([raw]));
    if ("error" in parsed || parsed.characters.length === 0) continue;
    const c = parsed.characters[0];
    const confidence = CONFIDENCES.includes(raw.confidence as Confidence) ? (raw.confidence as Confidence) : "low";
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : []).filter((n): n is number => ids.has(n as number));
    out.push({ ...c, aliases: c.aliases.slice(0, MAX_ALIASES), confidence, evidence: [...new Set(evidence)].slice(0, MAX_EVIDENCE) });
  }
  return out.slice(0, MAX_CHARACTERS);
}

// Sent to the browser. Counts and timings only, besides the sheet itself.
export type CharactersResult = {
  characters: AnalyzedCharacter[];
  analyzedCues: number;
  totalCues: number;
  requests: number;
  usage: TokenUsage;
  elapsedMs: number;
  estimatedCostUsd?: number;
};

export type AnalyzeOptions = {
  maxAttempts?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  prices?: TokenPrices;
  now?: () => number;
};

// One analysis request, repeated after temporary errors or an unusable
// answer, within `maxAttempts` requests. Throws when no usable answer came
// back; cancelled requests reject with the abort reason.
export async function analyzeCharacters(
  createResponse: CreateResponse,
  allCues: Cue[],
  notes: string,
  { maxAttempts = 3, signal, sleep = defaultSleep, random = Math.random, prices, now = Date.now }: AnalyzeOptions = {}
): Promise<CharactersResult> {
  const startedAt = now();
  const cues = analysisCues(allCues);
  const params = buildCharactersRequest(cues, notes);
  let usage = NO_USAGE;
  let requests = 0;
  let retry = 0;
  let lastError = "the answer was not a valid character list";

  while (requests < maxAttempts) {
    signal?.throwIfAborted();
    requests++;
    let response: ModelResponse;
    try {
      response = await createResponse(params, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      retry++;
      const decision = decideRetry(error, retry, random);
      if (!decision.retry || retry > MAX_RETRIES_PER_REQUEST || requests >= maxAttempts) throw error;
      lastError = decision.reason;
      await sleep(decision.delayMs, signal);
      continue;
    }
    usage = addUsage(usage, response.usage);
    const characters = validateCharactersResponse(response, cues);
    if (characters) {
      return {
        characters,
        analyzedCues: cues.length,
        totalCues: allCues.length,
        requests,
        usage,
        elapsedMs: now() - startedAt,
        ...(prices ? { estimatedCostUsd: estimateCostUsd(usage, prices) } : {}),
      };
    }
  }
  throw new Error(`Character analysis failed: ${lastError}.`);
}
