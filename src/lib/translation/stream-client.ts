// Browser-side reader for the /api/translate NDJSON stream.

export type StreamHandlers = {
  onProgress?: (progress: number) => void;
};

// Reads the stream to the end and returns the translated SRT. Lines that are
// not valid JSON are skipped; an error event or a stream without a
// translation throws.
export async function readTranslationStream(res: Response, handlers: StreamHandlers = {}): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let translatedText = "";

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
    } else if (msg.type === "complete") {
      translatedText = msg.content;
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

  if (!translatedText) {
    throw new Error("No translation received");
  }
  return translatedText;
}
