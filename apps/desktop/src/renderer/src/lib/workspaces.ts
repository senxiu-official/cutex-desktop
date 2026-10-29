// Workspaces (docs/desktop-modules.md §24.13; canvas principles §7, owner 2026-10-21; prototype
// .claude/preview-workspaces.html): a workspace = a conversation column + its own Shelf (lib/convShelves), one
// or two on screen. Three ways to see A and B together:
//   投影 project  — B as a live conversation pane in A's Shelf (B itself, not a copy; without B's Shelf)
//   并排 beside   — [A | A's Shelf] [B | B's Shelf]; short of width the Shelves fold to their rails once
//   替换 replace  — the whole workspace switches to B (B's Shelf); A's is remembered as it was
// Drag rules (sidebar rows, the Ctrl+B rail, ⌘K rows, the tray — `startWorkspaceDrag`): into a Shelf = project,
// the window's edge = beside, onto a conversation / a click = replace. Services, artifacts and pages always go
// into the target workspace's Shelf (the edge refuses them). ⌘K: Enter = replace, Ctrl/⌘+Enter = beside (a service /
// artifact / page: into the other workspace's Shelf, or with one workspace a new page of its Shelf — `besideShelfTarget`).
// 「—」 on a conversation closes its pane (the agent keeps running in cutex; no conversation chips any more).
//
// The API other parts call (the tray among them): `openRef(ref, mode)`, `startWorkspaceDrag(ref, event)`,
// `isOnScreen(ref)`. The decisions are pure (`dropOutcome`, `sidebarAutoRail`; the row's geometry: lib/workspaceRow); the drag's
// DOM part (probe, the overlay's state) is here too; components/WorkspaceDndLayer draws it. Shell code: names
// no feature (the projection is a well-known component id, lib/sideKinds).
import { create } from "zustand";
import type { PointerEvent as ReactPointerEvent } from "react";
import { translate } from "../i18n";
import { getLiveWidth } from "./appearance";
import { setSidebarRailToggleHook } from "./prefs";
import type { CutexRef } from "../modules/slots";
import type { ItemId } from "../modules/types";
import { sidebarOf, useApp } from "../store";
import { convKey } from "./convShelves";
import { CONVERSATION_MIN_W, conversationPanes, focusedConversation, isEmptyPane, maxConversationColumns, moveConversation, pageKind, paneBinding, paneShowing, type PaneLayout } from "./paneLayout";
import { closeConversationPane, focusConversationPane, openAgentBeside, setPaneLayout, usePanes } from "./paneStore";
import { refsOpen } from "./refServices";
import { PROJECTION_COMPONENT, type ProjectionParams } from "./sideKinds";
import { COLLAPSED_SHELF_WIDTH, CARD_GAP, RAIL_WIDTH, closeInstances, locate, moveToNewPage, pagesOnScreen, pagesOfShelf, shelfOfPage, MAX_SHELF_PAGES } from "./sideLayout";
import { liveConversation, updateLayout, useSide } from "./sideLayoutStore";
import { sideOpen } from "./sideServices";
import { openShelfPage } from "./shelves";
import { useFullscreen } from "./panelFull";
import { foldHeld } from "./foldHysteresis";
import { closeOpen } from "./trayOpen";
import { trayNextAfterClose } from "./trayPins";
import { holdTrayPlace } from "./trayRoom";
import { isElement, ownerWindowOf } from "./ownerWindow";
import { appWindowOfKey, onEveryAppWindow } from "./appWindowSet";
import { useDesks } from "./deskStore";
import { currentWindow, useWindowKey, windowKeyOf, windowStore, type WindowKey } from "./windowScope";

// ── Refs ─────────────────────────────────────────────────────────────────────────────────────────

export type WorkspaceRefKind = "agent" | "service" | "artifact" | "page";

/**
 * What can be opened into a workspace: an agent (`key` = its session id), a service (`key` = its slug), an
 * artifact (`key` = its ref), a page (`key` = a Shelf page id `p<n>`, or a page item id).
 */
export interface WorkspaceRef {
  kind: WorkspaceRefKind;
  hostId: string;
  key: string;
  /** Shown while dragging (an agent's name is looked up when absent). */
  title?: string;
}

export type WorkspaceOpenMode = "replace" | "beside" | "project";

// ── The screen (pure inputs) ─────────────────────────────────────────────────────────────────────

/** The conversation panes on screen, left → right, with their agents, and the focused one. */
export interface WsScreen {
  panes: { paneId: string; hostId: string; sessionId: string | null }[];
  focused: string | null;
}

export function screenOf(layout: PaneLayout): WsScreen {
  return {
    panes: conversationPanes(layout).map((paneId) => {
      const b = paneBinding(layout, paneId)!;
      return { paneId, hostId: b.hostId, sessionId: b.sessionId };
    }),
    focused: focusedConversation(layout),
  };
}

/** Where a drag is over: the window's left / right edge, a workspace's Shelf, a workspace's conversation. */
export type WsTarget = { kind: "edge"; side: "left" | "right" } | { kind: "shelf"; paneId: string } | { kind: "conversation"; paneId: string };

/** What dropping there does. */
export type WsOutcome =
  | { kind: "project"; paneId: string }
  | { kind: "into-shelf"; paneId: string }
  | { kind: "beside"; side: "left" | "right"; replaces: string | null }
  | { kind: "replace"; paneId: string }
  | { kind: "refuse"; reason: "edge-not-agent" | "on-screen" | "same" | "own-shelf" | "shown-other"; focus?: string };

const isAgentRef = (ref: Pick<WorkspaceRef, "kind">) => ref.kind === "agent";

/**
 * The drop rules (canvas principles §7): a Shelf = project (services / artifacts / pages: into that Shelf; an
 * agent into its own Shelf: refused); the edge = beside (not for services / artifacts / pages; an agent on
 * screen in the only workspace: refused; two workspaces: the one on that side shows it — refused when it is
 * that one already); a conversation = replace (the same agent: refused; shown in the other workspace:
 * refused, the drop focuses it there). Pure.
 */
export function dropOutcome(ref: Pick<WorkspaceRef, "kind" | "hostId" | "key">, target: WsTarget, screen: WsScreen): WsOutcome {
  const agent = isAgentRef(ref);
  const shows = (p: WsScreen["panes"][number] | undefined) => !!p && p.hostId === ref.hostId && p.sessionId === ref.key;
  const onScreen = screen.panes.find(shows);
  if (target.kind === "edge") {
    if (!agent) return { kind: "refuse", reason: "edge-not-agent" };
    if (screen.panes.length < 2) {
      if (onScreen) return { kind: "refuse", reason: "on-screen", focus: onScreen.paneId };
      return { kind: "beside", side: target.side, replaces: null };
    }
    const there = target.side === "left" ? screen.panes[0] : screen.panes[screen.panes.length - 1];
    if (shows(there)) return { kind: "refuse", reason: "on-screen", focus: there!.paneId };
    return { kind: "beside", side: target.side, replaces: there?.paneId ?? null };
  }
  const pane = screen.panes.find((p) => p.paneId === target.paneId);
  if (!pane) return { kind: "refuse", reason: "same" };
  if (!agent) return { kind: "into-shelf", paneId: pane.paneId };
  // A workspace showing nothing (the desktop): it takes the agent.
  if (!pane.sessionId) return { kind: "replace", paneId: pane.paneId };
  if (target.kind === "shelf") return shows(pane) ? { kind: "refuse", reason: "own-shelf" } : { kind: "project", paneId: pane.paneId };
  if (shows(pane)) return { kind: "refuse", reason: "same" };
  if (onScreen) return { kind: "refuse", reason: "shown-other", focus: onScreen.paneId };
  return { kind: "replace", paneId: pane.paneId };
}

/**
 * Where 「beside」 puts a service / artifact / page (canvas principles §7: they always go into a Shelf): two
 * workspaces = the other one's Shelf (a page: the other workspace); one = a new page of the focused
 * workspace's Shelf instead of a tab on its page in view. `paneId`: the workspace it is beside (default the
 * focused one). Pure.
 */
export function besideShelfTarget(screen: WsScreen, paneId?: string): { kind: "other"; paneId: string } | { kind: "new-page"; paneId: string | null } {
  const from = paneId && screen.panes.some((p) => p.paneId === paneId) ? paneId : screen.focused;
  const other = screen.panes.length >= 2 ? screen.panes.find((p) => p.paneId !== from) : undefined;
  return other ? { kind: "other", paneId: other.paneId } : { kind: "new-page", paneId: from };
}

// ── Geometry (pure) ──────────────────────────────────────────────────────────────────────────────

/** A conversation beside another with its Shelf expanded in tight space keeps this much (prototype). */
export const WS_CONVERSATION_MIN_W = 300;
/** The expanded Shelf of a workspace in tight space: this wide (prototype 230–360 px, its rail not counted). */
export const WS_SHELF_TIGHT = { min: 230, max: 360 } as const;

/**
 * The sidebar (full width `sidebarWidth`) drops to its rail while two workspaces would not fit beside it; `was`:
 * it is railed so now — it comes back only with lib/foldHysteresis's slack more (no flapping while the window is
 * resized across the threshold). `tray`: the tray's band beside the row (docked left / right; ChipTray
 * TrayFrame) — the sidebar and the row share only what it leaves. Pure.
 */
export function sidebarAutoRail(input: { workspaces: number; windowWidth: number; sidebarWidth: number; tray?: number; was?: boolean }): boolean {
  if (input.workspaces < 2) return false;
  const need = sidebarNeed(input.sidebarWidth);
  return foldHeld((slack) => input.windowWidth - Math.max(0, input.tray ?? 0) < need + slack, !!input.was);
}

/**
 * The widest the sidebar can be dragged beside two workspaces without dropping to its automatic rail (`sidebarAutoRail`):
 * past it the release folded the sidebar to 72 px and both columns jumped (fuzz 2026-10-23). Infinity: one workspace,
 * or the sidebar is kept expanded / railed already. Pure.
 */
export function sidebarDragMax(input: { workspaces: number; windowWidth: number; tray?: number }): number {
  if (input.workspaces < 2) return Number.POSITIVE_INFINITY;
  return input.windowWidth - Math.max(0, input.tray ?? 0) - sidebarNeed(0);
}

/** What two workspaces need beside a sidebar of `sidebarWidth` before it drops to its rail. */
const sidebarNeed = (sidebarWidth: number): number => sidebarWidth + 2 * CONVERSATION_MIN_W + 2 * COLLAPSED_SHELF_WIDTH + WS_SHELF_TIGHT.min + RAIL_WIDTH + 3 * CARD_GAP;

/** sidebarDragMax for the window as it is now (the Settings Shelf's reserve, the tray's band). */
export function sidebarDragMaxNow(): number {
  const ui = useWsUi.getState();
  if (ui.sidebarKept) return Number.POSITIVE_INFINITY;
  return sidebarDragMax({ workspaces: conversationPanes(usePanes.getState().layout).length, windowWidth: ui.windowWidth - (ui.reserved ?? 0), tray: ui.tray ?? 0 });
}

/** The sidebar's automatic rail as last shown in each window (its hysteresis; the hook below keeps it). */
const autoRailedIn = new Map<WindowKey, boolean>();
const autoRailedNow = (): boolean => autoRailedIn.get(currentWindow()) ?? false;

// ── The sidebar's automatic rail (two workspaces short of width) ──────────────────────────────────

interface WsUi {
  windowWidth: number;
  /** Width taken beside the work row by the window itself (the Settings Shelf, lib/settingsShelf); 0 = none. */
  reserved?: number;
  /** The tray's band beside the row (docked or its handle at the left / right edge; ChipTray TrayFrame); 0 = none / top / bottom. */
  tray?: number;
  /** The owner expanded the sidebar while it was railed automatically (until one workspace is left). */
  sidebarKept: boolean;
}

/** Per app window (multi-window P3, lib/windowScope): each window's own width and sidebar choice. */
export const useWsUi = windowStore((key) => create<WsUi>(() => ({ windowWidth: typeof window === "undefined" ? 1600 : (appWindowOfKey(key)?.innerWidth ?? 1600), sidebarKept: false })));


// Whether the window's width changed in the current task (cleared after it): the sidebar's rail switched by a width
// change renders in that same task, so components/Sidebar tells it from the owner's switch (which eases) without
// re-rendering on every step of a window resize (perf audit 2026-10-23 #28).
let widthChanging = false;
useWsUi.subscribe((s, prev) => {
  if (s.windowWidth === prev.windowWidth || widthChanging) return;
  widthChanging = true;
  setTimeout(() => (widthChanging = false), 0);
});
/** The window's width changed in this task (lib/workspaces useWsUi). */
export const windowWidthChanging = (): boolean => widthChanging;

let watching = false;
export function watchWindow(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  // Each app window's width is its own (multi-window P3).
  onEveryAppWindow((win) => {
    const key = windowKeyOf(useDesks.getState().desks.find((d) => d.handle.win === win)?.deskId ?? null);
    const resized = () => useWsUi.of(key).setState({ windowWidth: win.innerWidth });
    resized();
    win.addEventListener("resize", resized);
    return () => win.removeEventListener("resize", resized);
  });
  usePanes.subscribe((s, prev) => {
    if (conversationPanes(s.layout).length < 2 && conversationPanes(prev.layout).length >= 2 && useWsUi.getState().sidebarKept) useWsUi.setState({ sidebarKept: false });
  });
}

/** The window's width the work row does not get (components/SettingsShelf while it is beside it). */
export function setReservedWidth(px: number): void {
  if ((useWsUi.getState().reserved ?? 0) !== px) useWsUi.setState({ reserved: px });
}

/** The tray's band beside the row (ChipTray TrayFrame: its width when docked left / right, else 0). */
export function setTrayBandWidth(px: number): void {
  if ((useWsUi.getState().tray ?? 0) !== px) useWsUi.setState({ tray: px });
}

/** Whether the sidebar is collapsed (hidden, owner 2026-10-28): the owner's choice, automatically with two workspaces short of width, or a panel in full screen (§24.16). */
export function useSidebarRail(prefRail: boolean, sidebarWidth: number = getLiveWidth("sidebarWidth")): boolean {
  watchWindow();
  const key = useWindowKey();
  const autoRailed = autoRailedIn.get(key) ?? false;
  const full = useFullscreen();
  const workspaces = usePanes((s) => conversationPanes(s.layout).length);
  // The answer from the store, not the width: the sidebar renders when it switches, not per step of a window resize.
  const auto = useWsUi((s) => sidebarAutoRail({ workspaces, windowWidth: s.windowWidth - (s.reserved ?? 0), sidebarWidth, tray: s.tray ?? 0, was: autoRailed }));
  const kept = useWsUi((s) => s.sidebarKept);
  autoRailedIn.set(key, auto);
  return prefRail || full || (!kept && auto);
}

/**
 * Ctrl/⌘+B or 展开侧栏 while the sidebar is railed only because two workspaces are short of width: the
 * sidebar expands (kept until one workspace is left) instead of turning the owner's rail setting on. True:
 * handled (the setting stays). `sidebarWidth`: the full sidebar's width.
 */
export function toggleAutoRail(prefRail: boolean, sidebarWidth: number = getLiveWidth("sidebarWidth")): boolean {
  if (prefRail) return false;
  const workspaces = conversationPanes(usePanes.getState().layout).length;
  const ui = useWsUi.getState();
  if (!sidebarAutoRail({ workspaces, windowWidth: ui.windowWidth - (ui.reserved ?? 0), sidebarWidth, tray: ui.tray ?? 0, was: autoRailedNow() })) return false;
  useWsUi.setState({ sidebarKept: !ui.sidebarKept });
  return true;
}

// Ctrl/⌘+B and 展开侧栏 go through prefs toggleSidebarRail: while the rail is automatic they expand the sidebar.
setSidebarRailToggleHook((prefRail) => toggleAutoRail(prefRail));

// ── Opening ─────────────────────────────────────────────────────────────────────────────────────

/** The pane to act on: the given one when on screen, else the focused conversation pane. */
function paneOrFocused(paneId: string | undefined): string | null {
  const layout = usePanes.getState().layout;
  if (paneId && conversationPanes(layout).includes(paneId)) return paneId;
  return focusedConversation(layout);
}

/** Makes `paneId` the focused workspace (its Shelf becomes the live one, lib/sideLayoutStore). */
function focusWorkspace(paneId: string | null): void {
  if (paneId) focusConversationPane(paneId);
}

/** Replace: the workspace (`paneId`, default the focused one) shows the agent; already on screen = focus it there. */
export function replaceWith(hostId: string, sessionId: string, paneId?: string): void {
  const layout = usePanes.getState().layout;
  const at = paneShowing(layout, hostId, sessionId);
  if (at) {
    focusWorkspace(at);
    return;
  }
  focusWorkspace(paneOrFocused(paneId));
  void useApp.getState().openAgent(sessionId, hostId);
}

/** Beside: a second workspace on that side (two on screen: the one on that side shows the agent). */
export function openBesideAt(hostId: string, sessionId: string, side: "left" | "right" = "right"): void {
  const layout = usePanes.getState().layout;
  if (paneShowing(layout, hostId, sessionId)) return replaceWith(hostId, sessionId);
  const panes = conversationPanes(layout);
  if (panes.length >= maxConversationColumns()) {
    replaceWith(hostId, sessionId, side === "left" ? panes[0] : panes[panes.length - 1]);
    return;
  }
  // The only pane shows nothing (the desktop): it takes the agent.
  if (panes.length === 1 && isEmptyPane(layout, panes[0]!)) return replaceWith(hostId, sessionId, panes[0]);
  // Short of width the Shelves fold once, when the row sees the second workspace (components/side/SideArea,
  // lib/workspaceRow shouldFoldShelves) — measured with both workspaces' Shelves as they are.
  openAgentBeside(hostId, sessionId);
  const after = usePanes.getState().layout;
  const opened = paneShowing(after, hostId, sessionId);
  if (side === "left" && opened) setPaneLayout((l) => moveConversation(l, opened, { edge: "left" }));
}

/** Project: the agent as a live conversation pane in the workspace's Shelf (default the focused one). False: refused. */
export function projectInto(hostId: string, sessionId: string, paneId?: string): boolean {
  const target = paneOrFocused(paneId);
  const layout = usePanes.getState().layout;
  const b = target ? paneBinding(layout, target) : null;
  if (b?.sessionId === sessionId && b.hostId === hostId) return false;
  focusWorkspace(target);
  const params: ProjectionParams = { hostId, sessionId };
  const result = sideOpen(PROJECTION_COMPONENT, params, { reveal: true, focus: true });
  if (result.status !== "opened") {
    useApp.getState().notify(translate("ws.projectFailed"), "info");
    return false;
  }
  return true;
}

/** The projection's 「投影 · 在旁边打开」: the projected agent becomes the workspace beside; the projection goes. */
export function promoteProjection(instanceId: string, hostId: string, sessionId: string): void {
  // Closed in this Shelf first (synchronously: the open below makes another conversation's Shelf the live one).
  updateLayout((l) => closeInstances(l, [instanceId].filter((id) => l.instances[id])));
  openBesideAt(hostId, sessionId, "right");
}

/** Why an open did not happen (a refs reason: `gone`, `host-offline`, `stale`, …); null = it opened. */
export type OpenRefFailure = string | null;

/** A service / artifact / page into the workspace's Shelf (default the focused one); `pageParams`: a page item's params. */
async function openIntoShelf(ref: WorkspaceRef, paneId?: string, pageParams: Record<string, string> = {}): Promise<OpenRefFailure> {
  focusWorkspace(paneOrFocused(paneId));
  if (ref.kind === "page") {
    if (/^p\d+$/.test(ref.key)) return openShelfPage(ref.key) ? null : "gone";
    if (!/^[^.]+\..+$/.test(ref.key)) return "bad-ref";
    useApp.getState().openPage(ref.key as ItemId, pageParams);
    return null;
  }
  const r = await refsOpen({ hostId: ref.hostId, kind: ref.kind, key: ref.key, title: ref.title ?? ref.key, params: {} } as CutexRef, { how: "page" });
  return r.status === "opened" ? null : r.status === "stale" ? "stale" : r.reason;
}

/**
 * A service / artifact into a new page of the workspace's Shelf: opened the usual way (a tab where its kind
 * goes, or the one already open), then — when it shares its page with other panes / tabs — moved to a new
 * page at the end of that Shelf, in view. The kind's remembered page stays as it was (this is a one-off, not
 * a move by hand). A Shelf with 9 pages: it stays a tab (a toast says why). Opened outside the Shelf (the
 * system browser): nothing to move.
 */
async function openIntoNewPage(ref: WorkspaceRef, paneId: string | null): Promise<OpenRefFailure> {
  focusWorkspace(paneId);
  const before = useSide.getState().layout;
  const seen = new Map(Object.entries(before.instances).map(([id, inst]) => [id, inst.lastActiveAt]));
  const failed = await openIntoShelf(ref, paneId ?? undefined);
  if (failed) return failed;
  const after = useSide.getState().layout;
  // The instance the open placed or revealed: a new one, else the one it touched.
  const ids = Object.keys(after.instances);
  const id = ids.find((x) => !seen.has(x)) ?? ids.find((x) => after.instances[x]!.lastActiveAt !== seen.get(x)) ?? null;
  const at = id ? locate(after, id) : null;
  const shelf = at ? shelfOfPage(after, at.page.id) : null;
  if (!id || !at || !shelf || (at.page.cards.length === 1 && at.card.tabs.length === 1)) return null;
  if (pagesOfShelf(after, shelf.id).length >= MAX_SHELF_PAGES) {
    useApp.getState().notify(translate("shelf.toast.pagesFull"), "info");
    return null;
  }
  updateLayout((l) => {
    const next = moveToNewPage(l, { instance: id }, shelf.id, Date.now());
    return next === l ? l : { ...next, overrides: l.overrides };
  });
  return null;
}

/**
 * Opens a ref in a workspace (the API of §24.13; `paneId`: the workspace, default the focused one). An agent:
 * replace / beside / project. A service, artifact or page goes into a Shelf in every mode: replace / project =
 * the workspace's; beside = `besideShelfTarget` (the other workspace's Shelf, or a new page of this one's —
 * a page item has no Shelf page of its own: with one workspace it opens as with replace). `pageParams`: a page
 * item's params. Resolves false when nothing opened.
 */
export async function openRef(ref: WorkspaceRef, mode: WorkspaceOpenMode, opts: { paneId?: string; side?: "left" | "right"; pageParams?: Record<string, string> } = {}): Promise<boolean> {
  return (await openRefWhy(ref, mode, opts)) === null;
}

/** openRef with the reason a service / artifact / page did not open (a tray click says why; null = opened). */
export async function openRefWhy(ref: WorkspaceRef, mode: WorkspaceOpenMode, opts: { paneId?: string; side?: "left" | "right"; pageParams?: Record<string, string> } = {}): Promise<OpenRefFailure> {
  if (!isAgentRef(ref)) {
    if (mode !== "beside") return openIntoShelf(ref, opts.paneId, opts.pageParams);
    const target = besideShelfTarget(screenOf(usePanes.getState().layout), opts.paneId);
    if (target.kind === "other") return openIntoShelf(ref, target.paneId, opts.pageParams);
    if (ref.kind === "page") return openIntoShelf(ref, target.paneId ?? undefined, opts.pageParams);
    return openIntoNewPage(ref, target.paneId);
  }
  if (mode === "beside") openBesideAt(ref.hostId, ref.key, opts.side ?? "right");
  else if (mode === "project") return projectInto(ref.hostId, ref.key, opts.paneId) ? null : "unavailable";
  else replaceWith(ref.hostId, ref.key, opts.paneId);
  return null;
}

/**
 * On screen: an agent in a workspace or projected in a Shelf page in view; a service / artifact / page in a
 * Shelf page in view of the focused workspace (its pane's ref, or a Shelf page id itself).
 */
export function isOnScreen(ref: WorkspaceRef): boolean {
  const layout = usePanes.getState().layout;
  if (isAgentRef(ref) && paneShowing(layout, ref.hostId, ref.key)) return true;
  const side = useSide.getState().layout;
  if (!side.open) return false;
  const pages = pagesOnScreen(side);
  if (ref.kind === "page" && pages.some((p) => p.id === ref.key)) return true;
  const shown = new Set(pages.flatMap((p) => p.cards.flatMap((c) => (c.active ? [c.active] : []))));
  for (const id of shown) {
    const inst = side.instances[id];
    if (!inst || typeof inst.state !== "object" || inst.state === null || Array.isArray(inst.state)) continue;
    // A page item open as its own pane (§24.4: `page:<id>`).
    if (ref.kind === "page" && inst.kind === pageKind(ref.key)) return true;
    const st = inst.state as Record<string, unknown>;
    if (isAgentRef(ref) && inst.kind === PROJECTION_COMPONENT && st.sessionId === ref.key && st.hostId === ref.hostId) return true;
    if (!isAgentRef(ref) && Object.values(st).some((v) => typeof v === "string" && (v === ref.key || v.includes(`/${ref.key}/`)))) return true;
  }
  return false;
}

/**
 * 「—」 on a conversation pane (owner 2026-10-21): the pane closes — its agent keeps running in cutex and its
 * workspace (Shelf) is remembered. The last one leaves the empty pane: the desktop shows.
 * `closing` (a close, not a minimise: the agents that leave): the last one's place goes to the tray's next entry
 * instead (owner 2026-10-23, like a browser closing its active tab; lib/trayPins nextAfterClose); none: the desktop.
 */
export function closeWorkspace(paneId: string, closing?: readonly { hostId: string; sessionId: string }[]): void {
  const layout = usePanes.getState().layout;
  const panes = conversationPanes(layout);
  if (!panes.includes(paneId)) return;
  if (panes.length > 1) {
    closeConversationPane(paneId);
    return;
  }
  const b = paneBinding(layout, paneId);
  if (!b?.sessionId) return;
  if (closing) {
    const gone = closing.length ? closing : [{ hostId: b.hostId, sessionId: b.sessionId }];
    const next = trayNextAfterClose(gone);
    if (next) {
      next.open();
      // Closed, not replaced: not an open item in the tray.
      for (const a of gone) closeOpen(a);
      return;
    }
  }
  // The only workspace: no agent focused; the desktop layer takes the pane (lib/paneDesk "empty"). The tray card
  // stays where it was (it does not fly to the desktop's middle).
  holdTrayPlace();
  useApp.setState({ selectedId: null, selectedHost: null });
}

// ── Drag ────────────────────────────────────────────────────────────────────────────────────────

export interface WsBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type WsTone = "project" | "beside" | "replace" | "refuse";

export interface WsDragState {
  ref: WorkspaceRef | null;
  title: string;
  x: number;
  y: number;
  outcome: WsOutcome | null;
  zone: WsBox | null;
  tone: WsTone | null;
  label: string;
  sub: string | null;
  /** The ghost's action word (投影 / 并排 / 替换 / 放进 Shelf / 不可放). */
  action: string;
  /** The window the drag runs in when it is a desk window (multi-window; its layer draws there). */
  doc?: Document;
}

const IDLE: WsDragState = { ref: null, title: "", x: 0, y: 0, outcome: null, zone: null, tone: null, label: "", sub: null, action: "" };

export const useWorkspaceDrag = create<WsDragState>(() => IDLE);

/** Pointer travel (px) before a press becomes a drag (shorter stays a click). */
export const WS_DRAG_THRESHOLD = 6;
/** The work area's left / right edge band that takes a beside drop (prototype 58 px). */
export const WS_EDGE = 58;
/** A workspace without a Shelf on screen: the right part of its conversation stands for it. */
export const WS_SHELF_STRIP = 0.22;

const nameOf = (hostId: string, sessionId: string | null): string => {
  if (!sessionId) return "";
  const sidebar = sidebarOf(useApp.getState(), hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === sessionId)?.displayName ?? sessionId;
};

const titleOf = (ref: WorkspaceRef): string => ref.title ?? (isAgentRef(ref) ? nameOf(ref.hostId, ref.key) : ref.key);

/** The words of an outcome (the zone's label and second line, the ghost's action). */
export function outcomeText(ref: WorkspaceRef, outcome: WsOutcome | null, screen: WsScreen): { tone: WsTone | null; label: string; sub: string | null; action: string } {
  const t = translate;
  const who = (paneId: string | null | undefined) => {
    const p = screen.panes.find((x) => x.paneId === paneId);
    return p ? nameOf(p.hostId, p.sessionId) || t("ws.nobody") : "";
  };
  const name = titleOf(ref);
  if (!outcome) return { tone: null, label: "", sub: null, action: t("ws.action.cancel") };
  switch (outcome.kind) {
    // The sentences and colours of 动作预告 (docs/design/008): the result, not the action's name.
    case "project":
      return { tone: "project", label: t("foretell.dropShelf", { name: who(outcome.paneId) }), sub: t("ws.drop.projectSub", { name }), action: t("ws.action.project") };
    case "into-shelf":
      return { tone: "project", label: t("foretell.dropShelf", { name: who(outcome.paneId) }), sub: null, action: t("ws.action.intoShelf") };
    case "beside": {
      const sub = outcome.replaces ? t(outcome.side === "left" ? "ws.drop.besideReplacesLeft" : "ws.drop.besideReplacesRight", { name: who(outcome.replaces) }) : t("ws.drop.besideSub");
      return { tone: "beside", label: t("foretell.dropBeside"), sub, action: t("ws.action.beside") };
    }
    case "replace": {
      // A workspace showing nothing (the desktop) takes it: nothing leaves the screen — blue.
      const pane = screen.panes.find((x) => x.paneId === outcome.paneId);
      if (!pane?.sessionId) return { tone: "project", label: t("foretell.dropDesktop"), sub: null, action: t("ws.action.replace") };
      return { tone: "replace", label: t("foretell.dropReplace", { name: who(outcome.paneId) }), sub: null, action: t("ws.action.replace") };
    }
    case "refuse": {
      const key = { "edge-not-agent": "ws.refuse.edge", "on-screen": "ws.refuse.onScreen", same: "ws.refuse.same", "own-shelf": "ws.refuse.ownShelf", "shown-other": "ws.refuse.shownOther" } as const;
      return { tone: "refuse", label: t(key[outcome.reason], { name }), sub: outcome.reason === "edge-not-agent" ? t("ws.refuse.edgeSub") : null, action: t("ws.action.refuse") };
    }
  }
}

const rectOf = (el: Element): WsBox => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** What lies under the pointer (the overlay and the shield skipped), as a target with the box to light up. */
export function probe(x: number, y: number, doc?: Document): { target: WsTarget; zone: WsBox } | null {
  if (typeof document === "undefined") return null;
  // The drag's window (multi-window); the tray's own probe is the main window's.
  doc ??= document;
  const layout = usePanes.getState().layout;
  const focused = focusedConversation(layout);
  // A surface that takes no drops (the Settings Shelf, `data-no-drop`) is in front: nothing there, not even the edge band under it.
  if (doc.elementsFromPoint(x, y).find((el) => !el.closest("[data-ws-dnd], [data-side-dnd]"))?.closest("[data-no-drop]")) return null;
  const work = doc.querySelector<HTMLElement>("[data-side-work]");
  if (work) {
    const r = rectOf(work);
    if (y >= r.top && y <= r.top + r.height) {
      const half = (left: number) => ({ left, top: r.top, width: r.width / 2 - 4, height: r.height });
      if (x >= r.left - 12 && x < r.left + WS_EDGE) return { target: { kind: "edge", side: "left" }, zone: half(r.left) };
      if (x > r.left + r.width - WS_EDGE && x <= r.left + r.width + 12) return { target: { kind: "edge", side: "right" }, zone: half(r.left + r.width / 2 + 4) };
    }
  }
  const els = doc.elementsFromPoint(x, y).filter((el) => !el.closest("[data-ws-dnd], [data-side-dnd]"));
  for (const el of els) {
    const rail = el.closest<HTMLElement>("[data-ws-shelf]");
    if (rail?.dataset.wsShelf) return { target: { kind: "shelf", paneId: rail.dataset.wsShelf }, zone: rectOf(rail) };
    const live = el.closest<HTMLElement>("[data-shelf-box], [data-side-box]") ?? (el.closest("[data-side-card-of]") ? doc.querySelector<HTMLElement>("[data-side-box]") : null);
    if (live && focused) return { target: { kind: "shelf", paneId: focused }, zone: rectOf(live) };
    const conv = el.closest<HTMLElement>("[data-conv-pane]");
    const paneId = conv?.dataset.convPane ?? (el.closest('[data-conv-single], [data-focus-region="main"], [data-pane-desktop]') ? focused : null);
    if (paneId) {
      const box = rectOf(conv ?? el.closest('[data-focus-region="main"]') ?? el);
      // No Shelf of that workspace on screen: the conversation's right part stands for it.
      // (The other workspace's live Shelf boxes are `data-ws-shelf` too: not the focused one's.)
      const hasShelf = paneId === focused ? !!doc.querySelector("[data-shelf-box]:not([data-ws-shelf]), [data-side-box]") : !!doc.querySelector(`[data-ws-shelf="${CSS.escape(paneId)}"]`);
      if (!hasShelf && x > box.left + box.width * (1 - WS_SHELF_STRIP)) {
        const w = box.width * WS_SHELF_STRIP;
        return { target: { kind: "shelf", paneId }, zone: { left: box.left + box.width - w, top: box.top, width: w, height: box.height } };
      }
      return { target: { kind: "conversation", paneId }, zone: box };
    }
  }
  return null;
}

/** Applies a drop (the outcome of `dropOutcome`). A refusal that names a workspace focuses it. */
export function applyDrop(ref: WorkspaceRef, outcome: WsOutcome): void {
  switch (outcome.kind) {
    case "project":
      projectInto(ref.hostId, ref.key, outcome.paneId);
      return;
    case "into-shelf":
      void openIntoShelf(ref, outcome.paneId);
      return;
    case "beside":
      openBesideAt(ref.hostId, ref.key, outcome.side);
      return;
    case "replace":
      replaceWith(ref.hostId, ref.key, outcome.paneId);
      return;
    case "refuse":
      if (outcome.focus) focusWorkspace(outcome.focus);
  }
}

let suppressClickUntil = 0;
/** The windows guarding clicks already (the drag's window: a desk window too, multi-window). */
const clickGuards = new WeakSet<Window>();
function guardClicks(view: Window): void {
  if (clickGuards.has(view)) return;
  clickGuards.add(view);
  // A press that became a drag must not also click (open) its source when released.
  view.addEventListener(
    "click",
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickUntil = 0;
      }
    },
    true,
  );
}

/** The drag running now (null: none). */
export const workspaceDragging = (): boolean => useWorkspaceDrag.getState().ref !== null;

/**
 * A drop target of the drag's own source (the tray reordering its pinned items, owner 2026-10-24): where it answers,
 * the workspace outcomes are off. `over`: `take` "drop" = it takes a release here, "refuse" = its area but no drop (a
 * release cancels), `action` = the ghost's word; null = not its area (the workspace targets as usual). `end` runs
 * whenever the drag ends (after `drop`).
 */
export interface WorkspaceDragLocal {
  /** `doc`: the drag's document (a desk window's, multi-window; default: the main one). */
  over(x: number, y: number, doc?: Document): { take: "drop" | "refuse"; action: string } | null;
  drop(): void;
  end(): void;
}

/**
 * A press on something that can open into a workspace (a sidebar row, a rail avatar, a ⌘K row, a tray icon):
 * past WS_DRAG_THRESHOLD it becomes a drag — the overlay lights up the target with what a drop does
 * (投影到 X 的 Shelf / 并排打开 / 替换 / refused), Esc cancels, the release applies it. A shorter press stays
 * the source's own click. Only the primary button.
 */
/**
 * Multi-window P3 (lib/deskSync): an agent row released outside its own window, over another app window — the agent
 * opens there (one copy: it moves). True = taken.
 */
let otherWindowDrop: ((ref: WorkspaceRef, from: Window, screenX: number, screenY: number) => boolean) | null = null;
export function setOtherWindowDrop(drop: typeof otherWindowDrop): void {
  otherWindowDrop = drop;
}

export function startWorkspaceDrag(ref: WorkspaceRef, event: PointerEvent | ReactPointerEvent, opts: { onStart?(): void; local?: WorkspaceDragLocal } = {}): void {
  if (typeof window === "undefined" || event.button !== 0 || workspaceDragging()) return;
  if (isElement(event.target) && event.target.closest("input, textarea, [contenteditable=true], [data-ws-nodrag]")) return;
  // The window it starts in (a desk window's row / chip, multi-window): its pointer, keys and layer.
  const win = ownerWindowOf(event.target);
  const doc = win.document;
  guardClicks(win);
  const x0 = event.clientX;
  const y0 = event.clientY;
  let active = false;
  let local: "drop" | "refuse" | null = null;
  const update = (x: number, y: number) => {
    const here = opts.local?.over(x, y, doc) ?? null;
    local = here?.take ?? null;
    if (here) {
      useWorkspaceDrag.setState({ x, y, outcome: null, zone: null, tone: here.take === "drop" ? "project" : "refuse", label: "", sub: null, action: here.action });
      return;
    }
    const hit = probe(x, y, doc);
    const screen = screenOf(usePanes.getState().layout);
    const outcome = hit ? dropOutcome(ref, hit.target, screen) : null;
    const text = outcomeText(ref, outcome, screen);
    useWorkspaceDrag.setState({ x, y, outcome, zone: hit?.zone ?? null, ...text });
  };
  const end = () => {
    win.removeEventListener("pointermove", move, true);
    win.removeEventListener("pointerup", up, true);
    win.removeEventListener("keydown", key, true);
    win.removeEventListener("blur", cancel);
    if (typeof document !== "undefined") delete doc.documentElement.dataset.wsDragging;
  };
  const cancel = () => {
    end();
    if (active) {
      useWorkspaceDrag.setState(IDLE);
      opts.local?.end();
    }
  };
  const move = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < WS_DRAG_THRESHOLD) return;
      active = true;
      opts.onStart?.();
      doc.documentElement.dataset.wsDragging = "";
      useWorkspaceDrag.setState({ ...IDLE, ref, title: titleOf(ref), doc: doc === document ? undefined : doc });
    }
    e.preventDefault();
    update(e.clientX, e.clientY);
  };
  const up = (e: PointerEvent) => {
    end();
    if (!active) return;
    suppressClickUntil = Date.now() + 400;
    // Outside this window, over another app window: it opens there.
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX >= win.innerWidth || e.clientY >= win.innerHeight;
    if (outside && otherWindowDrop?.(ref, win, e.screenX, e.screenY)) {
      useWorkspaceDrag.setState(IDLE);
      opts.local?.end();
      return;
    }
    update(e.clientX, e.clientY);
    const { outcome } = useWorkspaceDrag.getState();
    useWorkspaceDrag.setState(IDLE);
    if (local === "drop") opts.local?.drop();
    else if (!local && outcome) applyDrop(ref, outcome);
    opts.local?.end();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !active) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickUntil = Date.now() + 400;
    cancel();
  };
  win.addEventListener("pointermove", move, true);
  win.addEventListener("pointerup", up, true);
  win.addEventListener("keydown", key, true);
  win.addEventListener("blur", cancel);
}

/** The live Shelf belongs to this conversation (`convKey`; the workspace with the focus). */
export const shelfIsLive = (hostId: string, sessionId: string): boolean => liveConversation() === convKey(hostId, sessionId);
