// Fork / revert of a busy agent (cutex `cutex/session/fork`, `cutex/session/history/revert`; edit &
// resend is a revert too). A Claude agent refuses both while a turn runs or input / notes are queued:
// the claude-r8 adapter (`session_ops.py` `idle()`) answers -32009 "interrupt the active turn before
// changing session history" / "finish or explicitly clear queued inputs and notes before changing
// session history", which cutex returns as `session_fork_failed` / `history_revert_failed` (502).
// Codex agents are not blocked: cutex forks a busy Codex agent (its running turn is copied as
// interrupted) and interrupts before reverting. Pure (no React, no store) so it is unit-tested.
import type { AgentFeatures } from "./agentFeatures";

/** Why fork / revert are not offered right now (i18n `structural.<block>`). */
export type StructuralBlock = "claudeBusy";

/** null = offer fork / revert as usual; otherwise show them disabled with the reason. */
export function structuralBlock(agent: AgentFeatures, busy: boolean): StructuralBlock | null {
  return agent.runtime === "claude" && busy ? "claudeBusy" : null;
}

/** A busy refusal carried by a failed fork / revert (i18n `structural.refused.<refusal>`). */
export type StructuralRefusal = "activeTurn" | "queued";

/**
 * The adapter's busy refusal in a failed fork / revert (the agent got busy after the menu or button
 * was shown, or has queued input the desktop does not see), or null for any other error.
 */
export function structuralRefusal(e: unknown): StructuralRefusal | null {
  const message = e instanceof Error ? e.message : String(e);
  if (/interrupt the active turn before changing session history/i.test(message)) return "activeTurn";
  if (/clear queued inputs and notes before changing session history/i.test(message)) return "queued";
  return null;
}
