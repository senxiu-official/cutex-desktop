// 个人助理 (Personal Assistants) — the renderer's pure model (modules/personal-assistants draws it; the store is
// lib/personalAssistantStore.ts). The owner's decision 2026-11-25: an assistant is cross-host by nature, so every
// project reference is {instance, project} (`PaProjectRef`) and the project picker lists every paired host. cutex
// keeps an assistant's projects on its home host for now (r295 `projectIds`; r296 also `projectRefs`). Until a host
// advertises the cross-host scope (`remoteProjectsSupported`), the other hosts' projects are listed greyed with a
// note. A host is paired with an instance only by what it reports (its connection's / list's instance id), never by a
// project's name or id.
import {
  PA_CROSS_HOST_FEATURE, PA_OWNER_VIEWS_FEATURE, PA_QUALIFIED_REFS_FEATURE, PA_READINESS_FEATURE, PA_RECURRING_FEATURE,
  type PaAssistant, type PaAvailability, type PaCapabilities, type PaOverlap, type PaProjectRef, type PaRequest, type PaRequestState, type PaRule, type PaRun, type PaSeat, type PaTemplate,
} from "../../../shared/personalAssistants";

export { PERSONAL_ASSISTANTS_FEATURE } from "../../../shared/personalAssistants";
export type { PaProjectRef } from "../../../shared/personalAssistants";
export const refKey = (r: PaProjectRef) => `${r.instanceId}\n${r.projectId}`;

/** What a host's cutex offers beyond r295 (its `featureList`). */
export interface PaHostFeatures {
  /** r296 recurring templates and the calendar snapshot. */
  recurring: boolean;
  /** r296 `projectRefs` / `scopedSettings`. */
  qualifiedRefs: boolean;
  /** r296 notes, list rows with availability, newest-first requests with a state filter, the owner query, events. */
  ownerViews: boolean;
  /** Projects of other hosts (not advertised by r296). */
  crossHost: boolean;
  /** r299 create-options, evaluated `capabilityDetails`, agenda display zone and source observations. */
  readiness: boolean;
}
export function paFeatures(features: ReadonlySet<string> | null | undefined): PaHostFeatures {
  const has = (f: string) => !!features?.has(f);
  return { recurring: has(PA_RECURRING_FEATURE), qualifiedRefs: has(PA_QUALIFIED_REFS_FEATURE), ownerViews: has(PA_OWNER_VIEWS_FEATURE), crossHost: has(PA_CROSS_HOST_FEATURE), readiness: has(PA_READINESS_FEATURE) };
}
/** The capabilities a host with these features reports in its detail view (used until the detail itself is read). */
export function capabilitiesOf(f: PaHostFeatures): PaCapabilities {
  return {
    localDirectorRequests: true, agenda: true, requiresHandoffConfirmation: true, ownerOperationDelegation: false,
    recurringDirectorTemplates: f.recurring, readOnlyCalendarSnapshot: f.recurring, qualifiedProjectRefs: f.qualifiedRefs, crossHostProjectScope: f.crossHost,
  };
}

/** The assistant's projects as refs (r296 `projectRefs` when sent; r295: all on its home instance). */
export function assistantRefs(a: PaAssistant): PaProjectRef[] {
  return a.config.projectRefs ?? a.config.projectIds.map((projectId) => ({ instanceId: a.config.homeInstanceId, projectId }));
}

/**
 * Whether the assistant's home takes projects of other hosts: only when its host advertises the cross-host scope
 * (r296 does not, and its detail says `crossHostProjectScope: false`; a detail that says false wins).
 */
export function remoteProjectsSupported(features: PaHostFeatures | null, capabilities?: PaCapabilities | null): boolean {
  if (capabilities?.crossHostProjectScope === false) return false;
  return !!features?.crossHost;
}

/** The refs r295 can store: the home instance's project ids (others are dropped by the caller with a note). */
export function homeProjectIds(refs: readonly PaProjectRef[], homeInstanceId: string): string[] {
  return [...new Set(refs.filter((r) => r.instanceId === homeInstanceId).map((r) => r.projectId))].sort();
}

/** An overlap: one project another enabled assistant also covers. */
export interface PaOverlapRow extends PaOverlap {
  instanceId: string;
}

/**
 * The overlaps a draft would have, from the assistants this app has read (the owner's decision: allowed, with a
 * warning that can be dismissed). The saved assistant's own list comes from cutex (`PaView.overlaps`).
 */
export function draftOverlaps(refs: readonly PaProjectRef[], others: readonly PaAssistant[], selfId: string | null): PaOverlapRow[] {
  const wanted = new Set(refs.map(refKey));
  const out: PaOverlapRow[] = [];
  for (const a of others) {
    if (a.id === selfId || !a.enabled) continue;
    for (const r of assistantRefs(a)) if (wanted.has(refKey(r))) out.push({ assistantId: a.id, name: a.config.name, projectId: r.projectId, instanceId: r.instanceId });
  }
  return out.sort((x, y) => x.projectId.localeCompare(y.projectId) || x.name.localeCompare(y.name) || x.assistantId.localeCompare(y.assistantId));
}

/** The dismissal of one overlap warning: per assistant (or a new one) and per exact set of overlaps. */
export function overlapDismissKey(selfId: string | null, rows: readonly Pick<PaOverlap, "assistantId" | "projectId">[]): string {
  return `${selfId ?? "new"}|${[...new Set(rows.map((r) => `${r.assistantId}:${r.projectId}`))].sort().join(",")}`;
}

/** The `code` of a cutex refusal as main passes it on (`code: message`); null when none is readable. */
export function paErrorCode(error: unknown): string | null {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const m = /(?:^|\s|')([a-z][a-z0-9_]{2,63}):\s/.exec(text);
  return m ? m[1]! : null;
}

/** Refusals that mean "another writer got there first": read again before trying with a new action id. */
export const STALE_CODES: ReadonlySet<string> = new Set(["revision_conflict", "director_changed", "director_missing", "confirmation_stale", "invalid_transition", "calendar_changed"]);
/** Retry the same action id: cutex says it is busy / storage is unavailable, or the reply never came. */
export function keepsActionId(error: unknown): boolean {
  const code = paErrorCode(error);
  return code === null || code === "assistant_unavailable" || code === "provisioning_in_progress";
}

export type RequestGroup = "decide" | "open" | "done";
/** 待确认 (the owner's turn) · 进行中 (queued / with the Director) · 已结束. */
export function requestGroup(state: PaRequestState | string): RequestGroup {
  if (state === "awaitingOwner") return "decide";
  if (state === "queued" || state === "accepted" || state === "clarification") return "open";
  return "done";
}
export const KNOWN_REQUEST_STATES: readonly string[] = ["awaitingOwner", "queued", "accepted", "clarification", "declined", "completed", "cancelled"];
/** Only these may be confirmed / cancelled by the owner. */
export const confirmable = (r: Pick<PaRequest, "state">) => r.state === "awaitingOwner";
export const cancellable = (r: Pick<PaRequest, "state">) => r.state === "awaitingOwner" || r.state === "queued" || r.state === "clarification";

export const KNOWN_AVAILABILITY: readonly PaAvailability[] = ["ready", "provisioning", "runtimeUnsupported", "disabled", "sessionMissing", "sessionInactive"];

/** A fresh action id (kept by the caller until the outcome is known). */
export function newActionId(kind: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(16).slice(2).padEnd(32, "0");
  return `desktop-${kind}-${rnd}`.slice(0, 128);
}

/** Host-local date YYYY-MM-DD (the agenda's default day is the host's; this is the device's, for the picker only). */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- 定期任务 (r296 recurring templates) ----

export type TemplateState = "active" | "paused" | "cancelled";
export function templateState(t: Pick<PaTemplate, "enabled" | "deletedAt">): TemplateState {
  return t.deletedAt ? "cancelled" : t.enabled ? "active" : "paused";
}

export type ReconfirmReason = "director" | "directorMissing" | "assistant";
/** Refusals of a run that mean the template must be confirmed again (cutex also raises an owner notice for them). */
const RECONFIRM: Readonly<Record<string, ReconfirmReason>> = { director_changed: "director", director_missing: "directorMissing", confirmation_stale: "assistant" };
/**
 * Why a template needs 重新确认, or null. cutex refuses a run whose confirmation went stale (the project's Director
 * changed or left, or the assistant changed in a way that matters) and keeps the template as it is. So: the last run of
 * the current revision was refused for that, or the Director this app sees now differs from the one confirmed (pass
 * `undefined` when the current seat is not known). A rename or a change to another project keeps a template valid, so
 * the assistant's revision alone says nothing.
 */
export function reconfirmReason(t: PaTemplate, currentSeat: PaSeat | null | undefined): ReconfirmReason | null {
  if (templateState(t) === "cancelled" || !t.template) return null;
  const run = t.lastRun;
  if (run && run.outcome === "refused" && run.scheduleRevision >= t.revision && run.lastError) {
    for (const [code, why] of Object.entries(RECONFIRM)) if (run.lastError.includes(code)) return why;
  }
  if (currentSeat !== undefined) {
    if (!currentSeat?.sessionId) return "directorMissing";
    const c = t.template.confirmedSeat;
    if (c.sessionId !== currentSeat.sessionId || c.epoch !== currentSeat.epoch) return "director";
  }
  return null;
}

export type RunKind = "sent" | "refused" | "cancelled" | "waiting" | "held" | "retrying" | "other";
/** A run's outcome as shown (handedOff = 已发送, with its request; open runs wait, are held or retry). */
export function runKind(run: Pick<PaRun, "outcome">): RunKind {
  switch (run.outcome) {
    case "handedOff":
      return "sent";
    case "refused":
      return "refused";
    case "cancelled":
      return "cancelled";
    case "pending":
    case "dispatching":
      return "waiting";
    case "held":
      return "held";
    case "retrying":
      return "retrying";
    default:
      return "other";
  }
}
/** The refusal code at the end of a run's error text (cutex writes the code, sometimes after context), else null. */
export function runErrorCode(run: Pick<PaRun, "lastError">): string | null {
  const m = run.lastError ? /([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*$/.exec(run.lastError.trim()) : null;
  return m ? m[1]! : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** The UTC offset (minutes) of an RFC 3339 time, or null. */
export function offsetOf(rfc3339: string | null | undefined): number | null {
  const m = rfc3339 ? /(?:([+-])(\d{2}):(\d{2})|Z)$/.exec(rfc3339) : null;
  if (!m) return null;
  if (!m[1]) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}
/**
 * The host's UTC offset (minutes) for a template: from its last run's host-local slot when known, else from the next run
 * of a daily / weekly rule (it falls on the rule's wall time: the offset that makes it so, the one nearest this device's
 * when two would). Null when it cannot be told (an interval rule before its first run).
 */
export function hostOffset(t: Pick<PaTemplate, "rule" | "nextRunAt" | "lastRun">, deviceOffset = -new Date().getTimezoneOffset()): number | null {
  const known = offsetOf(t.lastRun?.slotLocal);
  if (known !== null) return known;
  if (!t.rule || t.rule.kind === "interval" || !t.nextRunAt) return null;
  const at = Date.parse(t.nextRunAt);
  if (!Number.isFinite(at)) return null;
  const [h, m] = t.rule.time.split(":").map(Number) as [number, number];
  const utc = new Date(at);
  const base = (((h * 60 + m - (utc.getUTCHours() * 60 + utc.getUTCMinutes())) % 1440) + 1440) % 1440;
  const candidates = [base - 1440, base, base + 1440].filter((o) => o >= -12 * 60 && o <= 14 * 60);
  return candidates.sort((a, b) => Math.abs(a - deviceOffset) - Math.abs(b - deviceOffset))[0] ?? null;
}
/** A UTC instant as host wall time at the given offset: {date YYYY-MM-DD, time HH:MM, weekday Mon=1…7}. */
export function hostWall(iso: string, offsetMinutes: number): { date: string; time: string; weekday: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + offsetMinutes * 60_000);
  return { date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`, time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`, weekday: ((d.getUTCDay() + 6) % 7) + 1 };
}
/** The rule of a new template. */
export const DEFAULT_RULE: PaRule = { kind: "daily", time: "09:00" };
