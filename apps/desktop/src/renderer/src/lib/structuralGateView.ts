// Store-backed access to the fork / revert gate (pure logic in structuralGate.ts).
import { translate, type MessageKey } from "../i18n";
import { sidebarOf, useApp, viewHostIn, viewOf } from "../store";
import { convViewHostOf, useConvScope } from "./conversationScope";
import type { AgentFeatures } from "./agentFeatures";
import { agentFeaturesFor } from "./agentFeaturesView";
import { structuralBlock, structuralRefusal, type StructuralBlock, type StructuralOp } from "./structuralGate";

type State = ReturnType<typeof useApp.getState>;

/** The agent (on `hostId`) runs a turn: its loaded timeline says so (live), else its session resource. */
function busyOf(state: State, sessionId: string, hostId: string): boolean {
  const view = viewOf(state, hostId, sessionId);
  if (view) return !!view.timeline.activeTurnId;
  return !!sidebarOf(state, hostId)?.active.find((r) => r.cutexSessionId === sessionId)?.runtime.activeTurnId;
}

/** The gate of `op` for `sessionId` right now (menus built on demand). */
export function structuralBlockFor(sessionId: string, op: StructuralOp, hostId?: string): StructuralBlock | null {
  const state = useApp.getState();
  const host = hostId ?? viewHostIn(state, sessionId);
  return structuralBlock(agentFeaturesFor(sessionId, host), busyOf(state, sessionId, host), op);
}

/**
 * The gate of `op` for `sessionId` (features `agent`), re-rendering when it changes: a Claude agent getting
 * busy or idle (never for a Codex agent, so a timeline's entries don't re-render on every turn).
 */
export function useStructuralBlock(sessionId: string, agent: AgentFeatures, op: StructuralOp): StructuralBlock | null {
  const scope = useConvScope();
  return useApp((s) => structuralBlock(agent, busyOf(s, sessionId, convViewHostOf(scope, s, sessionId)), op));
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
