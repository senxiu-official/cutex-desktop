// React side of the multi-host sidebar (RFC §8, P1 step 2a; model in lib/scopedSidebar.ts): the
// sidebars of the hosts in the view scope (the focus host's top-level snapshot, the others' byHost
// slices), the last snapshot of a host that went away (memory only, RFC §8.5), and their attention.
import { createContext, useContext, useMemo } from "react";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { OWNER_NOTIFY_FEATURE } from "../../../shared/ownerNotify";
import { featuresOf, focusSessionViews, hostSessionViews, pinnedOn, sidebarOf, useApp } from "../store";
import type { Attention } from "./attentionView";
import { ASKS_FEATURE } from "./delegations";
import { hostDelegations, useDelegations } from "./delegationStore";
import type { HostLook, HostScope } from "./hostScope";
import { useHostScope } from "./useHostScope";
import { useOwnerNotify } from "./ownerNotifyStore";
import { mergeHostSidebars, scopedSignals, type HostAttentionPart, type HostSidebarPart, type ScopedSidebarModel } from "./scopedSidebar";
import { liveStatuses, needsInputIds, pendingByAgent } from "./sidebar";
import { turnMarksOn, useTurnMarks } from "./turnUnread";

// Last snapshot seen per host this run (never persisted): a host that disconnects keeps its rows, greyed.
const lastKnown = new Map<string, SidebarSnapshot>();
// Only a snapshot that just arrived is recorded: while a focus switch is handled, `hosts.active` is
// already the new host but `sidebar` still the old one's.
useApp.subscribe((s, prev) => {
  if (s.sidebar && s.sidebar !== prev.sidebar) lastKnown.set(s.hosts?.active ?? "local", s.sidebar);
  if (s.byHost !== prev.byHost) for (const [id, slice] of Object.entries(s.byHost)) if (slice.sidebar && slice.sidebar !== prev.byHost[id]?.sidebar) lastKnown.set(id, slice.sidebar);
});

/**
 * A host's last sidebar snapshot seen this run (its current one while followed). For lists that keep a
 * host that went away greyed (RFC §8.5); null = never seen since the app started.
 */
export function lastKnownSidebar(hostId: string): SidebarSnapshot | null {
  return lastKnown.get(hostId) ?? null;
}

/** How a host of the scope is shown in the sidebar. */
export type HostSidebarState =
  /** Connected with a current snapshot. */
  | "live"
  /** Connected, first snapshot not here yet (rows of the last one, if any). */
  | "loading"
  /** Not reachable / not connected: last rows greyed (or only the host header), not openable. */
  | "offline";

export interface ScopedSidebar {
  scope: HostScope;
  model: ScopedSidebarModel;
  /** Each host of the scope (switcher order) with its state. */
  hosts: { look: HostLook; state: HostSidebarState; hasRows: boolean }[];
  stateOf(hostId: string | undefined): HostSidebarState;
}

export function hostSidebarState(look: HostLook, snapshot: SidebarSnapshot | null): HostSidebarState {
  if (!look.connected || look.indicator.status !== "online") return "offline";
  return snapshot ? "live" : "loading";
}

/** The merged sidebar of the view scope (one host: today's sidebar, its rows keyed by host). */
export function useScopedSidebar(): ScopedSidebar {
  const scope = useHostScope();
  const sidebar = useApp((s) => s.sidebar);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  const hostsState = useApp((s) => s.hosts);
  const pinned = useApp((s) => s.pinned);
  const sessions = useApp((s) => s.sessions);
  // The focus host's requests seen on its host feed: agents not open here are ⚠ rows too.
  const hostWaiting = useApp((s) => s.hostWaiting);
  return useMemo(() => {
    const source = { hosts: hostsState, sidebar, byHost, features };
    const parts: HostSidebarPart[] = [];
    const hosts: ScopedSidebar["hosts"] = [];
    for (const look of scope.hostsInScope) {
      const current = look.connected ? sidebarOf(source, look.id) : null;
      const snapshot = current ?? lastKnown.get(look.id) ?? null;
      const state = hostSidebarState(look, current);
      const focus = look.id === scope.focus;
      const views = hostSessionViews(sessions, look.id);
      parts.push({ hostId: look.id, snapshot, pinned: focus ? pinned : pinnedOn(look.id), needsInput: focus ? new Set(Object.keys(pendingByAgent(views, hostWaiting))) : needsInputIds(views), chats: featuresOf(source, look.id).has("human-create-session"), statusUnknown: state === "loading", liveStatus: state === "loading" ? liveStatuses(views) : undefined });
      hosts.push({ look, state, hasRows: !!snapshot });
    }
    const stateOf = (hostId: string | undefined) => hosts.find((h) => h.look.id === (hostId ?? scope.focus))?.state ?? "live";
    return { scope, model: mergeHostSidebars(parts), hosts, stateOf };
  }, [scope, sidebar, byHost, features, hostsState, pinned, sessions, hostWaiting]);
}

/** Signals / needs-you of the merged rows (keyed by row key), each from its own host's sources. */
export function useScopedAttention(model: ScopedSidebarModel, scope: HostScope): Attention {
  const sessions = useApp((s) => s.sessions);
  const hostsState = useApp((s) => s.hosts);
  const approvals = useApp((s) => s.approvals);
  const hostWaiting = useApp((s) => s.hostWaiting);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  const delegations = useDelegations((s) => s.byKey);
  const ownerNotify = useApp((s) => s.features.has(OWNER_NOTIFY_FEATURE));
  const notes = useOwnerNotify((s) => s.byId);
  const otherNotes = useOwnerNotify((s) => s.others);
  const marks = useTurnMarks();
  const rows = useMemo(() => [...model.groups.flatMap((g) => [...g.online, ...g.offline]), ...model.chats], [model]);
  const result = useMemo(() => {
    const parts: HostAttentionPart[] = scope.hostsInScope.map((look) => {
      const focus = look.id === scope.focus;
      const views = focus ? focusSessionViews({ hosts: hostsState, sessions }) : hostSessionViews(sessions, look.id);
      // The focus host: also its requests seen on its host feed (agents not open here).
      const pending = pendingByAgent(views, focus ? hostWaiting : undefined);
      // Another host: its requests seen on its host feed (methods unknown: a confirmation).
      if (!focus) for (const [id, requests] of Object.entries(byHost[look.id]?.waiting ?? {})) if (!pending[id] && requests.length) pending[id] = requests.map(() => "");
      return {
        hostId: look.id,
        pending,
        approvals: focus ? approvals : (byHost[look.id]?.approvals ?? null),
        // Each host's own records (another host's while followed: its open agent / a page of it).
        delegations: featuresOf({ hosts: hostsState, sidebar: null, byHost, features }, look.id).has(ASKS_FEATURE) ? Object.values(hostDelegations(delegations, look.id)) : null,
        ownerNotes: focus ? (ownerNotify ? Object.values(notes) : null) : Object.values(otherNotes[look.id] ?? {}),
        marks: focus ? marks : turnMarksOn(look.id),
      };
    });
    return scopedSignals(rows, parts, scope.focus);
  }, [rows, scope, hostsState, sessions, hostWaiting, approvals, byHost, features, delegations, ownerNotify, notes, otherNotes, marks]);
  return { rows, signals: result.signals, needs: result.needs, marks };
}

/** What sidebar rows need to know about hosts (provided by the sidebar; absent elsewhere = the focus host). */
export interface SidebarHosts {
  /** Draw host marks (RFC §8.2: multi-host scope, or the 单主机也显示主机标记 setting). */
  marks: boolean;
  /** Marks also on the local host (this machine) entries (Settings → 主机 「本机也显示主机标记」, default off). */
  localMarks: boolean;
  focus: string;
  look(hostId: string | undefined): HostLook | null;
  stateOf(hostId: string | undefined): HostSidebarState;
}
export const SidebarHostsContext = createContext<SidebarHosts | null>(null);
export function useSidebarHosts(): SidebarHosts | null {
  return useContext(SidebarHostsContext);
}
