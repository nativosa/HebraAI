import OpenAI from "openai";
import { NextResponse } from "next/server";
import { rateLimitOrThrow } from "@/lib/ratelimit";


export const runtime = "nodejs"; // ensure Node runtime (not Edge) for SDK compatibility

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Cue = {
  index: number;
  start: string;
  end: string;
  text: string;
};

function parseSrt(srt: string): Cue[] {
  // Simple parser that handles common SRT structure:
  // index \n time --> time \n text lines... \n\n
  const blocks = srt.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;

    const index = Number(lines[0].trim());
    const timeLine = lines[1].trim();
    const m = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    if (!m || !Number.isFinite(index)) continue;

    const text = lines.slice(2).join("\n").trim();
    cues.push({ index, start: m[1], end: m[2], text });
  }

  return cues;
}

function buildSrt(cues: Cue[]): string {
  return cues
    .map(
      (c) =>
        `${c.index}\n${c.start} --> ${c.end}\n${c.text.trim()}\n`
    )
    .join("\n");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isSoundEffectCue(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return false;

  // Remove the cue ONLY if every non-empty line
  // is entirely wrapped in parentheses or brackets
  return lines.every(isSoundEffectLineSingle);
}


function isSoundEffectLineSingle(line: string): boolean {
  // Entire line is (...) → sound effect (includes names, voices, SFX)
  if (/^\([^)]*\)$/.test(line)) return true;

  // Entire line is [...] → sound effect
  if (/^\[[^\]]+\]$/.test(line)) return true;

  // Musical cues
  if (/^♪.*♪$/.test(line)) return true;

  return false;
}

// Removes simple HTML tags but preserves the inner text.
// Example: "<i>(music)</i>" -> "(music)"
function stripHtmlTags(input: string): string {
  return input.replace(/<\/?[^>]+>/g, "");
}

// Removes non-dialogue annotations anywhere in the line:
// - (...) blocks
// - [...] blocks
// - ♪...♪ blocks (musical cues)
function stripNonDialogueMarkers(line: string): string {
  let s = line;

  // remove musical markers like ♪ ... ♪ (including the content)
  s = s.replace(/♪[^♪]*♪/g, "");

  // remove bracketed annotations anywhere
  s = s.replace(/\([^)]*\)/g, ""); // (whispers)
  s = s.replace(/\[[^\]]*\]/g, ""); // [music]

  return s;
}

// Cleans a cue's text to keep only dialogue.
// Returns cleaned text; may become empty.
function toDialogueOnlyCueText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(stripHtmlTags)
    .map(stripNonDialogueMarkers)
    // normalize whitespace after removals
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

// Decide if the cleaned cue still contains "dialogue-like" characters.
// This keeps Hebrew/English letters and digits.
// If none remain, we treat it as non-dialogue and remove the cue entirely.
function isDialogueLike(text: string): boolean {
  return /[A-Za-z\u0590-\u05FF0-9]/.test(text);
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}


export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const ip = getClientIp(req);

  // 2 requests per 120 seconds per IP
  const rl = await rateLimitOrThrow({
    key: `translate:${ip}`,
    limit: 2,
    windowSec: 120,
  });

  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      }
    );
  }

  const form = await req.formData();

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected form-data field 'file' (SRT)" },
      { status: 400 }
    );
  }

  // --- Inputs (sanitize) ---
  const toneRaw = (form.get("tone") as string) || "Neutral";
  const tone = (toneRaw === "Formal" || toneRaw === "Informal" || toneRaw === "Neutral")
    ? toneRaw
    : "Neutral";

  const removeSoundEffects = form.get("removeSoundEffects") === "true";
  const preserveBreaks = form.get("preserveBreaks") === "true";

  const maxCharsRaw = Number(form.get("maxChars"));
  const maxChars = Number.isFinite(maxCharsRaw)
    ? Math.min(Math.max(maxCharsRaw, 20), 80)
    : 42;

  // --- Build instructions (dynamic) ---
  let instructions =
    "Translate English subtitles to natural, fluent Hebrew suitable for on-screen captions.\n" +
    "- Preserve meaning, intent, and tone; do not translate word-for-word if unnatural.\n";

  switch (tone) {
    case "Formal":
      instructions += "- Use formal, polite Hebrew register suitable for professional or official contexts.\n";
      break;
    case "Informal":
      instructions += "- Use informal, natural spoken Hebrew suitable for casual dialogue.\n";
      break;
    default:
      instructions += "- Use neutral conversational Hebrew suitable for everyday speech.\n";
  }

  instructions +=
    "- Translate/transliterate names, places, and brands into common Hebrew forms when appropriate.\n" +
    "- Maintain correct gender and plurality from context.\n" +
    "- Preserve numbers, punctuation, and symbols.\n";

  // FIX: actually append the maxChars instruction
  instructions += `- Keep each subtitle line at or below ${maxChars} characters.\n`;

  if (preserveBreaks) {
    instructions += "- Preserve original line breaks where possible; do not reflow text.\n";
  } else {
    instructions += "- You may reflow lines for readability while respecting the character limit.\n";
  }

  instructions +=
    "- Do NOT add explanations, comments, or extra text.\n" +
    "- Return ONLY valid JSON matching the requested schema.";

  // --- Parse SRT ---
  const srtText = await file.text();
  const cues = parseSrt(srtText);

  if (cues.length === 0) {
    return NextResponse.json(
      { error: "Could not parse SRT (0 cues found)" },
      { status: 400 }
    );
  }

  // --- Filter cues ---
  let filteredCues = cues;

  if (removeSoundEffects) {
  filteredCues = filteredCues
    .map((c) => {
      const cleaned = toDialogueOnlyCueText(c.text);
      return { ...c, text: cleaned };
    })
    .filter((c) => c.text.length > 0 && isDialogueLike(c.text));
}

  if (filteredCues.length === 0) {
    return NextResponse.json(
      { error: "All cues were filtered out (check sound-effect rules)" },
      { status: 400 }
    );
  }

  // --- Chunking ---
  const cuesChunks = chunk(filteredCues, 60);

  // --- Translation loop ---
  const translated: Cue[] = [];

  for (const cuesPart of cuesChunks) {
    const payload = cuesPart.map((c) => ({ index: c.index, text: c.text }));

    const response = await client.responses.create({
      model: "gpt-5.2",
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Translate this JSON array of subtitle items.\n" +
                "Return a JSON object with key 'items' which is an array of {index, text_he}.\n\n" +
                JSON.stringify(payload),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "subtitle_translation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    text_he: { type: "string" },
                  },
                  required: ["index", "text_he"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    });

    let json: { items: { index: number; text_he: string }[] };
    try {
      json = JSON.parse(response.output_text);
    } catch (e) {
      return NextResponse.json(
        {
          error: "Model returned invalid JSON (unexpected).",
          details: response.output_text?.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const map = new Map<number, string>(json.items.map((x) => [x.index, x.text_he]));

    for (const c of cuesPart) {
      const he = map.get(c.index);
      translated.push({
        ...c,
        text: (he ?? c.text).trim(),
      });
    }
  }

  const outSrt = buildSrt(translated);

  return new NextResponse(outSrt, {
    headers: {
      "Content-Type": "application/x-subrip; charset=utf-8",
      "Content-Disposition": `attachment; filename="translated.he.srt"`,
    },
  });
}
