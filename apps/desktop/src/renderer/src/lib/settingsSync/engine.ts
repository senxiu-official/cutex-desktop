// Settings sync (design 056 §12, owner 2026-11-26): each category is one section of the person's document on the
// memory host, the same document and machinery as the sidebar layout (lib/userLayout): a confirmed copy, a durable
// queue of this device's edits, replayed on a 409, written while the memory host is online. Each device chooses per
// category whether it follows (「同步」); a device that turns one on while its own values differ is asked once which to
// keep (「用同步设置」 / 「用本机设置」). Requests go through the main-process bridge (deps.backend).
import { create } from "zustand";
import type { MemoryHost, UserLayout, LayoutWritten } from "@cutex-desktop/cutex-client";
import type { HomeResult } from "../../../../shared/home";
import type { LayoutHost } from "../userLayoutModel";
import type { SyncCategory, SyncContext } from "./registry";
import { allOps, applySyncOps, changedOps, differingKeys, docValues, emptySyncDoc, readSyncDoc, sectionOf, toApply, type SyncDoc, type SyncOp, type SyncValues } from "./model";

export const SETTINGS_SYNC_KEY = "cutex-desktop.settingsSync.v1";

/** This device's switch for a category as stored (before the engine starts: the sidebar layout's first read). */
export function storedSyncOn(id: string, defaultOn: boolean, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    const on = (JSON.parse(storage.getItem(SETTINGS_SYNC_KEY) ?? "null") as { on?: Record<string, unknown> } | null)?.on?.[id];
    return typeof on === "boolean" ? on : defaultOn;
  } catch {
    return defaultOn;
  }
}

export interface SyncBackend {
  get(): Promise<HomeResult<UserLayout>>;
  put(section: string, revision: number, data: SyncDoc): Promise<HomeResult<LayoutWritten>>;
}

interface Entry {
  docKey: string;
  revision: number;
  confirmed: SyncDoc;
  /** This device's edits not yet acknowledged by the memory host. */
  ops: SyncOp[];
  /** This device follows the synced values (it has answered, or there was nothing to choose). */
  adopted: boolean;
  /** This device's values as last read (the base for spotting its own edits). */
  seen: SyncValues;
}
interface Stored {
  /** Per-device choice; a category missing here follows its default. */
  on: Record<string, boolean>;
  /** Memory host instanceId → category → entry. */
  docs: Record<string, Record<string, Entry>>;
  lastSync: Record<string, number>;
}

export type SyncStatus = "noHost" | "missing" | "offline" | "loading" | "unsupported" | "synced";
export interface CategoryView {
  on: boolean;
  /** Following the synced values on this device. */
  adopted: boolean;
  /** The synced values (the memory host's, with this device's pending edits); null = not read yet. */
  synced: SyncValues | null;
  local: SyncValues;
  /** Synced values this device does not have (category off, waiting for an answer, or not applied yet). */
  differs: boolean;
}
export interface SettingsSyncState {
  status: SyncStatus;
  memoryHost: MemoryHost | null;
  lastSync: number | null;
  pending: number;
  error: string | null;
  /** Categories turned on whose values differ from the synced ones: 「保留哪一份？」. */
  ask: string[];
  categories: Record<string, CategoryView>;
}

export function createSettingsSync(deps: {
  storage: Pick<Storage, "getItem" | "setItem">;
  backend(hostId: string): SyncBackend;
  categories(): SyncCategory[];
  now?(): number;
}) {
  const now = deps.now ?? Date.now;
  let stored: Stored;
  try { stored = JSON.parse(deps.storage.getItem(SETTINGS_SYNC_KEY) ?? "null") as Stored; } catch { stored = null!; }
  if (!stored || typeof stored !== "object" || !stored.on || !stored.docs) stored = { on: {}, docs: {}, lastSync: {} };
  stored.lastSync ??= {};
  const state = create<SettingsSyncState>(() => ({ status: "noHost", memoryHost: null, lastSync: null, pending: 0, error: null, ask: [], categories: {} }));
  let memoryHost: MemoryHost | null = null;
  let hosts: LayoutHost[] = [];
  let running: Promise<void> | null = null;
  let again = false;
  let applying = false;
  let disposed = false;
  let lastT = 0;
  const tick = () => (lastT = Math.max(now(), lastT + 1));
  const ctx = (): SyncContext => ({ hosts });
  const fields = () => deps.categories().filter((c) => c.kind !== "layout");
  const isOn = (c: SyncCategory) => stored.on[c.id] ?? c.defaultOn;
  const host = () => hosts.find((h) => !!memoryHost && h.instanceId === memoryHost.instanceId);
  const docs = () => (memoryHost ? (stored.docs[memoryHost.instanceId] ??= {}) : null);
  const persist = () => { try { deps.storage.setItem(SETTINGS_SYNC_KEY, JSON.stringify(stored)); } catch (e) { state.setState({ error: String(e) }); } };
  const safeRead = (c: SyncCategory): SyncValues => { try { return c.read(ctx()); } catch { return {}; } };
  const syncedOf = (e: Entry | undefined): SyncValues | null => (e ? docValues(applySyncOps(e.confirmed, e.ops)) : null);

  function status(): SyncStatus {
    if (!memoryHost) return "noHost";
    const h = host();
    if (!h) return "missing";
    if (!h.online) return "offline";
    if (h.known === false) return "loading";
    if (!h.supported || !h.eligible) return "unsupported";
    return "synced";
  }

  function publish(error?: string | null) {
    const d = docs();
    const views: Record<string, CategoryView> = {};
    const ask: string[] = [];
    let pending = 0;
    for (const c of fields()) {
      const e = d?.[c.id];
      const local = safeRead(c);
      const synced = syncedOf(e);
      const differs = !!synced && Object.keys(toApply(local, synced)).length > 0;
      views[c.id] = { on: isOn(c), adopted: !!e?.adopted, synced, local, differs };
      if (isOn(c) && e && !e.adopted && differingKeys(local, synced ?? {}).length > 0) ask.push(c.id);
      pending += e?.ops.length ?? 0;
    }
    for (const c of deps.categories()) if (c.kind === "layout") views[c.id] = { on: isOn(c), adopted: isOn(c), synced: null, local: {}, differs: false };
    state.setState({
      status: status(), memoryHost, pending, ask, categories: views,
      lastSync: memoryHost ? stored.lastSync[memoryHost.instanceId] ?? null : null,
      ...(error !== undefined && { error }),
    });
  }

  /** Take synced values onto this device without them counting as this device's edits. */
  function take(c: SyncCategory, e: Entry, values: SyncValues) {
    const want = toApply(safeRead(c), values);
    if (Object.keys(want).length) {
      applying = true;
      try { c.write(want, ctx()); } catch { /* a value this device cannot use stays as it is */ } finally { applying = false; }
    }
    e.seen = safeRead(c);
  }

  /** Read the memory host's sections; adopt, ask or apply per category. */
  async function read(h: LayoutHost): Promise<boolean> {
    const result = await deps.backend(h.id).get();
    if (!result.ok) { publish(result.error.message || result.error.code); return false; }
    const r = result.value;
    const d = docs()!;
    for (const c of fields()) {
      const section = r.sections[sectionOf(c.id)];
      let e = d[c.id];
      // The document is the server's person (docKey): never replay another person's edits into it.
      if (e && e.docKey !== r.docKey) e = undefined;
      if (!e) e = { docKey: r.docKey, revision: 0, confirmed: emptySyncDoc(), ops: [], adopted: false, seen: safeRead(c) };
      e.revision = section?.revision ?? 0;
      e.confirmed = readSyncDoc(section?.data);
      d[c.id] = e;
      if (!isOn(c)) continue;
      const local = safeRead(c);
      if (!e.adopted) {
        const synced = docValues(e.confirmed);
        if (Object.keys(synced).length === 0) {
          // Nothing synced yet: this device's values start it.
          e.ops.push(...allOps(local, tick()));
          e.adopted = true; e.seen = local;
        } else if (differingKeys(local, synced).length === 0) {
          // The same as the synced values: follow them, and add what only this device has.
          e.ops.push(...allOps(Object.fromEntries(Object.entries(local).filter(([k]) => !(k in synced))), tick()));
          e.adopted = true;
          take(c, e, synced);
        }
        // Otherwise: ask (publish lists it); nothing is written either way until the answer.
        continue;
      }
      take(c, e, syncedOf(e)!);
    }
    stored.lastSync[memoryHost!.instanceId] = now();
    persist(); publish(null);
    return true;
  }

  async function flush(h: LayoutHost) {
    const d = docs()!;
    for (const c of fields()) {
      const e = d[c.id];
      if (!e || !e.ops.length) continue;
      for (let attempt = 0; ; attempt++) {
        const ops = [...e.ops];
        const next = applySyncOps(e.confirmed, ops);
        const result = await deps.backend(h.id).put(sectionOf(c.id), e.revision, next);
        if (result.ok) {
          e.confirmed = next; e.revision = result.value.revision;
          e.ops = e.ops.slice(ops.length);
          stored.lastSync[memoryHost!.instanceId] = now();
          persist(); publish(null);
          break;
        }
        if (result.error.code !== "layout_revision_conflict" || attempt >= 2) { publish(result.error.message || result.error.code); return; }
        // Someone else wrote first: read their document, replay the same edits on it.
        const fresh = await deps.backend(h.id).get();
        if (!fresh.ok || (e.docKey && fresh.value.docKey !== e.docKey)) { publish(fresh.ok ? "layout_identity_changed" : fresh.error.message); return; }
        e.docKey = fresh.value.docKey;
        const section = fresh.value.sections[sectionOf(c.id)];
        e.confirmed = readSyncDoc(section?.data); e.revision = section?.revision ?? 0;
        if (isOn(c) && e.adopted) take(c, e, syncedOf(e)!);
        persist();
      }
    }
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      const h = host();
      if (status() !== "synced" || !h) { publish(); return; }
      if (await read(h)) await flush(h);
    })().catch((e: unknown) => publish(String(e))).finally(() => {
      running = null;
      if (again) { again = false; void refresh(); }
    });
    return running;
  }

  /** This device's values may have changed: queue the fields that did, for each category it follows. */
  function check() {
    if (applying || disposed || !memoryHost) return;
    const d = docs()!;
    let queued = false;
    for (const c of fields()) {
      const e = d[c.id];
      if (!e || !isOn(c) || !e.adopted) continue;
      const cur = safeRead(c);
      const ops = changedOps(e.seen, cur, tick());
      e.seen = cur;
      if (ops.length) { e.ops.push(...ops); queued = true; }
    }
    if (queued) { persist(); publish(); void refresh(); }
    else publish();
  }

  function setOn(id: string, on: boolean) {
    stored.on[id] = on;
    const e = docs()?.[id];
    if (e) {
      // Turning on asks again if this device's values differ (read decides); turning off drops queued edits.
      e.adopted = false;
      if (!on) e.ops = [];
    }
    persist(); publish(); void refresh();
  }

  /** 「用同步设置」: this device takes the synced values (and follows them if the category is on). */
  function useSynced(id: string) {
    const c = fields().find((x) => x.id === id); const e = docs()?.[id];
    if (!c || !e) return;
    take(c, e, syncedOf(e)!);
    if (isOn(c)) e.adopted = true;
    persist(); publish(); void refresh();
  }

  /** 「用本机设置」 / 「把本机设置同步上去」: this device's values replace the synced ones. */
  function pushLocal(id: string) {
    const c = fields().find((x) => x.id === id); const d = docs();
    if (!c || !d) return;
    const local = safeRead(c);
    const e = d[id] ??= { docKey: "", revision: 0, confirmed: emptySyncDoc(), ops: [], adopted: false, seen: local };
    e.ops.push(...allOps(local, tick()));
    e.seen = local;
    if (isOn(c)) e.adopted = true;
    persist(); publish(); void refresh();
  }

  function setMemory(next: MemoryHost | null, nextHosts: LayoutHost[]) {
    const changed = next?.instanceId !== memoryHost?.instanceId || JSON.stringify(nextHosts) !== JSON.stringify(hosts);
    memoryHost = next; hosts = nextHosts;
    if (changed) { publish(); void refresh(); }
  }

  const offs = deps.categories().flatMap((c) => (c.subscribe ? [c.subscribe(() => check())] : []));
  publish();
  return {
    state, refresh, check, setOn, useSynced, pushLocal, setMemory,
    /** Another device wrote a section of this person's document. */
    invalidate(section: string) { if (section.startsWith("settings-")) void refresh(); },
    dispose() { disposed = true; for (const off of offs) off(); },
  };
}
export type SettingsSyncStore = ReturnType<typeof createSettingsSync>;
