// Claude runtime r56 (CLI 2.1.330; owner accepted 2026-11-23): a model / effort change made while the agent's turn is
// running switches the model on the next request, but the effort only from the next turn (an effort-only change was
// next-turn on every version). Wherever the effort of such an agent can be changed, a short line says so.
import type { SessionDelivery } from "@cutex-desktop/protocol";

/** A turn is running now (ledger hosts: the delivery state; older hosts: the legacy busy flag). Not a start or a hold.
 *  A ledger host whose delivery is not read yet (an unopened session) is unknown, not idle: the legacy flag (the
 *  runtime's active turn) answers until the delivery arrives. */
export function turnRunning(ledgerMode: boolean, delivery: SessionDelivery | null | undefined, legacyBusy: boolean): boolean {
  return ledgerMode && delivery ? delivery.state === "turn" || delivery.state === "finishing" : legacyBusy;
}

/** Whether a picked level changes the agent's effort: compared with the raw current value (Claude's `none` shows as no
 *  level, so picking 「不指定」 again is no change — no request, no notice). */
export function isEffortChange(next: string, current: string | null | undefined): boolean {
  return next !== (current ?? null);
}

/** Whether to say 「强度下一轮生效」: a Claude agent with a running turn. */
export function effortAppliesNextTurn(runtime: string | null | undefined, running: boolean): boolean {
  return runtime === "claude" && running;
}
