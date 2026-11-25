import type { SessionDelivery } from "@cutex-desktop/protocol";

/** Composer owns delegation details; Timeline separately shows every server-reported running turn.
 * Queue recovery and other delivery alerts stay visible.
 * This only controls session-level copy; input records keep their server-assigned surfaces. */
export function showStandaloneDelivery(delivery: SessionDelivery | null | undefined, delegationRecovery = true): boolean {
  if (!delivery) return false;
  if (delegationRecovery && delivery.lease?.reconcile.state === "stale") return true;
  return !(delivery.state === "turn" && delivery.turn?.kind === "ask")
    && !(delivery.state === "held" && delivery.reason === "delegationLease");
}

/**
 * Delivery held for a delegation lease (the Composer shows the lease). Every other delivery state keeps the timeline's
 * working-line box (its status text, or the running line); this one alone used to drop it, so the timeline shrank and
 * grew by 22 px each time delivery flipped between a turn and the hold (owner 2026-11-26). The timeline keeps the box,
 * empty and still: no running turn is invented, nothing moves.
 */
export function quietDeliveryHold(delivery: SessionDelivery | null | undefined): boolean {
  return !!delivery && delivery.state === "held" && delivery.reason === "delegationLease";
}

/**
 * The turn whose header / live line close the timeline on the input-ledger path: the delivery's running turn, and
 * during a delegation-lease hold (no delivery turn) the turn the lease belongs to, while the thread still runs it.
 * Without this the header and line left at each flip to the hold and came back with the turn: the timeline grew and
 * shrank (owner 2026-11-26). The turn ending (no longer the active native turn) still removes them, and a native turn
 * the lease does not name (stale native activity) is never taken for a running one.
 */
export function ledgerTailTurn(delivery: SessionDelivery | null | undefined, activeTurnId: string | null | undefined): string | null {
  if (delivery?.turn?.turnId) return delivery.turn.turnId;
  if (!quietDeliveryHold(delivery) || !activeTurnId) return null;
  return delivery?.lease?.turnId === activeTurnId ? activeTurnId : null;
}
