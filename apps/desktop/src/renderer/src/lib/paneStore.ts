// The window's pane layout as state (docs/desktop-modules.md §24; research panes-20261019.md §4): the
// work area — which conversation panes are on screen, which agent each shows, which one has the focus,
// how wide the columns are and which page a pane shows over its conversation. Kept per device and per
// focus host in localStorage `cutex-desktop.panes` (lib/paneFile, with the tool area lib/sideLayoutStore
// keeps; the owner decided 2026-10-20: local only), restored on start without the panes whose agent is
// gone. Pages are never stored.
//
// A page (`services.ui.openPage`, §24.4) shows in the focused conversation pane: the store's `view`
// (MainView, kept for its readers) is the focused pane's page — opening a page puts it over the
// focused pane's conversation, closing it (or a plain open of an agent) takes it away; focusing another
// pane makes `view` that pane's page or its conversation. Pages with an Aside (设置) stay full-window
// and never enter a pane.
//
// The focused conversation pane is bound to the store's selection (`selectedId` / `selectedHost` = the
// focused conversation: sidebar highlight, title bar, follow-bound side cards): a plain open replaces
// its agent (or focuses the pane already showing it); focusing another pane selects that pane's agent.
// The other panes keep their agent (components/PaneHost retains each pane's view, store retainView).
// The placement rules are the pure functions of lib/paneLayout.
import { create } from "zustand";
import { agentHost, sidebarOf, useApp } from "../store";
import type { ItemId, PageParams } from "../modules/types";
import { migrateSideOnce, PANES_STORAGE_KEY, readPanesFile, writeWork } from "./paneFile";
import {
  bindPane,
  closePane,
  closePaneOverlay,
  defaultLayout,
  dropGoneAgents,
  focusedConversation,
  focusPane,
  openBeside,
  paneBinding,
  panePage,
  resizeColumns,
  restoreLayout,
  showAgent,
  showPageIn,
  type PaneAgent,
  type PaneLayout,
} from "./paneLayout";

export { PANES_STORAGE_KEY };

interface PanesState {
  layout: PaneLayout;
  /** The layout's scope key (`host:<focus host>`), null until the hosts are known. */
  scope: string | null;
  /** The restored focused pane's agent, selected once its host lists it (null: nothing to restore). */
  restore: PaneAgent | null;
}

type AppNow = ReturnType<typeof useApp.getState>;

/** The layout of a fresh window: one conversation pane (today's look). The dock follows the prefs (PaneHost). */
const freshLayout = (hostId: string, sessionId: string | null = null): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId, sessionId });

export const usePanes = create<PanesState>(() => ({ layout: freshLayout("local"), scope: null, restore: null }));

const focusOf = (s: Pick<AppNow, "hosts">) => s.hosts?.active ?? "local";
export const paneScopeOf = (hostId: string) => `host:${hostId}`;

/** Stores the work area (the tool area stored with it stays, lib/paneFile). */
const save = (scope: string, layout: PaneLayout): void => writeWork(scope, layout);

/** Whether `hostId`'s agent list has this agent (active or archived); null: that host's list is not known. */
function listed(s: AppNow, hostId: string, sessionId: string): boolean | null {
  const sidebar = sidebarOf(s, hostId);
  return sidebar ? [...sidebar.active, ...sidebar.retired].some((r) => r.cutexSessionId === sessionId) : null;
}

const setLayout = (layout: PaneLayout) => {
  if (layout !== usePanes.getState().layout) usePanes.setState({ layout });
};

/** Load the stored layout of a scope (or a fresh one); its focused pane's agent is selected once listed. */
function enterScope(s: AppNow): void {
  const scope = paneScopeOf(focusOf(s));
  migrateSideOnce();
  const layout = restoreLayout(readPanesFile().layouts[scope]) ?? freshLayout(focusOf(s));
  const focused = focusedConversation(layout);
  const b = focused ? paneBinding(layout, focused) : null;
  usePanes.setState({ layout, scope, restore: b?.sessionId && !s.selectedId ? { hostId: b.hostId, sessionId: b.sessionId } : null });
}

/** The selection moved (select, a host switch, a delete): the focused conversation pane follows it. */
export function followSelection(layout: PaneLayout, s: Pick<AppNow, "selectedId" | "selectedHost" | "hosts">, now: number): PaneLayout {
  const host = agentHost(s);
  if (s.selectedId) return showAgent(layout, { hostId: host, sessionId: s.selectedId }, now);
  const focused = focusedConversation(layout);
  return focused ? bindPane(layout, focused, host, null) : layout;
}

/** Restore step: the restored agent is listed → select it; listed no more → forget it. */
function settleRestore(s: AppNow): void {
  const restore = usePanes.getState().restore;
  if (!restore) return;
  if (s.selectedId) return usePanes.setState({ restore: null });
  const known = listed(s, restore.hostId, restore.sessionId);
  if (known === null) return;
  usePanes.setState({ restore: null });
  if (known) void s.openAgent(restore.sessionId, restore.hostId);
  else setLayout(followSelection(usePanes.getState().layout, s, Date.now()));
}

let started = false;
/** A pane focus is moving `view` itself (selectPane): the view change is not a page open / close. */
let mirroring = false;

/** Pages with an Aside (设置) are full-window: never in a pane (lib/paneKinds says which). */
let fullWindowPage: (page: string) => boolean = () => false;
export function setFullWindowPages(test: (page: string) => boolean): void {
  fullWindowPage = test;
}

/** `view` changed (openPage / closePage / a plain open): the focused conversation pane shows that page, or its conversation again. */
function followView(s: Pick<AppNow, "view">): void {
  const { layout } = usePanes.getState();
  const focused = focusedConversation(layout);
  if (!focused) return;
  const view = s.view;
  if (view.kind === "page") {
    if (fullWindowPage(view.page)) return;
    setLayout(showPageIn(layout, focused, view.page, view.params as Record<string, unknown>));
  } else setLayout(closePaneOverlay(layout, focused));
}

/** Keep the layout in step with the store (App mounts it once); returns the stop. */
export function startPaneSync(): () => void {
  if (started) return () => {};
  started = true;
  const s0 = useApp.getState();
  if (s0.hosts) enterScope(s0);
  const offApp = useApp.subscribe((s, prev) => {
    if (!s.hosts) return;
    const scope = paneScopeOf(focusOf(s));
    const entered = scope !== usePanes.getState().scope;
    if (entered) enterScope(s);
    if (s.view !== prev.view && !mirroring) followView(s);
    if (entered || s.selectedId !== prev.selectedId || s.selectedHost !== prev.selectedHost) {
      // At start the selection is empty while the restored agent waits for its host's list.
      if (s.selectedId || !usePanes.getState().restore) setLayout(followSelection(usePanes.getState().layout, s, Date.now()));
    }
    if (entered || s.sidebar !== prev.sidebar || s.byHost !== prev.byHost) {
      settleRestore(s);
      // Agents deleted meanwhile (their host's list no longer has them) leave their pane.
      setLayout(dropGoneAgents(usePanes.getState().layout, (hostId, sessionId) => listed(s, hostId, sessionId) === false));
    }
  });
  // Stored shortly after a change (a divider drag changes the layout on every move), at once on unload.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const { scope, layout } = usePanes.getState();
    if (scope) save(scope, layout);
  };
  const offPanes = usePanes.subscribe((state, prev) => {
    if (!state.scope) return;
    // Leaving a scope: the old one's layout is stored now.
    if (prev.scope && state.scope !== prev.scope) {
      if (timer) clearTimeout(timer);
      timer = null;
      save(prev.scope, prev.layout);
    }
    if (state.layout !== prev.layout || state.scope !== prev.scope) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    }
  });
  const onUnload = () => flush();
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onUnload);
  return () => {
    started = false;
    flush();
    offApp();
    offPanes();
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", onUnload);
  };
}

/** A conversation pane's binding now, once the layout follows the store (null: not started / no such pane). */
export function livePaneBinding(paneId: string): { hostId: string; sessionId: string | null } | null {
  const { scope, layout } = usePanes.getState();
  return started && scope ? paneBinding(layout, paneId) : null;
}

// ---------- actions (sidebar rows, pane headers, clicks inside a pane) ----------

/** The focused conversation is now `paneId`'s: select its agent (or none); `view` = its page or its conversation. */
function selectPane(layout: PaneLayout, paneId: string | null): void {
  const b = paneId ? paneBinding(layout, paneId) : null;
  const app = useApp.getState();
  const page = paneId ? panePage(layout, paneId) : null;
  const fullWindow = app.view.kind === "page" && fullWindowPage(app.view.page);
  mirroring = true;
  try {
    if (b?.sessionId) void app.openAgent(b.sessionId, b.hostId);
    else if (app.selectedId) useApp.setState({ selectedId: null, selectedHost: null });
    if (!fullWindow) {
      const view = useApp.getState().view;
      if (page) useApp.setState({ view: { kind: "page", page: page.page as ItemId, params: page.params as PageParams } });
      else if (view.kind !== "conversation") useApp.setState({ view: { kind: "conversation" } });
    }
  } finally {
    mirroring = false;
  }
}

/** A pane header's × on its page: the page closes, its conversation shows again. */
export function closePanePage(paneId: string): void {
  const { layout } = usePanes.getState();
  const next = closePaneOverlay(layout, paneId);
  if (next === layout) return;
  usePanes.setState({ layout: next });
  if (focusedConversation(next) === paneId && useApp.getState().view.kind === "page") {
    mirroring = true;
    try {
      useApp.setState({ view: { kind: "conversation" } });
    } finally {
      mirroring = false;
    }
  }
}

/** A click / focus inside a conversation pane: it becomes the focused conversation. */
export function focusConversationPane(paneId: string): void {
  const { layout } = usePanes.getState();
  if (layout.focus === paneId) return;
  const next = focusPane(layout, paneId, Date.now());
  if (next === layout) return;
  usePanes.setState({ layout: next, restore: null });
  selectPane(next, paneId);
}

/**
 * Ctrl/⌘ + click, middle click, 「在旁边打开」 on an agent: in a conversation pane beside the focused one.
 * `focus: false` (services.panes.open background): the pane opens, the focus stays where it was.
 */
export function openAgentBeside(hostId: string, sessionId: string, opts: { focus?: boolean } = {}): void {
  const { layout } = usePanes.getState();
  const next = openBeside(layout, { hostId, sessionId }, Date.now(), opts);
  if (next === layout) return;
  usePanes.setState({ layout: next, restore: null });
  if (opts.focus !== false) selectPane(next, next.focus);
}

/** A pane header's ×: the pane closes (never the last conversation pane); a closed focus moves on. */
export function closeConversationPane(paneId: string): void {
  const { layout } = usePanes.getState();
  const next = closePane(layout, paneId);
  if (next === layout) return;
  usePanes.setState({ layout: next });
  if (layout.focus === paneId) selectPane(next, next.focus);
}

/** The divider between two columns dragged: column `index` takes `share` of the pair's width. */
export function resizePaneColumns(index: number, share: number): void {
  setLayout(resizeColumns(usePanes.getState().layout, index, share));
}
