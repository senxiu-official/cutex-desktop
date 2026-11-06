// Confirmed sidebar + durable operation log. Requests always go through the main-process bridge.
import { keyFocus } from "./hostKeys";
import { create } from "zustand";
import type { MemoryHost, UserLayout, LayoutWritten } from "@cutex-desktop/cutex-client";
import type { HomeResult } from "../../../shared/home";
import { applyLayoutOp, decodeSidebar, encodeSidebar, readSidebar, sidebarEdits, type LayoutHost, type LayoutOp, type SidebarDoc, type SidebarLocal } from "./userLayoutModel";

export const USER_LAYOUT_KEY = "cutex-desktop.userLayout.v1";
export interface LayoutBackend {
  get(): Promise<HomeResult<UserLayout>>;
  put(revision: number, data: SidebarDoc): Promise<HomeResult<LayoutWritten>>;
}
interface CachedLayout { docKey: string; revision: number; confirmed: SidebarDoc; operations: LayoutOp[]; migratedAt?: number }
interface LayoutCache { memoryHost: MemoryHost | null; hosts: Record<string, string>; entries: Record<string, CachedLayout> }
interface LayoutState { memoryHost: MemoryHost | null; hosts: LayoutHost[]; doc: SidebarDoc | null; status: "local" | "loading" | "synced" | "offline" | "missing" | "unsupported"; error: string | null; migration: boolean; ownerPersonConfirmed: boolean; pending: number }
export function createUserLayout(deps: { storage: Pick<Storage, "getItem" | "setItem">; backend(hostId: string): LayoutBackend; local(): SidebarLocal; saveMemoryHost?(h: MemoryHost): Promise<void> }) {
  let cache: LayoutCache;
  try { cache = JSON.parse(deps.storage.getItem(USER_LAYOUT_KEY) ?? "null") as LayoutCache; } catch { cache = null!; }
  if (!cache || !cache.entries || !cache.hosts) cache = { memoryHost: null, hosts: {}, entries: {} };
  const state = create<LayoutState>(() => ({ memoryHost: cache.memoryHost, hosts: [], doc: null, status: "local", error: null, migration: false, ownerPersonConfirmed: true, pending: 0 }));
  let running: Promise<void> | null = null;
  let generation = 0;
  let remoteForMigration: UserLayout | null = null;
  let migrationSource: SidebarDoc | null = null;
  let invalidated = false;
  let lastEditAt = Date.now();
  let disposed = false;
  const persist = () => {
    try { deps.storage.setItem(USER_LAYOUT_KEY, JSON.stringify(cache)); }
    catch (e) { state.setState({ error: String(e) }); return false; }
    return true;
  };
  const entry = () => cache.memoryHost ? cache.entries[cache.memoryHost.instanceId] : undefined;
  const host = () => state.getState().hosts.find(h => h.instanceId === cache.memoryHost?.instanceId);
  function publish() {
    const e = entry();
    state.setState({ memoryHost: cache.memoryHost, doc: e ? e.operations.reduce(applyLayoutOp, e.confirmed) : null, pending: e?.operations.length ?? 0 });
  }
  function localDoc() { return encodeSidebar(deps.local(), state.getState().hosts, keyFocus()); }
  async function readAndMigrate(h: LayoutHost, gen: number): Promise<boolean> {
    const result = await deps.backend(h.id).get();
    if (gen !== generation) return false;
    if (!result.ok) { state.setState({ error: result.error.message || result.error.code }); return false; }
    const r = result.value;
    const section = r.sections.sidebar;
    let e = entry();
    // Cache identity is server-derived. Never replay a previous person's edits into another document.
    if (e && e.docKey !== r.docKey) {
      cache.entries[`${cache.memoryHost!.instanceId}/${e.docKey}`] = e;
      e = cache.entries[`${cache.memoryHost!.instanceId}/${r.docKey}`];
    }
    if (!e) e = { docKey: r.docKey, revision: section?.revision ?? 0, confirmed: readSidebar(section?.data), operations: [] };
    e.revision = section?.revision ?? 0;
    e.confirmed = readSidebar(section?.data);
    cache.entries[cache.memoryHost!.instanceId] = e;
    state.setState({ ownerPersonConfirmed: r.ownerPersonConfirmed });
    if (!e.migratedAt) {
      const source = migrationSource ?? localDoc();
      if (!section?.data || Object.keys(section.data).length === 0) {
        e.operations.push({ kind: "import", data: source, t: Date.now() });
        e.migratedAt = Date.now();
      } else if (JSON.stringify(decodeSidebar(e.confirmed, state.getState().hosts)) !== JSON.stringify(decodeSidebar(source, state.getState().hosts))) {
        remoteForMigration = r;
        state.setState({ migration: true });
      } else e.migratedAt = Date.now();
    }
    const durable = persist(); publish();
    return durable;
  }
  async function flush() {
    const h = host(); const e = entry(); const gen = generation;
    if (!h || !e || !h.online || !h.supported || state.getState().migration) return;
    while (e.operations.length && gen === generation) {
      // Persist each operation before any network write; remove only acknowledged operations.
      const op = e.operations[0]!;
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const next = applyLayoutOp(e.confirmed, op);
        const result = await deps.backend(h.id).put(e.revision, next);
        if (gen !== generation) return;
        if (result.ok) {
          e.confirmed = next; e.revision = result.value.revision; e.operations.shift();
          persist(); publish(); success = true; break;
        }
        if (result.error.code !== "layout_revision_conflict") { state.setState({ error: result.error.message || result.error.code }); return; }
        const fresh = await deps.backend(h.id).get();
        if (gen !== generation) return;
        if (!fresh.ok || fresh.value.docKey !== e.docKey) { state.setState({ error: fresh.ok ? "layout_identity_changed" : fresh.error.message }); return; }
        e.confirmed = readSidebar(fresh.value.sections.sidebar?.data);
        e.revision = fresh.value.sections.sidebar?.revision ?? 0;
        persist(); publish();
      }
      if (!success) { state.setState({ error: "layout_revision_conflict" }); return; }
    }
    state.setState({ status: "synced", error: null });
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) return running;
    const gen = generation;
    running = (async () => {
      const h = host();
      if (!cache.memoryHost) { state.setState({ status: "local" }); return; }
      if (!h) { state.setState({ status: "missing" }); publish(); return; }
      if (!h.online) { state.setState({ status: "offline" }); publish(); return; }
      if (h.known === false) { state.setState({ status: "loading" }); publish(); return; }
      if (!h.supported || !h.eligible) { state.setState({ status: "unsupported", doc: null }); return; }
      if (await readAndMigrate(h, gen)) { state.setState({ status: "synced", error: null }); await flush(); }
    })().catch((e: unknown) => { if (gen === generation) state.setState({ status: "offline", error: String(e) }); }).finally(() => { running = null; if (invalidated) { invalidated = false; void refresh(); } });
    return running;
  }
  function setHosts(hosts: LayoutHost[]) {
    // The instance mapping survives disconnects, never host removal; removed hosts stay hidden.
    for (const h of hosts) if (h.instanceId) cache.hosts[h.id] = h.instanceId;
    state.setState({ hosts: hosts.map(h => ({ ...h, instanceId: h.instanceId ?? cache.hosts[h.id] })) });
    persist(); publish();
  }
  function edit(before: SidebarLocal, after: SidebarLocal) {
    if (disposed) return;
    const e = entry(); const s = state.getState();
    if (!e || s.status === "unsupported" || !s.doc || s.migration) return;
    const ops = sidebarEdits(encodeSidebar(before, s.hosts, keyFocus()), encodeSidebar(after, s.hosts, keyFocus()), lastEditAt = Math.max(Date.now(), lastEditAt + 1));
    if (!ops.length) return;
    e.operations.push(...ops); const durable = persist(); publish();
    if (!durable) return;
    if (host()?.online) void refresh();
  }
  async function choose(memoryHost: MemoryHost, adopt = false) {
    if (disposed) return;
    if (cache.memoryHost?.instanceId === memoryHost.instanceId) return refresh();
    const previous = state.getState().doc;
    migrationSource = adopt ? null : previous;
    generation++; cache.memoryHost = memoryHost;
    if (!adopt && previous && entry()) delete entry()!.migratedAt;
    state.setState({ memoryHost, doc: null, migration: false, status: "loading" });
    persist();
    await deps.saveMemoryHost?.(memoryHost);
    // A requested move carries the currently displayed document. The original is retained.
    if (!adopt && previous && !entry()) {
      const h = host();
      if (h?.online && h.supported) {
        const result = await deps.backend(h.id).get();
        if (result.ok && !result.value.sections.sidebar?.data) {
          cache.entries[memoryHost.instanceId] = { docKey: result.value.docKey, revision: result.value.sections.sidebar?.revision ?? 0, confirmed: readSidebar(result.value.sections.sidebar?.data), operations: [{ kind: "import", data: previous, t: Date.now() }], migratedAt: Date.now() };
          persist();
        }
      }
    }
    // Let an old in-flight request finish; its generation check prevents cross-host writes.
    if (running) await running;
    await refresh();
  }
  async function resolveMigration(merge: boolean) {
    const e = entry(); if (!e || !remoteForMigration) return;
    if (merge) e.operations.push({ kind: "import", data: migrationSource ?? localDoc(), t: Date.now() });
    e.migratedAt = Date.now(); remoteForMigration = null; migrationSource = null;
    state.setState({ migration: false }); persist(); publish(); await refresh();
  }
  publish();
  return { state, refresh, setHosts, edit, choose, resolveMigration,
    dispose() { disposed = true; generation++; },
    invalidate(docKey: string, revision: number) {
      const e = entry();
      if (e && e.docKey === docKey && revision > e.revision) {
        if (running) invalidated = true;
        else void refresh();
      }
    },
    local: (): SidebarLocal | null => { const s = state.getState(); return s.doc && s.status !== "unsupported" ? decodeSidebar(s.doc, s.hosts) : null; },
  };
}
export type UserLayoutStore = ReturnType<typeof createUserLayout>;
let active: UserLayoutStore | null = null;
export const layoutStore = () => active;
export function setLayoutStore(value: UserLayoutStore | null) { active = value; }
