import type { InputRecord, SessionDelivery } from "@cutex-desktop/protocol";
import type { InputLedgerSession } from "./alignment";
import { compareNextUp, nextUpRecords, pendingNoteRecords } from "./selectors";

/** Surface is the only membership authority. Admission/asks/history never add or remove rows. */
export function ledgerQueue(session: InputLedgerSession | undefined, now: number) {
  return {
    nextUp: session ? nextUpRecords(session, { now }).sort(compareNextUp) : [],
    notes: session ? pendingNoteRecords(session) : [],
  };
}

/** Uncertainty is persistent, including on the timeline; only a server-offered dismiss clears it. */
export function clearableUncertain(session: InputLedgerSession | undefined): InputRecord[] {
  return session ? [...session.records.values()].filter(r => r.state === "uncertain" && r.actions?.includes("dismiss")) : [];
}

/** No smoothing over the gap between turns; disconnected/offline never look busy. */
export function deliveryBusy(delivery: SessionDelivery | null | undefined): boolean {
  return delivery?.state === "turn" || delivery?.state === "finishing" || delivery?.state === "starting" ||
    (delivery?.state === "held" && delivery.reason === "hostBusy");
}
