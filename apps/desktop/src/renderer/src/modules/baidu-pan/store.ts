// 百度网盘 page state, one slice per host (each host has its own Baidu account and downloads).
// Reads go through the host's daemon (main/panApi.ts). Downloads follow the daemon's event feed while a
// page shows them (acquireFeed / release: ref-counted, the last release stops the feed); the auth flow
// polls only while its page is visible and the window is not hidden.
import { create } from "zustand";
import type { DaemonApi } from "../../../../shared/ipc";
import { PAN_PAGE_SIZE, type PanAuthStart, type PanConnection, type PanDownload, type PanDownloadAction, type PanEventsMessage, type PanFile, type PanResult } from "../../../../shared/baiduPan";
import { apiFor, bridge } from "../../bridge";
import { mergeDownload, newRequestId } from "./model";

type Failure = { code: string; message: string };
const fail = (r: PanResult<unknown>): Failure | null => (r.ok ? null : { code: r.code, message: r.message });

export interface Listing {
  dir: string;
  files: PanFile[];
  hasMore: boolean;
  nextStart: number | null;
  loading: boolean;
  error: Failure | null;
}
export interface Search {
  key: string;
  dir: string;
  files: PanFile[];
  hasMore: boolean;
  loading: boolean;
  error: Failure | null;
}
export type AuthPhase = "idle" | "starting" | "pending" | "expired" | "failed";
export type FeedState = "off" | "connecting" | "live" | "retrying";

export interface HostPan {
  /** null until the first read answered. */
  connection: PanConnection | null;
  connLoading: boolean;
  connError: Failure | null;
  saving: boolean;
  saveError: Failure | null;
  auth: PanAuthStart | null;
  authPhase: AuthPhase;
  authError: Failure | null;
  listing: Listing;
  search: Search | null;
  selected: PanFile | null;
  downloads: PanDownload[];
  downloadsError: Failure | null;
  starting: boolean;
  startError: Failure | null;
  feed: FeedState;
}

export const emptyHost = (): HostPan => ({
  connection: null, connLoading: false, connError: null, saving: false, saveError: null,
  auth: null, authPhase: "idle", authError: null,
  listing: { dir: "/", files: [], hasMore: false, nextStart: null, loading: false, error: null },
  search: null, selected: null, downloads: [], downloadsError: null, starting: false, startError: null, feed: "off",
});

export const usePan = create<{ hosts: Record<string, HostPan> }>(() => ({ hosts: {} }));

export const hostPan = (hostId: string): HostPan => usePan.getState().hosts[hostId] ?? emptyHost();
function patch(hostId: string, f: (h: HostPan) => Partial<HostPan>) {
  usePan.setState((s) => {
    const h = s.hosts[hostId] ?? emptyHost();
    return { hosts: { ...s.hosts, [hostId]: { ...h, ...f(h) } } };
  });
}

let daemonOf: (hostId: string) => DaemonApi = (hostId) => apiFor(hostId);
/** Tests: replace the daemon lookup (null = the real one). */
export function setPanDaemon(f: ((hostId: string) => DaemonApi) | null) {
  daemonOf = f ?? ((hostId) => apiFor(hostId));
}
const unreachable = (e: unknown): PanResult<never> => ({ ok: false, code: "unreachable", message: String((e as Error)?.message ?? e), retryable: true });
const safe = <T,>(p: () => Promise<PanResult<T>>): Promise<PanResult<T>> => {
  try {
    return p().catch(unreachable);
  } catch (e) {
    // main refused the input before calling cutex (invalid path, …)
    return Promise.resolve({ ok: false, code: "invalid_request", message: String((e as Error)?.message ?? e), retryable: false });
  }
};

/* ---- connection and login ---- */

export async function loadConnection(hostId: string) {
  patch(hostId, () => ({ connLoading: true }));
  const r = await safe(() => daemonOf(hostId).panConnection());
  patch(hostId, (h) => ({ connLoading: false, connError: fail(r), connection: r.ok ? r.value : h.connection }));
  if (r.ok && r.value.state === "connected" && hostPan(hostId).listing.files.length === 0) void openDir(hostId, hostPan(hostId).listing.dir);
  return r;
}

export async function configure(hostId: string, input: { appId: string; clientId: string; clientSecret: string }) {
  patch(hostId, () => ({ saving: true, saveError: null }));
  const r = await safe(() => daemonOf(hostId).panConfigure(input));
  patch(hostId, (h) => ({ saving: false, saveError: fail(r), connection: r.ok ? r.value : h.connection }));
  return r.ok;
}

export async function disconnect(hostId: string) {
  const r = await safe(() => daemonOf(hostId).panDisconnect());
  if (r.ok) patch(hostId, () => ({ ...emptyHost(), feed: hostPan(hostId).feed, downloads: hostPan(hostId).downloads }));
  await loadConnection(hostId);
  return r.ok;
}

export async function startAuth(hostId: string) {
  patch(hostId, () => ({ authPhase: "starting", authError: null, auth: null }));
  const r = await safe(() => daemonOf(hostId).panAuthStart());
  patch(hostId, () => (r.ok ? { auth: r.value, authPhase: "pending" } : { authPhase: "failed", authError: fail(r) }));
}

export function cancelAuth(hostId: string) {
  patch(hostId, () => ({ auth: null, authPhase: "idle", authError: null }));
}

/** One poll of the open login; the page schedules it every `intervalSeconds` while visible. */
export async function pollAuth(hostId: string, now = Date.now()) {
  const h = hostPan(hostId);
  if (h.authPhase !== "pending" || !h.auth) return;
  if (Date.parse(h.auth.expiresAt) <= now) return patch(hostId, () => ({ authPhase: "expired" }));
  const authId = h.auth.id;
  const r = await safe(() => daemonOf(hostId).panAuthPoll(authId));
  if (hostPan(hostId).auth?.id !== authId) return; // cancelled / restarted meanwhile
  if (!r.ok) return patch(hostId, () => (r.retryable ? { authError: fail(r) } : { authPhase: "failed", authError: fail(r) }));
  const v = r.value;
  if (v.state === "pending") return patch(hostId, () => ({ authError: null }));
  if (v.state === "connected") {
    patch(hostId, (x) => ({ auth: null, authPhase: "idle", authError: null, connection: v.connection ?? x.connection }));
    if (!v.connection) await loadConnection(hostId);
    else void openDir(hostId, "/");
    return;
  }
  patch(hostId, () => ({ authPhase: v.state === "expired" ? "expired" : "failed", authError: v.error ? { code: v.error.code, message: v.error.message } : null }));
}

/** The authorization-code / OOB fallback: the owner pastes the code Baidu showed; it is sent once and not kept. */
export async function submitAuthCode(hostId: string, code: string, redirectUri: string) {
  patch(hostId, () => ({ authPhase: "starting", authError: null, auth: null }));
  const r = await safe(() => daemonOf(hostId).panAuthCode(code.trim(), redirectUri.trim() || "oob"));
  patch(hostId, (h) => (r.ok ? { authPhase: "idle", connection: r.value } : { authPhase: "failed", authError: fail(r), connection: h.connection }));
  if (r.ok && r.value.state === "connected") void openDir(hostId, "/");
  return r.ok;
}

/* ---- browse / search / details ---- */

export async function openDir(hostId: string, dir: string) {
  patch(hostId, (h) => ({ listing: { ...h.listing, dir, loading: true, error: null, ...(h.listing.dir === dir ? {} : { files: [], hasMore: false, nextStart: null }) }, search: null, selected: null }));
  const r = await safe(() => daemonOf(hostId).panFiles(dir, 0, PAN_PAGE_SIZE));
  if (hostPan(hostId).listing.dir !== dir) return; // navigated on
  patch(hostId, (h) => ({ listing: r.ok ? { dir, files: r.value.files, hasMore: r.value.hasMore, nextStart: r.value.nextStart, loading: false, error: null } : { ...h.listing, loading: false, error: fail(r) } }));
}

export async function loadMore(hostId: string) {
  const l = hostPan(hostId).listing;
  if (l.loading || !l.hasMore || l.nextStart == null) return;
  const { dir, nextStart } = l;
  patch(hostId, (h) => ({ listing: { ...h.listing, loading: true } }));
  const r = await safe(() => daemonOf(hostId).panFiles(dir, nextStart, PAN_PAGE_SIZE));
  if (hostPan(hostId).listing.dir !== dir) return;
  patch(hostId, (h) => {
    if (!r.ok) return { listing: { ...h.listing, loading: false, error: fail(r) } };
    const seen = new Set(h.listing.files.map((f) => f.id));
    return { listing: { dir, files: [...h.listing.files, ...r.value.files.filter((f) => !seen.has(f.id))], hasMore: r.value.hasMore, nextStart: r.value.nextStart, loading: false, error: null } };
  });
}

export async function search(hostId: string, key: string) {
  const k = key.trim();
  if (!k) return clearSearch(hostId);
  const dir = hostPan(hostId).listing.dir;
  patch(hostId, () => ({ search: { key: k, dir, files: [], hasMore: false, loading: true, error: null }, selected: null }));
  const r = await safe(() => daemonOf(hostId).panSearch(k, dir));
  if (hostPan(hostId).search?.key !== k) return;
  patch(hostId, () => ({ search: r.ok ? { key: k, dir, files: r.value.files, hasMore: r.value.hasMore, loading: false, error: null } : { key: k, dir, files: [], hasMore: false, loading: false, error: fail(r) } }));
}
export const clearSearch = (hostId: string) => patch(hostId, () => ({ search: null }));

export function select(hostId: string, file: PanFile | null) {
  patch(hostId, () => ({ selected: file, startError: null }));
  // The list row is enough to show; meta refreshes size / time when it answers.
  if (file && !file.isDir) void safe(() => daemonOf(hostId).panMeta(file.path)).then((r) => {
    if (r.ok && hostPan(hostId).selected?.path === file.path) patch(hostId, () => ({ selected: r.value.file }));
  });
}

/* ---- downloads ---- */

export async function loadDownloads(hostId: string) {
  const r = await safe(() => daemonOf(hostId).panDownloads(100));
  // The daemon's list and order win; a row the feed already moved past keeps its newer copy.
  patch(hostId, (h) => ({ downloadsError: fail(r), downloads: r.ok ? r.value.downloads.map((x) => { const mine = h.downloads.find((y) => y.id === x.id); return mine && mine.updatedAt > x.updatedAt ? mine : x; }) : h.downloads }));
}

export async function startDownload(hostId: string, file: PanFile, targetDir: string): Promise<PanDownload | null> {
  patch(hostId, () => ({ starting: true, startError: null }));
  const r = await safe(() => daemonOf(hostId).panStartDownload({ requestId: newRequestId(), remote: file.path, targetDir: targetDir.trim() }));
  patch(hostId, (h) => ({ starting: false, startError: fail(r), downloads: r.ok ? mergeDownload(h.downloads, r.value.download) : h.downloads }));
  return r.ok ? r.value.download : null;
}

export async function control(hostId: string, id: string, action: PanDownloadAction) {
  const r = await safe(() => daemonOf(hostId).panDownloadAction(id, action));
  patch(hostId, (h) => ({ downloadsError: fail(r), downloads: r.ok ? mergeDownload(h.downloads, r.value.download) : h.downloads }));
  return r.ok;
}

/* ---- the event feed (ref-counted per host) ---- */

const feeds = new Map<string, { users: number; watchId: string | null; closing: boolean }>();
let offEvents: (() => void) | null = null;

function onMessage(hostId: string, m: PanEventsMessage) {
  const f = feeds.get(hostId);
  if (!f || f.watchId !== m.watchId) return;
  if (m.kind === "download") patch(hostId, (h) => ({ downloads: mergeDownload(h.downloads, m.download) }));
  else {
    patch(hostId, () => ({ feed: m.status }));
    // (Re)connected: whatever happened while away is read once.
    if (m.status === "live") void loadDownloads(hostId);
  }
}

/** The page shows this host's downloads: follow its feed until the returned release. */
export function acquireFeed(hostId: string): () => void {
  offEvents ??= bridge.on("panEvents", ({ hostId: h, ...m }) => onMessage(h, m as PanEventsMessage)) ?? null;
  let f = feeds.get(hostId);
  if (!f) {
    feeds.set(hostId, (f = { users: 0, watchId: null, closing: false }));
    const mine = f;
    patch(hostId, () => ({ feed: "connecting" }));
    void loadDownloads(hostId);
    daemonOf(hostId).watchPan().then(
      (id) => {
        if (feeds.get(hostId) !== mine) void daemonOf(hostId).unwatchPan(id).catch(() => undefined); // released meanwhile
        else mine.watchId = id;
      },
      () => patch(hostId, () => ({ feed: "off" })),
    );
  }
  f.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = feeds.get(hostId);
    if (!cur || --cur.users > 0) return;
    feeds.delete(hostId);
    if (cur.watchId) void daemonOf(hostId).unwatchPan(cur.watchId).catch(() => undefined);
    patch(hostId, () => ({ feed: "off" }));
  };
}

/** Tests: forget feeds and the listener. */
export function resetPanStore() {
  feeds.clear();
  offEvents?.();
  offEvents = null;
  usePan.setState({ hosts: {} });
}
