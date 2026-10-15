import { describe, expect, it } from "vitest";
import type { AgentSignal, NeedsYou } from "./agentAttention";
import { compactAttentionText, statusTail, tailTier } from "./statusTail";

const needs = (count: number, ...reasons: NeedsYou["reasons"]): NeedsYou => ({ count, reasons, askIds: [] });

describe("tailTier", () => {
  it("puts every state on one of three tiers", () => {
    const tiers: Record<AgentSignal, string> = {
      needsYou: "attention",
      error: "attention",
      running: "activity",
      done: "passive",
      idle: "passive",
      offline: "passive",
      unknown: "passive",
    };
    for (const [signal, tier] of Object.entries(tiers)) expect(tailTier(signal as AgentSignal)).toBe(tier);
  });
});

describe("statusTail", () => {
  it("keeps the colour budget: a pill for pending decisions (warn) and 出错 (danger), quiet for the rest", () => {
    expect(statusTail("needsYou")).toEqual({ tier: "attention", tone: "warn" });
    expect(statusTail("error")).toEqual({ tier: "attention", tone: "danger" });
    for (const r of ["confirm", "question", "approval"] as const) expect(statusTail("needsYou", null, needs(1, r))).toEqual({ tier: "attention", tone: "warn" });
    for (const r of ["review", "acceptance", "check", "ownerMessage"] as const) expect(statusTail("needsYou", null, needs(1, r))).toEqual({ tier: "attention", tone: "quiet" });
    expect(statusTail("needsYou", null, needs(2, "review", "question"))).toEqual({ tier: "attention", tone: "warn" });
  });

  it("running is a dot with its start time (null = dot only)", () => {
    expect(statusTail("running", 1000)).toEqual({ tier: "activity", kind: "running", since: 1000 });
    expect(statusTail("running")).toEqual({ tier: "activity", kind: "running", since: null });
  });

  it("passive states are 完成 or the last activity", () => {
    expect(statusTail("done")).toEqual({ tier: "passive", kind: "done" });
    for (const s of ["idle", "offline", "unknown"] as const) expect(statusTail(s, 5)).toEqual({ tier: "passive", kind: "lastActivity" });
  });
});

describe("compactAttentionText", () => {
  it("shrinks needs-you to its count, whatever the reason", () => {
    expect(compactAttentionText("needsYou", undefined)).toBe("1");
    expect(compactAttentionText("needsYou", needs(1, "review"))).toBe("1");
    expect(compactAttentionText("needsYou", needs(4, "confirm", "acceptance"))).toBe("4");
    expect(compactAttentionText("needsYou", needs(12, "approval"))).toBe("9+");
  });

  it("keeps the full label for other signals", () => {
    for (const s of ["error", "running", "done", "idle"] as const) expect(compactAttentionText(s, needs(2, "confirm"))).toBeNull();
  });
});
