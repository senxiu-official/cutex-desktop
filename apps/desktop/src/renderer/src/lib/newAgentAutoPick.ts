// New agent with cutex `profile-auto-pick` (docs/design/041-profile-auto-pick.md §3 桌面): the owner
// picks the provider first; its account defaults to 「自动」 (cutex picks the opted-in profile whose
// quota lasts longest when the agent is created) and can be changed to a specific account. Without
// the capability, or for a provider with one profile / none opted in, it is today's manual choice.
import type { ProfileItem } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { autoFamily, autoProfile, type AutoPickPreview, type ProfilePick, type ProviderPick } from "../../../shared/profileAutoPick";

export interface ProviderGroup {
  family: string;
  /** The chip's short name. */
  label: string;
  /** cutex's own label (the chip's tooltip). */
  fullLabel: string;
  profiles: ProfileItem[];
  optedIn: number;
}

/** Short chip names for cutex's family labels (「Anthropic (Claude)」 → 「Claude」); others keep cutex's label. */
const CHIP_LABEL: Record<string, string> = { anthropic: "Claude", "openai-chatgpt": "ChatGPT", "openai-api": "OpenAI API", zhipu: "GLM", moonshot: "Kimi", xai: "Grok" };

/** Profiles by `providerFamily`, in list order (profiles without one form no group). */
export function providerGroups(profiles: readonly ProfileItem[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const p of profiles) {
    const family = p.providerFamily;
    if (!family) continue;
    const fullLabel = p.providerFamilyLabel || family;
    const group = groups.get(family) ?? { family, label: CHIP_LABEL[family] ?? fullLabel, fullLabel, profiles: [], optedIn: 0 };
    group.profiles.push(p);
    if (p.autoPick) group.optedIn++;
    groups.set(family, group);
  }
  return [...groups.values()];
}

/** The group offers 「自动」: two or more profiles, at least one opted in. */
export const groupOffersAuto = (group: ProviderGroup | undefined): boolean => !!group && group.profiles.length >= 2 && group.optedIn >= 1;

export type AutoState =
  /** Manual choice (no capability, a concrete profile picked, or the provider offers no 「自动」). */
  | { kind: "manual" }
  /** 「自动」 picked, the preview is on its way. */
  | { kind: "loading"; family: string }
  | { kind: "ready"; family: string; pick: ProfilePick }
  /** cutex has no candidate (or the pick is closed): the form falls back to a manual profile. */
  | { kind: "refused"; family: string; code: string; detail: string };

export interface AutoResolution {
  state: AutoState;
  /** The `profile` field of the create request ("" = the host default). */
  send: string;
  /** The profile the form shows (models, Claude rules, quota, portrait): the recommendation while 「自动」. */
  shown: ProfileItem | null;
  /** The provider the account list shows. */
  family: string | null;
}

const byIdOrName = (list: readonly ProfileItem[], key: string | null | undefined) => (key ? (list.find((p) => p.id === key) ?? list.find((p) => p.name === key) ?? null) : null);

/**
 * What the form uses. `picked`: the form's profile value — "" (default), a profile id, or
 * `auto:<family>`. `preview`: the last `GET /v2/profile-auto-pick` for `previewFamily`.
 */
export function resolveAuto(input: {
  enabled: boolean;
  picked: string;
  profiles: { defaultProfile: string | null; profiles: ProfileItem[] } | null;
  preview: AutoPickPreview | null;
  previewFamily: string | null;
}): AutoResolution {
  const list = input.profiles?.profiles ?? [];
  const fallbackDefault = byIdOrName(list, input.profiles?.defaultProfile);
  const groups = providerGroups(list);
  const requestedFamily = autoFamily(input.picked);
  if (!input.enabled || (input.picked && !requestedFamily)) {
    const shown = input.picked ? byIdOrName(list, input.picked) : fallbackDefault;
    return { state: { kind: "manual" }, send: input.picked, shown, family: shown?.providerFamily ?? null };
  }
  // "" = the default profile's provider, 「自动」 when that provider offers it.
  const family = requestedFamily ?? fallbackDefault?.providerFamily ?? null;
  const group = groups.find((g) => g.family === family);
  if (!family || !groupOffersAuto(group)) {
    const shown = requestedFamily ? (group?.profiles.find((p) => p === fallbackDefault) ?? group?.profiles[0] ?? null) : fallbackDefault;
    return { state: { kind: "manual" }, send: requestedFamily ? (shown?.id ?? "") : input.picked, shown, family: shown?.providerFamily ?? family };
  }
  // Manual fallback inside the provider: the default profile when it is one of them, else the first.
  const fallback = group!.profiles.find((p) => p === fallbackDefault) ?? group!.profiles[0]!;
  const entry: ProviderPick | undefined = input.previewFamily === family ? input.preview?.providers.find((p) => p.provider === family) : undefined;
  if (input.previewFamily === family && input.preview && !input.preview.available) {
    return { state: { kind: "refused", family, code: "auto_pick_unavailable", detail: input.preview.unavailableReason ?? "" }, send: fallback.id, shown: fallback, family };
  }
  if (!entry) return { state: { kind: "loading", family }, send: autoProfile(family), shown: fallback, family };
  if (!entry.pick) {
    return { state: { kind: "refused", family, code: entry.refusal?.code ?? "no_auto_pick_candidate", detail: entry.refusal?.detail ?? "" }, send: fallback.id, shown: fallback, family };
  }
  return { state: { kind: "ready", family, pick: entry.pick }, send: autoProfile(family), shown: byIdOrName(list, entry.pick.pickedId) ?? byIdOrName(list, entry.pick.picked) ?? fallback, family };
}

/** The value the account list selects when the owner switches to `family`. */
export function profileForFamily(groups: readonly ProviderGroup[], family: string, defaultProfile: ProfileItem | null): string {
  const group = groups.find((g) => g.family === family);
  if (!group) return "";
  if (groupOffersAuto(group)) return autoProfile(family);
  return (group.profiles.find((p) => p === defaultProfile) ?? group.profiles[0])?.id ?? "";
}

/** A create refused by the pick itself (CutexApiError messages read "<code>: <message>"). */
export const isAutoPickRefusal = (message: string): boolean => /\b(no_auto_pick_candidate|auto_pick_unavailable|provider_required|unknown_provider)\b/.test(message);

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** 「推荐 X：周额度剩 12%，约 8 小时后到顶」-style reason of a pick (localized by the caller's `t`). */
export function pickReason(pick: ProfilePick, t: T): string {
  const top = pick.candidates.find((c) => c.profileId === pick.pickedId) ?? pick.candidates.find((c) => c.profile === pick.picked);
  if (!top) return t("autoPick.reason.plain", { name: pick.picked });
  const vars = { name: pick.picked, window: top.bindingWindow ?? "—", percent: Math.round(top.remainingPercent ?? 0), hours: top.hours >= 24 ? "24+" : top.hours.toFixed(1) };
  return t(pick.rule === "all_near_wall_soonest_reset" ? "autoPick.reason.nearWall" : "autoPick.reason.wall", vars);
}

/** One line per candidate and per excluded profile (the ⓘ details). */
export function pickDetails(pick: ProfilePick, t: T): string[] {
  const reasonKey = (reason: string) => `autoPick.excluded.${reason}` as MessageKey;
  return [
    ...pick.candidates.map((c) => t("autoPick.detail.candidate", { name: c.profile, hours: c.hours >= 24 ? "24+" : c.hours.toFixed(1), window: c.bindingWindow ?? "—", percent: Math.round(c.remainingPercent ?? 0), agents: c.activeAgents })),
    ...pick.excluded.map((e) => {
      const key = reasonKey(e.reason);
      const why = t(key);
      return t("autoPick.detail.excluded", { name: e.profile, reason: why === key ? e.reason : why });
    }),
  ];
}
