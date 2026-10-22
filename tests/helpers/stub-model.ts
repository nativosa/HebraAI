import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { CreateResponse } from "@/lib/translation/pipeline";
import { echoItems } from "../../scripts/fake-openai.mjs";

// In-process stand-in for the model: no network. By default it answers like
// the offline fake server (scripts/fake-openai.mjs): every item comes back as
// "[HE] " + text. `outputs` overrides the raw output text per call (1-based).
export function stubModel(outputs: Record<number, string | undefined | Error> = {}) {
  const calls: ResponseCreateParamsNonStreaming[] = [];
  const createResponse: CreateResponse = async (params) => {
    calls.push(params);
    const n = calls.length;
    if (n in outputs) {
      const out = outputs[n];
      if (out instanceof Error) throw out;
      return { output_text: out as string };
    }
    return { output_text: JSON.stringify(echoItems(params)) };
  };
  return { calls, createResponse };
}

// The subtitle items sent in a request (the JSON array after the blank line).
export function itemsSent(params: ResponseCreateParamsNonStreaming): { index: number; text: string }[] {
  const text = (params.input as { content: { text: string }[] }[])[0].content[0].text;
  return JSON.parse(text.slice(text.indexOf("\n\n[") + 2));
}
