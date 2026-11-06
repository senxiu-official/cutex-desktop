// @vitest-environment jsdom
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { quotaEvenPaceRemaining, quotaWindowSeconds, type QuotaGauge } from "../src/renderer/src/lib/quota";
const NOW = Date.UTC(2026, 10, 3, 12);
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key, useI18n: () => ({ t: (_key: string, args: { percent: number }) => `Even pace: ${args.percent}% left` }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => Date.UTC(2026, 10, 3, 12) }));
import { GaugeBar } from "../src/renderer/src/components/GaugeBar";
const gauge = (overrides: Partial<QuotaGauge> = {}): QuotaGauge => ({ id: "g", label: "reader", kind: "window", balance: null, remainingPercent: 75, resetAt: NOW / 1000 + 2.5 * 3600, windowLabel: "5h", observedAt: NOW / 1000, stale: false, ...overrides });
describe("quota even pace", () => {
  it("puts a 5h window with 2h30m left at 50%", () => {
    expect(quotaEvenPaceRemaining(gauge(), NOW)).toBe(0.5);
  });
  it("uses explicit day/week durations, including model-scoped windows", () => {
    const resetAt = NOW / 1000 + 36 * 3600;
    expect(quotaEvenPaceRemaining(gauge({ windowLabel: "7d", resetAt }), NOW)).toBeCloseTo(36 / 168);
    expect(quotaEvenPaceRemaining(gauge({ windowLabel: "Fable 7d", resetAt }), NOW)).toBeCloseTo(36 / 168);
    expect(quotaEvenPaceRemaining(gauge({ windowLabel: "week", resetAt }), NOW)).toBeCloseTo(36 / 168);
    expect(quotaWindowSeconds("90m")).toBe(5400);
  });
  it("clamps reset / expired / full-window edges", () => {
    expect(quotaEvenPaceRemaining(gauge({ resetAt: NOW / 1000 }), NOW)).toBe(0);
    expect(quotaEvenPaceRemaining(gauge({ resetAt: NOW / 1000 - 60 }), NOW)).toBe(0);
    expect(quotaEvenPaceRemaining(gauge({ resetAt: NOW / 1000 + 5 * 3600 }), NOW)).toBe(1);
    expect(quotaEvenPaceRemaining(gauge({ resetAt: NOW / 1000 + 8 * 3600 }), NOW)).toBe(1);
  });
  it("does not guess missing resets, calendar lengths, balances or arbitrary labels", () => {
    for (const overrides of [{ resetAt: null }, { windowLabel: null }, { windowLabel: "month" }, { windowLabel: "points" }, { windowLabel: "unknown" }, { kind: "balance" as const }, { error: "unavailable" }, { resetAt: NaN }]) {
      expect(quotaEvenPaceRemaining(gauge(overrides), NOW)).toBeNull();
    }
    expect(quotaEvenPaceRemaining(gauge({ windowLabel: "Provider C 7d", resetAt: null }), NOW)).toBeNull();
    expect(quotaEvenPaceRemaining(gauge({ windowLabel: null, label: "5h" }), NOW)).toBeNull();
    expect(quotaEvenPaceRemaining(gauge(), Infinity)).toBeNull();
    for (const label of ["0h", "-5h", "weekly-ish", "7d credits"]) expect(quotaWindowSeconds(label)).toBeNull();
  });
  it("keeps actual quota fill independent from the titled pace marker", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(h(GaugeBar, { ratio: 0.75, view: "remaining", gauge: gauge() }));
    const meter = host.querySelector('[role="meter"]')!;
    expect(meter.getAttribute("aria-valuenow")).toBe("75");
    const marker = host.querySelector<HTMLElement>("[data-quota-even-pace]")!;
    expect(marker.title).toBe("Even pace: 50% left");
    expect(marker.style.left).toBe("50%");
    host.innerHTML = renderToStaticMarkup(h(GaugeBar, { ratio: 0.75, view: "remaining", gauge: gauge({ resetAt: null }) }));
    expect(host.querySelector("[data-quota-even-pace]")).toBeNull();
  });
});
