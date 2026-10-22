import { describe, expect, it } from "vitest";
import { readTranslationStream } from "@/lib/translation/stream-client";

// A Response whose body arrives in the given byte chunks.
function streamed(...chunks: (string | Uint8Array)[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
        c.close();
      },
    })
  );
}

const line = (o: object) => JSON.stringify(o) + "\n";

describe("readTranslationStream", () => {
  it("reports progress and returns the completed SRT", async () => {
    const progress: number[] = [];
    const out = await readTranslationStream(
      streamed(
        line({ type: "progress", progress: 50, currentChunk: 1, totalChunks: 2 }),
        line({ type: "progress", progress: 100, currentChunk: 2, totalChunks: 2 }),
        line({ type: "complete", content: "1\nA\n" })
      ),
      { onProgress: (p) => progress.push(p) }
    );
    expect(out).toEqual({ content: "1\nA\n", report: undefined, partial: false });
    expect(progress).toEqual([50, 100, 100]);
  });

  it("joins lines split across chunks, including inside a multi-byte character", async () => {
    const bytes = new TextEncoder().encode(line({ type: "complete", content: "שלום" }));
    const cut = bytes.indexOf(0xd7) + 1; // inside the first Hebrew letter
    const out = await readTranslationStream(streamed(bytes.slice(0, cut), bytes.slice(cut)));
    expect(out.content).toBe("שלום");
  });

  it("accepts a final line without a trailing newline", async () => {
    expect((await readTranslationStream(streamed(JSON.stringify({ type: "complete", content: "x" })))).content).toBe("x");
  });

  it("ignores progress in an unterminated final line", async () => {
    const progress: number[] = [];
    await expect(
      readTranslationStream(streamed(JSON.stringify({ type: "progress", progress: 10 })), {
        onProgress: (p) => progress.push(p),
      })
    ).rejects.toThrow("No translation received");
    expect(progress).toEqual([]);
  });

  it("skips lines that are not JSON", async () => {
    expect((await readTranslationStream(streamed("garbage\n", "\n", line({ type: "complete", content: "ok" })))).content).toBe(
      "ok"
    );
  });

  it("returns the report of the complete event", async () => {
    const report = { cues: 1, translated: 1, untranslated: [], removedSoundEffectCues: 0, parse: { recovered: [], unparsed: [] } };
    expect(await readTranslationStream(streamed(line({ type: "complete", content: "x", report })))).toEqual({
      content: "x",
      report,
      partial: false,
    });
  });

  it("reports retry events", async () => {
    const retries: unknown[] = [];
    await readTranslationStream(
      streamed(
        line({ type: "retry", chunk: 2, attempt: 1, delayMs: 1000, reason: "HTTP 429" }),
        line({ type: "complete", content: "x" })
      ),
      { onRetry: (r) => retries.push(r) }
    );
    expect(retries).toEqual([{ chunk: 2, attempt: 1, delayMs: 1000, reason: "HTTP 429" }]);
  });

  it("returns a partial result marked as partial", async () => {
    const report = {
      cues: 2,
      translated: 1,
      untranslated: [{ id: 2, number: 2, start: "00:00:01,000", end: "00:00:02,000", reason: "missing" }],
      removedSoundEffectCues: 0,
      parse: { recovered: [], unparsed: [] },
    };
    const progress: number[] = [];
    const out = await readTranslationStream(streamed(line({ type: "partial", content: "x", report })), {
      onProgress: (p) => progress.push(p),
    });
    expect(out).toEqual({ content: "x", report, partial: true });
    expect(progress).toEqual([100]);
  });

  it("throws the message of an error event", async () => {
    await expect(readTranslationStream(streamed(line({ type: "error", message: "boom" })))).rejects.toThrow("boom");
    await expect(readTranslationStream(streamed(line({ type: "error" })))).rejects.toThrow("Unknown error");
  });

  it("throws when no translation arrives", async () => {
    await expect(readTranslationStream(streamed(line({ type: "progress", progress: 100 })))).rejects.toThrow(
      "No translation received"
    );
  });

  it("throws without a body", async () => {
    await expect(readTranslationStream(new Response(null))).rejects.toThrow("No response body");
  });
});
