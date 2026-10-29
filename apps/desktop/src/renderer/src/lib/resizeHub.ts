// One ResizeObserver for the app's many small measurers (perf §9; §8.4 of the 2026-10-20 baseline). Every
// `new ResizeObserver` gets its own callback per frame; the browser runs a microtask checkpoint after each, so a
// store update in one (zustand / useSyncExternalStore = a synchronous React render) committed before the next
// one read its element — one commit and one forced layout per observer, ~25–80 per frame while the window or a
// column is resized. Through the hub, all of them are one callback: every measurer reads, React commits once
// after all of them. Same timing as before (after layout, before paint; deeper re-notifications in the same
// frame as the browser does them); only the order between measurers is observation order instead of creation
// order (none of them reads another's result).
//
// `sharedResizeObserver(cb)` is a drop-in for `new ResizeObserver(cb)`: `observe` / `unobserve` / `disconnect`,
// `cb(entries)` once per notification with this observer's entries. The synchronous-layout observers
// (lib/syncResize) and the stick-to-bottom ones keep their own observers on purpose.
import { ownerWindowOf } from "./ownerWindow";

type Listener = (entries: ResizeObserverEntry[]) => void;

interface Hub {
  ctor: typeof ResizeObserver;
  /** The table it is in (this window's, or a desk window's). */
  table: Map<string, Hub>;
  ro: ResizeObserver;
  /** Element → the listeners observing it (insertion order). */
  subs: Map<Element, Set<Listener>>;
}

const hubs = new Map<string, Hub>();
/** Desk windows' hubs (multi-window): an observer from this realm follows the main window's rendering, not the desk's. */
const deskHubs = new WeakMap<Window, Map<string, Hub>>();

function deliver(hub: Hub, entries: readonly ResizeObserverEntry[] | undefined): void {
  // A stand-in observer (tests) may call back without entries: every listener re-measures.
  const list = Array.isArray(entries) ? entries : null;
  const batches = new Map<Listener, ResizeObserverEntry[]>();
  if (list) {
    for (const entry of list) for (const l of hub.subs.get(entry.target) ?? []) (batches.get(l) ?? batches.set(l, []).get(l)!).push(entry);
  } else {
    for (const set of hub.subs.values()) for (const l of set) batches.set(l, []);
  }
  for (const [listener, own] of batches) {
    // Disconnected by an earlier listener of this same notification: like a native observer, no callback.
    if (list && !own.some((e) => hub.subs.get(e.target)?.has(listener))) continue;
    try {
      listener(own);
    } catch (error) {
      // One measurer failing must not starve the others (each had its own observer before).
      setTimeout(() => {
        throw error;
      });
    }
  }
}

function hubFor(box: ResizeObserverBoxOptions, view: Window): Hub | null {
  const main = view === window;
  const ctor = main ? (typeof ResizeObserver === "undefined" ? null : ResizeObserver) : (view.ResizeObserver ?? null);
  if (!ctor) return null;
  let table = main ? hubs : deskHubs.get(view);
  if (!table) deskHubs.set(view, (table = new Map()));
  let hub = table.get(box);
  // A replaced global (tests stub ResizeObserver per test): a fresh hub on the current one.
  if (!hub || hub.ctor !== ctor) {
    const fresh: Hub = { ctor, table, ro: null as unknown as ResizeObserver, subs: new Map() };
    fresh.ro = new ctor((entries) => deliver(fresh, entries));
    table.set(box, (hub = fresh));
  }
  return hub;
}

export interface SharedResizeObserver {
  observe(el: Element, options?: ResizeObserverOptions): void;
  unobserve(el: Element): void;
  disconnect(): void;
}

/** Whether a ResizeObserver exists here (jsdom without a stand-in has none). */
export const canObserveResize = (): boolean => typeof ResizeObserver !== "undefined";

/** A ResizeObserver look-alike on the shared observer (see the header). Without ResizeObserver: inert. */
export function sharedResizeObserver(cb: Listener): SharedResizeObserver {
  const mine = new Map<Element, Hub>();
  const drop = (el: Element, hub: Hub) => {
    const set = hub.subs.get(el);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      hub.subs.delete(el);
      hub.ro.unobserve?.(el);
    }
    // Nothing left to watch: let the observer go (made again on the next observe).
    if (hub.subs.size === 0) {
      hub.ro.disconnect();
      for (const [box, h] of hub.table) if (h === hub) hub.table.delete(box);
    }
  };
  return {
    observe(el, options) {
      const hub = hubFor(options?.box ?? "content-box", ownerWindowOf(el));
      if (!hub) return;
      const old = mine.get(el);
      if (old && old !== hub) drop(el, old);
      mine.set(el, hub);
      let set = hub.subs.get(el);
      if (set?.has(cb)) return;
      const shared = !!set;
      if (!set) hub.subs.set(el, (set = new Set()));
      set.add(cb);
      // A native observer reports a newly observed element once; the shared one only does that for the first
      // listener of an element, so observe it afresh (its other listeners get one extra, unchanged report).
      if (shared) hub.ro.unobserve?.(el);
      hub.ro.observe(el, options);
    },
    unobserve(el) {
      const hub = mine.get(el);
      if (!hub) return;
      mine.delete(el);
      drop(el, hub);
    },
    disconnect() {
      for (const [el, hub] of mine) drop(el, hub);
      mine.clear();
    },
  };
}
