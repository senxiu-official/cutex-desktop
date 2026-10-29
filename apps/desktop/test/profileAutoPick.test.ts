// cutex profile-auto-pick (docs/design/041-profile-auto-pick.md, P2): the shared parsers, the New-agent
// page logic (provider first, 「自动」 by default, manual fallback on a refusal), the preview mock and
// the strings.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PreloadBridge, ProfileItem } from "../src/shared/ipc";
import { autoFamily, autoPickPreviewOf, autoPickQuery, autoProfile, offersAuto, profilePickOf, providerTermsUrl, type AutoPickPreview, type ProfilePick } from "../src/shared/profileAutoPick";
import { groupOffersAuto, pickDetails, pickReason, profileForFamily, providerGroups, resolveAuto } from "../src/renderer/src/lib/newAgentAutoPick";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { MOCK_NEW_FEATURES } from "../src/renderer/src/dev/mockFeatures";

const profile = (id: string, family: string, autoPick = false): ProfileItem =>
  ({ id, name: id, providerFamily: family, providerFamilyLabel: family === "anthropic" ? "Claude" : family, autoPick }) as unknown as ProfileItem;

const t = ((key: string, vars?: Record<string, string | number>) =>
  ((zhCN as Record<string, string>)[key] ?? key).replace("{{agent}}", "智能体").replace("{{owner}}", "主人").replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`))) as Parameters<typeof pickReason>[1];

const pick: ProfilePick = {
  requested: "auto:anthropic", provider: "anthropic", picked: "profileDawn", pickedId: "id-profileDawn", rule: "latest_wall", reason: "profileDawn: …",
  candidates: [
    { profile: "profileDawn", profileId: "id-profileDawn", hours: 8, bindingWindow: "7d", remainingPercent: 12, resetAt: 1, activeAgents: 1 },
    { profile: "Ceobe", profileId: "id-ceobe", hours: 3.2, bindingWindow: "5h", remainingPercent: 20, resetAt: 1, activeAgents: 3 },
  ],
  excluded: [{ profile: "profileElm", reason: "not_opted_in" }, { profile: "Odd", reason: "something_new" }],
};
const preview = (entry: Partial<AutoPickPreview["providers"][number]>, available = true): AutoPickPreview => ({
  available, unavailableReason: available ? null : "rename profile 'auto' first",
  providers: [{ provider: "anthropic", providerLabel: "Claude", profiles: 3, optedIn: 2, pick: null, refusal: null, ...entry }],
});

describe("shared profile-auto-pick", () => {
  it("names the per-provider pick and parses cutex answers defensively", () => {
    expect(autoProfile("anthropic")).toBe("auto:anthropic");
    expect(autoFamily("auto:zhipu")).toBe("zhipu");
    expect(autoFamily("auto")).toBeNull();
    expect(autoFamily("profileDawn")).toBeNull();
    expect(profilePickOf({ ...pick, candidates: [...pick.candidates, { profile: "x" }], excluded: [...pick.excluded, 3] })).toEqual(pick);
    expect(profilePickOf({ picked: "profileDawn" })).toBeNull();
    expect(profilePickOf(null)).toBeNull();
    const parsed = autoPickPreviewOf({ available: true, providers: [{ provider: "anthropic", providerLabel: "Claude", profiles: 3, optedIn: 2, profilePick: pick, refusal: null }, { provider: "zhipu", profiles: 1, optedIn: 1, profilePick: null, refusal: { code: "no_auto_pick_candidate", detail: "…" } }, { nope: 1 }] });
    expect(parsed?.providers.map((p) => [p.provider, p.pick?.picked ?? null, p.refusal?.code ?? null])).toEqual([["anthropic", "profileDawn", null], ["zhipu", null, "no_auto_pick_candidate"]]);
    expect(autoPickPreviewOf({ providers: "x" })).toBeNull();
    expect(autoPickQuery({ provider: "anthropic", model: " ", effort: "high" })).toBe("?provider=anthropic&effort=high");
    expect(autoPickQuery({})).toBe("");
  });

  it("links each provider's terms (041 §5) and offers 「自动」 only with two profiles, one opted in", () => {
    expect(providerTermsUrl("anthropic")).toBe("https://www.anthropic.com/legal/consumer-terms");
    expect(providerTermsUrl("openai-chatgpt")).toContain("openai.com/policies");
    expect(providerTermsUrl("zhipu")).toBe("https://docs.z.ai/legal-agreement/subscription-terms");
    expect(providerTermsUrl("deepseek")).toBeNull();
    expect(offersAuto({ profiles: 2, optedIn: 1 }, { available: true })).toBe(true);
    expect(offersAuto({ profiles: 1, optedIn: 1 }, { available: true })).toBe(false);
    expect(offersAuto({ profiles: 3, optedIn: 0 }, { available: true })).toBe(false);
    expect(offersAuto({ profiles: 3, optedIn: 1 }, { available: false })).toBe(false);
  });
});

describe("New agent: provider first, 「自动」 by default", () => {
  const list = [profile("id-profileElm", "anthropic"), profile("id-profileDawn", "anthropic", true), profile("id-ceobe", "anthropic", true), profile("profileGlen", "zhipu", true), profile("solo", "deepseek", true)];
  const profiles = { defaultProfile: "id-profileElm", profiles: list };

  it("groups by provider and offers 「自动」 per group", () => {
    const groups = providerGroups(list);
    expect(groups.map((g) => [g.family, g.profiles.length, g.optedIn])).toEqual([["anthropic", 3, 2], ["zhipu", 1, 1], ["deepseek", 1, 1]]);
    // Chips use short names; cutex's own label is the tooltip.
    expect(groups.map((g) => [g.label, g.fullLabel])).toEqual([["Claude", "Claude"], ["GLM", "zhipu"], ["deepseek", "deepseek"]]);
    expect(groups.map(groupOffersAuto)).toEqual([true, false, false]);
    expect(profileForFamily(groups, "anthropic", null)).toBe("auto:anthropic");
    expect(profileForFamily(groups, "zhipu", null)).toBe("profileGlen");
  });

  it("is today's choice without the capability or with a concrete account", () => {
    expect(resolveAuto({ enabled: false, picked: "", profiles, preview: null, previewFamily: null })).toMatchObject({ state: { kind: "manual" }, send: "", shown: { id: "id-profileElm" } });
    expect(resolveAuto({ enabled: true, picked: "id-ceobe", profiles, preview: null, previewFamily: null })).toMatchObject({ state: { kind: "manual" }, send: "id-ceobe", shown: { id: "id-ceobe" }, family: "anthropic" });
  });

  it("defaults to 「自动」 for the default profile's provider, shows the recommendation, sends auto:<family>", () => {
    const loading = resolveAuto({ enabled: true, picked: "", profiles, preview: null, previewFamily: null });
    expect(loading).toMatchObject({ state: { kind: "loading", family: "anthropic" }, send: "auto:anthropic", shown: { id: "id-profileElm" } });
    const ready = resolveAuto({ enabled: true, picked: "", profiles, preview: preview({ pick }), previewFamily: "anthropic" });
    expect(ready).toMatchObject({ state: { kind: "ready" }, send: "auto:anthropic", shown: { id: "id-profileDawn" } });
    // A preview of another provider does not count.
    expect(resolveAuto({ enabled: true, picked: "", profiles, preview: preview({ pick }), previewFamily: "zhipu" }).state.kind).toBe("loading");
  });

  it("falls back to a manual account when cutex has no candidate or the pick is closed", () => {
    const refused = resolveAuto({ enabled: true, picked: "auto:anthropic", profiles, preview: preview({ refusal: { code: "no_auto_pick_candidate", detail: "profileDawn: quota_stale" } }), previewFamily: "anthropic" });
    expect(refused).toMatchObject({ state: { kind: "refused", code: "no_auto_pick_candidate" }, send: "id-profileElm", shown: { id: "id-profileElm" } });
    const closed = resolveAuto({ enabled: true, picked: "auto:anthropic", profiles, preview: preview({ pick }, false), previewFamily: "anthropic" });
    expect(closed).toMatchObject({ state: { kind: "refused", code: "auto_pick_unavailable" }, send: "id-profileElm" });
    // A provider without 「自动」 picks its account.
    expect(resolveAuto({ enabled: true, picked: "auto:zhipu", profiles, preview: null, previewFamily: null })).toMatchObject({ state: { kind: "manual" }, send: "profileGlen" });
  });

  it("explains the pick: reason, candidates, excluded with the reason in words", () => {
    expect(pickReason(pick, t)).toBe("profileDawn：7d 额度剩 12%，约 8.0 小时后到顶");
    expect(pickReason({ ...pick, rule: "all_near_wall_soonest_reset" }, t)).toBe("profileDawn：所有账号都快到顶，它最先重置");
    expect(pickDetails(pick, t)).toEqual([
      "profileDawn：约 8.0 小时（7d 剩 12%，1 个智能体在用）",
      "Ceobe：约 3.2 小时（5h 剩 20%，3 个智能体在用）",
      "profileElm：不参与（没打开「参与自动选择」）",
      "Odd：不参与（something_new）",
    ]);
  });
});

async function install(search = ""): Promise<PreloadBridge> {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return win.cutex!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Each install() needs a fresh mock bridge (vi.resetModules()), so the import stays there; this warm-up loads it once
// (with the same globals) first, so its first transform is not billed to the first test under the full suite's load.
beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  await import("../src/renderer/src/dev/mockBridge");
  vi.unstubAllGlobals();
}, 60_000);

describe("preview mock", () => {
  it("reports the capability and the opt-in, and round-trips it through PATCH", async () => {
    expect(MOCK_NEW_FEATURES).toContain("profile-auto-pick");
    const api = (await install()).api;
    const list = await api.listProfiles();
    expect(list?.profiles.find((p) => p.id === "claude")?.autoPick).toBe(true);
    expect(list?.profiles.find((p) => p.id === "GLM")?.autoPick).toBe(false);
    expect((await api.patchProfile("GLM", { autoPick: true })).autoPick).toBe(true);
    expect((await api.patchProfile("GLM", { autoPick: false })).autoPick).toBe(false);
    await expect(api.patchProfile("GLM", { autoPick: "yes" as unknown as boolean })).rejects.toThrow("autoPick: must be a boolean");
  });

  it("ranks per provider, refuses a provider without a fresh candidate, and creates with the pick", async () => {
    const api = (await install()).api;
    const all = await api.profileAutoPick({});
    const claude = all.providers.find((p) => p.provider === "anthropic")!;
    expect(claude.pick?.picked).toBe("claude-work");
    expect(claude.pick?.candidates.map((c) => c.profile)).toEqual(["claude-work", "claude"]);
    const responses = all.providers.find((p) => p.provider === "responses-api")!;
    expect(responses.pick).toBeNull();
    expect(responses.refusal?.code).toBe("no_auto_pick_candidate");
    // cutex's family id is "anthropic"; "claude" is an alias of it.
    expect((await api.profileAutoPick({ provider: "claude" })).providers.map((p) => p.provider)).toEqual(["anthropic"]);
    const created = await api.createAgent({ name: "Numbat", profile: "auto:anthropic", start: false });
    expect(created.profilePick?.picked).toBe("claude-work");
    await expect(api.createAgent({ name: "Wombat", profile: "auto", start: false })).rejects.toThrow("provider_required");
    await expect(api.createAgent({ name: "Quokka", profile: "auto:responses-api", start: false })).rejects.toThrow("no_auto_pick_candidate");
    expect((await api.createAgent({ name: "Plain", profile: "claude", start: false })).profilePick).toBeNull();
  });

  it("is absent on an older cutex (?legacy)", async () => {
    const api = (await install("?legacy")).api;
    expect((await api.listProfiles())?.profiles.find((p) => p.id === "claude")).not.toHaveProperty("autoPick");
    await expect(api.profileAutoPick({})).rejects.toThrow();
  });
});

describe("strings", () => {
  it("are in every required locale, with the terms line as the owner asked", () => {
    const keys = Object.keys(zhCN).filter((k) => k.startsWith("autoPick."));
    expect(keys.length).toBeGreaterThan(20);
    for (const catalog of [zhCN, en, enAU, zhHantCN] as Record<string, string>[]) for (const key of keys) expect(catalog[key], key).toBeTruthy();
    expect(zhCN["autoPick.terms"]).toBe("是否符合各家条款由你自己判断");
    expect(zhCN["autoPick.setting"]).toBe("参与自动选择");
    expect(zhHantCN["autoPick.setting"]).toBe("參與自動選擇");
    expect(zhCN["autoPick.autoRecommend"]).toBe("自动（推荐 {reason}）");
  });
});
