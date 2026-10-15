// Owner notify (agent → owner messages, capability `owner-notify`; docs/research/owner-notify.md):
// pure predicates and helpers shared by the main process (big alert, main/ownerAlert.ts) and the
// renderer (timeline card, 需要你, OS notification, settings). No Electron / DOM imports.
import type { OwnerNotification, OwnerNotifyChannel, OwnerNotifyLevel, OwnerNotifySettings, OwnerNotifySettingsPatch, OwnerNotifyState } from "@cutex-desktop/protocol";
import type { OwnerAlertItem } from "./ownerAlert";
import { OWNER_NOTIFY_CREATED, OWNER_NOTIFY_DELETE_FEATURE, OWNER_NOTIFY_DELETED, OWNER_NOTIFY_FEATURE, OWNER_NOTIFY_UPDATED } from "@cutex-desktop/protocol";

export { OWNER_NOTIFY_CREATED, OWNER_NOTIFY_DELETE_FEATURE, OWNER_NOTIFY_DELETED, OWNER_NOTIFY_FEATURE, OWNER_NOTIFY_UPDATED };

/** A notice cutex wrote itself (delivery failure, reminder): not from the agent, takes no reply. */
export function isSystemNotice(n: Pick<OwnerNotification, "origin">): boolean {
  return n.origin === "system";
}

/** 回复 is offered: the agent asked for a reply, wrote it itself, and it is not answered / dismissed yet. */
export function canReply(n: Pick<OwnerNotification, "needsReply" | "origin" | "state">): boolean {
  return n.needsReply && !isSystemNotice(n) && !isFinal(n.state);
}

/** Final states: nothing more can happen to the record. */
export function isFinal(state: OwnerNotifyState): boolean {
  return state === "answered" || state === "dismissed";
}

/**
 * Pending (= counts in 需要你): needs a reply and not answered / dismissed yet; or no reply needed,
 * still open, and delivered somewhere (muted / rate-limited records stay in the conversation only).
 * cutex's own notices (origin system) are records only: the owner cannot act on them, so they never
 * count, whatever level / channels an older cutex gave them (notification-levels §2 记录).
 */
export function isPending(n: Pick<OwnerNotification, "needsReply" | "state" | "channels" | "origin">): boolean {
  if (isSystemNotice(n)) return false;
  if (n.needsReply) return n.state === "open" || n.state === "acknowledged";
  return n.state === "open" && n.channels.length > 0;
}

/** Alerting: an OS notification / big alert may still be showing (never for cutex's own notices). */
export function isAlerting(n: Pick<OwnerNotification, "state" | "origin">): boolean {
  return n.state === "open" && !isSystemNotice(n);
}

/** The main process shows a big alert window for this record. */
export function wantsBigAlert(n: Pick<OwnerNotification, "state" | "channels" | "origin">): boolean {
  return isAlerting(n) && n.channels.includes("bigAlert");
}

/** The renderer fires an OS notification for this record (on `created`). */
export function wantsDesktopNotification(n: Pick<OwnerNotification, "state" | "channels" | "origin">): boolean {
  return isAlerting(n) && n.channels.includes("desktop");
}

/** Rank for merging two copies of one record (events may arrive out of order with list reloads). */
const STATE_RANK: Record<OwnerNotifyState, number> = { open: 0, acknowledged: 1, answered: 2, dismissed: 2 };

/** The newer of two copies of a record: a later state wins; on a tie the incoming copy. */
export function newerRecord(current: OwnerNotification | undefined, incoming: OwnerNotification): OwnerNotification {
  if (!current) return incoming;
  return STATE_RANK[incoming.state] >= STATE_RANK[current.state] ? incoming : current;
}

/** Merge records into a map by notificationId (unchanged map when nothing changed). */
export function mergeRecords(byId: Readonly<Record<string, OwnerNotification>>, records: readonly unknown[] | null | undefined): Record<string, OwnerNotification> {
  let out: Record<string, OwnerNotification> | null = null;
  for (const raw of records ?? []) {
    const r = asRecord(raw);
    if (!r) continue;
    const current = (out ?? byId)[r.notificationId];
    const next = newerRecord(current, r);
    if (next === current) continue;
    out ??= { ...byId };
    out[r.notificationId] = next;
  }
  return out ?? (byId as Record<string, OwnerNotification>);
}

const LEVELS = new Set(["info", "attention", "urgent"]);
const STATES = new Set(["open", "acknowledged", "answered", "dismissed"]);

/** A record from the wire, or null when it is not one (defensive: events are untyped JSON). */
export function asRecord(raw: unknown): OwnerNotification | null {
  const r = raw as Partial<OwnerNotification> | null;
  if (!r || typeof r !== "object" || typeof r.notificationId !== "string" || typeof r.agentId !== "string" || typeof r.text !== "string") return null;
  if (!LEVELS.has(r.level as string) || !STATES.has(r.state as string)) return null;
  return {
    notificationId: r.notificationId,
    agentId: r.agentId,
    agentName: typeof r.agentName === "string" ? r.agentName : null,
    origin: r.origin === "system" ? "system" : "agent",
    text: r.text,
    level: r.level as OwnerNotifyLevel,
    requestedLevel: LEVELS.has(r.requestedLevel as string) ? (r.requestedLevel as OwnerNotifyLevel) : (r.level as OwnerNotifyLevel),
    downgraded: r.downgraded && typeof r.downgraded === "object" ? r.downgraded : null,
    muted: r.muted === true,
    channels: Array.isArray(r.channels) ? r.channels.filter((c): c is OwnerNotifyChannel => c === "desktop" || c === "phone" || c === "bigAlert") : [],
    needsReply: r.needsReply === true,
    delegation: typeof r.delegation === "string" ? r.delegation : null,
    job: typeof r.job === "string" ? r.job : null,
    turnId: typeof r.turnId === "string" ? r.turnId : null,
    state: r.state as OwnerNotifyState,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    acknowledgedAt: typeof r.acknowledgedAt === "string" ? r.acknowledgedAt : null,
    reply: r.reply && typeof r.reply === "object" && typeof r.reply.text === "string" ? r.reply : null,
    closedAt: typeof r.closedAt === "string" ? r.closedAt : null,
    ...(r.notificationLevel === "urgent" || r.notificationLevel === "needsYou" || r.notificationLevel === "inform" || r.notificationLevel === "record" ? { notificationLevel: r.notificationLevel } : {}),
    ...(typeof r.notificationEvent === "string" ? { notificationEvent: r.notificationEvent } : {}),
    ...(Array.isArray(r.actions) ? { actions: r.actions.filter((a): a is string => typeof a === "string") } : {}),
    ...(typeof r.systemKind === "string" ? { systemKind: r.systemKind } : {}),
  };
}

/** The record of a `cutex/ownerNotify/created|updated` event, else null. */
export function recordOfEvent(method: string | undefined, params: unknown): OwnerNotification | null {
  if (method !== OWNER_NOTIFY_CREATED && method !== OWNER_NOTIFY_UPDATED) return null;
  return asRecord((params as { notification?: unknown } | null | undefined)?.notification);
}

/** The record id of a `cutex/ownerNotify/deleted` event, else null. */
export function deletedIdOfEvent(method: string | undefined, params: unknown): string | null {
  if (method !== OWNER_NOTIFY_DELETED) return null;
  const id = (params as { notificationId?: unknown } | null | undefined)?.notificationId;
  return isNotificationId(id) ? id : null;
}

/** One-line preview (notification bodies, chips): whitespace collapsed, cut at `max` chars. */
export function previewText(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
}

// ---------- settings ----------

export interface OwnerNotifyDraft {
  delivery?: Partial<Record<OwnerNotifyLevel, OwnerNotifyChannel[]>>;
  bigAlertSound?: boolean;
  toolAudience?: OwnerNotifySettings["toolAudience"];
  rateLimit?: Partial<OwnerNotifySettings["rateLimit"]>;
  agentOverrides?: OwnerNotifySettings["agentOverrides"];
}

const CHANNEL_ORDER: OwnerNotifyChannel[] = ["desktop", "phone", "bigAlert"];

/** A level's channel list with `channel` switched on / off (canonical order, no duplicates). */
export function toggleChannel(list: readonly OwnerNotifyChannel[], channel: OwnerNotifyChannel, on: boolean): OwnerNotifyChannel[] {
  const set = new Set(list);
  if (on) set.add(channel);
  else set.delete(channel);
  return CHANNEL_ORDER.filter((c) => set.has(c));
}

/** Integer in range, or null when the input is not one. */
function clampInt(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/**
 * The `PATCH /v2/settings {ownerNotify}` body for a change: only what differs from `current`;
 * `agentOverrides` is sent whole (cutex replaces the map) with removed keys as `null`. Null = nothing to send.
 */
export function ownerNotifyPatch(current: OwnerNotifySettings, draft: OwnerNotifyDraft): OwnerNotifySettingsPatch | null {
  const patch: OwnerNotifySettingsPatch = {};
  if (draft.delivery) {
    const delivery: Partial<Record<OwnerNotifyLevel, OwnerNotifyChannel[]>> = {};
    for (const level of ["info", "attention", "urgent"] as const) {
      const next = draft.delivery[level];
      if (!next) continue;
      const clean = CHANNEL_ORDER.filter((c) => next.includes(c));
      const was = CHANNEL_ORDER.filter((c) => (current.delivery[level] ?? []).includes(c));
      if (clean.join() !== was.join()) delivery[level] = clean;
    }
    if (Object.keys(delivery).length) patch.delivery = delivery;
  }
  if (typeof draft.bigAlertSound === "boolean" && draft.bigAlertSound !== current.bigAlertSound) patch.bigAlertSound = draft.bigAlertSound;
  if (draft.toolAudience && draft.toolAudience !== current.toolAudience) patch.toolAudience = draft.toolAudience;
  if (draft.rateLimit) {
    const rate: Partial<OwnerNotifySettings["rateLimit"]> = {};
    const perHour = clampInt(draft.rateLimit.perHour, 1, 1000);
    const urgent = clampInt(draft.rateLimit.urgentPerHour, 0, 100);
    if (perHour !== null && perHour !== current.rateLimit.perHour) rate.perHour = perHour;
    if (urgent !== null && urgent !== current.rateLimit.urgentPerHour) rate.urgentPerHour = urgent;
    if (Object.keys(rate).length) patch.rateLimit = rate;
  }
  if (draft.agentOverrides) {
    const next = draft.agentOverrides;
    const was = current.agentOverrides ?? {};
    const keys = new Set([...Object.keys(was), ...Object.keys(next)]);
    let changed = false;
    const overrides: Record<string, "mute" | "force" | null> = {};
    for (const k of keys) {
      const v = next[k] === "mute" || next[k] === "force" ? next[k] : null;
      if (v !== (was[k] ?? null)) changed = true;
      if (v) overrides[k] = v;
      else if (was[k]) overrides[k] = null;
    }
    if (changed) patch.agentOverrides = overrides;
  }
  return Object.keys(patch).length ? patch : null;
}

/** The writable subset of a patch the renderer sent (main forwards only this; cutex validates values). */
export function sanitizeOwnerNotifyPatch(raw: unknown): OwnerNotifySettingsPatch {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: OwnerNotifySettingsPatch = {};
  if (p.delivery && typeof p.delivery === "object") {
    const delivery: Partial<Record<OwnerNotifyLevel, OwnerNotifyChannel[]>> = {};
    for (const level of ["info", "attention", "urgent"] as const) {
      const list = (p.delivery as Record<string, unknown>)[level];
      if (Array.isArray(list)) delivery[level] = list.filter((c): c is OwnerNotifyChannel => typeof c === "string" && (CHANNEL_ORDER as string[]).includes(c));
    }
    if (Object.keys(delivery).length) out.delivery = delivery;
  }
  if (typeof p.bigAlertSound === "boolean") out.bigAlertSound = p.bigAlertSound;
  if (p.toolAudience === "ownerFacing" || p.toolAudience === "everyone" || p.toolAudience === "directors" || p.toolAudience === "none") out.toolAudience = p.toolAudience;
  if (p.rateLimit && typeof p.rateLimit === "object") {
    const r = p.rateLimit as Record<string, unknown>;
    const rate: Partial<OwnerNotifySettings["rateLimit"]> = {};
    if (typeof r.perHour === "number") rate.perHour = r.perHour;
    if (typeof r.urgentPerHour === "number") rate.urgentPerHour = r.urgentPerHour;
    if (Object.keys(rate).length) out.rateLimit = rate;
  }
  if (p.agentOverrides && typeof p.agentOverrides === "object") {
    const overrides: Record<string, "mute" | "force" | null> = {};
    for (const [k, v] of Object.entries(p.agentOverrides as Record<string, unknown>).slice(0, 500)) {
      if (typeof k === "string" && k.length <= 200 && (v === "mute" || v === "force" || v === null)) overrides[k] = v;
    }
    out.agentOverrides = overrides;
  }
  return out;
}

/** Checked ids (main: the renderer / alert window may only name records by a sane id). */
export function isNotificationId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id);
}

// ---------- big alert list (main/ownerAlert.ts keeps it) ----------

export function alertItemOf(n: OwnerNotification): OwnerAlertItem {
  return {
    notificationId: n.notificationId,
    agentId: n.agentId,
    agentName: n.agentName?.trim() || n.agentId,
    level: n.level,
    text: n.text,
    createdAt: n.createdAt,
    needsReply: n.needsReply,
    delegation: n.delegation,
    job: n.job,
    // notification-levels: the record's decided methods say whether it rings; older records follow bigAlertSound.
    ...(n.actions ? { sound: n.actions.includes("sound") } : {}),
  };
}

/** Alert order: oldest first. */
export const compareAlerts = (a: OwnerAlertItem, b: OwnerAlertItem) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.notificationId.localeCompare(b.notificationId);

/** The alert list after one record changed (`created` / `updated`): shown while it wants a big alert, else gone. */
export function applyAlertRecord(alerts: readonly OwnerAlertItem[], n: OwnerNotification): OwnerAlertItem[] {
  const rest = alerts.filter((a) => a.notificationId !== n.notificationId);
  return wantsBigAlert(n) ? [...rest, alertItemOf(n)].sort(compareAlerts) : rest;
}

/** After (re)connecting: what cutex lists as alerting replaces the owner_notify alerts (demo and event alerts stay). */
export function reconcileAlerts(alerts: readonly OwnerAlertItem[], alerting: readonly OwnerNotification[]): OwnerAlertItem[] {
  const fresh = alerting.filter(wantsBigAlert).map(alertItemOf);
  return [...alerts.filter((a) => a.demo || a.kind === "event"), ...fresh].sort(compareAlerts);
}
