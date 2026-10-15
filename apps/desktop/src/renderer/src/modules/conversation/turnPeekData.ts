// Hooks / helpers of the core reference component (TurnPeek.tsx draws it; turnPeek.ts declares it).
// Kept out of the .tsx so Fast Refresh keeps working there.
import { useMemo } from "react";
import { turnTitle } from "../../lib/refs";
import type { TurnPeekParams } from "../../lib/sideKinds";
import { useTurnRef, type TurnTarget } from "../../lib/turnRefs";
import { sidebarOf, useApp } from "../../store";
import type { SideTabInfo, SideTabProps } from "../slots";

/** Display names of `hostId`'s sidebar agents (unknown ids stay ids). */
export function useNames(hostId: string): (id: string) => string {
  const sidebar = useApp((s) => sidebarOf(s, hostId));
  return useMemo(() => {
    const names = new Map([...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map((r) => [r.cutexSessionId, r.displayName]));
    return (id: string) => names.get(id) ?? id;
  }, [sidebar]);
}

export const turnTarget = (s: TurnPeekParams): TurnTarget => ({ hostId: s.hostId, sessionId: s.sessionId, turnId: s.turnId, threadId: s.threadId ?? null, ordinal: s.ordinal ?? null });

/** Tab / card title: 「Lead · #36 · 10-09 14:20」 (the ordinal only when known). */
export function useTurnPeekTab({ instance }: SideTabProps<TurnPeekParams>): SideTabInfo {
  const s = instance.state;
  const nameOf = useNames(s.hostId);
  const result = useTurnRef(turnTarget(s));
  const found = result.status === "found" ? result.found : null;
  const known = nameOf(s.sessionId);
  const name = known === s.sessionId && s.agentName ? s.agentName : known;
  const title = turnTitle(name, found?.ordinal ?? s.ordinal, found?.turn.startedAt);
  return { title, tooltip: s.snippet ? `${title}\n${s.snippet}` : title };
}
