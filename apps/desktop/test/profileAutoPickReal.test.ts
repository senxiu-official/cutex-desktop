// cutex profile-auto-pick (design 041) against real cutex answers: the fixture is what cutex
// feat/profile-auto-pick @ 50bc494 returned on a private debug daemon (two Claude subscription profiles,
// family `anthropic`). Runs them through the desktop's parsers and the New-agent form logic.
import { describe, expect, it } from "vitest";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import type { ProfileItem } from "../src/shared/ipc";
import { autoPickPreviewOf, profilePickOf, providerTermsUrl } from "../src/shared/profileAutoPick";
import { groupOffersAuto, isAutoPickRefusal, pickDetails, pickReason, profileForFamily, providerGroups, resolveAuto } from "../src/renderer/src/lib/newAgentAutoPick";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import real from "./fixtures/profileAutoPick.cutex-50bc494.json";

type Listing = { defaultProfile: string | null; profiles: ProfileItem[] };
const listing = (entry: { response: unknown }) => entry.response as Listing;
const errorOf = (entry: { status: number; response: unknown }) => {
  const e = (entry.response as { error: { code: string; message: string; retryable?: boolean; details?: unknown } }).error;
  return new CutexApiError(entry.status, e.code, e.message, e.retryable ?? false, e.details);
};
const t = ((key: string, vars?: Record<string, string | number>) =>
  ((zhCN as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`))) as Parameters<typeof pickReason>[1];

const opted = listing(real.listOptedIn);
const work = opted.profiles.find((p) => p.name === "ClaudeWork")!;
const home = opted.profiles.find((p) => p.name === "ClaudeHome")!;

describe("profile auto-pick against cutex 50bc494", () => {
  it("groups the Claude profiles under cutex's family id `anthropic`, short chip name, opt-in read from the list", () => {
    const before = providerGroups(listing(real.listNoneOptedIn).profiles);
    expect(before.map((g) => [g.family, g.label, g.fullLabel, g.profiles.length, g.optedIn])).toEqual([["anthropic", "Claude", "Anthropic (Claude)", 2, 0]]);
    expect(groupOffersAuto(before[0])).toBe(false);
    const after = providerGroups(opted.profiles);
    expect(after[0]?.optedIn).toBe(2);
    expect(groupOffersAuto(after[0])).toBe(true);
    expect(profileForFamily(after, "anthropic", null)).toBe("auto:anthropic");
    expect(providerTermsUrl(work.providerFamily)).toContain("anthropic.com");
    // PATCH answers the profile with the switch on.
    expect((real.patchOptIn.response as { profile: { autoPick: boolean } }).profile.autoPick).toBe(true);
  });

  it("parses the preview (also for the `claude` alias and a model / effort) and shows 「自动」 ready on the pick", () => {
    for (const entry of [real.previewReady, real.previewAlias, real.previewOpusHigh]) {
      const preview = autoPickPreviewOf(entry.response)!;
      expect(preview.available).toBe(true);
      const provider = preview.providers[0]!;
      expect(provider).toMatchObject({ provider: "anthropic", providerLabel: "Anthropic (Claude)", profiles: 2, optedIn: 2, refusal: null });
      expect(provider.pick).toMatchObject({ picked: "ClaudeWork", pickedId: work.id, provider: "anthropic", rule: "latest_wall" });
      expect(provider.pick!.candidates.map((c) => [c.profile, c.profileId])).toEqual([["ClaudeWork", work.id], ["ClaudeHome", home.id]]);
    }
    const preview = autoPickPreviewOf(real.previewReady.response);
    const auto = resolveAuto({ enabled: true, picked: "auto:anthropic", profiles: opted, preview, previewFamily: "anthropic" });
    expect(auto).toMatchObject({ state: { kind: "ready", family: "anthropic" }, send: "auto:anthropic", shown: { id: work.id }, family: "anthropic" });
    const pick = preview!.providers[0]!.pick!;
    expect(pickReason(pick, t)).toContain("ClaudeWork");
    expect(pickReason(pick, t)).toContain("80");
    expect(pickDetails(pick, t)).toHaveLength(2);
  });

  it("the host default is no profile here: the form opens on today's list until a provider is picked", () => {
    expect(opted.defaultProfile).toBeNull();
    expect(resolveAuto({ enabled: true, picked: "", profiles: opted, preview: null, previewFamily: null })).toMatchObject({ state: { kind: "manual" }, send: "", family: null });
    // Picking a Claude account shows the provider (and its 「自动」 row).
    expect(resolveAuto({ enabled: true, picked: home.id, profiles: opted, preview: null, previewFamily: null })).toMatchObject({ state: { kind: "manual" }, send: home.id, family: "anthropic" });
  });

  it("reads profilePick of the create answer (and the requestId replay) like the preview's", () => {
    const created = profilePickOf((real.createPicked.response as { profilePick: unknown }).profilePick)!;
    expect(created).toMatchObject({ requested: "auto:anthropic", provider: "anthropic", picked: "ClaudeWork", pickedId: work.id });
    expect(profilePickOf((real.createReplay.response as { profilePick: unknown }).profilePick)).toEqual(created);
    expect(profilePickOf((real.createWithLaunch.response as { profilePick: unknown }).profilePick)?.picked).toBe("ClaudeWork");
    expect(t("autoPick.created", { reason: pickReason(created, t) })).toContain("ClaudeWork");
  });

  it("falls back to a manual account on the refusals cutex sends", () => {
    for (const [entry, reason] of [[real.previewNoneOptedIn, "not_opted_in"], [real.previewStale, "quota_stale"]] as const) {
      const preview = autoPickPreviewOf(entry.response)!;
      const provider = preview.providers[0]!;
      expect(provider.pick).toBeNull();
      expect(provider.refusal?.code).toBe("no_auto_pick_candidate");
      expect(provider.refusal?.detail).toContain(reason);
    }
    const stale = resolveAuto({ enabled: true, picked: "auto:anthropic", profiles: opted, preview: autoPickPreviewOf(real.previewStale.response), previewFamily: "anthropic" });
    expect(stale.state).toMatchObject({ kind: "refused", code: "no_auto_pick_candidate" });
    expect(stale.send).toBe(home.id);
    for (const [entry, code] of [[real.createNoneOptedIn, "no_auto_pick_candidate"], [real.createStale, "no_auto_pick_candidate"], [real.createBareAuto, "provider_required"], [real.createUnknownProvider, "unknown_provider"]] as const) {
      const error = errorOf(entry);
      expect(error.code).toBe(code);
      expect(isAutoPickRefusal(error.message)).toBe(true);
    }
    expect(isAutoPickRefusal("agent_creation_failed: Claude runtime not installed")).toBe(false);
  });
});
