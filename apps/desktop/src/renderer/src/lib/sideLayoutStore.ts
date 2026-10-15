// The right side's state (docs/desktop-modules.md §18): the layout of the current view scope (pages,
// cards, instances, overrides — persisted per scope in localStorage "cutex-desktop.side"), with one
// view per agent (column open, page in view: `layout.views`, RFC §13 D27′), plus what lives in
// memory only: maximise / fullscreen (per agent too), the tab infos the page buttons sum, reveal
// counters and the flash. A small zustand store of its own (not the 1900-line store.ts); every layout change
// goes through the pure reducers in lib/sideLayout.ts.
import { create } from "zustand";
import type { Json } from "../modules/types";
import type { SideTabInfo } from "../modules/slots";
import { agentHost, selectedSidebar, sidebarOf, useApp } from "../store";
import { parseHostKey } from "./hostKeys";
import { getUiPrefs } from "./prefs";
import {
  closeIfEmptied,
  closeInstances,
  dropDeletedAgents,
  dropViews,
  emptyLayout,
  findCard,
  findPage,
  instanceVisible,
  locate,
  prepareForSave,
  restoreInstances,
  restoreView,
  sanitizeLayout,
  saveView,
  stateSize,
  STATE_LIMIT,
  switchAgentView,
  viewKey,
  type SideLayout,
} from "./sideLayout";
import { sideRegistry, sideViewNow } from "./sideComponents";
import { peekOpen } from "./peekStore";
import { scopeFor, scopeKey } from "./workspace";

export const SIDE_STORAGE_KEY = "cutex-desktop.side";

export interface SideMode {
  kind: "maximised" | "fullscreen";
  /** A single card (card-level ⤢ / ⛶), or null for the page in view. */
  card: string | null;
}

export interface SideStoreState {
  /** View scope key ("host:<id>"; later "group:<id>" / "all"). null until started. */
  scope: string | null;
  layout: SideLayout;
  mode: SideMode | null;
  /** services.side.reveal / focus: Body props `revealed` per instance. */
  revealed: Record<string, number>;
  /** The latest useTab() of every visible instance (page-button badges, tab rows, tooltips). */
  tabInfo: Record<string, SideTabInfo>;
  /** A card (or the page's pill) flashes once after a reveal. */
  flash: { cardId: string | null; pageId: string; nonce: number } | null;
  /** The window is too narrow for both: the side is a drawer (set by the side area's measurement). */
  narrow: boolean;
  /** The card last focused / clicked (Ctrl+Shift+M / Shift+F11 act on it). */
  focusedCard: string | null;
}

export const useSide = create<SideStoreState>(() => ({
  scope: null,
  layout: emptyLayout(),
  mode: null,
  revealed: {},
  tabInfo: {},
  flash: null,
  narrow: false,
  focusedCard: null,
}));

// ── Persistence ─────────────────────────────────────────────────────────────────────────────────

interface SideFile {
  v: 1;
  layouts: Record<string, unknown>;
}

function readFile(): SideFile {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDE_STORAGE_KEY) ?? "null") as unknown;
    if (raw && typeof raw === "object" && (raw as SideFile).v === 1 && (raw as SideFile).layouts && typeof (raw as SideFile).layouts === "object") return raw as SideFile;
  } catch {
    // unreadable: start empty
  }
  return { v: 1, layouts: {} };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveNow(): void {
  saveTimer = null;
  const { scope, layout } = useSide.getState();
  if (!scope) return;
  let ctx: ReturnType<typeof sideViewNow> | null = null;
  try {
    ctx = sideViewNow();
  } catch {
    ctx = null;
  }
  const registry = (() => {
    try {
      return sideRegistry();
    } catch {
      return null;
    }
  })();
  const stored = prepareForSave(layout, {
    persist: (kind) => registry?.get(kind)?.item.persist !== false,
    visible: (id) => (ctx ? instanceVisible(layout, id, ctx) : true),
  });
  const file = readFile();
  file.layouts[scope] = stored;
  try {
    localStorage.setItem(SIDE_STORAGE_KEY, JSON.stringify(file));
  } catch {
    // storage full / unavailable: the layout lasts for this session only
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

export function flushSideSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveNow();
  }
}

// ── Updates ─────────────────────────────────────────────────────────────────────────────────────

/** Mode after a layout change: gone with its card / page or a closed column; a card mode on another page becomes the page's. */
function validMode(layout: SideLayout, mode: SideMode | null): SideMode | null {
  if (!mode || !layout.open || !findPage(layout, layout.activePage)) return null;
  if (!mode.card) return mode;
  const at = findCard(layout, mode.card);
  if (!at) return null;
  return at.page.id === layout.activePage ? mode : { kind: mode.kind, card: null };
}

/**
 * The selected agent as the bindings see it (no registry needed: works before modules register): its
 * host is the agent's own (multi-host P1: an agent of another host in the scope opens in place).
 */
function bindingCtx(): { hostId: string; sessionId: string | null; workspaceKey: string | null } {
  const s = useApp.getState();
  const scope = scopeFor(selectedSidebar(s), s.selectedId);
  return { hostId: agentHost(s), sessionId: s.selectedId, workspaceKey: scope ? scopeKey(scope) : null };
}

type AppNow = ReturnType<typeof useApp.getState>;
/** The selected agent's view key (host-keyed for an agent of another host than the focus host). */
const currentViewKey = (s: AppNow) => viewKey(s.selectedId, agentHost(s), s.hosts?.active ?? "local");

/** The agent whose view `layout.open` / `activePage` are (set on scope load and agent switch). */
let viewAgent: string | null = null;

/** Applies a reducer to the current layout (persisted, debounced); the result is the current agent's view. */
export function updateLayout(fn: (layout: SideLayout) => SideLayout): void {
  const s = useSide.getState();
  const next = fn(s.layout);
  if (next === s.layout) return;
  let layout = closeIfEmptied(s.layout, next, bindingCtx());
  if (viewAgent !== null) layout = saveView(layout, viewAgent, Date.now());
  const mode = validMode(layout, s.mode);
  const focusedCard = s.focusedCard && findCard(layout, s.focusedCard) ? s.focusedCard : null;
  useSide.setState({ layout, mode, focusedCard });
  scheduleSave();
}

/** Maximise / full screen per agent, in memory only (modes never outlive the session). */
const modes = new Map<string, SideMode>();

/** Another agent selected: keep the old one's view (and mode), show the new one's. */
function switchAgent(to: string): void {
  const s = useSide.getState();
  const from = viewAgent;
  if (from === to) return;
  if (from !== null) {
    if (s.mode) modes.set(from, s.mode);
    else modes.delete(from);
  }
  viewAgent = to;
  const layout = from === null ? saveView(restoreView(s.layout, to, bindingCtx()), to, Date.now(), true) : switchAgentView(s.layout, from, to, bindingCtx(), Date.now());
  const mode = validMode(layout, modes.get(to) ?? null);
  const focusedCard = s.focusedCard && findCard(layout, s.focusedCard) ? s.focusedCard : null;
  if (layout !== s.layout || mode !== s.mode || focusedCard !== s.focusedCard) {
    useSide.setState({ layout, mode, focusedCard, flash: null });
    scheduleSave();
  }
}

export function setMode(mode: SideMode | null): void {
  const s = useSide.getState();
  useSide.setState({ mode: mode ? validMode(s.layout, mode) : null });
}

export function setInstanceStateNow(id: string, state: Json, v: number): void {
  if (import.meta.env?.DEV && stateSize(state) > STATE_LIMIT) {
    console.warn(`[side] state of ${id} is over ${STATE_LIMIT} chars: kept in memory, not persisted`);
  }
  updateLayout((layout) => {
    const inst = layout.instances[id];
    return inst ? { ...layout, instances: { ...layout.instances, [id]: { ...inst, state, v } } } : layout;
  });
}

export function reportTabInfo(id: string, info: SideTabInfo | null): void {
  const current = useSide.getState().tabInfo;
  const old = current[id];
  if (!info) {
    if (!old) return;
    const next = { ...current };
    delete next[id];
    useSide.setState({ tabInfo: next });
    return;
  }
  if (old && old.title === info.title && old.tooltip === info.tooltip && !!old.busy === !!info.busy && (old.attention ?? 0) === (info.attention ?? 0) && !!old.unread === !!info.unread) return;
  useSide.setState({ tabInfo: { ...current, [id]: info } });
}

export function bumpRevealed(id: string): void {
  const revealed = useSide.getState().revealed;
  useSide.setState({ revealed: { ...revealed, [id]: (revealed[id] ?? 0) + 1 } });
}

export function flashInstance(id: string): void {
  const at = locate(useSide.getState().layout, id);
  if (at) useSide.setState({ flash: { cardId: at.card.id, pageId: at.page.id, nonce: Date.now() + Math.random() } });
}

/** Flash a card (its page button too when that page is not in view). */
export function flashCard(cardId: string): void {
  const at = findCard(useSide.getState().layout, cardId);
  if (at) useSide.setState({ flash: { cardId, pageId: at.page.id, nonce: Date.now() + Math.random() } });
}

export function setFocusedCard(cardId: string | null): void {
  if (useSide.getState().focusedCard !== cardId) useSide.setState({ focusedCard: cardId });
}

export function setNarrow(narrow: boolean): void {
  if (useSide.getState().narrow !== narrow) useSide.setState({ narrow });
}

/** Esc chain (§19): the reference card or a right-side layer is in front — the conversation's Esc must not interrupt. */
export function sideLayersActive(): boolean {
  const s = useSide.getState();
  return peekOpen() || !!s.mode || (s.narrow && s.layout.open && getUiPrefs().sideNarrow === "overlay");
}

// ── Restore (component `restore`, dormant instances) ───────────────────────────────────────────

/** Instance ids loaded from storage whose component has not restored them yet (module off / not registered). */
const pending = new Set<string>();

function restorePending(): void {
  if (!pending.size) return;
  let registry: ReturnType<typeof sideRegistry>;
  try {
    registry = sideRegistry();
  } catch {
    return;
  }
  updateLayout((layout) =>
    restoreInstances(layout, (inst, id) => {
      if (!pending.has(id)) return "keep";
      const entry = registry.get(inst.kind);
      if (!entry) return "keep";
      pending.delete(id);
      const item = entry.item;
      const version = item.stateVersion ?? 1;
      if (item.persist === false) return null;
      try {
        if (item.restore) {
          const state = item.restore(inst.state, inst.v);
          return state === null ? null : { state, v: version };
        }
      } catch {
        return null;
      }
      return inst.v === version ? { state: inst.state, v: version } : null;
    }),
  );
  // Ids no longer in the layout need no restore.
  const layout = useSide.getState().layout;
  for (const id of [...pending]) if (!layout.instances[id]) pending.delete(id);
}

// ── Scope ───────────────────────────────────────────────────────────────────────────────────────

/** v1.10 releaseHold discard of a card in a scope not loaded now: closed when that scope loads (memory only). */
const closeOnLoad = new Map<string, Set<string>>();

/** Closes instances of `scope` without their components' onClose (the caller is the component itself): now, or when that scope loads. */
export function closeInstancesIn(scope: string, ids: readonly string[]): void {
  if (!ids.length) return;
  if (useSide.getState().scope === scope) {
    updateLayout((layout) => closeInstances(layout, ids.filter((id) => layout.instances[id])));
    return;
  }
  const set = closeOnLoad.get(scope) ?? new Set<string>();
  for (const id of ids) set.add(id);
  closeOnLoad.set(scope, set);
}

let firstLoad = true;

function loadScope(scope: string): void {
  if (useSide.getState().scope === scope) return;
  flushSideSave();
  const file = readFile();
  let layout = sanitizeLayout(file.layouts[scope], scope.startsWith("host:") ? scope.slice("host:".length) : undefined);
  if (firstLoad && !getUiPrefs().sideRestore) layout = { ...emptyLayout(), overrides: layout.overrides, seq: layout.seq };
  firstLoad = false;
  const discarded = closeOnLoad.get(scope);
  if (discarded) {
    closeOnLoad.delete(scope);
    layout = closeInstances(layout, [...discarded].filter((id) => layout.instances[id]));
  }
  pending.clear();
  for (const id of Object.keys(layout.instances)) pending.add(id);
  // The selected agent's view of this scope (a fresh load: no agent's view is shown yet).
  viewAgent = currentViewKey(useApp.getState());
  modes.clear();
  layout = saveView(restoreView(layout, viewAgent, bindingCtx()), viewAgent, Date.now(), true);
  useSide.setState({ scope, layout, mode: null, revealed: {}, tabInfo: {}, flash: null, focusedCard: null });
  restorePending();
}

const scopeOf = (hostId: string) => `host:${hostId}`;

let started = false;

/** Starts the side store once (App): loads the active host's layout and follows host / agent / module changes. */
export function startSideStore(subscribeModules: (listener: () => void) => () => void): () => void {
  if (started) return () => {};
  started = true;
  loadScope(scopeOf(useApp.getState().hosts?.active ?? "local"));
  const offApp = useApp.subscribe((s, prev) => {
    const host = s.hosts?.active ?? "local";
    if (host !== (prev.hosts?.active ?? "local")) loadScope(scopeOf(host));
    if (s.selectedId !== prev.selectedId || s.selectedHost !== prev.selectedHost) switchAgent(currentViewKey(s));
    if (s.sidebar && s.sidebar !== prev.sidebar) {
      const sidebar = s.sidebar;
      const known = new Set([...sidebar.active, ...sidebar.retired].map((r) => r.cutexSessionId));
      // Views of another host's agents stay while that host's sidebar is unknown or still lists them.
      const exists = (key: string) => {
        const other = parseHostKey(key);
        if (!other) return known.has(key);
        const otherSidebar = sidebarOf(s, other[0]);
        return !otherSidebar || [...otherSidebar.active, ...otherSidebar.retired].some((r) => r.cutexSessionId === other[1]);
      };
      updateLayout((layout) => dropViews(dropDeletedAgents(layout, host, (id) => known.has(id)), exists));
    }
  });
  const offModules = subscribeModules(() => restorePending());
  const onUnload = () => flushSideSave();
  window.addEventListener("beforeunload", onUnload);
  return () => {
    started = false;
    viewAgent = null;
    offApp();
    offModules();
    window.removeEventListener("beforeunload", onUnload);
  };
}
