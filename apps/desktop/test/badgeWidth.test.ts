import { describe, expect, it } from "vitest";
import { projectBadgeWidth, BADGE_MAX_WIDTH, clipToWidth, displayWidth, isBadgeLabelError } from "../src/renderer/src/lib/badgeWidth";
import { autoBadge } from "../src/renderer/src/lib/projectCreate";
import { zhCN } from "../src/renderer/src/modules/projects/i18n";
import { en } from "../src/renderer/src/modules/projects/i18n.en";

describe("badge display width (cutex: 1..=2 columns)", () => {
  it("CJK / fullwidth / emoji count 2, Latin 1", () => {
    expect(displayWidth("桌")).toBe(2);
    expect(displayWidth("CD")).toBe(2);
    expect(displayWidth("ＡＢ")).toBe(4);
    expect(displayWidth("🚀")).toBe(2);
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("👩🏽‍💻")).toBe(2);
    expect(displayWidth("🇹🇼")).toBe(2);
    expect(displayWidth("1️⃣")).toBe(2);
    expect(clipToWidth("👩🏽‍💻A", 2)).toBe("👩🏽‍💻");
  });
  it("input is clipped to the max, whole characters", () => {
    expect(BADGE_MAX_WIDTH).toBe(2);
    expect(clipToWidth("ABCD")).toBe("AB");
    expect(clipToWidth("桌面")).toBe("桌");
    expect(clipToWidth("A桌")).toBe("A");
    expect(clipToWidth("桌", 4)).toBe("桌");
    expect(clipToWidth("桌面项目x", 4)).toBe("桌面");
  });
  it("the automatic badge always fits", () => {
    expect(autoBadge("cutex-desktop")).toBe("CU");
    expect(autoBadge("桌面项目")).toBe("桌");
    expect(displayWidth(autoBadge("桌面项目"))).toBeLessThanOrEqual(BADGE_MAX_WIDTH);
  });
  it("cutex's refusal is recognised; the hint says 1 CJK or 2 letters", () => {
    expect(isBadgeLabelError(new Error("invalid_project_badge_label: width"))).toBe(true);
    expect(isBadgeLabelError(new Error("other"))).toBe(false);
    expect(zhCN["projects.badgeHint"]).toContain("1 个汉字或 2 个字母");
    expect(en["projects.badgeHint"]).toContain("1 CJK character or 2 letters");
  });
});


describe("project-badge-wide capability", () => {
  it("keeps the old width unless this host advertises the feature", () => {
    expect(projectBadgeWidth(new Set())).toBe(2);
    expect(projectBadgeWidth(new Set(["project-badge-wide"]))).toBe(4);
    expect(autoBadge("桌面项目", 4)).toBe("桌面");
    expect(autoBadge("abcde", 4)).toBe("ABCD");
    expect(clipToWidth("桌ABX", 4)).toBe("桌AB");
    expect(zhCN["projects.badgeHintWide"]).toContain("2 个汉字或 4 个字母");
  });
});
