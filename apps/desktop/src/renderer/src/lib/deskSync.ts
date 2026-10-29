// Desk windows, wiring (multi-window P1 + P3): main's desk events, the remembered desks on start, the hand-back
// of a closed desk's conversations to the main window, and — P3 — each desk's own layout and Shelves following the
// app (lib/paneStore, lib/sideLayoutStore per window), the active window and the one-copy routing
// (lib/windowRoute). Only with the 多窗口 setting on (lib/deskWindows; followDesksSetting).
import { bridge } from "../bridge";
import { useApp } from "../store";
import { appWindowAt, appWindowList, byRecency, onEveryAppWindow } from "./appWindowSet";
import { setOtherWindowDrop } from "./workspaces";
import { agentListed, dedupeAtStart, giveBackToMain, layoutAgents, moveToDesk, openInNewDesk, openInWindow, reopenDesks, takeRestoring } from "./deskActions";
import { installDeskGuards } from "./deskGuards";
import { zoomShortcut } from "./appearance";
import { deskGone, onDeskWindowEvent, openDesk, persistDesks, setDeskShownBy, useDesks, type DeskRecord } from "./deskStore";
import { desksEnabled } from "./deskWindows";
import { subscribeMultiWindow } from "./multiWindowPref";
import { readScope } from "./paneFile";
import { defaultLayout } from "./paneLayout";
import { openAgentBeside, paneScopeOf, seedWindowLayout, startPaneSync, usePanes } from "./paneStore";
import { startSideStore } from "./sideLayoutStore";
import { activateWindow, agentPlaces, readStoredActive, startWindowRoute, windowGone } from "./windowRoute";
import { dropWindowStores, forgetSelection, inWindow, recentWindows, useActiveWindow, windowKeyOf, type WindowKey } from "./windowScope";

let started = false;

/** A desk's own layout and Shelves follow the app while it is open (P3); returns the stop. */
function startDesk(record: DeskRecord, subscribeModules: (listener: () => void) => () => void, lastActive: WindowKey | null): () => void {
  const key = record.deskId;
  const host = useApp.getState().hosts?.active ?? "local";
  // A new desk (or a remembered one with no stored layout): one column with the conversation it opened with.
  if (record.content.kind === "conversation" && !readScope(paneScopeOf(host, key)).work) {
    seedWindowLayout(key, defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: record.content.hostId, sessionId: record.content.sessionId }));
  }
  const offPanes = startPaneSync(key);
  // A remembered desk back after a restart (its layout loaded just now): one copy per agent again (P3.5).
  if (takeRestoring(key)) dedupeAtStart(lastActive);
  const offSide = startSideStore(subscribeModules, key);
  return () => {
    offSide();
    offPanes();
    windowGone(key);
    dropWindowStores(key);
    forgetSelection(key);
  };
}

/**
 * App mounts this once (P6): desks start when the 多窗口 setting is on — at start, or the moment it is switched on
 * (the remembered desks come back then). Switching it off only takes the window menu items away (lib/menus,
 * ConversationHeader read desksEnabled): desks open now stay until closed, and the remembered ones stay stored
 * for the next start with it on. Returns the stop.
 */
export function followDesksSetting(subscribeModules?: (listener: () => void) => () => void): () => void {
  let stop: (() => void) | null = null;
  const check = () => {
    if (!stop && desksEnabled()) stop = startDesks(subscribeModules);
  };
  const off = subscribeMultiWindow(check);
  check();
  return () => {
    off();
    stop?.();
  };
}

/** Desks on (followDesksSetting); returns the stop. `subscribeModules`: the module registry's changes (Shelf restores). */
export function startDesks(subscribeModules: (listener: () => void) => () => void = () => () => {}): () => void {
  if (started || !desksEnabled() || !bridge?.window?.desk) return () => {};
  started = true;
  const off = bridge.on("deskWindow", (event) => onDeskWindowEvent(event, giveBackToMain));
  // Each desk document gets this document's guards (IME, selection scope, animation phase / rest, scrollbars).
  const offGuards = onEveryAppWindow(installDeskGuards);
  // Ctrl/Cmd + = / − / 0 in a desk too (the main window has its own, main.tsx); main zooms every app window alike.
  const offZoom = onEveryAppWindow((win) => {
    if (win === window) return () => {};
    const onKey = (e: KeyboardEvent) => {
      if (zoomShortcut(e)) e.preventDefault();
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  });
  // The window the owner was in last time (before this start's focus events overwrite it): it wins a restart's duplicates.
  const lastActive = readStoredActive();
  // P3: the active window and the one-copy routing; a desk's stored entry names its focused conversation.
  const offRoute = startWindowRoute();
  // A sidebar row (or any agent drag) released over another app window opens the agent there.
  setOtherWindowDrop((ref, from, x, y) => {
    if (ref.kind !== "agent") return false;
    const keyOfWin = (win: Window) => windowKeyOf(useDesks.getState().desks.find((d) => d.handle.win === win)?.deskId ?? null);
    const target = appWindowAt(byRecency(appWindowList(), keyOfWin, recentWindows()), x, y, from);
    if (!target) return false;
    const deskId = useDesks.getState().desks.find((d) => d.handle.win === target)?.deskId ?? null;
    openInWindow(windowKeyOf(deskId), ref.hostId, ref.key);
    return true;
  });
  setDeskShownBy((deskId) => (usePanes.windows().includes(deskId) ? (layoutAgents(usePanes.of(deskId).getState().layout)[0] ?? null) : null));
  // Each open desk's layout follows the app; a closed one's stops after its hand-back (deskGone gives back first).
  const running = new Map<string, () => void>();
  const syncDesks = () => {
    const desks = useDesks.getState().desks;
    for (const desk of desks) if (!running.has(desk.deskId)) running.set(desk.deskId, startDesk(desk, subscribeModules, lastActive));
    for (const [deskId, stop] of running) {
      if (desks.some((d) => d.deskId === deskId)) continue;
      running.delete(deskId);
      queueMicrotask(stop);
    }
  };
  syncDesks();
  const offDesks = useDesks.subscribe(syncDesks);
  // This document going away (reload, quit) takes its desks with it (main closes them): keep them remembered.
  const unload = () => {
    persistDesks();
    for (const desk of useDesks.getState().desks) deskGone(desk.deskId, () => {}, true);
  };
  window.addEventListener("pagehide", unload);
  // The remembered desks come back once the focus host's agent list is known.
  let reopened = false;
  const reopen = () => {
    if (reopened || !useApp.getState().sidebar) return;
    reopened = true;
    void reopenDesks(agentListed);
  };
  const offApp = useApp.subscribe(reopen);
  reopen();
  // A test hook while the feature is behind its setting (P0 / P1 / P3 checks over CDP).
  (window as unknown as { __cutexDesks?: unknown }).__cutexDesks = {
    openProbe: () => openDesk(bridge.window?.desk, { kind: "probe" }),
    move: (paneId: string) => moveToDesk(paneId),
    openConversation: (hostId: string, sessionId: string) => openInNewDesk(hostId, sessionId),
    openIn: (deskId: string | null, hostId: string, sessionId: string) => openInWindow(deskId ?? "main", hostId, sessionId),
    state: () => useDesks.getState().desks.map((d) => ({ deskId: d.deskId, content: d.content, agents: usePanes.windows().includes(d.deskId) ? layoutAgents(usePanes.of(d.deskId).getState().layout) : [] })),
    places: (hostId: string, sessionId: string) => agentPlaces(hostId, sessionId),
    beside: (deskId: string, hostId: string, sessionId: string) => inWindow(deskId, () => openAgentBeside(hostId, sessionId)),
    inDesk: (deskId: string, fn: () => unknown) => inWindow(deskId, fn),
    activate: (key: string) => activateWindow(key),
    active: () => useActiveWindow.getState().key,
    chips: () => usePanes.of("main").getState().layout.chips.length,
  };
  return () => {
    off();
    offGuards();
    offZoom();
    offRoute();
    setOtherWindowDrop(null);
    offDesks();
    offApp();
    for (const stop of running.values()) stop();
    running.clear();
    window.removeEventListener("pagehide", unload);
    started = false;
  };
}
