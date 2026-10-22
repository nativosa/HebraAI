// Browser-side reader for the /api/translate NDJSON stream.

import type { TranslationReport } from "./report";

// partial: some cues could not be translated and are kept in English.
export type TranslationResult = { content: string; report?: TranslationReport; partial: boolean };

export type StreamHandlers = {
  onProgress?: (progress: number) => void;
};

// Reads the stream to the end and returns the translated SRT and its report. Lines that are
// not valid JSON are skipped; an error event or a stream without a
// translation throws.
export async function readTranslationStream(res: Response, handlers: StreamHandlers = {}): Promise<TranslationResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result = null as TranslationResult | null; // assigned inside handle()

  // `trailing`: the unterminated last line, where progress is ignored.
  const handle = (line: string, trailing = false) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      if (e instanceof SyntaxError) return; // JSON parse error, skip this line
      throw e;
    }
    if (msg.type === "progress" && !trailing) {
      handlers.onProgress?.(msg.progress);
    } else if (msg.type === "complete" || msg.type === "partial") {
      result = { content: msg.content, report: msg.report, partial: msg.type === "partial" };
      handlers.onProgress?.(100);
    } else if (msg.type === "error") {
      throw new Error(msg.message || "Unknown error");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");

    // Process complete lines
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) handle(line);
    }

    // Keep incomplete line in buffer
    buffer = lines[lines.length - 1];
  }

  // Process any remaining buffer
  if (buffer.trim()) handle(buffer.trim(), true);

  if (!result?.content) {
    throw new Error("No translation received");
  }
  return result;
}
