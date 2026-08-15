import { describe, expect, it } from "vitest";
import { applyUsageToSpend, emptySpend, isTurnSpend } from "./threadSpend";

describe("thread spend", () => {
  it("ignores context-window snapshots", () => {
    expect(isTurnSpend({ totalTokens: 1200, contextSize: 500000 })).toBe(false);
    expect(applyUsageToSpend(emptySpend(), { totalTokens: 1200, contextSize: 500000 })).toEqual(
      emptySpend(),
    );
  });

  it("adds per-turn input and output from the start of the task", () => {
    const first = applyUsageToSpend(emptySpend(), { inputTokens: 40, outputTokens: 13, totalTokens: 53 });
    expect(first).toEqual({ input: 40, output: 13, total: 53 });
    const second = applyUsageToSpend(first, { inputTokens: 20, outputTokens: 8, totalTokens: 28 });
    expect(second).toEqual({ input: 60, output: 21, total: 81 });
  });

  it("keeps a rising session total instead of double-counting it", () => {
    const first = applyUsageToSpend(emptySpend(), { inputTokens: 40, outputTokens: 13, totalTokens: 53 });
    const second = applyUsageToSpend(first, { inputTokens: 60, outputTokens: 21, totalTokens: 81 });
    expect(second.total).toBe(81);
  });

  it("skips an identical snapshot", () => {
    const incoming = { inputTokens: 40, outputTokens: 13, totalTokens: 53 };
    const first = applyUsageToSpend(emptySpend(), incoming);
    expect(applyUsageToSpend(first, incoming, incoming)).toEqual(first);
  });
});
