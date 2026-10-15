// What a profile's account kind makes meaningful in Settings → Profiles, and where its model list
// came from. Pure helpers (no React) so they are unit-testable.
import type { ModelsSource, ProfileDetail, ProfileItem } from "../../../shared/ipc";

/**
 * Official-login profiles (ChatGPT login, Claude): quota comes from the official source that cutex
 * queries itself, there is no base URL / API key. Model editing is capability-gated separately.
 */
export function isOfficialLogin(p: KindFields): boolean {
  return p.cliKind === "claude" || p.authKind === "claude" || profileKind(p) === "chatgpt";
}

type KindFields = Pick<ProfileItem, "cliKind" | "authKind"> & { providerFamily?: string | null };

/** cutex derives `authKind` from the stored credentials, so a signed-out (or never signed-in)
 *  official profile reports "none"; its configured provider family still says it is a ChatGPT
 *  profile (it needs the ChatGPT login rows, not an API key). */
const signedOutChatGpt = (p: KindFields) => p.authKind === "none" && p.providerFamily === "openai-chatgpt";

/** cutex capabilities that light up profile lifecycle actions (rendered disabled until present). */
export const PROFILE_FEATURES = {
  create: "profile-create",
  duplicate: "profile-duplicate",
  delete: "profile-delete",
  planLabel: "profile-plan-label",
  /** A manual plan label overrides the signed-in account's plan; cutex's live plan follows downgrades. */
  planLabelOverride: "profile-plan-label-override",
  /** Claude profiles take a manual plan label too (cutex has no live plan for them: manual only). */
  planLabelClaude: "profile-plan-label-claude",
  providerCategory: "profile-provider-category-v2",
} as const;

/**
 * The plan shown in the profile header. With `profile-plan-label-override` cutex's `planLabel` is
 * final (manual label > account plan > stored plan); older cutex let the login's plan win.
 */
export function headerPlan(planLabel: string | null | undefined, livePlan: string | null, override: boolean): string | null {
  return (override ? planLabel : (livePlan ?? planLabel)) || null;
}

/** Longest plan label cutex accepts (`PATCH planLabel`, characters). */
export const MAX_PLAN_LABEL_CHARS = 40;

/**
 * PATCH value for the plan-label draft: trimmed text, `null` to clear (empty), or `undefined`
 * when it equals the stored label (nothing to send).
 */
export function planLabelPatch(draft: string | null | undefined, stored: string | null | undefined): string | null | undefined {
  if (draft === undefined) return undefined;
  const next = draft?.trim() || null;
  return next === ((stored ?? "").trim() || null) ? undefined : next;
}

/**
 * The draft 「恢复默认」 leaves: `null` (PATCH `planLabel: null` clears the manual label) when one is
 * stored, else `undefined` (no draft: there is nothing to clear).
 */
export function planLabelReset(stored: string | null | undefined): null | undefined {
  return stored?.trim() ? null : undefined;
}

/** 「恢复默认」 is offered while the input holds a label: the draft's, else the stored one. */
export function planLabelResettable(draft: string | null | undefined, stored: string | null | undefined): boolean {
  return !!(draft !== undefined ? draft : stored)?.trim();
}

/** cutex capabilities behind the profile editor's agent rows (docs/agent-tool-security.md §7–8). */
export const PROFILE_AGENT_FEATURES = { nativeSubagents: "profile-native-subagents", agentApproval: "profile-agent-approval", delegationTools: "delegation-tools" } as const;

/**
 * A defaultable profile option (`null` = cutex default) as the editor's one switch + ↺: the switch
 * shows the effective value, ↺ is offered only while a value is stored (`explicit`).
 * `pending`: the draft (undefined = untouched, null = cleared), else `stored` counts.
 */
export function defaultableState(pending: boolean | null | undefined, stored: boolean | null | undefined, def: boolean): { checked: boolean; explicit: boolean } {
  const value = pending !== undefined ? pending : (stored ?? null);
  return { checked: value ?? def, explicit: value !== null };
}

export type ProfileKind = "chatgpt" | "claude" | "apiKey";

export function profileKind(p: KindFields): ProfileKind {
  if (p.cliKind === "claude" || p.authKind === "claude") return "claude";
  return p.authKind === "chatgpt" || signedOutChatGpt(p) ? "chatgpt" : "apiKey";
}

/** Sessions whose profile (current, else next launch) is this profile, by name or id. */
export function sessionsUsingProfile<S extends { profile: string | null; effectiveNextLaunch?: { profile: string | null } | null }>(sessions: S[], p: Pick<ProfileItem, "id" | "name">): S[] {
  return sessions.filter((s) => {
    const v = s.profile ?? s.effectiveNextLaunch?.profile ?? null;
    return v !== null && (v === p.name || v === p.id);
  });
}

/** cutex `detail.editable[field]`: absent (older cutex) counts as editable. */
export function fieldEditable(detail: ProfileDetail, field: string): boolean {
  return detail.detail.editable?.[field] !== false;
}

/** For fields newer than the editability map itself: editable only when cutex says so explicitly. */
export function fieldOffered(detail: ProfileDetail, field: string): boolean {
  return detail.detail.editable?.[field] === true;
}

/** Leading numeric x.y.z of a version string ("0.160.0-r47" → [0,160,0]); null if none. */
function versionParts(v: string | null | undefined): number[] | null {
  const m = v ? /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** >0 when a is newer than b; 0 when equal or either is unparseable. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export interface UpstreamModelsNotice {
  /** Cached slugs missing from the cute-codex compiled list. */
  missing: string[];
  /** Set when the native cache was written by a newer client than the installed cute-codex. */
  newer: { cache: string; native: string } | null;
}

/** Non-null when upstream has models the installed cute-codex doesn't know (needs an update / re-patch). */
export function upstreamModelsNotice(src: ModelsSource | null | undefined): UpstreamModelsNotice | null {
  if (!src) return null;
  const missing = (src.notInBundled ?? []).filter(Boolean);
  const cache = src.kind === "nativeCache" ? src.clientVersion : null;
  const native = src.native?.version ?? null;
  const newer = cache && native && compareVersions(cache, native) > 0 ? { cache, native } : null;
  return missing.length || newer ? { missing, newer } : null;
}

/** "2026-10-06 21:46" in local time; the raw string when unparseable. */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
