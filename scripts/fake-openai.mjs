// Minimal local stand-in for the OpenAI Responses API, used only by the
// offline baseline harness. It never forwards anything to OpenAI.
//
// POST /v1/responses -> echoes each subtitle item back as
//   { index, text_he: "[HE] " + text }
// The "[HE] " marker makes English fallbacks (missing items) visible in output.
//
// Only requests carrying the expected fake bearer token are accepted, so a
// real key can never be used by accident. Request bodies are never logged;
// accepted bodies are kept in memory (`requests`) only so the harness can
// fingerprint them.

import { createServer } from "node:http";

export const FAKE_API_KEY = "sk-offline-fake-key-not-real";

function responseFor(text) {
  return {
    id: "resp_fake",
    object: "response",
    created_at: 0,
    status: "completed",
    model: "fake-offline",
    output: [
      {
        type: "message",
        id: "msg_fake",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}

function echoItems(body) {
  // The route sends one user message whose text ends with "\n\n<JSON array>".
  const text = body?.input?.[0]?.content?.[0]?.text ?? "";
  const json = text.slice(text.indexOf("\n\n[") + 2);
  const payload = JSON.parse(json);
  return {
    items: payload.map((p) => ({ index: p.index, text_he: `[HE] ${p.text}` })),
  };
}

export function startFakeOpenAI() {
  const stats = { requests: 0, rejected: 0 };
  const requests = [];

  const server = createServer((req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
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
      try {
        const body = JSON.parse(data);
        const out = echoItems(body);
        stats.requests++;
        requests.push(body);
        send(200, responseFor(JSON.stringify(out)));
      } catch {
        stats.rejected++;
        send(400, { error: { message: "fake server: could not parse request" } });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseURL: `http://127.0.0.1:${port}/v1`,
        stats,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
