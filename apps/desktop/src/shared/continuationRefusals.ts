/**
 * r296 continuation decisions (cutex docs/continuation-approval.md, ddd0f067 "refusal codes"): these refusals leave the
 * delegation, budget, approval and operation receipt as they were before the request. Main rethrows them as a bare
 * code; the renderer then lifts its unknown-outcome fence (the original action id did nothing) and reads again.
 * `outcome_unknown`, transport or persistence failures are not here: they keep the fence until the receipt is checked.
 * Scoped to continuation decisions only; the tree's shared precondition list is unchanged.
 */
export const CONTINUATION_DECISION_REFUSALS: ReadonlySet<string> = new Set([
  "approval_changed", "approval_not_pending", "approval_guarded", "forbidden", "unauthorized", "invalid_arguments", "ask_not_found",
  "idempotency_conflict", "action_id_payload_conflict",
  "continuation_not_limited", "continuation_revision_conflict", "continuation_guarded", "continuation_reconciling",
  "routing_not_authorized", "routing_scope_mismatch", "invalid_routing_identifier", "invalid_authority_epoch", "delegation_cross_host_routing_unsupported",
  // Desktop-side checks in main before any write (shared/delegationUpgradeAdapter decideContinuation).
  "approval_not_allowed",
]);
