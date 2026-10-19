// The hosts a view reads (multi-host P1): the focus host, and the open agent's host when it is another
// one (an agent of another host in the scope opens in place). Names / statuses of agents mentioned in
// the open conversation (delegation cards, bus messages, parties) come from both hosts' sidebars.
import { useMemo } from "react";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { sidebarOf, useApp } from "../store";
import { useConvSidebar } from "./conversationScope";

export type SessionRow = SidebarSnapshot["active"][number];

/** Active + archived agents of the given sidebars (later ones win on equal ids). */
export function rowsOf(...sidebars: (SidebarSnapshot | null | undefined)[]): SessionRow[] {
  const byId = new Map<string, SessionRow>();
  for (const sidebar of sidebars) for (const r of [...(sidebar?.retired ?? []), ...(sidebar?.active ?? [])]) byId.set(r.cutexSessionId, r);
  return [...byId.values()];
}

/** The agents of the focus host and of the open agent's host (the latter wins on equal ids; lib/conversationScope). */
export function useViewRows(): SessionRow[] {
  const focus = useApp((s) => s.sidebar);
  const selected = useConvSidebar();
  return useMemo(() => (focus === selected ? rowsOf(focus) : rowsOf(focus, selected)), [focus, selected]);
}

/**
 * One agent row of `hostId` (the agent's host: a conversation's scope host, else the open agent's) or,
 * failing that, of the focus host (non-React selectors).
 */
export function viewRow(s: Parameters<typeof sidebarOf>[0], hostId: string, id: string): SessionRow | undefined {
  const find = (sidebar: SidebarSnapshot | null) => [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === id);
  return find(sidebarOf(s, hostId)) ?? find(s.sidebar);
}
