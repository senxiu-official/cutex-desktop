// 用量 table 「每回合」 / 「每步上下文」 (modules/usage/shape.ts) and the peak request across hosts (merge.ts).
import { describe, expect, it } from "vitest";
import type { UsageReport } from "../src/shared/ipc";
import { HEAVY_STEP_CONTEXT, turnShape } from "../src/renderer/src/modules/usage/shape";
import { mergeUsageReports } from "../src/renderer/src/modules/usage/merge";

describe("usage turn shape", () => {
  it("divides input by turns and by model requests", () => {
    const s = turnShape({ turns: 4, requests: 40, input: 4_000_000, maxRequestInput: 150_000 });
    expect(s).toEqual({ perTurn: 1_000_000, perStep: 100_000, stepsPerTurn: 10, peak: 150_000, heavy: false });
  });

  it("flags a large context re-sent on every step, or a huge turn", () => {
    expect(turnShape({ turns: 2, requests: 20, input: 20 * HEAVY_STEP_CONTEXT }).heavy).toBe(true);
    expect(turnShape({ turns: 1, requests: 200, input: 12_000_000 }).heavy).toBe(true);
    // One large request near compaction alone is not a runaway.
    expect(turnShape({ turns: 5, requests: 50, input: 5_000_000, maxRequestInput: 380_000 }).heavy).toBe(false);
  });

  it("has no numbers without turns or requests, and no peak from an older cutex", () => {
    expect(turnShape({ turns: 0, requests: 0, input: 0 })).toEqual({ perTurn: null, perStep: null, stepsPerTurn: null, peak: null, heavy: false });
  });
});

describe("usage all hosts: largest request", () => {
  const amounts = (input: number, max?: number) => ({ turns: 1, requests: 2, input, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: input, ...(max !== undefined ? { maxRequestInput: max } : {}) });
  const report = (max?: number): UsageReport => ({ from: "2026-10-22", to: "2026-10-22", groupBy: ["agent"], totals: amounts(10, max), rows: [{ key: { agent: "a" }, ...amounts(10, max) }], recordingSince: null, warnings: [] }) as UsageReport;

  it("takes the maximum, not the sum", () => {
    const m = mergeUsageReports([{ hostId: "h1", label: "a", report: report(300) }, { hostId: "h2", label: "b", report: report(200) }]);
    expect(m.report.totals.maxRequestInput).toBe(300);
    expect(m.report.totals.input).toBe(20);
  });

  it("stays absent when no host reports it", () => {
    const m = mergeUsageReports([{ hostId: "h1", label: "a", report: report() }, { hostId: "h2", label: "b", report: report() }]);
    expect(m.report.totals.maxRequestInput).toBeUndefined();
  });
});
