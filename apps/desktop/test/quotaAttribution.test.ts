// @vitest-environment jsdom
// Design 052 §5 item 2: 「谁在用」 — the top 3 agents + 其它, 未归因 only above the tolerance, shares
// of the recorded usage when cutex has no calibration yet.
import { describe, expect, it } from "vitest";
import type { QuotaAttribution, QuotaAttributionRow } from "../src/shared/quotaAttribution";
import { attributionWindow, shareText, summarizeAttribution, UNATTRIBUTED_TOLERANCE } from "../src/renderer/src/lib/quotaAttribution";

const row = (name: string, units: number, percent: number | null, over: Partial<QuotaAttributionRow> = {}): QuotaAttributionRow => ({ cutexSessionId: `cutex.${name}`, agentName: name, units, percent, ...over });
const answer = (rows: QuotaAttributionRow[], over: Partial<QuotaAttribution> = {}): QuotaAttribution => ({
  window: { label: "5h", startAt: 0, resetAt: 18000, usedPercent: 100, observedAt: 1000 },
  calibration: { unitsPerPercent: 260000, windows: 9, confidence: "high" },
  rows,
  unattributedPercent: 7,
  ...over,
});

describe("summarizeAttribution", () => {
  it("top 3 by share, the rest as 其它, 未归因 hidden under the tolerance (the Ceobe 10-31 window)", () => {
    const s = summarizeAttribution(answer([row("ui-lead", 9_350_000, 36), row("review-insert-opus", 13_120_000, 50.4, { running: true }), row("alice", 1_610_000, 6.2), row("x", 100_000, 0.4), row("y", 50_000, 0.2)]))!;
    expect(s.calibrated).toBe(true);
    expect(s.top.map((l) => l.row.agentName)).toEqual(["review-insert-opus", "ui-lead", "alice"]);
    expect(s.top.map((l) => l.share)).toEqual([50.4, 36, 6.2]);
    expect(s.other).toEqual({ count: 2, share: expect.closeTo(0.6, 5) });
    expect(s.unattributed).toBeNull();
    expect(s.all).toHaveLength(5);
    expect(s.inFlight).toEqual(["review-insert-opus"]);
  });

  it("shows 未归因 at or above the tolerance; no 其它 with three rows or fewer", () => {
    const s = summarizeAttribution(answer([row("a", 10, 40), row("b", 5, 20)], { unattributedPercent: UNATTRIBUTED_TOLERANCE + 4, inFlight: [{ cutexSessionId: "cutex.a", agentName: "a", startedAt: 1 }] }))!;
    expect(s.unattributed).toBe(12);
    expect(s.other).toBeNull();
    expect(s.inFlight).toEqual(["a"]);
  });

  it("without a calibration: shares between agents (summing to 100), no 未归因, marked low confidence when cutex says so", () => {
    const s = summarizeAttribution(answer([row("a", 300, null), row("b", 100, null)], { calibration: null, unattributedPercent: 30 }))!;
    expect(s.calibrated).toBe(false);
    expect(s.top.map((l) => l.share)).toEqual([75, 25]);
    expect(s.unattributed).toBeNull();
    const low = summarizeAttribution(answer([row("a", 3, 10)], { calibration: { unitsPerPercent: 1, windows: 2, confidence: "low" } }))!;
    expect(low.lowConfidence).toBe(true);
  });

  it("v1: cutex's share without a calibration, its tolerancePercent, in-flight names without a row", () => {
    const uncal = { unitsPerPercent: null, windows: 0, confidence: "low" as const };
    const s = summarizeAttribution(answer([row("a", 300, null, { share: 60 }), row("b", 200, null, { share: 40 })], { calibration: uncal, unattributedPercent: null }))!;
    expect(s.calibrated).toBe(false);
    expect(s.top.map((l) => l.share)).toEqual([60, 40]);
    const tol = (unattributedPercent: number, tolerancePercent?: number) => summarizeAttribution(answer([row("a", 10, 40)], { unattributedPercent, tolerancePercent }))!.unattributed;
    expect(tol(12, 15)).toBeNull();
    expect(tol(15, 15)).toBe(15);
    expect(tol(5, 4)).toBe(5);
    const flying = summarizeAttribution(answer([row("a", 10, 40)], { inFlight: [{ cutexSessionId: "cutex.z", agentName: "z", startedAt: 1 }] }))!;
    expect(flying.inFlight).toEqual(["z"]);
  });

  it("nothing recorded → null", () => {
    expect(summarizeAttribution(answer([]))).toBeNull();
    expect(summarizeAttribution(answer([row("idle", 0, 0)]))).toBeNull();
  });

  it("share text and windows", () => {
    expect(shareText(0.4)).toBe("<1");
    expect(shareText(50.4)).toBe("50");
    expect(shareText(0)).toBe("0");
    expect(attributionWindow("5h")).toBe("5h");
    expect(attributionWindow("7d")).toBe("7d");
    expect(attributionWindow("Fable 7d")).toBeNull();
    expect(attributionWindow(null)).toBeNull();
  });
});

describe("one row per agent (review 2026-11-17)", () => {
  it("rows of one session on two models add up before the top 3", () => {
    const s = summarizeAttribution(
      answer([row("a", 50, 50, { cutexSessionId: "a", model: "opus" }), row("a", 30, 30, { cutexSessionId: "a", model: "sonnet" }), row("b", 15, 15, { cutexSessionId: "b" }), row("c", 5, 5, { cutexSessionId: "c" })], { unattributedPercent: 0 }),
    )!;
    expect(s.top.map((l) => [l.row.cutexSessionId, l.share])).toEqual([["a", 80], ["b", 15], ["c", 5]]);
    expect(s.top[0]!.row.model).toBeNull();
    expect(new Set(s.all.map((l) => l.row.cutexSessionId)).size).toBe(s.all.length);
  });

  it("uncalibrated shares add up too; rows without a session stay apart", () => {
    const uncal = { unitsPerPercent: null, windows: 0, confidence: "low" as const };
    const s = summarizeAttribution(
      answer([row("a", 30, null, { cutexSessionId: "a", share: 30 }), row("a", 30, null, { cutexSessionId: "a", share: 30 }), row("x", 20, null, { cutexSessionId: null, share: 20 }), row("y", 20, null, { cutexSessionId: null, share: 20 })], { calibration: uncal, unattributedPercent: null }),
    )!;
    expect(s.all.map((l) => [l.row.agentName, l.share])).toEqual([["a", 60], ["x", 20], ["y", 20]]);
  });

  it("an in-flight session with nothing recorded yet is named (0, running)", () => {
    const s = summarizeAttribution(answer([], { inFlight: [{ cutexSessionId: "cutex.new", agentName: "new", startedAt: 1 }] }))!;
    expect(s.top.map((l) => [l.row.agentName, l.share, l.row.running])).toEqual([["new", 0, true]]);
    expect(s.calibrated).toBe(true);
  });
});
