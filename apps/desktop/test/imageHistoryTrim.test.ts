import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_HISTORY_TRIM, imageHistoryTrimOf, parseImageHistoryTrim, sameImageHistoryTrim, validImageHistoryTrim } from "../src/shared/imageHistoryTrim";

describe("image history trim (design 027 option C)", () => {
  it("defaults to over 20, keep 5", () => {
    expect(DEFAULT_IMAGE_HISTORY_TRIM).toEqual({ maxInline: 20, keep: 5 });
    expect(validImageHistoryTrim(DEFAULT_IMAGE_HISTORY_TRIM)).toBe(true);
  });
  it("validates cutex's ranges: keep 1..50, maxInline keep+1..500", () => {
    expect(validImageHistoryTrim({ maxInline: 2, keep: 1 })).toBe(true);
    expect(validImageHistoryTrim({ maxInline: 500, keep: 50 })).toBe(true);
    for (const bad of [{ maxInline: 20, keep: 0 }, { maxInline: 100, keep: 51 }, { maxInline: 5, keep: 5 }, { maxInline: 4, keep: 5 }, { maxInline: 501, keep: 5 }, { maxInline: 20.5, keep: 5 }, { maxInline: NaN, keep: 5 }])
      expect(validImageHistoryTrim(bad)).toBe(false);
  });
  it("parses the typed inputs, refusing anything invalid", () => {
    expect(parseImageHistoryTrim({ maxInline: " 30 ", keep: "8" })).toEqual({ maxInline: 30, keep: 8 });
    for (const bad of [{ maxInline: "", keep: "5" }, { maxInline: "20", keep: "" }, { maxInline: "1e2", keep: "5" }, { maxInline: "20", keep: "-1" }, { maxInline: "20", keep: "2.5" }, { maxInline: "5", keep: "5" }, { maxInline: "600", keep: "5" }])
      expect(parseImageHistoryTrim(bad)).toBeNull();
  });
  it("reads stored values and compares them", () => {
    expect(imageHistoryTrimOf({ maxInline: 20, keep: 5 })).toEqual({ maxInline: 20, keep: 5 });
    expect(imageHistoryTrimOf(null)).toBeNull();
    expect(imageHistoryTrimOf({ keep: 5 })).toBeNull();
    expect(sameImageHistoryTrim({ maxInline: 20, keep: 5 }, { maxInline: 20, keep: 5 })).toBe(true);
    expect(sameImageHistoryTrim({ maxInline: 20, keep: 5 }, null)).toBe(false);
    expect(sameImageHistoryTrim(null, null)).toBe(true);
  });
});
