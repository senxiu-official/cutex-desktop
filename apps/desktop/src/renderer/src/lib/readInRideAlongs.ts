// 接下来 rows already read in (owner 2026-10-24): a ride-along item (admission.nextStep: a wake, a tell,
// an alarm …) whose `external_event` item is in the timeline has reached the agent, so its row leaves
// at once. cutex keeps listing it until the runtime's receipt: Codex sends that as it reads the input,
// but the Claude adapter (subscription backend) acknowledges a turn's inputs only with the turn's
// terminal result (cute_claude/subscription.py `claude/input/contextPersisted`), so the row stayed for
// the whole turn although the message showed at its start. The item id is the bus message id
// (cute_claude/store.py `external_item`; Codex the same), which is the row's `id`.
// Safety: once the turn that holds the item has ended, cutex's list is the truth again after
// READ_IN_GRACE_S (time for its receipt and queue/list to land): an input it still lists then was
// not kept (an interrupted / failed turn hands it back) and shows again.
import { useEffect, useMemo, useState } from "react";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import type { TimelineState } from "./timeline";

export const READ_IN_GRACE_S = 15;

type Timeline = Pick<TimelineState, "entries" | "turns" | "activeTurnId">;

/**
 * The ride-along items whose row still shows at `nowS` (unix s), and when (unix s) the next hidden one
 * comes back if cutex still lists it (null: none). The same array when nothing is hidden.
 */
export function unreadNextStep(nextStep: readonly AdmissionNextStep[], timeline: Timeline | null | undefined, nowS: number): { rows: AdmissionNextStep[]; recheckAt: number | null } {
  if (!timeline || !nextStep.length) return { rows: nextStep as AdmissionNextStep[], recheckAt: null };
  let recheckAt: number | null = null;
  const rows = nextStep.filter((item) => {
    const entry = timeline.entries.get(item.id);
    if (!entry || !("turnId" in entry) || !entry.turnId) return true;
    if (entry.turnId === timeline.activeTurnId) return false;
    const turn = timeline.turns.find((t) => t.id === entry.turnId);
    if (!turn || turn.status === "inProgress") return false;
    // Ended without a time: cutex's list decides.
    if (turn.completedAt === null) return true;
    const until = turn.completedAt + READ_IN_GRACE_S;
    if (nowS >= until) return true;
    recheckAt = recheckAt === null ? until : Math.min(recheckAt, until);
    return false;
  });
  return { rows: rows.length === nextStep.length ? (nextStep as AdmissionNextStep[]) : rows, recheckAt };
}

/** `unreadNextStep` as a hook; `rev` moves when the timeline (mutated in place) changed. Re-renders when a grace ends. */
export function useUnreadNextStep(nextStep: readonly AdmissionNextStep[], timeline: Timeline | null | undefined, rev: unknown): AdmissionNextStep[] {
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline is mutated in place; `rev` / `tick` stand in for it and the clock
  const { rows, recheckAt } = useMemo(() => unreadNextStep(nextStep, timeline, Date.now() / 1000), [nextStep, timeline, rev, tick]);
  useEffect(() => {
    if (recheckAt === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, recheckAt * 1000 - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [recheckAt]);
  return rows;
}
