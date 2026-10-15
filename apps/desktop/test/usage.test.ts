import { describe, expect, it } from "vitest";
import type { UsageReport } from "../src/shared/ipc";
import { formatTokens } from "../src/renderer/src/lib/usage";
import { buckets, buildSeries, formatMoney, niceScale, remainingColor, remainingRatio, smoothPath, stack } from "../src/renderer/src/modules/usage/chart";
import { modelProvider, profileProvider } from "../src/renderer/src/lib/provider";
import { isDeletedProfile, withoutDeletedProfiles } from "../src/renderer/src/modules/usage/provider";
import { anyScanning, availableKinds, billingBySeries, suggestedPath } from "../src/renderer/src/modules/usage/sourceHelpers";
import type { UsageSource, UsageSourcesView } from "../src/shared/usageSources";

const amounts = (total: number, cachedInput = 0, output = 0) => ({ turns: 1, requests: 1, input: total - output, cachedInput, cacheWriteInput: 0, output, reasoningOutput: 0, total });
const report = (rows: UsageReport["rows"]): UsageReport => ({ from: "2026-10-05", to: "2026-10-06", groupBy: ["day", "profile"], recordingSince: null, warnings: [], totals: amounts(0), rows });

describe("usage", () => {
  it("formats token counts and money", () => {
    expect([formatTokens(999), formatTokens(1234), formatTokens(3_400_000)]).toEqual(["999", "1.2k", "3.4M"]);
    expect([formatMoney(2.345, "USD"), formatMoney(3.1, "AUD"), formatMoney(18.42, "CNY"), formatMoney(0.004, "USD"), formatMoney(250, "EUR")]).toEqual(["$2.35", "A$3.10", "¥18.42", "<$0.01", "EUR 250"]);
  });

  it("builds per-day series for a split and token-type series for 总计", () => {
    const r = report([
      { key: { day: "2026-10-05", profile: "GLM" }, ...amounts(10, 4, 2) },
      { key: { day: "2026-10-06", profile: "GLM" }, ...amounts(20) },
      { key: { day: "2026-10-06", profile: null }, ...amounts(30) },
    ]);
    const bks = buckets(["2026-10-05", "2026-10-06"]);
    expect(buildSeries(r, "profile", bks, "tokens")).toEqual({ series: ["GLM", "—"], values: [[10, 20], [0, 30]] });
    // cached 4, fresh 8 - 4 = 4, output 2 on the first day
    expect(buildSeries(r, "total", bks, "tokens").values.map((v) => v[0])).toEqual([4, 4, 2]);
    expect(stack([[1, 2], [3, 4]])).toEqual([[1, 2], [4, 6]]);
  });

  it("folds long ranges into weeks ending on the last day", () => {
    const days = Array.from({ length: 90 }, (_, i) => `d${i}`);
    const b = buckets(days);
    expect(b).toHaveLength(13);
    expect(b.at(-1)!.days).toEqual(days.slice(83));
    expect(b[0]!.days).toEqual(days.slice(0, 6));
    expect(buckets(days.slice(0, 30))).toHaveLength(30);
  });

  it("picks nice axis steps and draws monotone curves", () => {
    expect(niceScale(730_000)).toEqual({ max: 800_000, step: 200_000 });
    expect(niceScale(0)).toEqual({ max: 1, step: 0.25 });
    expect(smoothPath([[0, 10]])).toBe("M0,10");
    // a flat run stays flat: both control points sit on y = 5
    expect(smoothPath([[0, 5], [3, 5], [6, 5]])).toContain("C1,5 2,5 3,5");
  });

  it("resolves a profile's provider: cutex value first, then auth / base URL / name", () => {
    const base = { name: "x", authKind: "apiKey" as const, cliKind: "codex", baseUrl: null, appearance: { color: null, effectiveColor: null, providerCategory: null } };
    expect(profileProvider({ ...base, effectiveProviderCategory: "kimi" } as never)).toBe("kimi");
    expect(profileProvider({ ...base, appearance: { ...base.appearance, providerCategory: "chatgpt" } })).toBe("codex");
    // a provider this build has no logo for: no guessing from the name
    expect(profileProvider({ ...base, name: "deepseek-proxy", effectiveProviderCategory: "qwen" } as never)).toBeNull();
    expect(profileProvider({ ...base, authKind: "chatgpt" })).toBe("codex");
    expect(profileProvider({ ...base, baseUrl: "https://open.bigmodel.cn/api/paas/v4" })).toBe("glm");
    expect(profileProvider({ ...base, baseUrl: "https://api.z.ai/api/paas/v4" })).toBe("zai");
    expect(profileProvider({ ...base, name: "relay" })).toBeNull();
    expect([modelProvider("glm-5"), modelProvider("deepseek-v4-flash"), modelProvider("gpt-5.5"), modelProvider("kimi-k3"), modelProvider("mystery")]).toEqual(["glm", "deepseek", "codex", "kimi", null]);
  });

  it("treats ledger names missing from /v2/profiles as deleted, once the list is known", () => {
    const live = new Map([["GLM", "glm" as const]]);
    expect([isDeletedProfile("GLM", live), isDeletedProfile("eta", live), isDeletedProfile("…", live), isDeletedProfile("—", live)]).toEqual([false, true, false, false]);
    expect(isDeletedProfile("eta", null)).toBe(false);
    const r = report([
      { key: { day: "2026-10-05", profile: "GLM" }, ...amounts(10) },
      { key: { day: "2026-10-05", profile: "eta" }, ...amounts(20) },
      { key: { day: "2026-10-05", profile: null }, ...amounts(5) },
      { key: { day: "2026-10-05", profile: "GLM" }, ...amounts(1), profileState: "deleted" },
      // r218: cutex's "current" wins even when the cached profile list does not know the name yet (rename)
      { key: { day: "2026-10-05", profile: "glm-renamed", profileState: "current" }, ...amounts(7), profileState: "current" },
    ]);
    expect(withoutDeletedProfiles(r, live).rows.map((x) => x.total)).toEqual([10, 5, 7]);
    // list unknown: only the cutex flag hides rows
    expect(withoutDeletedProfiles(r, null).rows.map((x) => x.total)).toEqual([10, 20, 5, 7]);
  });

  it("shows quota as what is left: full = untouched, warmer as it runs out", () => {
    expect([remainingRatio(100), remainingRatio(62), remainingRatio(-3), remainingRatio(null)]).toEqual([1, 0.62, 0, null]);
    expect([remainingColor(1), remainingColor(0.39), remainingColor(0.1)]).toEqual(["var(--accent)", "var(--warn)", "var(--danger)"]);
  });

  it("splits by source: cutex vs extra directories, with each source's billing", () => {
    const r = report([
      { key: { day: "2026-10-05", source: "cutex", sourceLabel: null, sourceKind: "cutex", sourceBilling: null }, ...amounts(10) },
      { key: { day: "2026-10-05", source: "claude-code", sourceLabel: "Claude Code", sourceKind: "claude-code", sourceBilling: "subscription" }, ...amounts(20) },
      { key: { day: "2026-10-06", source: "codex", sourceLabel: "Codex", sourceKind: "codex", sourceBilling: "api" }, ...amounts(5) },
    ]);
    const bks = buckets(["2026-10-05", "2026-10-06"]);
    expect(buildSeries(r, "source", bks, "tokens")).toEqual({ series: ["Claude Code", "cutex", "Codex"], values: [[20, 0], [10, 0], [0, 5]] });
    expect([...billingBySeries(r)]).toEqual([["Claude Code", "subscription"], ["Codex", "api"]]);
  });

  it("offers the host's default directory only when it exists and is not used yet", () => {
    const source = (path: string): UsageSource => ({ id: "claude-code", kind: "claude-code", path, label: "Claude Code", billing: "subscription", enabled: true, supported: true, status: { lastScanAt: null, files: 0, rows: 0, errors: 0, scanning: false } });
    const view = (sources: UsageSource[]): UsageSourcesView => ({ sources, defaults: [{ kind: "claude-code", path: "/home/o/.claude", exists: true }, { kind: "codex", path: "/home/o/.codex", exists: false }], kinds: ["claude-code", "codex"], billing: ["subscription", "api"], scanIntervalSecs: 300 });
    expect(suggestedPath(view([]), "claude-code")).toBe("/home/o/.claude");
    expect(suggestedPath(view([]), "codex")).toBe("");
    expect(suggestedPath(view([source("/home/o/.claude")]), "claude-code")).toBe("");
    expect(suggestedPath(null, "claude-code")).toBe("");
    expect(anyScanning(view([{ ...source("/x"), status: { ...source("/x").status, scanning: true } }]))).toBe(true);
    expect(anyScanning(view([{ ...source("/x"), enabled: false, status: { ...source("/x").status, scanning: true } }]))).toBe(false);
  });

  it("offers zcode only when the host lists it", () => {
    const view = (kinds: UsageSourcesView["kinds"]): UsageSourcesView => ({ sources: [], defaults: [{ kind: "zcode", path: "/home/o/.zcode", exists: true }], kinds, billing: ["subscription", "api"], scanIntervalSecs: 300 });
    expect(availableKinds(view(["claude-code", "codex"]))).toEqual(["claude-code", "codex"]);
    expect(availableKinds(view(["claude-code", "codex", "zcode"]))).toEqual(["claude-code", "codex", "zcode"]);
    expect(availableKinds(null)).toEqual(["claude-code", "codex"]);
    expect(suggestedPath(view(["claude-code", "codex", "zcode"]), "zcode")).toBe("/home/o/.zcode");
  });
});
