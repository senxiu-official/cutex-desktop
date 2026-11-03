import type { SessionDelivery } from "@cutex-desktop/protocol";

/** Composer owns the working-on-delegation line. Recovery and other delivery alerts stay visible.
 * This only controls session-level copy; input records keep their server-assigned surfaces. */
export function showStandaloneDelivery(delivery: SessionDelivery | null | undefined, delegationRecovery = true): boolean {
  if (!delivery) return false;
  if (delegationRecovery && delivery.lease?.reconcile.state === "stale") return true;
  return !(delivery.state === "turn" && delivery.turn?.kind === "ask")
    && !(delivery.state === "held" && delivery.reason === "delegationLease");
}
