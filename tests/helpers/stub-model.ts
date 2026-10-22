import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { CreateResponse } from "@/lib/translation/pipeline";
import type { ModelResponse } from "@/lib/translation/response";
import { echoItems } from "../../scripts/fake-openai.mjs";

// What the stub answers to call n: raw output text, a full response object,
// or an Error to throw.
export type StubReply = string | undefined | Error | ModelResponse;

// In-process stand-in for the model: no network. By default it answers like
// the offline fake server (scripts/fake-openai.mjs): every item comes back as
// "[HE] " + text. `outputs` overrides the answer per call (1-based).
export function stubModel(outputs: Record<number, StubReply> = {}) {
  const calls: ResponseCreateParamsNonStreaming[] = [];
  const createResponse: CreateResponse = async (params) => {
    calls.push(params);
    const n = calls.length;
    if (n in outputs) {
      const out = outputs[n];
      if (out instanceof Error) throw out;
      if (typeof out === "object") return out;
      return { output_text: out as string };
    }
    return { output_text: JSON.stringify(echoItems(params)) };
  };
  return { calls, createResponse };
}

// Responses with a status or refusal, as the Responses API returns them.
export const refusalResponse: ModelResponse = {
  output_text: "",
  status: "completed",
  output: [{ type: "message", content: [{ type: "refusal" }] }],
};

export const incompleteResponse = (reason: string, output_text = '{"items":[{"index":1,'): ModelResponse => ({
  output_text,
  status: "incomplete",
  incomplete_details: { reason },
});

// The subtitle items sent in a request (the JSON array after the blank line).
export function itemsSent(params: ResponseCreateParamsNonStreaming): { index: number; text: string }[] {
  const text = (params.input as { content: { text: string }[] }[])[0].content[0].text;
  return JSON.parse(text.slice(text.indexOf("\n\n[") + 2));
}

// A model output translating the given ids as "HE<id>".
export const itemsFor = (...ids: number[]) =>
  JSON.stringify({ items: ids.map((id) => ({ index: id, text_he: `HE${id}` })) });
