// Which group's 全部 agent dialog is open (sidebar divider / 还有 N 个 / project header menu).
import { useSyncExternalStore } from "react";
import type { AgentListTab } from "./agentList";

export interface AgentListDialogState {
  groupId: string;
  tab: AgentListTab;
  /** The group's host (undefined: the focus host). The dialog lists that host's agents (multi-host P1). */
  hostId?: string;
}

let state: AgentListDialogState | null = null;
const listeners = new Set<() => void>();
const set = (next: AgentListDialogState | null) => {
  state = next;
  for (const l of listeners) l();
};

export function openAgentList(groupId: string, tab: AgentListTab = "offline", hostId?: string): void {
  set({ groupId, tab, hostId });
}

export function closeAgentList(): void {
  if (state) set(null);
}

export function useAgentListDialog(): AgentListDialogState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
