// What this app offers for a 个人助理, and what takes effect. The host decides where it can say (r299
// `personal-assistants-readiness-v1`: create-options per Profile `{eligible, reason, runtimePin}`; `capabilityDetails`
// per key `{configured, effective, unsupported, reason}`); this app's rule is only the fallback for older hosts:
// - which Profiles can run an assistant (only Claude Subscription has the assistant tools there), so the create form
//   never starts on one that would give an unusable assistant — with create-options the host's list is the whole
//   truth (a Profile it doesn't name is not usable; an empty eligible set is "none", never a default);
// - which levels / operations the host can carry out (`unsupported`), so the 权限 card never lets the owner pick
//   something that does nothing, and what takes effect now (`effective`; older hosts: only what can't, never a claim
//   that something does).
import type { ProfileItem } from "../../../../shared/ipc";
import { PA_OPERATIONS, PA_TIERS, type PaCapabilities, type PaCapabilityDetails, type PaOperation, type PaProfileReadiness, type PaTier } from "../../../../shared/personalAssistants";

export interface ProfileChoice {
  name: string;
  model: string | null;
  eligible: boolean;
  /** Why not: `notClaude` / `notSubscription` (this app's rule), the host's code, or `notListed` (host didn't name it). */
  reason: string | null;
  /** The runtime pin the host would use (r299). */
  runtimePin?: string | null;
}

/** This app's rule for hosts without create-options: a Claude Profile signed in with the subscription (not an API
 * key; where the host lists provider interfaces, one of them is `claudeSubscription`). */
export function clientProfileReason(p: Pick<ProfileItem, "cliKind" | "authKind" | "providerInterfaces">): "notClaude" | "notSubscription" | null {
  if (p.cliKind !== "claude") return "notClaude";
  const kinds = p.providerInterfaces?.map((i) => i.kind);
  if (kinds?.length) return kinds.includes("claudeSubscription") ? null : "notSubscription";
  return p.authKind === "apiKey" ? "notSubscription" : null;
}

/**
 * Every Profile with whether it can run an assistant, usable ones first. `host` (r299 create-options): its verdicts
 * decide, in its order; a Profile it doesn't name is not usable. Without it: this app's rule.
 */
export function assistantProfileChoices(profiles: readonly ProfileItem[], host?: readonly PaProfileReadiness[] | null): ProfileChoice[] {
  const model = new Map(profiles.map((p) => [p.name, p.model]));
  const rows: ProfileChoice[] = host
    ? [
        ...host.map((p) => ({ name: p.name, model: model.get(p.name) ?? null, eligible: p.eligible, reason: p.eligible ? null : (p.reason ?? "unknown"), runtimePin: p.runtimePin })),
        ...profiles.filter((p) => !host.some((h) => h.name === p.name)).map((p) => ({ name: p.name, model: p.model, eligible: false, reason: "notListed" })),
      ]
    : profiles.map((p) => {
        const reason = clientProfileReason(p);
        return { name: p.name, model: p.model, eligible: reason === null, reason };
      });
  return [...rows.filter((r) => r.eligible), ...rows.filter((r) => !r.eligible)];
}

/** The Profile to start on: the current one, the host default, the first usable — never one that can't run it. */
export function pickAssistantProfile(choices: readonly ProfileChoice[], current: string, hostDefault: string | null): string {
  const ok = (name: string | null) => !!name && choices.some((c) => c.name === name && c.eligible);
  if (ok(current)) return current;
  if (ok(hostDefault)) return hostDefault!;
  return choices.find((c) => c.eligible)?.name ?? "";
}

export interface GrantSupport {
  tiers: ReadonlySet<PaTier>;
  operations: ReadonlySet<PaOperation>;
}

/** The capability key behind a level (収件箱 has none: it is always there). */
const TIER_KEY: Partial<Record<PaTier, string>> = { coordinator: "localDirectorRequests", projectAdmin: "projectAdmin" };

/**
 * What the host can carry out. With r299 details: each key's `unsupported` (levels: 协调 = `localDirectorRequests`,
 * 项目管理 = `projectAdmin`, 运维 = any operation). Without: 收件箱 always, 协调 unless the host says it can't send to
 * a Director, 项目管理 / 运维 and the operations only where it delegates owner operations (no host does yet).
 */
export function grantSupport(caps: PaCapabilities, details?: PaCapabilityDetails | null): GrantSupport {
  const can = (key: string, fallback: boolean) => (details?.[key] ? details[key]!.unsupported !== true : fallback);
  const ops = PA_OPERATIONS.filter((op) => can(op, caps.ownerOperationDelegation === true));
  const tiers = PA_TIERS.filter((tier) =>
    tier === "inbox" ? true : tier === "coordinator" ? can("localDirectorRequests", caps.localDirectorRequests !== false) : tier === "projectAdmin" ? can("projectAdmin", caps.ownerOperationDelegation === true) : ops.length > 0,
  );
  return { tiers: new Set(tiers), operations: new Set(ops) };
}

/** The level that can take effect: the highest one the host supports, not above the one set. */
export function effectiveTier(tier: PaTier, support: GrantSupport): PaTier {
  const upTo = PA_TIERS.slice(0, PA_TIERS.indexOf(tier) + 1);
  return [...upTo].reverse().find((t) => support.tiers.has(t)) ?? "inbox";
}

/** The operations that can take effect: those set that the host supports, in the fixed order (only at 运维). */
export function effectiveOperations(ops: readonly PaOperation[], tier: PaTier, support: GrantSupport): PaOperation[] {
  if (effectiveTier(tier, support) !== "operational") return [];
  return PA_OPERATIONS.filter((op) => ops.includes(op) && support.operations.has(op));
}

/** Why nothing beyond the inbox works: the assistant itself (disabled, no session…), not a grant or the host. */
const BINDING_REASONS = new Set(["assistant_disabled", "provisioning_in_progress", "session_missing", "session_inactive", "assistant_runtime_unsupported", "project_scope_empty"]);

export interface LiveGrants {
  /** `effective`: the host says (r299, saved grants); `atMost`: what the host can carry out, at most (older host or
   * an unsaved draft); never a claim that something works. */
  source: "effective" | "atMost";
  tier: PaTier;
  operations: PaOperation[];
  /** The assistant-level reason nothing beyond the inbox takes effect (r299 codes), if any. */
  reason: string | null;
}

/**
 * What takes effect for the grants shown. The saved grants on an host with grant support: its `effective` per key (the highest level
 * whose key is effective; 运维 when an operation is). A draft, or an older host: the level / operations the host can
 * carry out, at most.
 */
export function liveGrants(tier: PaTier, ops: readonly PaOperation[], support: GrantSupport, details: PaCapabilityDetails | null | undefined, saved: boolean): LiveGrants {
  if (!details || !saved) return { source: "atMost", tier: effectiveTier(tier, support), operations: effectiveOperations(ops, tier, support), reason: null };
  const on = (key: string) => details[key]?.effective === true;
  const liveOps = tier === "operational" ? PA_OPERATIONS.filter((op) => ops.includes(op) && on(op)) : [];
  const upTo = PA_TIERS.slice(0, PA_TIERS.indexOf(tier) + 1);
  const live = [...upTo].reverse().find((t) => (t === "inbox" ? true : t === "operational" ? liveOps.length > 0 : on(TIER_KEY[t]!))) ?? "inbox";
  const why = details.localDirectorRequests?.reason ?? null;
  return { source: "effective", tier: live, operations: liveOps, reason: why && BINDING_REASONS.has(why) ? why : null };
}
