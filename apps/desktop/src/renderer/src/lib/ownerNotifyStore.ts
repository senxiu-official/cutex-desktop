// Owner notify records (agent → owner messages, capability `owner-messages`) in their own zustand
// store, like the delegation store: seeded from each opened agent's bootstrap
// (`cutexState.ownerNotifications`) and from `GET /v2/owner-notifications?filter=pending` on connect
// (需要你 for agents not opened yet), kept fresh by `cutex/ownerNotify/created|updated` from the host
// feed (it carries every session's stream), and `cutex/ownerNotify/deleted` drops a record (deleted ids
// are remembered so a stale list cannot bring one back). New records with the `desktop` channel raise an OS
// notification. Per host (multi-host RFC §10): every connected host's records are followed — `byId` is
// the focus host's (the host the app shows), `others` the rest (their count, notifications); a host's
// records go when its connection is replaced or it is removed (lib/hostSwitch onHostReset).
import { create } from "zustand";
import { NOTIFICATION_PAGES_FEATURE } from "../../../shared/notificationPaging";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import type { DaemonApi, OwnerNotifyAction, OwnerNotifyResult, SafetyCheckDecision, SafetyCheckResult } from "../../../shared/ipc";
import { deletedIdOfEvent, isAlerting, isPending, isSystemNotice, mergeRecords, OWNER_NOTIFY_CREATED, OWNER_NOTIFY_FEATURE, previewText, recordOfEvent } from "../../../shared/ownerNotify";
import { api, apiFor, bridge } from "../bridge";
import { translate } from "../i18n";
import { useFocusRequest } from "./focusRequest";
import { appHasFocus } from "./appFocus";
import { onHostReset } from "./hostSwitch";
import { emitNotify, retractNotify } from "./notifyEvents";
import { ownerNoteActions } from "./ownerNotify";

type Records = Record<string, OwnerNotification>;

export interface OwnerNotifyStore {
  /** The focus host's records. */
  byId: Records;
  /** The other connected hosts' records by host id (their attention count and notifications). */
  others: Readonly<Record<string, Records>>;
  /** Bounded history state, scoped to the host connection and agent. */
  history: Readonly<Record<string, OwnerNotificationHistoryState>>;
  reset(): void;
}

interface HostNotes {
  byId: Records;
  notified: Set<string>;
  /** Records the owner deleted (this host): later copies from lists / events are ignored. */
  deleted: Set<string>;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  pages: Map<string, HistoryRequest>;
}
const hosts = new Map<string, HostNotes>();

export const useOwnerNotify = create<OwnerNotifyStore>((set) => ({
  byId: {},
  others: {},
  history: {},
  reset: () => {
    for (const notes of hosts.values()) if (notes.refreshTimer) clearTimeout(notes.refreshTimer);
    hosts.clear();
    set({ byId: {}, others: {}, history: {} });
  },
}));

type Rows = { cutexSessionId: string; displayName: string }[];
interface SidebarSlice {
  active: Rows;
  retired: Rows;
  hostRows: Record<string, { projectId?: string | null }>;
}
interface AppSlice {
  /** The focus host's capabilities. */
  features: ReadonlySet<string>;
  selectedId: string | null;
  view: { kind: string };
  sidebar: SidebarSlice | null;
  /** Host list (focus = `active`); absent before it loads (= local). */
  hosts?: { active: string; hosts: { id: string; label: string }[] } | null;
  /** The other connected hosts' capabilities / sidebar (store.ts background slices). */
  byHost?: Readonly<Record<string, { features: ReadonlySet<string>; sidebar: SidebarSlice | null }>>;
}

/** The bits of the app store this module uses (passed in by store.ts). */
export interface OwnerNotifyAppHandle {
  getState(): AppSlice & { select(id: string): Promise<void>; openAgent?(id: string, hostId: string): Promise<void> };
  subscribe(listener: (state: AppSlice, prev: AppSlice) => void): () => void;
}

let app: OwnerNotifyAppHandle | null = null;

const focusHost = (s: AppSlice | undefined = app?.getState()) => s?.hosts?.active ?? "local";
const isFocus = (hostId: string) => hostId === focusHost();
const daemonOf = (hostId: string): DaemonApi => (isFocus(hostId) ? api : apiFor(hostId));

function notesOf(hostId: string): HostNotes {
  let notes = hosts.get(hostId);
  if (!notes) {
    notes = { byId: {}, notified: new Set(), deleted: new Set(), refreshTimer: null, pages: new Map() };
    hosts.set(hostId, notes);
  }
  return notes;
}

/** Show the focus host's records as `byId`, the others' as `others`. */
function publish(): void {
  const focus = focusHost();
  const others: Record<string, Records> = {};
  for (const [hostId, notes] of hosts) if (hostId !== focus && Object.keys(notes.byId).length) others[hostId] = notes.byId;
  const byId = hosts.get(focus)?.byId ?? {};
  const state = useOwnerNotify.getState();
  const sameOthers = Object.keys(others).length === Object.keys(state.others).length && Object.entries(others).every(([id, records]) => state.others[id] === records);
  const sameById = state.byId === byId || (Object.keys(byId).length === 0 && Object.keys(state.byId).length === 0);
  if (!sameById || !sameOthers) useOwnerNotify.setState({ byId: sameById ? state.byId : byId, others: sameOthers ? state.others : others });
}

function supported(hostId: string): boolean {
  const s = app?.getState();
  if (!s) return false;
  return isFocus(hostId) ? s.features.has(OWNER_NOTIFY_FEATURE) : !!s.byHost?.[hostId]?.features.has(OWNER_NOTIFY_FEATURE);
}

/** A missing entry means this view has not requested its first bounded page yet. */
export interface OwnerNotificationHistoryState {
  cursor: string | null;
  loading: boolean;
  error: string | null;
}
interface HistoryRequest {
  state: OwnerNotificationHistoryState;
  seen: Set<string>;
  inflight?: Promise<void>;
}
export const ownerNotificationHistoryKey = (hostId: string, agentId: string): string => JSON.stringify([hostId, agentId]);

function publishHistory(hostId: string, agentId: string, page: HistoryRequest): void {
  useOwnerNotify.setState(s => ({ history: { ...s.history, [ownerNotificationHistoryKey(hostId, agentId)]: page.state } }));
}

function pagesSupported(hostId: string): boolean {
  const s = app?.getState();
  const features = isFocus(hostId) ? s?.features : s?.byHost?.[hostId]?.features;
  return !!features?.has(NOTIFICATION_PAGES_FEATURE);
}

function cursorExpired(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  if (typeof e?.status === "number" || typeof e?.code === "string") {
    return (e.status === 400 && e.code === "invalid_cursor") || (e.status === 409 && e.code === "resync_required");
  }
  // Electron retains Error.message only. CutexApiError prefixes the daemon code in it;
  // match that exact prefix, including the optional Electron wrapper, not arbitrary text.
  return error instanceof Error && /^(?:Error invoking remote method '[^']+': )?(?:(?:CutexApi)?Error: )?(?:invalid_cursor|resync_required):/.test(error.message);
}

/** One explicit page per request, independent of native turn history. No automatic draining. */
export function loadOwnerNotificationHistory(hostId: string, agentId: string): Promise<void> {
  if (!supported(hostId) || !pagesSupported(hostId)) return Promise.resolve();
  const notes = notesOf(hostId);
  let page = notes.pages.get(agentId);
  if (page?.inflight) return page.inflight;
  if (page && !page.state.cursor && !page.state.error) return Promise.resolve();
  if (!page) {
    page = { state: { cursor: null, loading: false, error: null }, seen: new Set() };
    notes.pages.set(agentId, page);
  }
  const request = page;
  // Bind to this host, including retries after the focus host changes.
  const daemon = apiFor(hostId);
  const current = () => hosts.get(hostId) === notes && notes.pages.get(agentId) === request;
  request.state = { ...request.state, loading: true, error: null };
  // Install the promise before publishing (subscribers can reenter); errors remain visible for retry.
  request.inflight = Promise.resolve().then(async () => {
    let restarted = false;
    try {
      while (current()) {
        const cursor = request.state.cursor;
        try {
          const before = notes.byId;
          const result = await daemon.ownerNotificationsPage({ filter: "all", agentId, limit: 50, ...(cursor ? { cursor } : {}) });
          if (!current()) return;
          const next = result.nextCursor || null;
          if (next && (next === cursor || request.seen.has(next))) {
            request.seen.clear();
            request.state = { cursor: null, loading: false, error: null };
            throw new Error("Notification history cursor did not advance");
          }
          // Stable cache rows can be reconciled by this snapshot. Changes from live events,
          // bootstrap or actions after the read began win; merge also checks deletion tombstones.
          merge(hostId, result.notifications.filter(r => r.agentId === agentId &&
            (!notes.byId[r.notificationId] || notes.byId[r.notificationId] === before[r.notificationId])));
          if (cursor) request.seen.add(cursor);
          request.state = { cursor: next, loading: false, error: null };
          return;
        } catch (error) {
          if (!current()) return;
          if (!restarted && cursorExpired(error)) {
            restarted = true;
            request.seen.clear();
            request.state = { cursor: null, loading: true, error: null };
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (current()) request.state = { ...request.state, loading: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      request.inflight = undefined;
      if (current()) publishHistory(hostId, agentId, request);
    }
  });
  publishHistory(hostId, agentId, request);
  return request.inflight;
}

/**
 * Records that stopped alerting (answered / acknowledged / dismissed, or deleted): their desktop
 * notification closes, and main drops their big alert too in case it missed the host event (the big
 * alert stayed up in the middle of the screen although the owner had handled it in the app).
 */
function retractClosed(hostId: string, notificationIds: readonly string[]): void {
  // Main takes up to 200 per call.
  for (let i = 0; i < notificationIds.length; i += 200) {
    const ids = notificationIds.slice(i, i + 200);
    retractNotify({ keys: ids.map((id) => `owner-notify:${id}`), notes: ids.map((notificationId) => ({ hostId, notificationId })) });
  }
}

function merge(hostId: string, records: readonly unknown[]): void {
  const notes = notesOf(hostId);
  const live = notes.deleted.size ? records.filter((r) => !notes.deleted.has((r as { notificationId?: string } | null)?.notificationId ?? "")) : records;
  const before = notes.byId;
  const next = mergeRecords(before, live);
  if (next === before) return;
  notes.byId = next;
  publish();
  // Only records this merge changed into a non-alerting state (an old closed record in a list stays quiet).
  retractClosed(hostId, Object.keys(next).filter((id) => next[id] !== before[id] && !isAlerting(next[id]!) && (!before[id] || isAlerting(before[id]!))));
}

function remove(hostId: string, notificationId: string): void {
  const notes = notesOf(hostId);
  if (!notes.deleted.has(notificationId)) retractClosed(hostId, [notificationId]);
  notes.deleted.add(notificationId);
  if (!(notificationId in notes.byId)) return;
  const next = { ...notes.byId };
  delete next[notificationId];
  notes.byId = next;
  publish();
}

/** Drop a deleted record (event, or our own delete) everywhere: timeline card, 需要你, OS notification bookkeeping. */
export function removeOwnerNote(notificationId: string, hostId = focusHost()): void {
  remove(hostId, notificationId);
}

/** Bootstrap `cutexState.ownerNotifications` of an opened agent (missing on older cutex = []). */
export function seedOwnerNotes(records: readonly unknown[] | null | undefined, hostId = focusHost()): void {
  if (records?.length) merge(hostId, records);
}

/** Every pending record of a host (需要你), plus a re-read of agents whose pending records left that list. */
export async function refreshPendingOwnerNotes(hostId = focusHost()): Promise<void> {
  if (!supported(hostId)) return;
  const daemon = daemonOf(hostId);
  const notes = notesOf(hostId);
  const before = notes.byId;
  try {
    const pending = await daemon.ownerNotifications({ filter: "pending", limit: 500 });
    if (hosts.get(hostId) !== notes) return; // that host's connection was replaced meanwhile
    const listed = new Set(pending.map((r) => r.notificationId));
    const stale = Object.values(notes.byId).filter((r) => before[r.notificationId] === r && isPending(r) && !listed.has(r.notificationId));
    // Live/action/bootstrap records changed while this snapshot was read take precedence.
    merge(hostId, pending.filter(r => notes.byId[r.notificationId] === before[r.notificationId]));
    for (const agentId of new Set(stale.map((r) => r.agentId))) {
      const rereadBefore = notes.byId;
      void daemon.ownerNotifications({ filter: "all", agentId, limit: 50 }).then((records) => {
        if (hosts.get(hostId) === notes) merge(hostId, records.filter(r => notes.byId[r.notificationId] === rereadBefore[r.notificationId]));
      }, () => {});
    }
  } catch {
    // transient: the next connect / event retries
  }
}

/** 知道了 / 回复 / 不回复 / 删除 on a record of `hostId` (default: the focus host): sent on the sender's session; the returned record is applied (delete: removed) at once. */
export async function ownerNotifyAct(record: Pick<OwnerNotification, "agentId" | "notificationId">, action: OwnerNotifyAction, text?: string, hostId = focusHost()): Promise<OwnerNotifyResult> {
  const r = await daemonOf(hostId).ownerNotifyAction(record.agentId, action, record.notificationId, text);
  if (action === "delete" && (r.ok || r.error.code === "notification_not_found")) remove(hostId, record.notificationId);
  else if (r.ok) merge(hostId, [r.notification]);
  else if (r.error.code === "notification_closed" || r.error.code === "notification_not_found") scheduleRefresh(hostId);
  return r;
}

/**
 * 批准一次 / 不批准 on a safety-block notice (claude-safety-grants) of `hostId`: the returned notice (or, when
 * it was decided elsewhere meanwhile, the one the refusal carries) is applied at once.
 */
export async function safetyCheckAct(record: Pick<OwnerNotification, "agentId" | "safetyBlock">, decision: SafetyCheckDecision, hostId = focusHost()): Promise<SafetyCheckResult> {
  const blockId = record.safetyBlock?.blockId;
  if (!blockId) throw new Error("not a safety block");
  const r = await daemonOf(hostId).safetyCheckDecide(record.agentId, blockId, decision);
  if (r.notification) merge(hostId, [r.notification]);
  else if (!r.ok) scheduleRefresh(hostId);
  return r;
}

/**
 * Open the sender at that message (OS notification click, 需要你 chip, big alert 打开). A record of
 * another host opens in place (store `openAgent`: widens the scope to 所有设备 when that host is
 * outside it); the focus host is not switched.
 */
export function focusOwnerNote(agentId: string, notificationId: string, hostId = focusHost()): void {
  useFocusRequest.setState({ request: { sessionId: agentId, hostId, notificationId, nonce: Date.now() + Math.random() } });
  const s = app?.getState();
  if (!s) return;
  if (s.openAgent) void s.openAgent(agentId, hostId);
  else if (isFocus(hostId)) void s.select(agentId);
}

/** The same for a record of any connected host. */
export function focusHostOwnerNote(hostId: string, agentId: string, notificationId: string): void {
  focusOwnerNote(agentId, notificationId, hostId);
}

const NO_NOTES: Records = {};
/** The records of one host (the focus host's `byId`, another connected host's `others` entry). */
export function useHostOwnerNotes(hostId: string): Records {
  return useOwnerNotify((s) => (isFocus(hostId) ? s.byId : (s.others[hostId] ?? NO_NOTES)));
}

function scheduleRefresh(hostId: string): void {
  const notes = notesOf(hostId);
  if (notes.refreshTimer) clearTimeout(notes.refreshTimer);
  notes.refreshTimer = setTimeout(() => {
    notes.refreshTimer = null;
    if (hosts.get(hostId) === notes) void refreshPendingOwnerNotes(hostId);
  }, 300);
}

function agentName(sidebar: SidebarSlice | null | undefined, record: OwnerNotification): string {
  const rows = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  return rows.find((x) => x.cutexSessionId === record.agentId)?.displayName ?? record.agentName ?? record.agentId;
}

/** Start following every host's feed and the connections (store.ts init). */
export function startOwnerNotifySync(handle: OwnerNotifyAppHandle): void {
  if (app) return;
  app = handle;
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    const gone = deletedIdOfEvent(envelope.cutex?.method, envelope.cutex?.params);
    if (gone) return remove(hostId, gone);
    const record = recordOfEvent(envelope.cutex?.method, envelope.cutex?.params);
    if (!record) return;
    const notes = notesOf(hostId);
    const known = notes.byId[record.notificationId];
    merge(hostId, [record]);
    if (envelope.cutex?.method !== OWNER_NOTIFY_CREATED || known || notes.notified.has(record.notificationId) || notes.deleted.has(record.notificationId)) return;
    notes.notified.add(record.notificationId);
    const s = handle.getState();
    const focus = isFocus(hostId);
    const sidebar = focus ? s.sidebar : s.byHost?.[hostId]?.sidebar;
    const level = translate(`ownerNotify.level.${record.level}`);
    const name = agentName(sidebar, record);
    const from = isSystemNotice(record) ? translate("ownerNotify.systemAbout", { name }) : name;
    const row = sidebar?.hostRows[record.agentId];
    // Hosts outside the scope (P0: not the shown one) say which host it is from.
    const label = focus ? null : (s.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId);
    // cutex decided the methods at creation (record.actions; older cutex: the channels, mutes applied).
    // The big alert is main's (main/ownerAlert.ts, also while hidden to the tray), so it is skipped here.
    emitNotify({
      key: `owner-notify:${record.notificationId}`,
      ...(focus ? {} : { hostId }),
      events: record.notificationEvent ? [record.notificationEvent] : [],
      decided: { level: record.notificationLevel ?? "needsYou", actions: ownerNoteActions(record) },
      fallback: [],
      agentId: record.agentId,
      agentName: name,
      projectId: row ? (row.projectId ?? null) : undefined,
      title: `${label ? `${label} · ` : ""}${from} · ${level}`,
      body: previewText(record.text, 200),
      looking: focus && appHasFocus() && s.view.kind === "conversation" && s.selectedId === record.agentId,
      skip: ["bigAlert", ...(record.channels.includes("bigAlert") ? ["sound"] : [])],
      onClick: () => focusHostOwnerNote(hostId, record.agentId, record.notificationId),
    });
  });
  bridge.on("ownerNotifyOpen", ({ hostId, agentId, notificationId }) => focusHostOwnerNote(hostId ?? focusHost(), agentId, notificationId));
  // A host's connection was replaced / the host removed: its records, notified and deleted ids go.
  onHostReset((hostId) => {
    const notes = hosts.get(hostId);
    if (!notes) return;
    if (notes.refreshTimer) clearTimeout(notes.refreshTimer);
    hosts.delete(hostId);
    useOwnerNotify.setState(s => ({ history: Object.fromEntries(Object.entries(s.history).filter(([key]) => JSON.parse(key)[0] !== hostId)) }));
    publish();
  });
  handle.subscribe((state, prev) => {
    // The focus moved: show that host's records (kept while it was connected outside the scope).
    if (focusHost(state) !== focusHost(prev)) publish();
    if (state.features !== prev.features && state.features.has(OWNER_NOTIFY_FEATURE)) void refreshPendingOwnerNotes(focusHost(state));
  });
  if (supported(focusHost())) void refreshPendingOwnerNotes();
}
