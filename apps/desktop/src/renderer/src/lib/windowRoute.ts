// Which window an agent is open in, and where an open goes (multi-window P3, owner 2026-10-27): one copy per agent.
// A click on an agent already showing in another window's column jumps to that window and column — never a second
// copy; open nowhere → it opens in the window clicked in (the active one, lib/windowScope). A chip of it in another
// window's tray goes from there (it opens here). The owner coming to a window (focus, a click, a key) makes it the
// active one: the selection becomes that window's own (lib/paneStore enterWindow).
import { bridge } from "../bridge";
import { setOpenRouter, useApp } from "../store";
import { onEveryAppWindow } from "./appWindowSet";
import { useDesks } from "./deskStore";
import { chipShowing, closeChip, conversationPanes, paneBinding, type PaneLayout } from "./paneLayout";
import { enterWindow, focusConversationPane, usePanes } from "./paneStore";
import { currentWindow, deskIdOf, inWindow, keepSelection, keptSelection, MAIN_WINDOW, noteWindowUsed, useActiveWindow, useWindowSelection, windowKeyOf, type WindowKey } from "./windowScope";

/** Where an agent shows: a window's conversation column, or its chip in that window's tray. */
export interface AgentPlace {
  window: WindowKey;
  paneId: string;
  kind: "column" | "chip";
}

/** The open windows, the main one first (a desk's store exists from its start). */
function openWindows(): WindowKey[] {
  return [MAIN_WINDOW, ...useDesks.getState().desks.map((d) => d.deskId)];
}

/** Every place this agent shows, in every window (columns first, the main window first). */
export function agentPlaces(hostId: string, sessionId: string, layouts: (key: WindowKey) => PaneLayout = (key) => usePanes.of(key).getState().layout, windows: readonly WindowKey[] = openWindows()): AgentPlace[] {
  const out: AgentPlace[] = [];
  for (const window of windows) {
    const layout = layouts(window);
    for (const paneId of conversationPanes(layout)) {
      const b = paneBinding(layout, paneId);
      if (b?.hostId === hostId && b.sessionId === sessionId) out.push({ window, paneId, kind: "column" });
    }
  }
  for (const window of windows) {
    const chip = chipShowing(layouts(window), hostId, sessionId);
    if (chip) out.push({ window, paneId: chip, kind: "chip" });
  }
  return out;
}

/**
 * The one-copy rule as a decision: `jump` = the agent shows in another window's column (go there); otherwise it opens
 * in `here`, and its chips in other windows' trays go (`dropChips`).
 */
export function routeFor(places: readonly AgentPlace[], here: WindowKey): { jump: AgentPlace | null; dropChips: AgentPlace[] } {
  if (places.some((p) => p.kind === "column" && p.window === here)) return { jump: null, dropChips: places.filter((p) => p.kind === "chip" && p.window !== here) };
  const jump = places.find((p) => p.kind === "column" && p.window !== here) ?? null;
  return { jump, dropChips: jump ? [] : places.filter((p) => p.kind === "chip" && p.window !== here) };
}

// ── Restart: one copy again (P3.5) ─────────────────────────────────────────────────────────────

/** The window the owner was in last (stored on every change of the active window; read once at start). */
export const ACTIVE_WINDOW_STORAGE_KEY = "cutex-desktop.activeWindow.v1";

let storedActive: WindowKey | null = null;
function storeActive(key: WindowKey): void {
  // Every press in a window asks: write only a change.
  if (storedActive === key) return;
  storedActive = key;
  try {
    localStorage.setItem(ACTIVE_WINDOW_STORAGE_KEY, key);
  } catch {
    // no storage (tests): a restart falls back to the desk rule
  }
}

/** The stored last active window (null: none or malformed). */
export function readStoredActive(): WindowKey | null {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(ACTIVE_WINDOW_STORAGE_KEY);
    return v === MAIN_WINDOW || (v && /^d[0-9a-f]{12}$/.test(v)) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Restart: of the windows whose stored layouts all show one agent as a column, the one that keeps it — the window
 * the owner was in last (`lastActive`, stored) when it is one of them, else the first desk of `deskOrder` (the
 * remembered desks' order: the agent was moved to a desk on purpose), else the first holder (the main window). Pure.
 */
export function startWinner(holders: readonly WindowKey[], lastActive: WindowKey | null, deskOrder: readonly WindowKey[]): WindowKey {
  if (lastActive && holders.includes(lastActive)) return lastActive;
  return deskOrder.find((k) => holders.includes(k)) ?? holders[0]!;
}

/**
 * Restart: the columns to take out so that every agent shows as a column in one window only (`startWinner` keeps
 * it; a window showing it twice keeps its first column). Pure over the windows' layouts.
 */
export function startDuplicates(windows: readonly WindowKey[], layouts: (key: WindowKey) => PaneLayout, lastActive: WindowKey | null, deskOrder: readonly WindowKey[]): AgentPlace[] {
  const out: AgentPlace[] = [];
  const done = new Set<string>();
  for (const window of windows) {
    const layout = layouts(window);
    for (const paneId of conversationPanes(layout)) {
      const b = paneBinding(layout, paneId);
      if (!b?.sessionId) continue;
      const id = `${b.hostId}\u0000${b.sessionId}`;
      if (done.has(id)) continue;
      done.add(id);
      const columns = agentPlaces(b.hostId, b.sessionId, layouts, windows).filter((p) => p.kind === "column");
      if (columns.length < 2) continue;
      const keep = startWinner([...new Set(columns.map((p) => p.window))], lastActive, deskOrder);
      const kept = columns.find((p) => p.window === keep)!;
      out.push(...columns.filter((p) => p !== kept));
    }
  }
  return out;
}

/** The window showing this agent in a column (null: none). */
export function windowShowing(hostId: string, sessionId: string): WindowKey | null {
  return agentPlaces(hostId, sessionId).find((p) => p.kind === "column")?.window ?? null;
}

/** Bring a window to the front (main does it; the renderer cannot raise another window itself). */
function raise(key: WindowKey): void {
  void bridge.window?.desk?.focus(deskIdOf(key));
}

/** The agent shows in another window's column: that window becomes the active one, the column takes the focus. */
export function jumpTo(place: AgentPlace): void {
  raise(place.window);
  activateWindow(place.window);
  inWindow(place.window, () => focusConversationPane(place.paneId));
}

/** store.ts openAgent's router: true = handled (jumped to another window). */
export function routeOpen(hostId: string, sessionId: string): boolean {
  if (useDesks.getState().desks.length === 0) return false;
  const here = currentWindow();
  const { jump, dropChips } = routeFor(agentPlaces(hostId, sessionId), here);
  if (jump) {
    jumpTo(jump);
    return true;
  }
  for (const chip of dropChips) {
    const store = usePanes.of(chip.window);
    const layout = store.getState().layout;
    const next = closeChip(layout, chip.paneId);
    if (next !== layout) store.setState({ layout: next });
  }
  return false;
}

/**
 * The owner is in window `key` now: it becomes the active one, the selection its own (the left one keeps its own).
 * `remember: false` (a window merely getting the focus, a desk going away): not stored as the window the owner was in
 * last — quitting closes the desks and moves the focus to the main window, which must not decide the next start's
 * one-copy winner (P3.5; dual-screen run 2026-10-28). A press / key in a window, a jump or a move there is stored.
 */
export function activateWindow(key: WindowKey, opts: { remember?: boolean } = {}): void {
  noteWindowUsed(key);
  if (opts.remember !== false) storeActive(key);
  const prev = useActiveWindow.getState().key;
  if (prev === key) return;
  const app = useApp.getState();
  keepSelection(prev, { selectedId: app.selectedId, selectedHost: app.selectedHost, view: app.view });
  const kept = keptSelection(key);
  useActiveWindow.setState({ key });
  useWindowSelection.setState({ active: key });
  enterWindow(key, kept);
}

/** A desk went away: the main window takes over when it was the active one. */
export function windowGone(key: WindowKey): void {
  if (useActiveWindow.getState().key === key) activateWindow(MAIN_WINDOW, { remember: false });
}

/**
 * Follow the owner between windows (lib/deskSync with desks on): a window's focus, a pointer press or a key in it
 * makes it the active one — before the press / key reaches the app's handlers (capture), so a click in a desk's
 * sidebar opens there. Also installs the open router. Returns the stop.
 */
export function startWindowRoute(): () => void {
  setOpenRouter(routeOpen);
  const keyOf = (win: Window): WindowKey => windowKeyOf(useDesks.getState().desks.find((d) => d.handle.win === win)?.deskId ?? null);
  const off = onEveryAppWindow((win) => {
    const enter = () => activateWindow(keyOf(win));
    // The focus alone also comes from the app (a desk closing at quit hands it to the main window): not remembered.
    const focused = () => activateWindow(keyOf(win), { remember: false });
    win.addEventListener("focus", focused);
    win.document.addEventListener("pointerdown", enter, true);
    win.document.addEventListener("keydown", enter, true);
    return () => {
      win.removeEventListener("focus", focused);
      win.document.removeEventListener("pointerdown", enter, true);
      win.document.removeEventListener("keydown", enter, true);
    };
  });
  return () => {
    setOpenRouter(null);
    off();
  };
}
