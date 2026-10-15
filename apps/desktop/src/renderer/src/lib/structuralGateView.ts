// Store-backed access to the fork / revert gate (pure logic in structuralGate.ts).
import { translate, type MessageKey } from "../i18n";
import { useApp } from "../store";
import type { AgentFeatures } from "./agentFeatures";
import { agentFeaturesFor } from "./agentFeaturesView";
import { structuralBlock, structuralRefusal, type StructuralBlock } from "./structuralGate";

type State = ReturnType<typeof useApp.getState>;

/** The agent runs a turn: its loaded timeline says so (live), else its session resource. */
function busyOf(state: State, sessionId: string): boolean {
  const view = state.sessions[sessionId];
  if (view) return !!view.timeline.activeTurnId;
  return !!state.sidebar?.active.find((r) => r.cutexSessionId === sessionId)?.runtime.activeTurnId;
}

/** The gate for `sessionId` right now (menus built on demand). */
export function structuralBlockFor(sessionId: string): StructuralBlock | null {
  return structuralBlock(agentFeaturesFor(sessionId), busyOf(useApp.getState(), sessionId));
}

/**
 * The gate for `sessionId` (features `agent`), re-rendering when it changes: a Claude agent getting
 * busy or idle (never for a Codex agent, so a timeline's entries don't re-render on every turn).
 */
export function useStructuralBlock(sessionId: string, agent: AgentFeatures): StructuralBlock | null {
  return useApp((s) => structuralBlock(agent, busyOf(s, sessionId)));
}

/** Tooltip / notice text of a block. */
export function structuralBlockText(block: StructuralBlock): string {
  return translate(`structural.${block}` as MessageKey);
}

/**
 * A failed fork / revert for the user: the adapter's busy refusal in readable form (`refused`, shown
 * as information), else the raw error message.
 */
export function structuralErrorText(e: unknown): { text: string; refused: boolean } {
  const refusal = structuralRefusal(e);
  if (refusal) return { text: translate(`structural.refused.${refusal}` as MessageKey), refused: true };
  return { text: e instanceof Error ? e.message : String(e), refused: false };
}
