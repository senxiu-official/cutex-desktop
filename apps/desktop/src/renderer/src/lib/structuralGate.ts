// Fork / revert of a busy agent (cutex `cutex/session/fork`, `cutex/session/history/revert`; edit &
// resend is a revert too). A Claude agent refuses both while a turn runs or input / notes are queued:
// the claude-r8 adapter (`session_ops.py` `idle()`) answers -32009 "interrupt the active turn before
// changing session history" / "finish or explicitly clear queued inputs and notes before changing
// session history", which cutex returns as `session_fork_failed` / `history_revert_failed` (502).
// Since claude-r21 (adapter feature `forkWhileBusy`) a busy Claude agent can be forked: the fork is
// made from the live transcript, leaving the running turn and the queue out; revert still needs idle.
// Codex agents are not blocked: cutex forks a busy Codex agent (its running turn is copied as
// interrupted) and interrupts before reverting. Pure (no React, no store) so it is unit-tested.
import { declares, type AgentFeatures } from "./agentFeatures";

/**
 * Why fork / revert are not offered right now (i18n `structural.<block>`): `claudeBusy` neither (an
 * adapter without `forkWhileBusy`), `claudeBusyRevert` revert only (fork works while busy).
 */
export type StructuralBlock = "claudeBusy" | "claudeBusyRevert";

/** The operation being gated: a fork (new agent) or a revert (edit & resend is a revert too). */
export type StructuralOp = "fork" | "revert";

/** null = offer `op` as usual; otherwise show it disabled with the reason. */
export function structuralBlock(agent: AgentFeatures, busy: boolean, op: StructuralOp): StructuralBlock | null {
  if (agent.runtime !== "claude" || !busy) return null;
  if (!declares(agent, "forkWhileBusy")) return "claudeBusy";
  return op === "fork" ? null : "claudeBusyRevert";
}

/** A busy refusal carried by a failed fork / revert (i18n `structural.refused.<refusal>`). */
export type StructuralRefusal = "activeTurn" | "queued" | "transcriptBehind";

/**
 * The adapter's busy refusal in a failed fork / revert (the agent got busy after the menu or button
 * was shown, or has queued input the desktop does not see), or null for any other error.
 */
export function structuralRefusal(e: unknown): StructuralRefusal | null {
  const message = e instanceof Error ? e.message : String(e);
  if (/interrupt the active turn before changing session history/i.test(message)) return "activeTurn";
  if (/clear queued inputs and notes before changing session history/i.test(message)) return "queued";
  // claude-r21 busy fork (`data.code: native_transcript_behind`, retryable): the running turn's start is
  // not on Claude Code's transcript yet.
  if (/native_transcript_behind|native transcript has not caught up|running turn cannot be separated|running turn has just started/i.test(message)) return "transcriptBehind";
  return null;
}
