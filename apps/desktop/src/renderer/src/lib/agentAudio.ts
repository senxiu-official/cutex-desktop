// Agents whose own Shelf has a tab playing sound (owner 2026-11-10): the sidebar row shows a speaker. Written by the
// browser module from main's media state of its tabs (modules/browser/media.ts); read by components/AgentRows.
import { create } from "zustand";

export type AgentAudio = "playing" | "muted";

/** `convKey` (lib/convShelves) → what its Shelf's tabs play (muted only when every playing one is muted). */
export const useAgentAudioStore = create<{ agents: Readonly<Record<string, AgentAudio>> }>(() => ({ agents: {} }));

export function setAgentAudio(agents: Readonly<Record<string, AgentAudio>>): void {
  const now = useAgentAudioStore.getState().agents;
  const keys = Object.keys(agents);
  if (keys.length === Object.keys(now).length && keys.every((k) => now[k] === agents[k])) return;
  useAgentAudioStore.setState({ agents });
}

export function useAgentAudio(hostId: string | null | undefined, sessionId: string): AgentAudio | null {
  return useAgentAudioStore((s) => (hostId ? (s.agents[`${hostId}|${sessionId}`] ?? null) : null));
}
