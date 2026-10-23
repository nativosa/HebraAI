// Minimal local stand-in for the OpenAI Responses API, used only by the
// offline baseline harness. It never forwards anything to OpenAI.
//
// POST /v1/responses -> echoes each subtitle item back as
//   { index, text_he: "[HE] " + text }
// The "[HE] " marker makes English fallbacks (missing items) visible in output.
//
// The harness can script other answers (errors, malformed output, refusals,
// delays) with setResponder(); see fakeReply() for the reply shape.
//
// Only requests carrying the expected fake bearer token are accepted, so a
// real key can never be used by accident. Request bodies are never logged;
// accepted bodies are kept in memory (`requests`) only so the harness can
// fingerprint them.

import { createServer } from "node:http";

export const FAKE_API_KEY = "sk-offline-fake-key-not-real";

// A Responses API object. `refusal` replaces the text with a refusal item;
// `status: "incomplete"` needs `incompleteReason`.
export function responseFor(text, { status = "completed", incompleteReason, refusal, inputChars = 0 } = {}) {
  const content = refusal
    ? [{ type: "refusal", refusal }]
    : [{ type: "output_text", text, annotations: [] }];
  return {
    id: "resp_fake",
    object: "response",
    created_at: 0,
    status,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    model: "fake-offline",
    output: [{ type: "message", id: "msg_fake", status, role: "assistant", content }],
    // Deterministic stand-in figures (~4 characters per token), so usage
    // reporting and cost estimates can be tested offline.
    usage: {
      input_tokens: inputChars ? Math.ceil(inputChars / 4) : 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: Math.ceil((text ?? "").length / 4),
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: (inputChars ? Math.ceil(inputChars / 4) : 0) + Math.ceil((text ?? "").length / 4),
    },
  };
}

// Also used by the unit tests as the stub model, so they translate exactly
// like the server that produced the legacy baseline.
export function echoItems(body) {
  // The routes send one user message whose text ends with "\n\n<JSON>": an
  // array of items (classic), { context_before, items, context_after }
  // (context mode) or an array of { n, text } (character analysis).
  const text = body?.input?.[0]?.content?.[0]?.text ?? "";
  const payload = JSON.parse(text.slice(text.lastIndexOf("\n\n") + 2));
  if (body?.text?.format?.name === "character_sheet") return fakeCharacters(payload);
  const items = Array.isArray(payload) ? payload : payload.items;
  return {
    items: items.map((p) => ({ index: p.index, text_he: `[HE] ${p.text}` })),
  };
}

// Character analysis: one character per speaker label ("MARY: ..."), gender
// unknown, with the subtitles that carry the label as evidence.
function fakeCharacters(cues) {
  const byName = new Map();
  for (const { n, text } of cues) {
    const label = /^([A-Z][A-Z' -]*):/.exec(text)?.[1];
    if (!label) continue;
    const name = label.charAt(0) + label.slice(1).toLowerCase();
    if (!byName.has(name)) byName.set(name, { name, hebrewName: "", aliases: [], gender: "unknown", confidence: "low", evidence: [] });
    const c = byName.get(name);
    if (c.evidence.length < 5) c.evidence.push(n);
  }
  return { characters: [...byName.values()] };
}

// Reply shape a responder may return (all fields optional):
//   { status: 429, headers: { "retry-after-ms": "5" }, error: "..." }  -> API error
//   { outputText: "not json" } / { items: [...] }                      -> 200 with that output
//   { response: {...} }                                                 -> 200 with a full object
//   { delayMs: 500 }                                                    -> wait before replying
// Returning undefined (or no responder) gives the default echo.
function buildReply(reply, body) {
  const inputChars = JSON.stringify(body).length;
  const echo = () => responseFor(JSON.stringify(echoItems(body)), { inputChars });
  if (!reply) return { status: 200, headers: {}, json: echo() };
  const headers = reply.headers ?? {};
  if (reply.status && reply.status !== 200) {
    return { status: reply.status, headers, json: { error: { message: reply.error ?? "fake error", code: reply.code ?? null } } };
  }
  if (reply.response) return { status: 200, headers, json: reply.response };
  if (reply.items) return { status: 200, headers, json: responseFor(JSON.stringify({ items: reply.items }), { inputChars }) };
  if ("outputText" in reply) return { status: 200, headers, json: responseFor(reply.outputText, { inputChars }) };
  return { status: 200, headers, json: echo() };
}

export function startFakeOpenAI() {
  // closedEarly: accepted requests whose connection the client closed before
  // the answer was sent (e.g. an aborted request).
  const stats = { requests: 0, rejected: 0, closedEarly: 0 };
  const requests = [];
  let responder = null;

  const server = createServer((req, res) => {
    const send = (status, obj, headers = {}) => {
      if (res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(obj));
    };

    if (req.headers.authorization !== `Bearer ${FAKE_API_KEY}`) {
      stats.rejected++;
      return send(401, { error: { message: "fake server: unexpected credentials" } });
    }
    if (req.method !== "POST" || !req.url?.endsWith("/responses")) {
      stats.rejected++;
      return send(404, { error: { message: "fake server: unsupported endpoint" } });
    }

    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(data);
        echoItems(body); // validates the request shape
      } catch {
        stats.rejected++;
        return send(400, { error: { message: "fake server: could not parse request" } });
      }
      stats.requests++;
      requests.push(body);
      res.on("close", () => {
        if (!res.writableEnded) stats.closedEarly++;
      });
      const reply = responder ? responder(body, requests.length) : undefined;
      const { status, headers, json } = buildReply(reply, body);
      if (reply?.delayMs) setTimeout(() => send(status, json, headers), reply.delayMs);
      else send(status, json, headers);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseURL: `http://127.0.0.1:${port}/v1`,
        stats,
        requests,
        // fn(body, requestNumber) -> reply | undefined; null restores the echo.
        setResponder: (fn) => (responder = fn),
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(r);
          }),
      });
    });
  });
}
