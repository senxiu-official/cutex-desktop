// A delegation row in 接下来 (components/DelegationQueue DelegationRow) shows only registered yielded-wait words
// (registry 2.1, lib/inputLedger/nextUpRegistry NEXT_UP_DELEGATION_WAITS). Pure (test/nextUpDelegationWaits.test.ts).
import { continuationTrailing } from "./continuationWait";
import type { DelegationStatus } from "./delegations";
import { NEXT_UP_DELEGATION_WAITS } from "./inputLedger/nextUpRegistry";

/** The status a 接下来 row shows: 自动继续已到期 (not registered there) reads as plain 等待中 — its hover still explains
 *  the limit (the hint follows the wait's own state). Every other status is unchanged. */
export function nextUpDelegationStatus(status: DelegationStatus): DelegationStatus {
  return status.key === "continuationLimited" ? { ...status, key: "continuationWait", tone: "muted" } : status;
}

/** The words a status shows as (status word key, trailing key or null), for a yielded wait; null for other statuses. */
export function delegationWaitForm(status: DelegationStatus, now: number): { status: string; trailing: string | null } | null {
  if (!status.cont) return null;
  const trailing = continuationTrailing(status.cont, now);
  return { status: `delegation.status.${status.key}`, trailing: trailing?.key ?? null };
}

/** The registry form a 接下来 row's wait words belong to (null: not registered — must never show there). */
export function registeredWaitForm(form: { status: string; trailing: string | null }): keyof typeof NEXT_UP_DELEGATION_WAITS | null {
  for (const [id, def] of Object.entries(NEXT_UP_DELEGATION_WAITS) as [keyof typeof NEXT_UP_DELEGATION_WAITS, (typeof NEXT_UP_DELEGATION_WAITS)[keyof typeof NEXT_UP_DELEGATION_WAITS]][]) {
    if (def.status !== form.status) continue;
    if (def.trailing === null ? form.trailing === null : form.trailing !== null && (def.trailing as readonly string[]).includes(form.trailing)) return id;
  }
  return null;
}
