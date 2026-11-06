// The window's pane layout as state (docs/desktop-modules.md §24; research panes-20261019.md §4): the
// work area — which conversation panes are on screen, which agent each shows, which one has the focus,
// how wide the columns are and which page a pane shows over its conversation. Kept per device and per
// focus host in the pane layout file (lib/paneFile, IndexedDB via lib/paneDb; with the tool area lib/sideLayoutStore
// keeps; the owner decided 2026-10-20: local only), restored on start without the panes whose agent is
// gone. Pages are never stored.
//
// A page (`services.ui.openPage`, §24.4) opens as its own pane in the focused conversation's Shelf (lib/paneServices,
// 2026-10-21); with 页面打开位置 = 占用会话 it shows in the focused conversation pane: the store's `view`
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
//
// Multi-window P3 (§24.17): every app window has its own layout (lib/windowScope windowStore; a desk's scope is
// `host:<id>/desk:<deskId>`), and the selection is the active window's — the other windows keep theirs
// (lib/windowScope keepSelection) until the owner comes back to them (enterWindow).
import { create } from "zustand";
import { currentWindow, inWindow, isActiveWindow, keepSelection, keptSelection, MAIN_WINDOW, windowStore, type WindowKey, type WindowSelection } from "./windowScope";
import { agentHost, routedElsewhere, sidebarOf, useApp } from "../store";
import { listedIn } from "./archivedAgent";
import type { ItemId, PageParams } from "../modules/types";
import { migrateSideOnce, PANES_STORAGE_KEY, readPanesFile, writeWork } from "./paneFile";
import { roomForColumn, roomForColumns } from "./paneRoom";
import {
  bindPane,
  closePane,
  conversationPanes,
  closePaneOverlay,
  maxConversationColumns,
  showAgentsLayout,
  defaultLayout,
  dropGoneAgents,
  focusedConversation,
  focusPane,
  openBeside,
  openEmptyBeside,
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

/** One per app window (lib/windowScope): hooks read their window's, module code the current window's. */
export const usePanes = windowStore(() => create<PanesState>(() => ({ layout: freshLayout("local"), scope: null, restore: null })));

const focusOf = (s: Pick<AppNow, "hosts">) => s.hosts?.active ?? "local";
/** A window's layout scope: `host:<id>` for the main window, `host:<id>/desk:<deskId>` for a desk (lib/paneFile scopeHost). */
export const paneScopeOf = (hostId: string, key: WindowKey = MAIN_WINDOW) => (key === MAIN_WINDOW ? `host:${hostId}` : `host:${hostId}/desk:${key}`);

/** Stores the work area (the tool area stored with it stays, lib/paneFile). */
const save = (scope: string, layout: PaneLayout): void => writeWork(scope, layout);

/** Whether `hostId`'s agent list has this agent (active or archived); null: that host's list is not known. */
function listed(s: AppNow, hostId: string, sessionId: string): boolean | null {
  return listedIn(sidebarOf(s, hostId), sessionId);
}

const setLayout = (layout: PaneLayout) => {
  if (layout !== usePanes.getState().layout) usePanes.setState({ layout });
};

/** A new desk's first layout (lib/deskActions: what moved into it), taken when its scope is entered. */
const seeds = new Map<WindowKey, PaneLayout>();
export function seedWindowLayout(key: WindowKey, layout: PaneLayout): void {
  seeds.set(key, layout);
}

/**
 * Load the stored layout of a scope (or a fresh one) in the current window; the active window's focused pane's agent
 * is selected once listed, another window keeps it as its own selection.
 */
function enterScope(s: AppNow): void {
  const key = currentWindow();
  const scope = paneScopeOf(focusOf(s), key);
  migrateSideOnce();
  const seed = seeds.get(key);
  seeds.delete(key);
  const layout = seed ?? restoreLayout(readPanesFile().layouts[scope]) ?? freshLayout(focusOf(s));
  const focused = focusedConversation(layout);
  const b = focused ? paneBinding(layout, focused) : null;
  const active = isActiveWindow(key);
  usePanes.setState({ layout, scope, restore: active && b?.sessionId && !s.selectedId ? { hostId: b.hostId, sessionId: b.sessionId } : null });
  if (!active) keepFromLayout(key, layout);
}

const CONVERSATION_VIEW = { kind: "conversation" } as const;

/** A window that is not the active one: its kept selection follows its layout's focused pane (a full-window page stays). */
function keepFromLayout(key: WindowKey, layout: PaneLayout): void {
  const kept = keptSelection(key);
  const focused = focusedConversation(layout);
  const b = focused ? paneBinding(layout, focused) : null;
  const page = focused ? panePage(layout, focused) : null;
  const keptView = kept?.view as { kind?: string; page?: string; params?: unknown } | undefined;
  const fullWindow = keptView?.kind === "page" && !!keptView.page && fullWindowPage(keptView.page);
  const samePage = !!page && keptView?.kind === "page" && keptView.page === page.page && keptView.params === page.params;
  const view = fullWindow || samePage ? keptView : page ? { kind: "page", page: page.page, params: page.params } : keptView?.kind === "conversation" ? keptView : CONVERSATION_VIEW;
  keepSelection(key, { selectedId: b?.sessionId ?? null, selectedHost: b?.sessionId ? b.hostId : null, view });
}

/**
 * The owner came to window `key` (lib/windowRoute activateWindow; it is the active window now): the selection
 * becomes its focused pane's agent, `view` its page — or the full-window page (设置) it showed when left.
 */
export function enterWindow(key: WindowKey, kept: WindowSelection | null): void {
  inWindow(key, () => {
    const { layout } = usePanes.getState();
    const focused = focusedConversation(layout);
    const b = focused ? paneBinding(layout, focused) : null;
    const page = focused ? panePage(layout, focused) : null;
    const keptView = kept?.view as AppNow["view"] | undefined;
    const fullWindow = keptView?.kind === "page" && fullWindowPage(keptView.page) ? keptView : null;
    mirroring = true;
    try {
      const app = useApp.getState();
      if (b?.sessionId) void app.openAgent(b.sessionId, b.hostId);
      else if (app.selectedId) useApp.setState({ selectedId: null, selectedHost: null });
      useApp.setState({ view: fullWindow ?? (page ? { kind: "page", page: page.page as ItemId, params: page.params as PageParams } : { kind: "conversation" }) });
    } finally {
      mirroring = false;
    }
  });
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
  if (!known) return setLayout(followSelection(usePanes.getState().layout, s, Date.now()));
  // The list that names it may arrive inside a host notification (a host switch adopts the slice's list in
  // store onHosts): daemon calls made during its delivery are refused (preload: 「host binding unavailable or
  // changed」, r265 D4 D-5), so the open waits until it is delivered — as the store's own follow-ups do.
  const scope = usePanes.getState().scope;
  queueMicrotask(() => {
    const now = useApp.getState();
    if (now.selectedId || usePanes.getState().scope !== scope || listed(now, restore.hostId, restore.sessionId) !== true) return;
    void now.openAgent(restore.sessionId, restore.hostId);
  });
}

/** The windows whose layout follows the store (startPaneSync). */
const started = new Set<WindowKey>();
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

/**
 * Keep window `key`'s layout in step with the store (App mounts it for the main window, lib/deskSync for each desk);
 * returns the stop. Only the active window's layout follows the selection and `view`.
 */
export function startPaneSync(key: WindowKey = MAIN_WINDOW): () => void {
  if (started.has(key)) return () => {};
  started.add(key);
  const store = usePanes.of(key);
  const s0 = useApp.getState();
  if (s0.hosts) inWindow(key, () => enterScope(s0));
  const offApp = useApp.subscribe((s, prev) =>
    inWindow(key, () => {
      if (!s.hosts) return;
      const scope = paneScopeOf(focusOf(s), key);
      const entered = scope !== usePanes.getState().scope;
      if (entered) enterScope(s);
      const active = isActiveWindow(key);
      if (active && s.view !== prev.view && !mirroring) followView(s);
      if (active && (entered || s.selectedId !== prev.selectedId || s.selectedHost !== prev.selectedHost)) {
        // At start the selection is empty while the restored agent waits for its host's list.
        if (s.selectedId || !usePanes.getState().restore) setLayout(followSelection(usePanes.getState().layout, s, Date.now()));
      }
      if (entered || s.sidebar !== prev.sidebar || s.byHost !== prev.byHost) {
        if (active) settleRestore(s);
        // Agents deleted meanwhile (their host's list no longer has them) leave their pane.
        setLayout(dropGoneAgents(usePanes.getState().layout, (hostId, sessionId) => listed(s, hostId, sessionId) === false));
      }
    }),
  );
  // Stored shortly after a change (a divider drag changes the layout on every move), at once on unload.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const { scope, layout } = store.getState();
    if (scope) save(scope, layout);
  };
  const offPanes = store.subscribe((state, prev) => {
    // Not the active window: what it shows is its own selection.
    if (state.layout !== prev.layout && !isActiveWindow(key)) keepFromLayout(key, state.layout);
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
    started.delete(key);
    flush();
    offApp();
    offPanes();
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", onUnload);
  };
}

/** A conversation pane's binding now, once the layout follows the store (null: not started / no such pane). */
export function livePaneBinding(paneId: string): { hostId: string; sessionId: string | null } | null {
  const { scope, layout } = usePanes.getState();
  return started.has(currentWindow()) && scope ? paneBinding(layout, paneId) : null;
}

// ---------- actions (sidebar rows, pane headers, clicks inside a pane) ----------

/** The focused conversation is now `paneId`'s: select its agent (or none); `view` = its page or its conversation. */
function selectPane(layout: PaneLayout, paneId: string | null): void {
  // Another window than the active one (multi-window P3): its own selection follows its layout (startPaneSync).
  if (!isActiveWindow(currentWindow())) return;
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

/**
 * A page that covers a conversation column (新建{{agent}}, design 038) opened with Ctrl/⌘: over a column beside the
 * focused one — a new empty column, or with two columns the other one — which takes the focus. No room for a
 * column: over the focused one, as a plain click.
 */
export function openPageBeside(page: ItemId, params: PageParams = {}): void {
  const { layout } = usePanes.getState();
  const focused = focusedConversation(layout);
  const other = conversationPanes(layout).find((id) => id !== focused);
  const host = (focused ? paneBinding(layout, focused)?.hostId : null) ?? useApp.getState().hosts?.active ?? null;
  const next = other ? focusPane(layout, other, Date.now()) : host ? openEmptyBeside(layout, host, Date.now(), roomForColumn("conversation")) : layout;
  if (next !== layout) {
    usePanes.setState({ layout: next, restore: null });
    selectPane(next, next.focus);
  }
  useApp.getState().openPage(page, params);
}

/** A pane header's × on its page: the page closes, its conversation shows again. */
export function closePanePage(paneId: string): void {
  const { layout } = usePanes.getState();
  const next = closePaneOverlay(layout, paneId);
  if (next === layout) return;
  usePanes.setState({ layout: next });
  if (focusedConversation(next) === paneId && isActiveWindow(currentWindow()) && useApp.getState().view.kind === "page") {
    mirroring = true;
    try {
      useApp.setState({ view: { kind: "conversation" } });
    } finally {
      mirroring = false;
    }
  }
}

/**
 * A page header's × / Esc (占用会话, §24.4): the page over the column `paneId` closes and its conversation shows
 * again. The focused column's page is the store's `view` (closePage); another column's is its own overlay.
 */
export function closeColumnPage(paneId: string): void {
  const { layout } = usePanes.getState();
  if (focusedConversation(layout) !== paneId) return closePanePage(paneId);
  if (useApp.getState().view.kind === "page") useApp.getState().closePage();
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
  // One copy per agent (multi-window P3): on screen in another window → that window's column takes the focus.
  if (routedElsewhere(hostId, sessionId)) return;
  const { layout } = usePanes.getState();
  // §24.13: a second workspace; with two on screen the other one shows the agent (no conversation chip).
  const next = openBeside(layout, { hostId, sessionId }, Date.now(), { ...opts, room: roomForColumn("conversation"), noChip: true });
  if (next === layout) return;
  usePanes.setState({ layout: next, restore: null });
  if (opts.focus !== false) selectPane(next, next.focus);
}

/**
 * 工作区 (design 039): the conversation columns show `agents` side by side (a remembered workspace coming back, a pinned
 * group); the columns already showing one of them stay. Short of width for that many columns only `focus` shows
 * (the others stay one click away in the tray).
 */
export function showWorkspace(agents: readonly { hostId: string; sessionId: string }[], focus: { hostId: string; sessionId: string } | null): void {
  const { layout } = usePanes.getState();
  const fits = agents.length < 2 || roomForColumns(Math.min(agents.length, maxConversationColumns()));
  const list = fits ? agents : focus ? [focus] : agents.slice(0, 1);
  const next = showAgentsLayout(layout, list, focus, Date.now(), fits);
  if (next === layout) return;
  usePanes.setState({ layout: next, restore: null });
  selectPane(next, next.focus);
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

/**
 * The two columns' widths (flex-grow) a resize to `share` would store — nothing is stored (the column
 * divider shows them live while dragging and calls resizePaneColumns on release). Null: no such pair.
 */
export function previewPaneColumns(index: number, share: number): [number, number] | null {
  const next = resizeColumns(usePanes.getState().layout, index, share);
  const left = next.cols[index];
  const right = next.cols[index + 1];
  return left && right ? [left.w, right.w] : null;
}

/**
 * Any other change of the work area (step 4: the tray, maximise, a dropped conversation column): applied,
 * and when it moved the focused conversation (another pane, another agent, none) the selection follows.
 */
export function setPaneLayout(fn: (layout: PaneLayout) => PaneLayout): void {
  const { layout } = usePanes.getState();
  const next = fn(layout);
  if (next === layout) return;
  usePanes.setState({ layout: next, restore: null });
  const before = focusedConversation(layout);
  const after = focusedConversation(next);
  const a = before ? paneBinding(layout, before) : null;
  const b = after ? paneBinding(next, after) : null;
  if (before !== after || a?.hostId !== b?.hostId || a?.sessionId !== b?.sessionId) selectPane(next, after);
}
