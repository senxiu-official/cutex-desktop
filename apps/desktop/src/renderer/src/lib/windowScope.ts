// Per-window state (multi-window P3, docs/desktop-modules.md §24.17; owner 2026-10-27): every app window — the
// main one and each desk (lib/deskStore) — has its own work area (pane layout, Shelves, tray, sidebar state) and
// its own selection. One renderer draws them all (desks are portals), so a store that is "the window's" keeps
// one instance per window:
//
// - `windowStore(make)` wraps a zustand store per window behind the usual API. As a hook it picks the instance of
//   the window the component is drawn in (lib/deskContext); `getState` / `setState` act on the *current* window:
//   the one `inWindow` names, else the active one (the window the owner works in: the last one focused / clicked /
//   typed in). `subscribe` listens to every window's instance, and runs the listener in that window (`inWindow`),
//   so module code reacting to a change reads that window's stores. `of(key)` names one window's instance.
// - The active window decides what is "selected" (owner: the global selection = the focused window's): the app
//   store's `selectedId` / `selectedHost` / `view` are the active window's. The other windows keep theirs as a
//   snapshot (`useWindowSelection`); store.ts shows each window its own through the `useApp` hook.
// Without desks there is one window ("main") and nothing changes.
import { useCallback, useContext, useEffect } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { DeskContext } from "./deskContext";
import { viewKey } from "./viewKey";

export type WindowKey = string;
export const MAIN_WINDOW: WindowKey = "main";

/** A desk id (null: the main window) as a window key. */
export const windowKeyOf = (deskId: string | null | undefined): WindowKey => deskId ?? MAIN_WINDOW;
/** A window key as a desk id (null: the main window). */
export const deskIdOf = (key: WindowKey): string | null => (key === MAIN_WINDOW ? null : key);

/** The window the owner works in now (focus, pointer, keys); MAIN_WINDOW without desks. */
export const useActiveWindow = create<{ key: WindowKey }>(() => ({ key: MAIN_WINDOW }));

const ambient: WindowKey[] = [];

/**
 * The app windows by when the owner was last in them, newest first (lib/windowRoute activateWindow notes each). The
 * renderer cannot read the windows' stacking order; the one used last is the best guess for the one on top.
 */
let recent: WindowKey[] = [];
export function noteWindowUsed(key: WindowKey): void {
  if (recent[0] !== key) recent = [key, ...recent.filter((k) => k !== key)];
}
export const recentWindows = (): readonly WindowKey[] => recent;

/** The window module code acts on: the one `inWindow` runs in, else the active one. */
export function currentWindow(): WindowKey {
  return ambient.length ? ambient[ambient.length - 1]! : useActiveWindow.getState().key;
}

/** Runs `fn` with `key` as the current window (store reads / writes of window stores go to that window's). */
export function inWindow<T>(key: WindowKey, fn: () => T): T {
  ambient.push(key);
  try {
    return fn();
  } finally {
    ambient.pop();
  }
}

/** Whether `key` is the active window. */
export const isActiveWindow = (key: WindowKey): boolean => useActiveWindow.getState().key === key;

/** The window this component is drawn in (lib/deskContext; the main window outside a desk). */
export function useWindowKey(): WindowKey {
  return windowKeyOf(useContext(DeskContext));
}

/** Whether this component's window is the active one (re-renders when that changes). */
export function useIsActiveWindow(): boolean {
  const key = useWindowKey();
  return useActiveWindow((s) => s.key === key);
}

// ── Per-window stores ───────────────────────────────────────────────────────────────────────────

export type WindowStore<T> = UseBoundStore<StoreApi<T>> & {
  /** This window's instance (made on first use). */
  of(key: WindowKey): UseBoundStore<StoreApi<T>>;
  /** The windows that have an instance now. */
  windows(): WindowKey[];
  /** A desk closed: its instance goes (its listeners with it). The main window's stays. */
  drop(key: WindowKey): void;
};

type Listener<T> = (state: T, prev: T) => void;

const allStores: WindowStore<unknown>[] = [];

/** One zustand store per app window behind the usual store API (see the file comment). */
export function windowStore<T>(make: (key: WindowKey) => UseBoundStore<StoreApi<T>>): WindowStore<T> {
  const stores = new Map<WindowKey, UseBoundStore<StoreApi<T>>>();
  const listeners = new Set<Listener<T>>();
  const unsubs = new Map<WindowKey, Map<Listener<T>, () => void>>();
  const attach = (key: WindowKey, store: UseBoundStore<StoreApi<T>>, listener: Listener<T>) => {
    const per = unsubs.get(key) ?? new Map<Listener<T>, () => void>();
    unsubs.set(key, per);
    per.set(
      listener,
      store.subscribe((s, prev) => inWindow(key, () => listener(s, prev))),
    );
  };
  const of = (key: WindowKey) => {
    let store = stores.get(key);
    if (!store) {
      store = make(key);
      stores.set(key, store);
      for (const l of listeners) attach(key, store, l);
    }
    return store;
  };
  of(MAIN_WINDOW);
  const hook = ((selector?: (s: T) => unknown) => {
    const store = of(useWindowKey());
    return selector ? store(selector) : store();
  }) as WindowStore<T>;
  hook.of = of;
  hook.windows = () => [...stores.keys()];
  hook.drop = (key) => {
    if (key === MAIN_WINDOW) return;
    for (const off of unsubs.get(key)?.values() ?? []) off();
    unsubs.delete(key);
    stores.delete(key);
  };
  hook.getState = () => of(currentWindow()).getState();
  hook.getInitialState = () => of(currentWindow()).getInitialState();
  hook.setState = ((partial: T | Partial<T> | ((s: T) => T | Partial<T>), replace?: boolean) => of(currentWindow()).setState(partial as T, replace as false)) as StoreApi<T>["setState"];
  hook.subscribe = (listener: Listener<T>) => {
    listeners.add(listener);
    for (const [key, store] of stores) attach(key, store, listener);
    return () => {
      listeners.delete(listener);
      for (const per of unsubs.values()) {
        per.get(listener)?.();
        per.delete(listener);
      }
    };
  };
  allStores.push(hook as WindowStore<unknown>);
  return hook;
}

/** A desk closed: every window store forgets its instance. */
export function dropWindowStores(key: WindowKey): void {
  for (const store of allStores) store.drop(key);
}

// ── Per-window selection ────────────────────────────────────────────────────────────────────────

/** What a window has selected (the app store's fields of that name; store.ts AppState). */
export interface WindowSelection {
  selectedId: string | null;
  selectedHost: string | null;
  view: unknown;
}

/**
 * Each window's selection: the active window's is the app store's own (not kept here while active); the others'
 * as they were when the owner left them. `active` mirrors useActiveWindow so one hook reads both.
 */
export const useWindowSelection = create<{ active: WindowKey; byWindow: Readonly<Record<WindowKey, WindowSelection>> }>(() => ({ active: MAIN_WINDOW, byWindow: {} }));

/** The selection a window shows when it is not the active one (null: it is the active one, or has none kept). */
export function useInactiveSelection(key: WindowKey): WindowSelection | null {
  return useWindowSelection((s) => (s.active === key ? null : (s.byWindow[key] ?? null)));
}

/** The snapshot kept for an inactive window (null: none). */
export function keptSelection(key: WindowKey): WindowSelection | null {
  return useWindowSelection.getState().byWindow[key] ?? null;
}

/** Keeps `key`'s selection (when it stops being the active window). */
export function keepSelection(key: WindowKey, sel: WindowSelection): void {
  const s = useWindowSelection.getState();
  const old = s.byWindow[key];
  if (old && old.selectedId === sel.selectedId && old.selectedHost === sel.selectedHost && old.view === sel.view) return;
  useWindowSelection.setState({ byWindow: { ...s.byWindow, [key]: { selectedId: sel.selectedId, selectedHost: sel.selectedHost, view: sel.view } } });
}

/** A desk closed: its kept selection goes. */
export function forgetSelection(key: WindowKey): void {
  const s = useWindowSelection.getState();
  if (!(key in s.byWindow)) return;
  const byWindow = { ...s.byWindow };
  delete byWindow[key];
  useWindowSelection.setState({ byWindow });
}

/**
 * The app store's state as an inactive window sees it: its own selection over the shared state. Cached per
 * (state, selection) so selectors returning parts of it stay referentially stable.
 */
const overlays = new WeakMap<object, WeakMap<WindowSelection, object>>();
export function withSelection<S extends object>(state: S, sel: WindowSelection): S {
  let per = overlays.get(state);
  if (!per) {
    per = new WeakMap();
    overlays.set(state, per);
  }
  let out = per.get(sel) as S | undefined;
  if (!out) {
    out = { ...state, selectedId: sel.selectedId, selectedHost: sel.selectedHost, view: sel.view };
    per.set(sel, out);
  }
  return out;
}

/**
 * The app store as each window sees it (store.ts): the hook gives a component in an inactive window that window's
 * own selection; `getState` / `setState` / `subscribe` are the store's (the active window's selection).
 */
export function selectionAware<S extends object>(store: UseBoundStore<StoreApi<S>>): UseBoundStore<StoreApi<S>> {
  const identity = (s: S) => s;
  const hook = ((selector?: (s: S) => unknown) => {
    const sel = useInactiveSelection(useWindowKey());
    const pick = (selector ?? identity) as (s: S) => unknown;
    return store(sel ? (s: S) => pick(withSelection(s, sel)) : pick);
  }) as UseBoundStore<StoreApi<S>>;
  return Object.assign(hook, { getState: store.getState, getInitialState: store.getInitialState, setState: store.setState, subscribe: store.subscribe });
}

/** Tests: back to one window. */
export function resetWindowsForTest(): void {
  for (const store of allStores) for (const key of store.windows()) store.drop(key);
  useActiveWindow.setState({ key: MAIN_WINDOW });
  useWindowSelection.setState({ active: MAIN_WINDOW, byWindow: {} });
  ambient.length = 0;
  recent = [];
}

// ── 「在看」 per window ──────────────────────────────────────────────────────────────────────────

/** Which windows show each view now (conversation panes, side agent pages): `viewKey` → window → count. */
const shown = new Map<string, Map<WindowKey, number>>();

/** A view is drawn (or no longer) in window `key` (beside the store's `views[…].visible`). */
export function noteShownIn(key: WindowKey, view: string, on: boolean): void {
  const per = shown.get(view) ?? new Map<WindowKey, number>();
  const n = (per.get(key) ?? 0) + (on ? 1 : -1);
  if (n > 0) per.set(key, n);
  else per.delete(key);
  if (per.size) shown.set(view, per);
  else shown.delete(view);
}

/**
 * Whether a view visible somewhere counts as looked at: it shows in the active window (owner 2026-10-27: the focused
 * window decides). A view no window noted (older callers): yes, as before.
 */
export function shownInActiveWindow(view: string): boolean {
  const per = shown.get(view);
  return !per || per.has(useActiveWindow.getState().key);
}

/** This component shows that agent's view in its window while `shown` (「在看」 per window). */
export function useShownInWindow(hostId: string, sessionId: string | null, shown: boolean): void {
  const key = useWindowKey();
  useEffect(() => {
    if (!shown || !sessionId) return;
    const view = viewKey(hostId, sessionId);
    noteShownIn(key, view, true);
    return () => noteShownIn(key, view, false);
  }, [key, hostId, sessionId, shown]);
}

/**
 * Runs module code in this component's window (multi-window P3): effects and observers of a component drawn in a
 * desk act on that desk's stores, not the active window's (React runs every window's effects in one commit).
 */
export function useInWindow(): <T>(fn: () => T) => T {
  const key = useWindowKey();
  return useCallback(<T,>(fn: () => T): T => inWindow(key, fn), [key]);
}
