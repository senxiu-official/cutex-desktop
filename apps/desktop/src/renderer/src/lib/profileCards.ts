// Settings → Profiles overview cards: order, problems (⚠) and the one-line summaries a card shows.
// Pure helpers (no React) so they are unit-testable.
import type { ProfileDetail, ProfileItem, ProfilePreset, QuotaGauge } from "../../../shared/ipc";
import { profileKind } from "./profileKind";
import { FALLBACK_PRESETS, familyPreset, officialPresetOf, shortPresetLabel } from "./profilePresets";

type ProfileList = { defaultProfile: string | null; profiles: ProfileItem[] };

/** cutex marks the default either on the item or by name / id in the list. */
export function isDefaultProfile(p: Pick<ProfileItem, "id" | "name" | "isDefault">, defaultProfile: string | null | undefined): boolean {
  return p.isDefault || (!!defaultProfile && (p.name === defaultProfile || p.id === defaultProfile));
}

/** Default profile first, then cutex's saved order (stable). */
export function orderProfiles(list: ProfileList): ProfileItem[] {
  const def = list.profiles.filter((p) => isDefaultProfile(p, list.defaultProfile));
  return [...def.slice(0, 1), ...list.profiles.filter((p) => p !== def[0])];
}

export type ProfileProblem = "notLoggedIn" | "keyMissing" | "quotaError";

/**
 * What needs attention on a card: ChatGPT login missing, API key missing (cutex `authPresent`),
 * or a quota reader that answered with an error. Claude profiles manage their own login.
 */
export function profileProblems(p: Pick<ProfileItem, "cliKind" | "authKind" | "authPresent">, gauges: readonly Pick<QuotaGauge, "error">[] | undefined): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const kind = profileKind(p);
  if (kind === "chatgpt" && !p.authPresent) out.push("notLoggedIn");
  if (kind === "apiKey" && !p.authPresent) out.push("keyMissing");
  if (gauges?.some((g) => !!g.error)) out.push("quotaError");
  return out;
}

/** "deepseek-v4-flash · high"; null when the profile has no default model. */
export function modelLine(p: Pick<ProfileItem, "model" | "modelReasoningEffort">): string | null {
  if (!p.model) return null;
  return p.modelReasoningEffort ? `${p.model} · ${p.modelReasoningEffort}` : p.model;
}

/**
 * "ChatGPT" / "Claude" / "API Key · GLM". The provider comes from the base URL host (lib/profilePresets):
 * a third-party relay is `custom` whatever its provider is called. No URL: cutex's family.
 */
export function profileKindLabel(p: Pick<ProfileItem, "cliKind" | "authKind" | "baseUrl" | "providerFamily">, custom: string, presets: readonly ProfilePreset[] = FALLBACK_PRESETS): string {
  const kind = profileKind(p);
  if (kind !== "apiKey") return kind === "chatgpt" ? "ChatGPT" : "Claude";
  const preset = p.baseUrl?.trim() ? officialPresetOf(p.baseUrl, presets) : familyPreset(p.providerFamily, presets);
  return `API Key · ${preset ? shortPresetLabel(preset) : custom}`;
}

/** "256K" / "1M" for a context window (null = unknown). */
export function contextLabel(tokens: number | null | undefined): string | null {
  if (!tokens) return null;
  return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}K`;
}

export type ProfileRule = "switch" | "approval" | "subagents" | "delegationWait" | "claudeWrite" | "claudeExec";

/** What is switched on for agents of this profile (card summary; Claude tools only once the detail is cached). */
export function profileRules(p: Pick<ProfileItem, "allowSessionSwitch" | "agentUseRequiresApproval" | "nativeSubagents" | "delegationWait">, detail: Pick<ProfileDetail, "claudeAllowWrite" | "claudeAllowExec"> | null): ProfileRule[] {
  const out: ProfileRule[] = [];
  if (p.allowSessionSwitch) out.push("switch");
  if (p.agentUseRequiresApproval) out.push("approval");
  if (p.nativeSubagents) out.push("subagents");
  if (p.delegationWait) out.push("delegationWait");
  if (detail?.claudeAllowWrite) out.push("claudeWrite");
  if (detail?.claudeAllowExec) out.push("claudeExec");
  return out;
}
