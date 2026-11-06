// The home document per host (cutex `user-home`: `GET/PUT /v2/users/me/home` with a revision), with
// optimistic writes: an edit shows at once (queued edits applied over the last confirmed document); the
// PUT carries the revision it was based on; 409 `home_revision_conflict` (another device wrote first) →
// read the host's current document and apply the same edit to it again (up to 3 times). A host without
// `user-home` (an older cutex, or the route missing) keeps the document on this device instead (module
// prefs, like bookmarks). Unit-tested in test/homeStore.test.ts.
import { useEffect } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { HOME_REVISION_CONFLICT, type HomeDoc, type HomeResult, type HomeView } from "../../../../shared/home";

export interface HomeBackend {
  get(): Promise<HomeResult<HomeView | null>>;
  put(revision: number, home: HomeDoc | null): Promise<HomeResult<HomeView>>;
}

export interface HomeLocal {
  read(): HomeDoc | null;
  write(doc: HomeDoc): void;
}

export interface HomeEntry {
  hostId: string;
  status: "loading" | "ready" | "error";
  /** Where the document lives: the host (`user-home`) or this device. */
  source: "host" | "local";
  revision: number;
  /** What the host (or this device) last confirmed. */
  confirmed: HomeDoc;
  /** What to show: the queued edits applied over `confirmed`. */
  doc: HomeDoc;
  coverEtag: string | null;
  saving: boolean;
  error: string | null;
}

type Edit = (doc: HomeDoc) => HomeDoc;
const MAX_TRIES = 3;

export interface HomeStore {
  store: UseBoundStore<StoreApi<{ entries: Record<string, HomeEntry> }>>;
  /** (Re)reads a host's document. */
  load(hostId: string): Promise<void>;
  /** Applies an edit (optimistic); resolves true once the host (or this device) has it. */
  update(hostId: string, edit: Edit): Promise<boolean>;
  /** A cover write answered with the home view: take its revision / cover etag. */
  noteView(hostId: string, view: HomeView): void;
  entry(hostId: string): HomeEntry | undefined;
  reproject(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createHomeStore(deps: { backend(hostId: string): HomeBackend | null; local: HomeLocal; present?(doc: HomeDoc): HomeDoc }): HomeStore {
  const store = create<{ entries: Record<string, HomeEntry> }>(() => ({ entries: {} }));
  type Queued = { edit: Edit; done(ok: boolean): void; applied: boolean };
  const queues = new Map<string, { edits: Queued[]; running: boolean }>();
  const loads = new Map<string, Promise<void>>();

  const get = (hostId: string) => store.getState().entries[hostId];
  const set = (hostId: string, patch: Partial<HomeEntry>) => {
    const before = get(hostId) ?? { hostId, status: "loading", source: "host", revision: 0, confirmed: {}, doc: {}, coverEtag: null, saving: false, error: null };
    if (patch.confirmed && deps.present) patch = { ...patch, confirmed: deps.present(patch.confirmed) };
    const next = { ...before, ...patch };
    const queued = queues.get(hostId)?.edits ?? [];
    next.doc = queued.reduce((d, q) => (q.applied ? d : q.edit(d)), next.confirmed);
    store.setState((s) => ({ entries: { ...s.entries, [hostId]: next } }));
  };

  const local = (hostId: string) => set(hostId, { status: "ready", source: "local", revision: 0, confirmed: deps.local.read() ?? {}, coverEtag: null, error: null });

  function load(hostId: string): Promise<void> {
    const running = loads.get(hostId);
    if (running) return running;
    const backend = deps.backend(hostId);
    if (!backend) {
      local(hostId);
      return Promise.resolve();
    }
    if (!get(hostId)) set(hostId, { status: "loading" });
    const p = backend
      .get()
      .then(
        (r) => {
          if (!r.ok) return set(hostId, { status: "error", error: r.error.message || r.error.code });
          // The capability without the route (or an older cutex): this device keeps it.
          if (!r.value) return local(hostId);
          set(hostId, { status: "ready", source: "host", revision: r.value.revision, confirmed: r.value.home ?? {}, coverEtag: r.value.coverEtag, error: null });
        },
        (e: unknown) => set(hostId, { status: "error", error: message(e) }),
      )
      .finally(() => loads.delete(hostId));
    loads.set(hostId, p);
    return p;
  }

  async function run(hostId: string): Promise<void> {
    const queue = queues.get(hostId)!;
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.edits.length) {
        const item = queue.edits[0]!;
        const ok = await apply(hostId, item);
        item.applied = true;
        queue.edits.shift();
        set(hostId, { saving: queue.edits.length > 0 });
        item.done(ok);
      }
    } finally {
      queue.running = false;
    }
  }

  async function apply(hostId: string, item: Queued): Promise<boolean> {
    const { edit } = item;
    const entry = get(hostId);
    if (!entry) return false;
    if (entry.source === "local") {
      const next = edit(entry.confirmed);
      try {
        deps.local.write(next);
      } catch (e) {
        set(hostId, { error: message(e) });
        return false;
      }
      item.applied = true;
      set(hostId, { confirmed: next, error: null });
      return true;
    }
    const backend = deps.backend(hostId);
    if (!backend) return false;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const base = get(hostId)!;
      const next = edit(base.confirmed);
      if (next === base.confirmed) return true;
      let r: HomeResult<HomeView>;
      try {
        r = await backend.put(base.revision, next);
      } catch (e) {
        set(hostId, { error: message(e) });
        return false;
      }
      if (r.ok) {
        item.applied = true;
        set(hostId, { revision: r.value.revision, confirmed: r.value.home ?? next, coverEtag: r.value.coverEtag, error: null, status: "ready" });
        return true;
      }
      if (r.error.code !== HOME_REVISION_CONFLICT) {
        set(hostId, { error: r.error.message || r.error.code });
        return false;
      }
      // Another device wrote first: read its document, then apply the same edit to it.
      try {
        const fresh = await backend.get();
        if (!fresh.ok || !fresh.value) {
          set(hostId, { error: fresh.ok ? null : fresh.error.message || fresh.error.code });
          return false;
        }
        set(hostId, { revision: fresh.value.revision, confirmed: fresh.value.home ?? {}, coverEtag: fresh.value.coverEtag });
      } catch (e) {
        set(hostId, { error: message(e) });
        return false;
      }
    }
    set(hostId, { error: HOME_REVISION_CONFLICT });
    return false;
  }

  async function update(hostId: string, edit: Edit): Promise<boolean> {
    if (!get(hostId) || get(hostId)!.status === "loading") await load(hostId);
    if (get(hostId)?.status === "error") await load(hostId);
    const entry = get(hostId);
    if (!entry || entry.status !== "ready") return false;
    let queue = queues.get(hostId);
    if (!queue) queues.set(hostId, (queue = { edits: [], running: false }));
    return new Promise<boolean>((resolve) => {
      queue.edits.push({ edit, done: resolve, applied: false });
      set(hostId, { saving: true });
      void run(hostId);
    });
  }

  function noteView(hostId: string, view: HomeView): void {
    const entry = get(hostId);
    if (!entry || entry.source !== "host") return;
    // A cover change never changes the revision; a newer document (another device) is taken as it is.
    if (view.revision > entry.revision) set(hostId, { revision: view.revision, confirmed: view.home ?? {}, coverEtag: view.coverEtag });
    else set(hostId, { coverEtag: view.coverEtag });
  }

  return { store, load, update, noteView, entry: get, reproject: () => { for (const [hostId, e] of Object.entries(store.getState().entries)) set(hostId, { confirmed: e.confirmed }); } };
}

// ── The module's instance (modules/home/index.ts activate) ───────────────────────────────────────

let current: HomeStore = createHomeStore({ backend: () => null, local: memoryLocal() });

function memoryLocal(): HomeLocal {
  let doc: HomeDoc | null = null;
  return { read: () => doc, write: (d) => void (doc = d) };
}

export function setHomeStore(store: HomeStore): void {
  current = store;
}

export function homeStore(): HomeStore {
  return current;
}

/**
 * A host's home document (null host: none yet). Reads it on mount and whenever `source` changes (the
 * host's capabilities became known: host storage vs this device).
 */
export function useHome(hostId: string | null, wantHost: boolean | null): { entry: HomeEntry | null; update(edit: Edit): Promise<boolean> } {
  const s = current;
  const entry = s.store((st) => (hostId ? st.entries[hostId] : undefined)) ?? null;
  useEffect(() => {
    if (!hostId || wantHost === null) return;
    void s.load(hostId);
  }, [s, hostId, wantHost]);
  return { entry, update: (edit) => (hostId ? s.update(hostId, edit) : Promise.resolve(false)) };
}

/** Whether 编辑主页 is on (the desktop and the 个人页 share it). */
/**
 * 编辑主页 / arranging the desktop (design 032): `editing` = arranging; `panel` = the 编辑主页 panel over the desktop's
 * right side (the 编辑主页 button, a widget's settings). A long press / 整理桌面 arranges without the panel, so the
 * widgets under it stay reachable.
 */
export const useHomeEdit = create<{ editing: boolean; panel: boolean }>(() => ({ editing: false, panel: false }));
export const setHomeEditing = (editing: boolean, panel = editing) => useHomeEdit.setState({ editing, panel: editing && panel });
