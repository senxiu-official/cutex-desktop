import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTA_VIEW, defaultQuotaLabel, fillColor, gaugeLabel, gaugeShortLabel, gaugesFromRateLimits, mergeRateLimits, migrateQuotaView, QUOTA_READERS, quotaFill, quotaPercent, quotaTextKey, readerFollowsBaseUrl, remainingColor, remainingRatio, resetsIn, resetsInCompact, usageColor, quotaLabelProblem, quotaLabelValid, usedRatio, windowLabel, windowName, withQuotaLabel, type QuotaGauge } from "../src/renderer/src/lib/quota";
import { translate } from "../src/renderer/src/i18n";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

describe("Kimi Code plan windows (cutex kimi-code-plan)", () => {
  it("names the month window 本月 / This month and leaves rolling windows alone", () => {
    expect(zhCN["quota.window.month"]).toBe("本月");
    expect(en["quota.window.month"]).toBe("This month");
    const month = translate("quota.window.month");
    expect(windowName("month")).toBe(month);
    expect(windowName(" Month ")).toBe(month);
    for (const raw of ["5h", "7d", "week", "mon"]) expect(windowName(raw)).toBe(raw);
    expect(windowName(null)).toBe("");
    expect(gaugeLabel({ label: "Kimi", windowLabel: "month" })).toBe(`Kimi ${month}`);
    expect(gaugeShortLabel({ label: "Kimi", windowLabel: "month" })).toBe(month);
    expect(gaugeShortLabel({ label: "Kimi", windowLabel: "5h" })).toBe("5h");
  });

  it("knows the kimi_code_plan reader, which follows the profile's Base URL", () => {
    expect(QUOTA_READERS).toContain("kimi_code_plan");
    expect(readerFollowsBaseUrl("kimi_code_plan")).toBe(true);
    expect(zhCN["agent-config.quota.reader.kimi_code_plan"]).toBe("Kimi Code 会员套餐额度");
  });
});

const gauge = (remainingPercent: number | null): QuotaGauge => ({ id: "g", label: "g", kind: "window", remainingPercent, balance: null, resetAt: null, windowLabel: null, observedAt: null, stale: false });

describe("quota", () => {
  it("maps codex rate limits to gauges and merges sparse updates", () => {
    const first = mergeRateLimits(null, { primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: 100 }, secondary: null, credits: null });
    const next = mergeRateLimits(first, { primary: null, credits: { hasCredits: true, unlimited: false, balance: "5.00" } });
    const gauges = gaugesFromRateLimits(next);
    expect(gauges.map((g) => [g.kind, g.windowLabel, g.remainingPercent, g.balance])).toEqual([
      ["window", "7d", 73, null],
      ["balance", null, null, "5.00"],
    ]);
    expect(usedRatio(gauges[0]!)).toBeCloseTo(0.27);
    expect(usedRatio(gauges[1]!)).toBeNull();
  });

  it("formats windows and reset countdowns", () => {
    expect([windowLabel(300), windowLabel(10080), windowLabel(45), windowLabel(null)]).toEqual(["5h", "7d", "45m", ""]);
    expect(resetsIn((3 * 3600 + 4 * 60) , 0)).toBe("3h 4m");
    expect(resetsIn(null)).toBe("");
    expect(resetsInCompact(42 * 3600 + 120, 0)).toBe("1d18h");
    expect(resetsInCompact(2 * 3600 + 17 * 60, 0)).toBe("2h17m");
  });

  it("shows quota as remaining by default, used on request", () => {
    expect(DEFAULT_QUOTA_VIEW).toBe("remaining");
    expect([migrateQuotaView("used"), migrateQuotaView("remaining"), migrateQuotaView(undefined), migrateQuotaView("bogus"), migrateQuotaView(3)]).toEqual(["used", "remaining", "remaining", "remaining", "remaining"]);
    const g = gauge(62);
    expect([quotaFill(g, "remaining"), quotaFill(g, "used")]).toEqual([0.62, expect.closeTo(0.38)]);
    expect([quotaPercent(g, "remaining"), quotaPercent(g, "used")]).toEqual([62, 38]);
    expect([quotaTextKey("remaining"), quotaTextKey("used")]).toEqual(["composer.quota.left", "composer.quota.used"]);
    // unknown stays unknown in both views; out-of-range readings are clamped
    expect([quotaFill(gauge(null), "remaining"), quotaFill(gauge(null), "used"), quotaPercent(gauge(null), "remaining")]).toEqual([null, null, null]);
    expect([remainingRatio(gauge(120)), remainingRatio(gauge(-5)), quotaPercent(gauge(100.4), "remaining"), quotaPercent(gauge(-5), "used")]).toEqual([1, 0, 100, 100]);
  });

  it("colours by what is left: warn under 40 %, danger under 15 % (used 60 / 85 % mirrored)", () => {
    const accent = "var(--accent)", warn = "var(--warn)", danger = "var(--danger)";
    expect([1, 0.62, 0.4, 0.39, 0.15, 0.14, 0].map(remainingColor)).toEqual([accent, accent, accent, warn, warn, danger, danger]);
    expect(fillColor(0.14, "remaining")).toBe(danger);
    expect(fillColor(0.14)).toBe(accent); // "used" view / default: 14 % used is fine
    // every remaining-view colour matches the used-view colour of the complementary fraction
    for (const used of [0, 0.3, 0.59, 0.61, 0.84, 0.86, 1]) expect(remainingColor(1 - used)).toBe(usageColor(used));
  });
});

describe("quota reader label (cutex: 1–6 ASCII letters / digits)", () => {
  it("valid labels", () => {
    expect(quotaLabelValid("7d")).toBe(true);
    expect(quotaLabelValid("GLM5h")).toBe(true);
    expect(quotaLabelValid("额度")).toBe(false);
    expect(quotaLabelValid("")).toBe(false);
    expect(quotaLabelValid("abcdefg")).toBe(false);
    expect(quotaLabelValid("5 h")).toBe(false);
  });

  it("an empty label stands in with the window name, never a made-up default", () => {
    expect(defaultQuotaLabel("7d")).toBe("7d");
    expect(defaultQuotaLabel(" 5h ")).toBe("5h");
    expect(defaultQuotaLabel("7天")).toBe("");
    expect(defaultQuotaLabel(null)).toBe("");
  });

  it("problems shown under the field", () => {
    expect(quotaLabelProblem("", "7d")).toBeNull();
    expect(quotaLabelProblem("GLM", null)).toBeNull();
    expect(quotaLabelProblem("额度", "7d")).toBe("bad");
    expect(quotaLabelProblem("", null)).toBe("missing");
    expect(quotaLabelProblem("  ", "7天")).toBe("missing");
  });

  it("saved reader: trimmed, empty filled from the window", () => {
    expect(withQuotaLabel({ label: "", window_label: "7d" })).toEqual({ label: "7d", window_label: "7d" });
    expect(withQuotaLabel({ label: " GLM ", window_label: "5h" })).toEqual({ label: "GLM", window_label: "5h" });
    expect(withQuotaLabel({ label: "", window_label: null })).toEqual({ label: "", window_label: null });
  });
});
