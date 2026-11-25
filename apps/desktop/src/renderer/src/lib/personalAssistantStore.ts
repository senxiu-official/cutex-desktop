// 个人助理 data per host (model lib/personalAssistants.ts). Every read is a GET; writes happen only from the owner's
// explicit buttons (create / save / grants / enable / confirm / cancel; 定期任务 and the calendar write in their cards).
//
// cutex r295: no change events, so the page reads again when it opens, while it is open (POLL_MS), when the window
// regains focus and when a host reconnects; each host read lists the assistants, reads each one's detail and all of its
// requests (oldest first, to the end, bounded so a broken cursor cannot loop).
// cutex r296 owner views: the list rows carry availability and the current Profile, so a host read is the list plus,
// per assistant, every request waiting for the owner and the newest page (newest first); the detail (overlaps, exact
// capabilities) is read when an assistant is opened. Committed changes arrive as `cutex/personalAssistant/changed`
// (`onPaChanged`): only the named assistant and areas are read again, and `ticks` tells open cards (今日, notes, history,
// 定期任务) to read theirs. No polling on those hosts.
import { create } from "zustand";
import type { PaAssistant, PaCancelInput, PaChange, PaConfig, PaConfirmInput, PaList, PaRequest, PaView } from "../../../shared/personalAssistants";
import { hostApi, hostDataNow } from "./hostLists";
import { capabilitiesOf, newActionId, paFeatures, type PaHostFeatures } from "./personalAssistants";

/** Pages read at most per list (100 rows each). */
const MAX_PAGES = 20;
export const POLL_MS = 30_000;
/** Newest requests read per assistant on an owner-views host (all the ones waiting for the owner come on their own). */
export const RECENT_REQUESTS = 100;

/** What a change event names (cutex: assistant / notes / calendar / requests, plus audit; later r296: templates). */
export type PaArea = "assistant" | "notes" | "calendar" | "requests" | "audit" | "templates";

export interface HostPa {
  /** The host's instance id as its list reports it (`homeInstanceId`). */
  instanceId: string | null;
  assistants: PaAssistant[];
  views: Record<string, PaView>;
  /** r295: oldest first, read to the end. r296: the waiting ones and the newest page, newest first. */
  requests: Record<string, PaRequest[]>;
  /** r296: older requests than those read exist (the 请求 tab pages them). */
  moreRequests: Record<string, boolean>;
  /** Per assistant and area: bumped by each change event (open cards read again when theirs moves). */
  ticks: Record<string, Partial<Record<PaArea, number>>>;
  /** The host has announced a 定期任务 change (area `templates`): its 定期任务 tab stops polling. */
  sendsTemplates: boolean;
  loadedAt: number | null;
  loading: boolean;
  error: string | null;
}

interface State {
  byHost: Record<string, HostPa>;
}

export const usePa = create<State>(() => ({ byHost: {} }));

/** `sessionId` on `hostId` is a 个人助理's agent (as last read; the nav badge keeps every supported host read). */
export function isAssistantSession(s: State, hostId: string | null | undefined, sessionId: string | null | undefined): boolean {
  if (!hostId || !sessionId) return false;
  return s.byHost[hostId]?.assistants.some((a) => a.sessionId === sessionId) === true;
}

const emptyHost = (): HostPa => ({ instanceId: null, assistants: [], views: {}, requests: {}, moreRequests: {}, ticks: {}, sendsTemplates: false, loadedAt: null, loading: false, error: null });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function patchHost(hostId: string, patch: (h: HostPa) => Partial<HostPa>): void {
  usePa.setState((s) => {
    const h = s.byHost[hostId] ?? emptyHost();
    return { byHost: { ...s.byHost, [hostId]: { ...h, ...patch(h) } } };
  });
}

/** The host's assistant features as its connection reports them now. */
export function hostPaFeatures(hostId: string): PaHostFeatures {
  return paFeatures(hostDataNow(hostId)?.features);
}

/** r295: every request, oldest first. */
async function readAllRequests(hostId: string, id: string): Promise<PaRequest[]> {
  const api = hostApi(hostId);
  const out: PaRequest[] = [];
  let cursor: number | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await api.paRequests(id, { cursor, limit: 100 });
    out.push(...page.items);
    if (page.nextCursor === null || page.items.length < 100 || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

/** r296: the ones waiting for the owner (cutex caps them at 50 per assistant) and the newest page, newest first. */
async function readRecentRequests(hostId: string, id: string): Promise<{ items: PaRequest[]; more: boolean }> {
  const api = hostApi(hostId);
  const [waiting, recent] = await Promise.all([api.paRequests(id, { state: "awaitingOwner", limit: 100 }), api.paRequests(id, { limit: RECENT_REQUESTS })]);
  const seen = new Set(recent.items.map((r) => r.id));
  const items = [...recent.items, ...waiting.items.filter((r) => !seen.has(r.id))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items, more: recent.nextCursor !== null };
}

/** The view of an r296 list row (kept detailed when the detail was read before). */
function rowView(a: PaAssistant, list: PaList, prior: PaView | undefined, f: PaHostFeatures): PaView {
  const status = list.status?.[a.id] ?? { availability: "provisioning", activeProfile: null };
  if (prior && !prior.fromList) return { ...prior, assistant: a, availability: status.availability, activeProfile: status.activeProfile };
  return { assistant: a, overlaps: [], moreOverlaps: false, availability: status.availability, activeProfile: status.activeProfile, capabilities: capabilitiesOf(f), fromList: true };
}

const inFlight = new Map<string, Promise<void>>();

/** Reads one host's assistants, their state and requests (one read at a time per host). */
export function refreshHost(hostId: string): Promise<void> {
  const running = inFlight.get(hostId);
  if (running) return running;
  const run = (async () => {
    patchHost(hostId, () => ({ loading: true }));
    try {
      const api = hostApi(hostId);
      const f = hostPaFeatures(hostId);
      const assistants: PaAssistant[] = [];
      let instanceId: string | null = null;
      let status: PaList["status"] = null;
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await api.paList({ cursor, limit: 100 });
        instanceId = page.homeInstanceId || instanceId;
        assistants.push(...page.items);
        if (page.status) status = { ...(status ?? {}), ...page.status };
        if (!page.nextCursor || page.items.length < 100 || page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }
      const views: Record<string, PaView> = {};
      const requests: Record<string, PaRequest[]> = {};
      const moreRequests: Record<string, boolean> = {};
      const prior = usePa.getState().byHost[hostId]?.views ?? {};
      if (f.ownerViews && status) {
        const list: PaList = { homeInstanceId: instanceId ?? "", items: assistants, status, nextCursor: null };
        for (const a of assistants) {
          views[a.id] = rowView(a, list, prior[a.id], f);
          const r = await readRecentRequests(hostId, a.id);
          requests[a.id] = r.items;
          moreRequests[a.id] = r.more;
        }
      } else {
        for (const a of assistants) {
          views[a.id] = await api.paGet(a.id);
          requests[a.id] = await readAllRequests(hostId, a.id);
        }
      }
      patchHost(hostId, () => ({ instanceId, assistants, views, requests, moreRequests, loadedAt: Date.now(), loading: false, error: null }));
    } catch (e) {
      patchHost(hostId, () => ({ loading: false, error: errorText(e) }));
    } finally {
      inFlight.delete(hostId);
    }
  })();
  inFlight.set(hostId, run);
  return run;
}

async function readRequestsOf(hostId: string, id: string): Promise<{ items: PaRequest[]; more: boolean }> {
  return hostPaFeatures(hostId).ownerViews ? readRecentRequests(hostId, id) : { items: await readAllRequests(hostId, id), more: false };
}

/** One assistant again: its detail and requests (after a write, or while a confirmation card is open). */
export async function refreshAssistant(hostId: string, id: string): Promise<void> {
  const api = hostApi(hostId);
  const view = await api.paGet(id);
  const requests = await readRequestsOf(hostId, id);
  takeView(hostId, view, requests);
}

/** Reads the detail of an assistant shown from its list row (overlaps, exact capabilities); once per open. */
export async function ensureDetail(hostId: string, id: string): Promise<void> {
  const v = usePa.getState().byHost[hostId]?.views[id];
  if (v && !v.fromList) return;
  takeView(hostId, await hostApi(hostId).paGet(id));
}

/** One assistant's requests again. */
export async function refreshRequests(hostId: string, id: string): Promise<void> {
  const r = await readRequestsOf(hostId, id);
  patchHost(hostId, (h) => ({ requests: { ...h.requests, [id]: r.items }, moreRequests: { ...h.moreRequests, [id]: r.more } }));
}

function takeView(hostId: string, view: PaView, requests?: { items: PaRequest[]; more: boolean }): void {
  patchHost(hostId, (h) => {
    const id = view.assistant.id;
    const has = h.assistants.some((a) => a.id === id);
    return {
      assistants: has ? h.assistants.map((a) => (a.id === id ? view.assistant : a)) : [...h.assistants, view.assistant],
      views: { ...h.views, [id]: view },
      ...(requests ? { requests: { ...h.requests, [id]: requests.items }, moreRequests: { ...h.moreRequests, [id]: requests.more } } : {}),
    };
  });
}

// ---- change events (r296) ----

const AREAS: ReadonlySet<string> = new Set<PaArea>(["assistant", "notes", "calendar", "requests", "audit", "templates"]);
/** The fields of a `cutex/personalAssistant/changed` event this app uses; null when malformed. */
export function readChange(params: unknown): { assistantId: string; areas: PaArea[]; requestId: string | null } | null {
  const p = params as { assistantId?: unknown; areas?: unknown; requestId?: unknown } | null;
  if (!p || typeof p.assistantId !== "string" || !p.assistantId) return null;
  const areas = Array.isArray(p.areas) ? (p.areas.filter((a) => typeof a === "string" && AREAS.has(a)) as PaArea[]) : [];
  return { assistantId: p.assistantId, areas, requestId: typeof p.requestId === "string" ? p.requestId : null };
}

/** Events of one assistant within this window are read together. */
const CHANGE_DEBOUNCE_MS = 250;
const pending = new Map<string, { areas: Set<PaArea>; timer: ReturnType<typeof setTimeout> }>();

/**
 * A change event of `hostId`: bump the named areas' ticks now (open cards read again), then read the assistant's
 * detail (area assistant) and requests (area requests) once per burst. An assistant this app has not read yet (made
 * elsewhere) reads the whole host. Hosts never read here (no page or badge yet) are left alone.
 */
export function onPaChanged(hostId: string, params: unknown): void {
  const change = readChange(params);
  const host = usePa.getState().byHost[hostId];
  if (!change || !host || host.loadedAt == null) return;
  const { assistantId, areas } = change;
  patchHost(hostId, (h) => {
    const cur = { ...h.ticks[assistantId] };
    for (const a of areas) cur[a] = (cur[a] ?? 0) + 1;
    return { ticks: { ...h.ticks, [assistantId]: cur }, ...(areas.includes("templates") ? { sendsTemplates: true } : {}) };
  });
  if (!host.assistants.some((a) => a.id === assistantId)) {
    void refreshHost(hostId);
    return;
  }
  const key = `${hostId}\n${assistantId}`;
  const entry = pending.get(key);
  if (entry) {
    for (const a of areas) entry.areas.add(a);
    return;
  }
  const next = { areas: new Set(areas), timer: setTimeout(() => {
    pending.delete(key);
    void flush(hostId, assistantId, next.areas);
  }, CHANGE_DEBOUNCE_MS) };
  pending.set(key, next);
}

async function flush(hostId: string, id: string, areas: ReadonlySet<PaArea>): Promise<void> {
  try {
    if (areas.has("assistant")) await refreshAssistant(hostId, id);
    else if (areas.has("requests")) await refreshRequests(hostId, id);
  } catch {
    // The next event, focus or open reads again; the last good data stays shown.
  }
}

/**
 * Creates an assistant. `actionId` is the caller's, kept until the outcome is known (a lost reply is retried with the
 * same id and the same config: cutex returns the same binding, never a second assistant).
 */
export async function createAssistant(hostId: string, actionId: string, config: PaConfig): Promise<PaView> {
  const view = await hostApi(hostId).paCreate({ actionId, config });
  takeView(hostId, view, { items: [], more: false });
  return view;
}

/** One settings / grants / enabled change at the revision the owner saw. */
export async function updateAssistant(hostId: string, a: Pick<PaAssistant, "id" | "revision">, change: PaChange, actionId = newActionId(change.kind)): Promise<PaView> {
  const view = await hostApi(hostId).paUpdate(a.id, { actionId, expectedRevision: a.revision, change });
  takeView(hostId, view);
  return view;
}

export async function confirmRequest(hostId: string, assistantId: string, requestId: string, input: Omit<PaConfirmInput, "actionId">, actionId = newActionId("confirm")): Promise<PaRequest> {
  const r = await hostApi(hostId).paConfirm(assistantId, requestId, { actionId, ...input });
  takeRequest(hostId, r);
  return r;
}

export async function cancelRequest(hostId: string, assistantId: string, requestId: string, input: Omit<PaCancelInput, "actionId">, actionId = newActionId("cancel")): Promise<PaRequest> {
  const r = await hostApi(hostId).paCancel(assistantId, requestId, { actionId, ...input });
  takeRequest(hostId, r);
  return r;
}

function takeRequest(hostId: string, r: PaRequest): void {
  patchHost(hostId, (h) => {
    const list = h.requests[r.assistantId] ?? [];
    return { requests: { ...h.requests, [r.assistantId]: list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r] } };
  });
}

/** A host left the view or its connection was replaced: forget what was read there. */
export function forgetHost(hostId: string): void {
  usePa.setState((s) => {
    if (!s.byHost[hostId]) return s;
    const { [hostId]: _gone, ...rest } = s.byHost;
    return { byHost: rest };
  });
}

/** Tests. */
export function resetPaStore(): void {
  inFlight.clear();
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  usePa.setState({ byHost: {} });
}
