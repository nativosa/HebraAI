import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "@/lib/translation/pipeline";
import { parseSrt } from "@/lib/srt/parse";
import { removeSoundEffectCues } from "@/lib/srt/sound-effects";
import { parseTranslateOptions } from "@/lib/translation/options";
import { buildChunkRequest, buildInstructions } from "@/lib/translation/prompt";
import { caseToSrt, loadCases } from "../../eval/lib/cases.mjs";
import { CHUNK, planCase } from "../../eval/lib/plan.mjs";
import { buildRequest } from "../../eval/lib/request.mjs";
import {
  DEFAULT_BUDGET_USD,
  addEstimates,
  canStart,
  chargeFor,
  checkBudget,
  orderRuns,
  worstCase,
  costUsd,
  estimateRequest,
  pricesFrom,
  sampleCases,
} from "../../eval/lib/estimate.mjs";

describe("estimateRequest", () => {
  it("over-estimates input (3 chars/token) and output incl. a reasoning allowance", () => {
    expect(estimateRequest({ requestChars: 3000, sourceChars: 400, items: 10 })).toEqual({
      requests: 1,
      inputTokens: 1000,
      outputTokens: 640, // (400 / 2 + 10 * 12) * 2
    });
  });

  it("adds estimates", () => {
    const a = estimateRequest({ requestChars: 30, sourceChars: 2, items: 1 });
    expect(addEstimates(a, a)).toEqual({ requests: 2, inputTokens: 20, outputTokens: 52 });
  });
});

describe("costUsd / pricesFrom", () => {
  it("prices tokens per million", () => {
    expect(costUsd({ inputTokens: 500_000, outputTokens: 100_000 }, { inputPerMTok: 2, outputPerMTok: 8 })).toBe(1.8);
  });

  it("needs both input and output prices", () => {
    expect(pricesFrom({ OPENAI_PRICE_INPUT_PER_MTOK: "2", OPENAI_PRICE_OUTPUT_PER_MTOK: "8" })).toEqual({ inputPerMTok: 2, outputPerMTok: 8 });
    expect(
      pricesFrom({ OPENAI_PRICE_INPUT_PER_MTOK: "1.75", OPENAI_PRICE_CACHED_INPUT_PER_MTOK: "0.175", OPENAI_PRICE_OUTPUT_PER_MTOK: "14" })
    ).toEqual({ inputPerMTok: 1.75, cachedInputPerMTok: 0.175, outputPerMTok: 14 });
    // Estimates assume no cached input: the full input price applies.
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0 }, { inputPerMTok: 1.75, cachedInputPerMTok: 0.175, outputPerMTok: 14 })).toBe(1.75);
    expect(pricesFrom({ OPENAI_PRICE_INPUT_PER_MTOK: "2" })).toBeNull();
    expect(pricesFrom({ OPENAI_PRICE_INPUT_PER_MTOK: "x", OPENAI_PRICE_OUTPUT_PER_MTOK: "8" })).toBeNull();
    expect(pricesFrom({})).toBeNull();
  });
});

describe("canStart (budget)", () => {
  it("has a conservative default budget", () => {
    expect(DEFAULT_BUDGET_USD).toBeLessThanOrEqual(1);
  });

  it("starts a case only if spent + estimate * margin fits", () => {
    expect(canStart({ spentUsd: 0.3, nextEstimateUsd: 0.1, budgetUsd: 0.5 })).toBe(true); // 0.45
    expect(canStart({ spentUsd: 0.4, nextEstimateUsd: 0.1, budgetUsd: 0.5 })).toBe(false); // 0.55
    expect(canStart({ spentUsd: 0, nextEstimateUsd: 0.4, budgetUsd: 0.5, margin: 1 })).toBe(true);
  });
});

describe("sampleCases", () => {
  const cases = ["a-1", "a-2", "a-3", "b-1", "b-2", "c-1"].map((id) => ({ id, category: id[0] }));

  it("takes cases round-robin across categories in id order", () => {
    expect(sampleCases(cases, 4).map((c) => c.id)).toEqual(["a-1", "b-1", "c-1", "a-2"]);
  });

  it("returns everything when the sample is at least the dataset", () => {
    expect(sampleCases(cases, 0)).toBe(cases);
    expect(sampleCases(cases, 99)).toBe(cases);
  });
});

describe("plan constants", () => {
  it("uses the app's chunk size", () => {
    expect(CHUNK).toBe(CHUNK_SIZE);
  });
});

describe("planCase (classic)", () => {
  const app = { parseSrt, removeSoundEffectCues, parseTranslateOptions, buildInstructions, buildChunkRequest };
  const cases = loadCases("eval/cases/synthetic");
  const byId = (id: string) => cases.find((c) => c.id === id)!;

  it("plans one request per 60 cues", () => {
    expect(planCase(byId("spk-01"), "classic", app).requests).toBe(1);
    expect(planCase(byId("cc-01"), "classic", app).requests).toBe(2);
    expect(planCase(byId("nm-06"), "classic", app).requests).toBe(3);
  });

  it("sizes input from the exact request the route builds", () => {
    const c = byId("spk-01");
    const cues = parseSrt(caseToSrt(c)).cues;
    const form = new FormData();
    for (const [k, v] of Object.entries(buildRequest(c, "classic").fields)) form.append(k, v as string);
    const request = buildChunkRequest(buildInstructions(parseTranslateOptions(form)), cues);
    expect(planCase(c, "classic", app).inputTokens).toBe(Math.ceil(JSON.stringify(request).length / 3));
  });

  it("refuses modes the app does not implement yet", () => {
    expect(() => planCase(byId("spk-01"), "context", app)).toThrow("no request plan");
  });

  it("estimates the whole synthetic dataset", () => {
    const total = cases.map((c) => planCase(c, "classic", app)).reduce(addEstimates);
    expect(total.requests).toBe(cases.reduce((n, c) => n + Math.ceil(c.expandedCues.length / 60), 0));
  });
});

describe("budget planning", () => {
  const cs = ["a-1", "a-2", "b-1", "c-1"].map((id) => ({ id, category: id[0] }));

  it("orders runs round-robin across categories with all modes of a case together", () => {
    expect(orderRuns(cs, ["classic", "context"], 1).map((r) => `${r.c.id}/${r.mode}`)).toEqual([
      "a-1/classic", "a-1/context", "b-1/classic", "b-1/context", "c-1/classic", "c-1/context", "a-2/classic", "a-2/context",
    ]);
  });

  it("checks the whole plan with the margin against the budget", () => {
    expect(checkBudget({ totalUsd: 0.46, budgetUsd: 0.5, margin: 1.5 })).toEqual({ fits: false, requiredUsd: 0.69 });
    expect(checkBudget({ totalUsd: 0.3, budgetUsd: 0.5, margin: 1.5 })).toEqual({ fits: true, requiredUsd: 0.45 });
  });

  it("reports the worst single case with all attempts used", () => {
    const runs = [{ c: { id: "x" }, mode: "classic", estimateUsd: 0.01 }, { c: { id: "y" }, mode: "classic", estimateUsd: 0.05 }];
    expect(worstCase(runs, 6)).toEqual({ caseId: "y", mode: "classic", usd: 0.3 });
  });

  it("charges retries at the per-request estimate, and the estimate when nothing was reported", () => {
    expect(chargeFor({ reportedUsd: 0.01, retries: 2, estimateUsd: 0.04, estimateRequests: 2 })).toBe(0.05);
    expect(chargeFor({ reportedUsd: undefined, retries: 0, estimateUsd: 0.04, estimateRequests: 2 })).toBe(0.04);
  });
});
