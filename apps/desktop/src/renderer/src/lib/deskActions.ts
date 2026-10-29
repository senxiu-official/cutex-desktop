// Desk window actions (multi-window P1 + P3): 「移到新窗口」 on a conversation column, 「在 桌子 N 打开」 /
// 「在主窗口打开」 on an agent (sidebar row menu, a row dropped on another window), 「放回主窗口」 in a desk, the
// hand-back when a desk window closes, and the remembered desks reopening on start. P3: every window has its own
// layout (lib/paneStore), so these move an agent between windows — one copy per agent (lib/windowRoute).
import { bridge } from "../bridge";
import { sidebarOf, useApp } from "../store";
import { DESKS_STORAGE_KEY, openDesk, parseStoredDesks, useDesks, type DeskContent } from "./deskStore";
import { addConversationChip, bindPane, closeChip, conversationPanes, focusedConversation, paneBinding, type PaneAgent, type PaneLayout } from "./paneLayout";
import { closeConversationPane, livePaneBinding, openAgentBeside, setPaneLayout, usePanes } from "./paneStore";
import { handOpenToMain } from "./trayOpen";
import { activateWindow, agentPlaces, startDuplicates, type AgentPlace } from "./windowRoute";
import { currentWindow, deskIdOf, inWindow, MAIN_WINDOW, type WindowKey } from "./windowScope";
import { handSetsToMain } from "./workspaceSets";

/** Desks closed with 「放回主窗口」: their focused conversation opens in the main window instead of going to the tray. */
const reopenInMain = new Set<string>();
/** Remembered desks reopening (reopenDesks): once each one's layout loaded, one copy per agent again (dedupeAtStart). */
const restoring = new Set<string>();

/** Whether `deskId` is a remembered desk coming back (asked once, by lib/deskSync when its layout loaded). */
export function takeRestoring(deskId: string): boolean {
  return restoring.delete(deskId);
}

/** A layout's agents: the focused column first, then the other columns, then the tray's chips. */
export function layoutAgents(layout: PaneLayout): PaneAgent[] {
  const focused = focusedConversation(layout);
  const ids = [...(focused ? [focused] : []), ...conversationPanes(layout).filter((id) => id !== focused), ...layout.chips];
  const out: PaneAgent[] = [];
  for (const id of ids) {
    const b = paneBinding(layout, id);
    if (b?.sessionId && !out.some((a) => a.hostId === b.hostId && a.sessionId === b.sessionId)) out.push({ hostId: b.hostId, sessionId: b.sessionId });
  }
  return out;
}

/** A desk's agents (its layout while its store is there; else what it opened with). */
function deskAgents(deskId: string, content: DeskContent): PaneAgent[] {
  if (usePanes.windows().includes(deskId)) return layoutAgents(usePanes.of(deskId).getState().layout);
  return content.kind === "conversation" ? [{ hostId: content.hostId, sessionId: content.sessionId }] : [];
}

/**
 * A closed desk's conversations come back to the main window as chips in its tray (owner 2026-10-27); with
 * 放回主窗口 the focused one opens beside instead. Called once the desk left the open list (so no open is routed to it).
 * P3.5: the desk tray's own items (open, not on screen; its remembered workspaces) join the main window's tray too.
 */
export function giveBackToMain(content: DeskContent, deskId: string): void {
  const agents = deskAgents(deskId, content);
  const beside = reopenInMain.delete(deskId);
  handTrayToMain(deskId);
  inWindow(MAIN_WINDOW, () => {
    agents.forEach((agent, i) => {
      if (beside && i === 0) openAgentBeside(agent.hostId, agent.sessionId);
      else setPaneLayout((layout) => addConversationChip(layout, agent, Date.now()));
    });
  });
}

/** A desk's tray (open items, remembered workspaces) moves to the main window's; the desk's stored tray goes. */
export function handTrayToMain(deskId: string): void {
  handOpenToMain(deskId);
  handSetsToMain(deskId);
}

/** The agent leaves window `key`: its column closes (the only one shows nothing), its chip goes. */
function takeOut(key: WindowKey, paneId: string, kind: "column" | "chip"): void {
  inWindow(key, () => {
    if (kind === "chip") return setPaneLayout((layout) => closeChip(layout, paneId));
    // A restore waiting for this column's agent (the store's start-up selection) is void now.
    const b = paneBinding(usePanes.getState().layout, paneId);
    const restore = usePanes.getState().restore;
    if (restore && b && restore.hostId === b.hostId && restore.sessionId === b.sessionId) usePanes.setState({ restore: null });
    if (conversationPanes(usePanes.getState().layout).length > 1) closeConversationPane(paneId);
    else setPaneLayout((layout) => bindPane(layout, paneId, paneBinding(layout, paneId)?.hostId ?? "local", null));
  });
}

/**
 * 「在 桌子 N 打开」 / 「在主窗口打开」 (sidebar row menu, a row dropped on another window): the agent moves to window
 * `key` — out of wherever else it is (one copy) — and that window comes to the front with it focused.
 */
export function openInWindow(key: WindowKey, hostId: string, sessionId: string): void {
  for (const place of agentPlaces(hostId, sessionId)) if (place.window !== key) takeOut(place.window, place.paneId, place.kind);
  void bridge.window?.desk?.focus(deskIdOf(key));
  activateWindow(key);
  inWindow(key, () => void useApp.getState().openAgent(sessionId, hostId));
}

/** 「在新窗口打开」: a new desk opens with the agent, which leaves wherever it was. False: no desk opened. */
export async function openInNewDesk(hostId: string, sessionId: string): Promise<boolean> {
  const record = await openDesk(bridge.window?.desk, { kind: "conversation", hostId, sessionId });
  if (!record) return false;
  for (const place of agentPlaces(hostId, sessionId)) if (place.window !== record.deskId) takeOut(place.window, place.paneId, place.kind);
  return true;
}

/** 「移到新窗口」: the column's conversation opens in a new desk window and leaves this window's work area. */
export async function moveToDesk(paneId: string): Promise<boolean> {
  const from = currentWindow();
  const binding = inWindow(from, () => livePaneBinding(paneId) ?? paneBinding(usePanes.getState().layout, paneId));
  if (!binding?.sessionId) return false;
  const { hostId, sessionId } = binding;
  const record = await openDesk(bridge.window?.desk, { kind: "conversation", hostId, sessionId });
  if (!record) return false;
  takeOut(from, paneId, "column");
  return true;
}

/** 「放回主窗口」 for a desk's column: the conversation moves to the main window (the desk stays). */
export function moveToMain(hostId: string, sessionId: string): void {
  openInWindow(MAIN_WINDOW, hostId, sessionId);
}

/** Close a desk with 「放回主窗口」: its window closes, its focused conversation opens in the main window. */
export function backToMain(deskId: string): void {
  reopenInMain.add(deskId);
  void bridge.window?.desk?.close(deskId);
}

/**
 * The desks of the last session come back at their places (owner 2026-10-27, option 2), once the agent
 * lists are known; a desk whose conversation is no longer listed is dropped (like the pane layout's dropGoneAgents).
 */
export async function reopenDesks(listed: (hostId: string, sessionId: string) => boolean | null): Promise<void> {
  restoring.clear();
  const stored = parseStoredDesks(localStorage.getItem(DESKS_STORAGE_KEY));
  for (const desk of stored) {
    // Not coming back: what its tray held goes to the main window's (P3.5).
    if (listed(desk.hostId, desk.sessionId) !== true) {
      handTrayToMain(desk.deskId);
      continue;
    }
    if (useDesks.getState().desks.some((d) => d.deskId === desk.deskId)) continue;
    restoring.add(desk.deskId);
    await openDesk(bridge.window?.desk, { kind: "conversation", hostId: desk.hostId, sessionId: desk.sessionId }, desk.deskId);
  }
}

/**
 * Restart (P3.5): the stored layouts of a remembered desk and the main window (or two desks) may both show an agent —
 * never two live copies. Of the windows whose layout has loaded, the one the owner was in last keeps it (`lastActive`,
 * lib/windowRoute readStoredActive), else the desk (the first remembered one), else the main window; the others' columns
 * of it close (an only column shows nothing; the agent is still in the sidebar and in the window that kept it).
 */
export function dedupeAtStart(lastActive: WindowKey | null): AgentPlace[] {
  const desks = useDesks.getState().desks.map((d) => d.deskId);
  const windows = [MAIN_WINDOW, ...desks].filter((k) => usePanes.windows().includes(k) && usePanes.of(k).getState().scope !== null);
  const drop = startDuplicates(windows, (k) => usePanes.of(k).getState().layout, lastActive, desks);
  for (const place of drop) takeOut(place.window, place.paneId, "column");
  return drop;
}

/** Whether the app's agent list for `hostId` has this agent (null: not known yet). */
export function agentListed(hostId: string, sessionId: string): boolean | null {
  const sidebar = sidebarOf(useApp.getState(), hostId);
  if (!sidebar) return null;
  return [...sidebar.active, ...sidebar.retired].some((r) => r.cutexSessionId === sessionId);
}

/** The windows an agent can be sent to from window `here`, for menus: the main window, then the desks (桌子 2, 3 …). */
export function windowChoices(here: WindowKey = currentWindow()): { key: WindowKey; n: number }[] {
  const all: { key: WindowKey; n: number }[] = [{ key: MAIN_WINDOW, n: 1 }, ...useDesks.getState().desks.map((d, i) => ({ key: d.deskId, n: i + 2 }))];
  return all.filter((w) => w.key !== here);
}
