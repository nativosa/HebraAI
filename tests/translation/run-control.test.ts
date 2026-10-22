import { describe, expect, it } from "vitest";
import { RunControl } from "@/lib/translation/run-control";

describe("RunControl", () => {
  it("the started run is current until it is cancelled", () => {
    const runs = new RunControl();
    const { id, signal } = runs.start();
    expect(runs.isCurrent(id)).toBe(true);
    runs.cancel();
    expect(runs.isCurrent(id)).toBe(false);
    expect(signal.aborted).toBe(true);
  });

  it("starting a new run supersedes and aborts the previous one", () => {
    const runs = new RunControl();
    const first = runs.start();
    const second = runs.start();
    expect(first.signal.aborted).toBe(true);
    expect(runs.isCurrent(first.id)).toBe(false);
    expect(runs.isCurrent(second.id)).toBe(true);
  });

  // The race the UI guards against: a result has already arrived (the await
  // resolved) when Cancel is pressed, before the result is applied.
  it("a result received before Cancel but applied after it is discarded", async () => {
    const runs = new RunControl();
    const { id } = runs.start();
    const applied: string[] = [];
    const result = Promise.resolve("complete");
    runs.cancel(); // user presses Cancel
    const value = await result;
    if (runs.isCurrent(id)) applied.push(value);
    expect(applied).toEqual([]);
  });

  it("cancel without a run is harmless", () => {
    expect(() => new RunControl().cancel()).not.toThrow();
  });
});
