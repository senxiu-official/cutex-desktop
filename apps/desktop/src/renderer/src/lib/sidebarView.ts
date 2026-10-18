// Non-component sidebar helpers (kept out of component files so React Fast Refresh works).
import { useMemo } from "react";
import { featuresOf, focusSessionViews, pinnedOn, sidebarOf, useApp, viewHostOf } from "../store";
import { useFocusHostId, useTargetHostId } from "./targetHost";
import { buildSidebar, needsInputIds, pendingByAgent, type AgentStatus } from "./sidebar";

export const STATUS_DOT: Record<AgentStatus, string> = {
  needsInput: "bg-warn",
  running: "bg-accent animate-pulse",
  idle: "bg-ok",
  offline: "bg-subtle/50",
  unknown: "border border-subtle/70 bg-transparent",
  error: "bg-danger",
};

export function relativeTime(ms: number): string {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * The sidebar model of the target host (lib/targetHost: a page / dialog of another host of the scope
 * under TargetHostContext), else of the focus host.
 */
export function useSidebarModel() {
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  const own = hostId === focus;
  const snapshot = useApp((s) => sidebarOf(s, hostId));
  const focusPinned = useApp((s) => s.pinned);
  const sessions = useApp((s) => s.sessions);
  const hosts = useApp((s) => s.hosts);
  // The focus host's agents waiting per its host feed (also those not open here).
  const hostWaiting = useApp((s) => s.hostWaiting);
  const chats = useApp((s) => featuresOf(s, hostId).has("human-create-session"));
  // Other hosts' pins are read from storage; the store's `pinned` gets a new set when any host's change.
  const pinned = useMemo(() => (own ? focusPinned : pinnedOn(hostId)), [own, focusPinned, hostId]);
  // That host's agent views only (`sessions` may also hold an open agent of another host).
  const needsInput = useMemo(
    () => (own ? new Set(Object.keys(pendingByAgent(focusSessionViews({ hosts, sessions }), hostWaiting))) : needsInputIds(Object.fromEntries(Object.entries(sessions).filter(([id]) => viewHostOf(id) === hostId)))),
    [own, hostId, hosts, sessions, hostWaiting],
  );
  return useMemo(
    () => (snapshot ? buildSidebar(snapshot, { pinned, needsInput, chats, ...(own ? {} : { hostId }) }) : { groups: [], chats: [], archived: [] }),
    [snapshot, pinned, needsInput, chats, own, hostId],
  );
}
