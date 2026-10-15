import { describe, expect, it } from "vitest";
import type { QuotaGauge, QuotaReaderConfig } from "../src/shared/ipc";
import { gaugeErrors, gaugesFromRateLimits, isKnownQuotaReader, isQuotaReaderPreset, latestObservedAt, mergeGauges, observedClock, QUOTA_READERS, quotaDraftNeedsReader, quotaEventPlanChanged, quotaEventProfiles, quotaPresetChoices, quotaPresetLabel, quotaReadersOff, readerFollowsBaseUrl, usesQuotaReaders, wantsNativeQuotaFallback, withPrimaryEnabled } from "../src/renderer/src/lib/quota";
import { compareVersions, headerPlan, isOfficialLogin, planLabelPatch, planLabelReset, planLabelResettable, profileKind, sessionsUsingProfile, upstreamModelsNotice } from "../src/renderer/src/lib/profileKind";
import { applyEvent, emptyTimeline } from "../src/renderer/src/lib/timeline";

const g = (id: string, over: Partial<QuotaGauge> = {}): QuotaGauge => ({ id, label: id, kind: "window", remainingPercent: 50, balance: null, resetAt: null, windowLabel: null, observedAt: null, stale: false, ...over });

describe("quota merge", () => {
  it("keeps cutex gauges, replaces same id only when the live one is newer, appends new ids", () => {
    const base = [g("codex-primary", { remainingPercent: 80, observedAt: 100 }), g("glm", { observedAt: 100 })];
    const merged = mergeGauges(base, [g("codex-primary", { remainingPercent: 70, observedAt: 200 }), g("codex-credits", { kind: "balance", balance: "5" })]);
    expect(merged.map((x) => [x.id, x.remainingPercent])).toEqual([["codex-primary", 70], ["glm", 50], ["codex-credits", 50]]);
    expect(mergeGauges(base, [g("codex-primary", { remainingPercent: 10, observedAt: 50 })])[0]!.remainingPercent).toBe(80);
    expect(latestObservedAt(merged)).toBe(200);
  });

  it("stamps derived gauges with the observed time", () => {
    const gauges = gaugesFromRateLimits({ primary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: 1 }, secondary: null, credits: { hasCredits: true, unlimited: false, balance: "62419.18" } }, 1234);
    expect(gauges.map((x) => [x.id, x.observedAt])).toEqual([["codex-primary", 1234], ["codex-credits", 1234]]);
  });

  it("formats the observed clock (HH:MM today, date otherwise)", () => {
    const at = new Date(2026, 9, 7, 9, 5).getTime() / 1000;
    expect(observedClock(at, new Date(2026, 9, 7, 12).getTime())).toBe("09:05");
    expect(observedClock(at, new Date(2026, 9, 8, 12).getTime())).toBe("10-07 09:05");
  });

  it("uses the native fallback only without cutex gauges, without the capability, and online", () => {
    expect(wantsNativeQuotaFallback([], true)).toBe(true);
    expect(wantsNativeQuotaFallback(undefined, true)).toBe(false);
    expect(wantsNativeQuotaFallback([g("x")], true)).toBe(false);
    expect(wantsNativeQuotaFallback([], false)).toBe(false);
  });

  it("reads profile names from quota-updated params in any shape", () => {
    expect(quotaEventProfiles({ profile: { id: "26ad", name: "alpha" } })).toEqual(["alpha", "26ad"]);
    expect(quotaEventProfiles({ profileName: "GLM", profileId: "g1" })).toEqual(["GLM", "g1"]);
    expect(quotaEventProfiles({ profile: "gamma" })).toEqual(["gamma"]);
    expect(quotaEventProfiles(null)).toEqual([]);
  });

  it("names the profiles of a plan change only when cutex says planChanged", () => {
    const profile = { id: "26ad", name: "eta" };
    expect(quotaEventPlanChanged({ profile, source: "native", planChanged: true })).toEqual(["eta", "26ad"]);
    expect(quotaEventPlanChanged({ profile, source: "native", planChanged: false })).toEqual([]);
    expect(quotaEventPlanChanged({ profile, source: "native" })).toEqual([]);
    expect(quotaEventPlanChanged(null)).toEqual([]);
  });

  it("offers 启用 only when no reader is on, and the switch turns the primary on", () => {
    const reader = (enabled: boolean): QuotaReaderConfig => ({ enabled, url: "", auth: "profile_api_key", label: "Q", refresh_seconds: 60, mode: "balance", value_pointer: "", limit_pointer: "", reset_pointer: "", reset_format: "rfc3339", window_label: null });
    const off = { preset: "auto", primary: reader(false), extras: [] as QuotaReaderConfig[] };
    expect(quotaReadersOff(off)).toBe(true);
    expect(quotaReadersOff({ ...off, extras: [reader(false)] })).toBe(true);
    expect(quotaReadersOff({ ...off, extras: [reader(true)] })).toBe(false);
    const on = withPrimaryEnabled(off);
    expect(on.primary.enabled).toBe(true);
    expect(on.preset).toBe("auto");
    expect(off.primary.enabled).toBe(false);
    expect(quotaReadersOff(on)).toBe(false);
  });

  it("lists cutex's error text only for gauges that failed", () => {
    expect(gaugeErrors([g("deepseek", { label: "余额" }), g("glm")])).toEqual([]);
    expect(gaugeErrors([g("deepseek", { label: "余额", kind: "balance", error: "HTTP 401: invalid api key" })])).toEqual(["余额: HTTP 401: invalid api key"]);
  });

  it("records when live rate limits arrived", () => {
    const tl = emptyTimeline();
    applyEvent(tl, { receivedAt: "2026-10-07T01:00:00Z", native: { kind: "notification", message: { method: "account/rateLimits/updated", params: { rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: null } } } } } } as never);
    expect(tl.rateLimitsObservedAt).toBe(Date.parse("2026-10-07T01:00:00Z") / 1000);
  });
});

describe("profile kind helpers", () => {
  it("classifies account kinds and presets", () => {
    expect(isOfficialLogin({ cliKind: "codex", authKind: "chatgpt" })).toBe(true);
    expect(isOfficialLogin({ cliKind: "claude", authKind: "none" })).toBe(true);
    expect(isOfficialLogin({ cliKind: "codex", authKind: "apiKey" })).toBe(false);
    expect(isOfficialLogin({ cliKind: "codex", authKind: "none", providerFamily: "openai-chatgpt" })).toBe(true);
    expect(profileKind({ cliKind: "codex", authKind: "none", providerFamily: "openai-chatgpt" })).toBe("chatgpt");
    expect(profileKind({ cliKind: "codex", authKind: "none", providerFamily: "deepseek" })).toBe("apiKey");
    expect(profileKind({ cliKind: "claude", authKind: "none" })).toBe("claude");
  });

  it("turns the plan-label draft into a PATCH value", () => {
    expect(planLabelPatch(undefined, "GLM Pro")).toBeUndefined();
    expect(planLabelPatch(" GLM Pro ", "GLM Pro")).toBeUndefined();
    expect(planLabelPatch("GLM Max", "GLM Pro")).toBe("GLM Max");
    expect(planLabelPatch("  ", "plus")).toBeNull();
    expect(planLabelPatch(null, "plus")).toBeNull();
    expect(planLabelPatch("", null)).toBeUndefined();
    expect(planLabelPatch("Pro", undefined)).toBe("Pro");
  });

  it("恢复默认 clears a stored label and is offered only while the input holds one", () => {
    // A stored manual label: the draft becomes null, which saves as PATCH planLabel: null.
    expect(planLabelReset("GLM Pro")).toBeNull();
    expect(planLabelPatch(planLabelReset("GLM Pro"), "GLM Pro")).toBeNull();
    // Nothing stored: no draft at all (a typed label is just dropped; nothing to send).
    expect(planLabelReset(null)).toBeUndefined();
    expect(planLabelReset("  ")).toBeUndefined();
    expect(planLabelResettable(undefined, "plus")).toBe(true);
    expect(planLabelResettable("Max", null)).toBe(true);
    expect(planLabelResettable(null, "plus")).toBe(false);
    expect(planLabelResettable("", "plus")).toBe(false);
    expect(planLabelResettable(undefined, null)).toBe(false);
  });

  it("shows cutex's plan label in the header once a manual label may override the login", () => {
    expect(headerPlan("free", "pro", true)).toBe("free");
    expect(headerPlan("pro", "pro", true)).toBe("pro");
    expect(headerPlan(null, "pro", true)).toBeNull();
    // Older cutex: the login's plan wins, the stored label only while signed out.
    expect(headerPlan("free", "pro", false)).toBe("pro");
    expect(headerPlan("free", null, false)).toBe("free");
    expect(headerPlan("", null, false)).toBeNull();
  });

  it("counts sessions by profile name or id", () => {
    const sessions = [{ profile: "GLM" }, { profile: null, effectiveNextLaunch: { profile: "g1" } }, { profile: "omega" }];
    expect(sessionsUsingProfile(sessions, { id: "g1", name: "GLM" })).toHaveLength(2);
  });

  it("flags upstream model changes only when cutex reports them", () => {
    expect(upstreamModelsNotice({ kind: "nativeCache", clientVersion: "0.160.0", fetchedAt: "x" })).toBeNull();
    expect(upstreamModelsNotice({ kind: "nativeCache", notInBundled: ["gpt-6.1-sol"] })?.missing).toEqual(["gpt-6.1-sol"]);
    expect(upstreamModelsNotice({ kind: "nativeCache", clientVersion: "0.161.0", native: { version: "0.160.0-r47" } })?.newer).toEqual({ cache: "0.161.0", native: "0.160.0-r47" });
    expect(upstreamModelsNotice({ kind: "nativeCache", clientVersion: "0.160.0", native: { version: "0.160.0-r47" } })).toBeNull();
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });
});

describe("explicit quota readers (cutex profile-generic-switches)", () => {
  it("offers cutex's presetOptions without auto, else custom + the known readers", () => {
    expect(quotaPresetChoices({ presetOptions: ["custom", "usage_endpoint", "auto", "future_reader"] })).toEqual(["custom", "usage_endpoint", "future_reader"]);
    expect(quotaPresetChoices({ presetOptions: ["usage_endpoint"] })).toEqual(["custom", "usage_endpoint"]);
    expect(quotaPresetChoices({})).toEqual(["custom", ...QUOTA_READERS]);
  });

  it("uses readers with the capability or a presetOptions answer; older cutex keeps auto / custom", () => {
    expect(usesQuotaReaders({}, false)).toBe(false);
    expect(usesQuotaReaders(null, true)).toBe(true);
    expect(usesQuotaReaders({ presetOptions: [] }, false)).toBe(true);
  });

  it("a legacy auto blocks the save only with readers; reader presets lock the endpoint", () => {
    expect(quotaDraftNeedsReader({ preset: "auto" }, true)).toBe(true);
    expect(quotaDraftNeedsReader({ preset: "auto" }, false)).toBe(false);
    expect(quotaDraftNeedsReader({ preset: "usage_endpoint" }, true)).toBe(false);
    expect(isQuotaReaderPreset("custom")).toBe(false);
    expect(isQuotaReaderPreset("auto")).toBe(false);
    expect(isQuotaReaderPreset("openrouter_key")).toBe(true);
    expect(readerFollowsBaseUrl("usage_endpoint")).toBe(true);
    expect(readerFollowsBaseUrl("deepseek_balance")).toBe(false);
  });

  it("labels known readers by key and unknown ones by their raw name", () => {
    const t = (key: string) => `<${key}>`;
    expect(quotaPresetLabel(t, "custom")).toBe("<agent-config.quota.custom>");
    expect(quotaPresetLabel(t, "zhipu_coding_plan")).toBe("<agent-config.quota.reader.zhipu_coding_plan>");
    expect(quotaPresetLabel(t, "future_reader")).toBe("future_reader");
    expect(isKnownQuotaReader("future_reader")).toBe(false);
  });
});
