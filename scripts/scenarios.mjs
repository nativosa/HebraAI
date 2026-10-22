// End-to-end reliability scenarios for the offline harness: the fake OpenAI
// server is scripted per request (setResponder) and the app's NDJSON result is
// checked. They run through the real route, OpenAI SDK and HTTP stack.
// No OpenAI calls; output and request bodies are never logged.

import { echoItems, responseFor } from "./fake-openai.mjs";

const finalEvent = (events) => events.at(-1) ?? {};
const reasons = (event) => [...new Set((event.report?.untranslated ?? []).map((u) => u.reason))].sort();

// Each scenario: fixture, responder(body, n), check(events, requestCount) -> problem string or null.
export const SCENARIOS = [
  {
    name: "missing item once -> repaired with a 1-item request, complete",
    fixture: "basic.srt",
    responder: (body, n, nInCase) => (nInCase === 1 ? { items: echoItems(body).items.slice(1) } : undefined),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "complete") return `final event ${f.type}`;
      if (f.report.repairs !== 1) return `repairs ${f.report.repairs}`;
      return requests === 2 ? null : `${requests} requests`;
    },
  },
  {
    name: "item always missing -> one repair, then partial with the cue reported",
    fixture: "basic.srt",
    responder: (body) => ({ items: echoItems(body).items.filter((i) => i.index !== 1) }),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "partial") return `final event ${f.type}`;
      if (f.report.untranslated.length !== 1 || reasons(f).join() !== "missing") return `untranslated ${JSON.stringify(reasons(f))}`;
      return requests === 2 ? null : `${requests} requests`;
    },
  },
  {
    name: "refusal -> error, not retried",
    fixture: "basic.srt",
    responder: () => ({ response: responseFor("", { refusal: "I can't help with that." }) }),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "error" || reasons(f).join() !== "refusal") return `final ${f.type} ${JSON.stringify(reasons(f))}`;
      return requests === 1 ? null : `${requests} requests`;
    },
  },
  {
    name: "content filter -> error, not retried",
    fixture: "basic.srt",
    responder: () => ({ response: responseFor("", { status: "incomplete", incompleteReason: "content_filter" }) }),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "error" || reasons(f).join() !== "content-filter") return `final ${f.type} ${JSON.stringify(reasons(f))}`;
      return requests === 1 ? null : `${requests} requests`;
    },
  },
  {
    name: "invalid JSON once in chunk 2 of 3 -> repaired in two halves, complete",
    fixture: "multi-chunk.srt",
    responder: (body, n, nInCase) => (nInCase === 2 ? { outputText: "not json" } : undefined),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "complete") return `final event ${f.type}`;
      return requests === 5 && f.report.repairs === 2 ? null : `${requests} requests, ${f.report.repairs} repairs`;
    },
  },
  {
    name: "chunk 2 of 3 and its repairs invalid -> partial, chunks 1 and 3 kept",
    fixture: "multi-chunk.srt",
    responder: (body, n, nInCase) => ([2, 3, 4].includes(nInCase) ? { outputText: "not json" } : undefined),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "partial") return `final event ${f.type}`;
      if (f.report.translated !== 90 || reasons(f).join() !== "invalid-json") return `translated ${f.report.translated}, ${JSON.stringify(reasons(f))}`;
      return requests === 5 ? null : `${requests} requests`;
    },
  },
  {
    name: "429 twice (retry-after-ms) -> retried, complete",
    fixture: "basic.srt",
    responder: (body, n, nInCase) => (nInCase <= 2 ? { status: 429, headers: { "retry-after-ms": "5" } } : undefined),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "complete") return `final event ${f.type}`;
      if (events.filter((e) => e.type === "retry").length !== 2 || f.report.retries !== 2) return `retries ${f.report.retries}`;
      return requests === 3 ? null : `${requests} requests`;
    },
  },
  {
    name: "503 once without retry-after -> retried after backoff, complete",
    fixture: "basic.srt",
    responder: (body, n, nInCase) => (nInCase === 1 ? { status: 503 } : undefined),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "complete") return `final event ${f.type}`;
      return requests === 2 && f.report.retries === 1 ? null : `${requests} requests, ${f.report.retries} retries`;
    },
  },
  {
    name: "persistent 500 -> 3 retries, then error",
    fixture: "basic.srt",
    responder: () => ({ status: 500, headers: { "retry-after-ms": "5" } }),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "error") return `final event ${f.type}`;
      return requests === 4 ? null : `${requests} requests`;
    },
  },
  {
    name: "400 -> not retried, error",
    fixture: "basic.srt",
    responder: () => ({ status: 400, error: "bad request" }),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "error") return `final event ${f.type}`;
      return requests === 1 ? null : `${requests} requests`;
    },
  },
  {
    name: "429 insufficient_quota -> not retried, error",
    fixture: "basic.srt",
    responder: () => ({ status: 429, code: "insufficient_quota", error: "quota", headers: { "retry-after-ms": "5" } }),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "error") return `final event ${f.type}`;
      return requests === 1 ? null : `${requests} requests`;
    },
  },
  {
    name: "chunk 2 of 3 fails permanently -> partial, chunk 1 kept, chunk 3 not sent",
    fixture: "multi-chunk.srt",
    responder: (body, n, nInCase) => (nInCase === 2 ? { status: 401, error: "unauthorized" } : undefined),
    check: (events, requests) => {
      const f = finalEvent(events);
      if (f.type !== "partial") return `final event ${f.type}`;
      if (f.report.translated !== 60 || !f.report.failure) return `translated ${f.report.translated}`;
      return requests === 2 ? null : `${requests} requests`;
    },
  },
];
