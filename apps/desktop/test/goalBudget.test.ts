import { describe, expect, it } from "vitest";
import { budgetText, parseBudget } from "../src/renderer/src/lib/goalBudget";

describe("goal budget", () => {
  it("parses k / M / plain / empty and rejects junk", () => {
    expect(parseBudget("200k")).toBe(200_000);
    expect(parseBudget("1.5M")).toBe(1_500_000);
    expect(parseBudget("50,000")).toBe(50_000);
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("∞")).toBeNull();
    expect(parseBudget("0")).toBeUndefined();
    expect(parseBudget("abc")).toBeUndefined();
  });
  it("formats round values compactly and round-trips", () => {
    expect(budgetText(null)).toBe("");
    expect(budgetText(2_000_000)).toBe("2M");
    expect(budgetText(250_000)).toBe("250k");
    expect(budgetText(12_345)).toBe("12345");
    for (const n of [2_000_000, 250_000, 12_345, 1_500_000]) expect(parseBudget(budgetText(n))).toBe(n);
  });
});
