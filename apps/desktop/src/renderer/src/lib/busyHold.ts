// The composer's "a turn is running" look (stop button, busy placeholder) across a turn boundary that
// is about to start the next turn: cutex flushes the queue (or admits a delegation) only after the
// native's turn/completed reached it, and the next turn/started arrives as a separate event — tens to
// hundreds of ms in which the agent is idle. Without a hold the stop button and the placeholder flip
// to idle and back in that gap. Held only while something will start a turn, and never longer than
// BUSY_HOLD_MS; turning busy is always immediate.
import { useEffect, useState } from "react";

export const BUSY_HOLD_MS = 800;

export interface BusyHold {
  /** `busy` at the previous step. */
  busy: boolean;
  /** The turn just ended while a follow-up was expected: keep looking busy. */
  holding: boolean;
}

/** One step: what changes when `busy` / `followUp` are observed. Pure. */
export function busyHoldStep(prev: BusyHold, busy: boolean, followUp: boolean): BusyHold {
  if (busy === prev.busy) return prev.holding && !followUp ? { busy, holding: false } : prev;
  return { busy, holding: !busy && followUp };
}

/** Whether to show the running look. */
export function busyShown(state: BusyHold, followUp: boolean): boolean {
  return state.busy || (state.holding && followUp);
}

/** `busy` with the hold (derived in render: no frame shows the idle look before the hold applies). */
export function useHeldBusy(busy: boolean, followUp: boolean, ms = BUSY_HOLD_MS): boolean {
  const [state, setState] = useState<BusyHold>({ busy, holding: false });
  const next = busyHoldStep(state, busy, followUp);
  if (next !== state) setState(next);
  const holding = next.holding;
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setState((s) => (s.holding ? { ...s, holding: false } : s)), ms);
    return () => clearTimeout(timer);
  }, [holding, ms]);
  return busyShown(next, followUp);
}
