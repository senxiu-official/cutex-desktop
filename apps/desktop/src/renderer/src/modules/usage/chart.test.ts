import { describe, expect, it } from "vitest";
import { claudeFiveHourGauge, DEFAULT_USAGE_SPLIT } from "./chart";
import { turnShape } from "./shape";

describe("usage defaults and Claude quota explanation", () => {
  it("opens the ledger split by profile so step usage is visible", () => {
    expect(DEFAULT_USAGE_SPLIT).toBe("profile");
  });

  it("marks only Claude's five-hour window", () => {
    expect(claudeFiveHourGauge({ id: "claude-primary", windowLabel: "5h" })).toBe(true);
    expect(claudeFiveHourGauge({ id: "claude-primary", windowLabel: "7d" })).toBe(false);
    expect(claudeFiveHourGauge({ id: "codex-primary", windowLabel: "5h" })).toBe(false);
  });

  it("keeps the largest request as the max-context signal", () => {
    expect(turnShape({ turns: 2, requests: 8, input: 80_000, maxRequestInput: 31_000 }).peak).toBe(31_000);
    expect(turnShape({ turns: 1, requests: 2, input: 10 }).peak).toBeNull();
  });
});
