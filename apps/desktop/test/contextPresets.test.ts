import { describe, expect, it } from "vitest";
import { compactPercentOf, formatWindow, parseWindow } from "../src/renderer/src/lib/contextPresets";

describe("context presets", () => {
  it("formats and parses windows", () => {
    expect([formatWindow(256_000), formatWindow(1_000_000), formatWindow(1_500_000), formatWindow(null)]).toEqual(["256K", "1M", "1.5M", "—"]);
    expect([parseWindow("256k"), parseWindow("1m"), parseWindow("300000"), parseWindow("abc"), parseWindow("")]).toEqual([256_000, 1_000_000, 300_000, null, null]);
    expect([parseWindow("285k"), parseWindow("0.1"), parseWindow("9999999999999999999999")]).toEqual([285_000, null, null]);
  });
  it("detects compact percent presets", () => {
    expect(compactPercentOf(204_800, 256_000)).toBe(80);
    expect(compactPercentOf(150_000, 256_000)).toBeNull();
  });
});
