// What takes the screen when the last workspace on it closes (owner 2026-10-23: the tray is the taskbar of what is
// open — closing the current item activates the next one, like a browser closing its active tab). Registered with the
// shell as the tray keeper's `nextAfterClose` (lib/trayPins; lib/workspaces closeWorkspace asks). Outside React: the
// same entries as the Dock draws (trayEntries over the home pins, lib/workspaceSets and what is on screen), the next
// one picked by entryAfterClose, opened as its plain click in the tray would (its workspace; a pinned group: exactly
// its members) — always in place of the closed one, whatever its 打开方式 (there is nothing left to go beside).
import { usePanes } from "../../lib/paneStore";
import type { TrayAgent, TrayNext } from "../../lib/trayPins";
import { agentEffect } from "../../lib/workspaceEffects";
import { screenOf } from "../../lib/workspaces";
import { useWorkspaceSets } from "../../lib/workspaceSets";
import { sidebarOf, useApp } from "../../store";
import { dockPins } from "./dockModes";
import { homeSourceNow } from "./hooks";
import { homeStore } from "./store";
import { allEntries, entryAfterClose, trayEntries } from "./trayEntries";

const rowOf = (a: TrayAgent) => {
  const sidebar = sidebarOf(useApp.getState(), a.hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === a.sessionId) ?? null;
};

export function nextAfterClose(closing: readonly TrayAgent[]): TrayNext | null {
  const hostId = homeSourceNow();
  const pins = dockPins(hostId ? (homeStore().entry(hostId)?.doc ?? null) : null).filter((p) => p.kind === "agent");
  const onScreen = screenOf(usePanes.getState().layout).panes.flatMap((p) => (p.sessionId ? [{ hostId: p.hostId, sessionId: p.sessionId }] : []));
  const entries = allEntries(trayEntries({ pins, sets: useWorkspaceSets.getState().sets, onScreen, known: (a) => !!rowOf(a) }));
  const next = entryAfterClose(entries, closing);
  if (!next) return null;
  const first = next.members[0]!;
  const nameOf = (a: TrayAgent) => rowOf(a)?.displayName ?? (next.members.length === 1 ? next.pin?.title : null) ?? a.sessionId;
  const name = next.members.map(nameOf).join(" + ");
  return {
    name,
    open: () => agentEffect({ hostId: first.hostId, key: first.sessionId, title: nameOf(first) }, "replace", next.pin && next.members.length > 1 ? { members: next.members } : {}).run(),
  };
}
