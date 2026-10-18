// Hooks / helpers of the side agent view (SideAgent.tsx draws it; sideAgentItem.ts declares it;
// docs/research/side-agent-view-20261018.md). Kept out of the .tsx so Fast Refresh keeps working there.
import { useEffect, useState } from "react";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideAgentParams } from "../../lib/sideKinds";
import { agentHost, sidebarOf, useApp } from "../../store";
import type { Json } from "../types";
import type { SideTabInfo, SideTabProps } from "../slots";

const ID = /^[^\s]{1,200}$/;

export function parseSideAgent(raw: Json): SideAgentParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const sessionId = (raw as Record<string, Json>).sessionId;
  return typeof sessionId === "string" && ID.test(sessionId) ? { sessionId } : null;
}

/** The agent's resource on `hostId` (active or archived); undefined while unknown. */
export function useAgentResource(hostId: string, sessionId: string): SessionResource | undefined {
  return useApp((s) => {
    const sidebar = sidebarOf(s, hostId);
    return sidebar?.active.find((r) => r.cutexSessionId === sessionId) ?? sidebar?.retired.find((r) => r.cutexSessionId === sessionId);
  });
}

/** The agent is the main area's agent right now (the side tab then shows a placeholder). */
export function useInMain(hostId: string, sessionId: string): boolean {
  return useApp((s) => s.selectedId === sessionId && agentHost(s) === hostId && s.view.kind === "conversation");
}

/** Tab / card title = the agent's name; busy while it runs; its pending approvals / questions as attention. */
export function useSideAgentTab({ instance, hostId }: SideTabProps<SideAgentParams>): SideTabInfo {
  const host = useApp((s) => hostId ?? s.hosts?.active ?? "local");
  const id = instance.state.sessionId;
  const resource = useAgentResource(host, id);
  const view = useApp((s) => (s.sideAgents[id]?.hostId === host || (s.selectedId === id && agentHost(s) === host) ? s.sessions[id] : undefined));
  const name = resource?.displayName ?? id;
  const busy = !!(view ? view.timeline.activeTurnId : resource?.runtime.activeTurnId);
  const attention = view?.timeline.pending.size ?? 0;
  return { title: name, tooltip: name, busy, ...(attention ? { attention } : {}) };
}

/** Milliseconds since `since` (ms), ticking each second while set. */
export function useSince(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, now - since);
}
