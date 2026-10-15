// Identity menu → 用量 ▸ (renderer lib/usageFlyout): the layout shown before the refresh is done.
import { describe, expect, it } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";
import { fireHostReset, fireHostSwitch } from "../src/renderer/src/lib/hostSwitch";
import { cachedUsage, PREDICTED_GAUGES, predictUsage, rememberUsage, usageLayout } from "../src/renderer/src/lib/usageFlyout";

const g = (id: string): QuotaGauge => ({ id, label: id, kind: "window", remainingPercent: 50, balance: null, resetAt: null, windowLabel: id, observedAt: null, stale: false });
const p = (name: string, authKind: "chatgpt" | "apiKey" | "claude" | "none", quotaEnabled = false, cliKind = "codex") => ({ name, authKind, quotaEnabled, cliKind });

describe("predictUsage", () => {
  it("expects quota from ChatGPT / Claude logins and API keys with a reader", () => {
    const layout = predictUsage([p("gamma", "chatgpt"), p("Kimi", "apiKey", true), p("relay", "apiKey"), p("cc", "none", false, "claude"), p("x", "none")]);
    expect(layout.rows).toEqual(["gamma", "Kimi", "cc"]);
    expect(layout.off).toEqual(["relay", "x"]);
    expect(layout.counts).toEqual({ gamma: PREDICTED_GAUGES, Kimi: PREDICTED_GAUGES, cc: PREDICTED_GAUGES });
  });
});

describe("usageLayout", () => {
  const names = ["a", "b", "c"];
  it("waits while a quota is unknown", () => {
    expect(usageLayout(names, { a: [g("5h")], b: [] }, false)).toBeNull();
  });
  it("is final once every read finished; unknown ones drop out", () => {
    expect(usageLayout(names, { a: [g("5h"), g("7d")], b: [] }, true)).toEqual({ rows: ["a"], off: ["b"], counts: { a: 2 } });
  });
  it("needs no refresh when every quota is known", () => {
    expect(usageLayout(names, { a: [g("5h")], b: [], c: [g("bal")] }, false)).toEqual({ rows: ["a", "c"], off: ["b"], counts: { a: 1, c: 1 } });
  });
});

describe("usage cache", () => {
  const snap = { rows: ["a"], off: [], counts: { a: 1 }, gauges: { a: [g("5h")] } };
  it("is per host and dropped on a host switch", () => {
    rememberUsage("h1", snap);
    rememberUsage("h2", snap);
    expect(cachedUsage("h1")).toBe(snap);
    fireHostReset("h1");
    expect(cachedUsage("h1")).toBeNull();
    expect(cachedUsage("h2")).toBe(snap);
    fireHostSwitch();
    expect(cachedUsage("h2")).toBeNull();
  });
});
