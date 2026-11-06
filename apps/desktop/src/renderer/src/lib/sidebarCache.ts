// The last whole agent list of each host, kept in IndexedDB: after a restart a big remote host shows its agents
// at once, marked as syncing (`cached`), instead of an empty list until its first read ends.
//
// Per desktop host id, and tied to who the connection is (the cutex host id and the user of its capabilities):
// shown only once this connection's capabilities name the same, dropped on a mismatch, a changed access or a
// removed host, and always replaced by the host's own list once read. Archived agents are not kept (they are
// read on demand). Never shared between hosts: each entry is read only for its own host id.
import type { SidebarSnapshot } from "../../../shared/ipc";

const DB_NAME = "cutex-sidebar-cache";
const STORE = "sidebars";
/** One write per host at most this often (a busy host refreshes its list every few seconds). */
const SAVE_EVERY_MS = 10_000;

interface Entry { hostId: string; identity: string; savedAt: number; snapshot: SidebarSnapshot }

let factory: IDBFactory | null | undefined;
let opened: Promise<IDBDatabase | null> | undefined;
const identities = new Map<string, string>();
const saves = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout>; next?: SidebarSnapshot }>();

/** Tests: an IndexedDB factory (fake-indexeddb), or null for none. */
export function setSidebarCacheFactory(next: IDBFactory | null): void {
  factory = next; opened = undefined; identities.clear();
  for (const save of saves.values()) clearTimeout(save.timer);
  saves.clear();
}

function db(): Promise<IDBDatabase | null> {
  const idb = factory !== undefined ? factory : typeof indexedDB === "undefined" ? null : indexedDB;
  if (!idb) return Promise.resolve(null);
  opened ??= new Promise((resolve) => {
    try {
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "hostId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return opened;
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await db();
  if (!database) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

/** Who a connection is: its cutex host id and user (absent on older cutex: the owner). null: not known. */
export function sidebarIdentity(capabilities: { hostId?: string | null; user?: unknown } | null | undefined): string | null {
  return capabilities?.hostId ? JSON.stringify([capabilities.hostId, capabilities.user ?? null]) : null;
}

/**
 * This connection's capabilities for `hostId` arrived: returns the list kept for the same host and identity
 * (marked `cached`, `partial`), else null — and drops an entry of another identity.
 */
export async function cachedSidebar(hostId: string, capabilities: { hostId?: string | null; user?: unknown } | null | undefined): Promise<SidebarSnapshot | null> {
  const identity = sidebarIdentity(capabilities);
  const before = identities.get(hostId);
  if (identity) identities.set(hostId, identity); else identities.delete(hostId);
  if (before && before !== identity) await dropCachedSidebar(hostId, false);
  if (!identity) return null;
  const entry = await run<Entry | undefined>("readonly", (store) => store.get(hostId));
  if (!entry) return null;
  if (entry.identity !== identity || entry.hostId !== hostId) { await dropCachedSidebar(hostId, false); return null; }
  return { ...entry.snapshot, retired: [], partial: true, cached: true, archivedPending: { count: entry.snapshot.archivedPending?.count ?? null } };
}

/** Keeps `hostId`'s whole list (a peek or a kept list is never kept), at most every 10 s. */
export function saveSidebar(hostId: string, snapshot: SidebarSnapshot): void {
  if (snapshot.loading || snapshot.cached || !identities.has(hostId)) return;
  const save = saves.get(hostId) ?? { at: 0 };
  saves.set(hostId, save);
  save.next = snapshot;
  if (save.timer) return;
  const write = () => {
    save.timer = undefined;
    const next = save.next, identity = identities.get(hostId);
    save.next = undefined;
    if (!next || !identity) return;
    save.at = Date.now();
    const { retired: _retired, partial: _partial, ...kept } = next;
    void run("readwrite", (store) => { store.put({ hostId, identity, savedAt: save.at, snapshot: { ...kept, retired: [] } } satisfies Entry); });
  };
  const wait = save.at + SAVE_EVERY_MS - Date.now();
  if (wait <= 0) write();
  else save.timer = setTimeout(write, wait);
}

/** Forgets `hostId`'s kept list (access changed, host removed). `identity`: also who it was. */
export async function dropCachedSidebar(hostId: string, identity = true): Promise<void> {
  const save = saves.get(hostId);
  if (save) { clearTimeout(save.timer); saves.delete(hostId); }
  if (identity) identities.delete(hostId);
  await run("readwrite", (store) => { store.delete(hostId); });
}

/** Forgets every kept list of a host no longer configured. */
export async function keepCachedSidebars(hostIds: readonly string[]): Promise<void> {
  const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  const keep = new Set(hostIds);
  for (const key of keys ?? []) if (typeof key === "string" && !keep.has(key)) await dropCachedSidebar(key);
}
