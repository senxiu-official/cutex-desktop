import { describe, expect, it } from "vitest";
import type { NeedsYou } from "../src/renderer/src/lib/agentAttention";
import { chipIsCompact, chipTone, DEFAULT_STATUS_CHIPS, migrateStatusChips, STATUS_CHIPS } from "../src/renderer/src/lib/statusChips";

const needs = (count: number, ...reasons: NeedsYou["reasons"]): NeedsYou => ({ count, reasons, askIds: [] });

describe("状态标签 pref", () => {
  it("defaults to 自动 and keeps only known values", () => {
    expect(DEFAULT_STATUS_CHIPS).toBe("auto");
    expect(STATUS_CHIPS).toEqual(["auto", "detailed", "compact"]);
    expect(migrateStatusChips(undefined)).toBe("auto");
    expect(migrateStatusChips("tiny")).toBe("auto");
    expect(migrateStatusChips("compact")).toBe("compact");
    expect(migrateStatusChips("detailed")).toBe("detailed");
  });
});

describe("chipIsCompact", () => {
  const fit = { lineWidth: 160, nameWidth: 60, otherWidth: 20, chipWidth: 50 };
  it("fixed modes ignore the measurement", () => {
    expect(chipIsCompact("compact", null)).toBe(true);
    expect(chipIsCompact("detailed", { ...fit, lineWidth: 10 })).toBe(false);
  });
  it("自动: text while name + rest + text chip fit, icon once the name would be truncated", () => {
    expect(chipIsCompact("auto", fit)).toBe(false);
    expect(chipIsCompact("auto", { ...fit, lineWidth: 130 })).toBe(false); // exactly fits
    expect(chipIsCompact("auto", { ...fit, lineWidth: 129 })).toBe(true);
    expect(chipIsCompact("auto", { ...fit, nameWidth: 120 })).toBe(true);
  });
  it("自动 before the first measurement shows the text chip", () => {
    expect(chipIsCompact("auto", null)).toBe(false);
    expect(chipIsCompact("auto", { ...fit, lineWidth: 0 })).toBe(false);
  });
});

describe("chip colour budget (quiet pass)", () => {
  it("keeps colour for errors and pending decisions only", () => {
    expect(chipTone("error", undefined)).toBe("error");
    expect(chipTone("needsYou", undefined)).toBe("urgent");
    expect(chipTone("needsYou", needs(1, "approval"))).toBe("urgent");
    expect(chipTone("needsYou", needs(1, "question"))).toBe("urgent");
    expect(chipTone("needsYou", needs(2, "review", "confirm"))).toBe("urgent");
    expect(chipTone("needsYou", needs(1, "review"))).toBe("quiet");
    expect(chipTone("needsYou", needs(1, "acceptance"))).toBe("quiet");
    expect(chipTone("needsYou", needs(1, "check"))).toBe("quiet");
    expect(chipTone("needsYou", needs(2, "ownerMessage", "ownerReply"))).toBe("quiet");
    expect(chipTone("done", undefined)).toBe("quiet");
  });
});
