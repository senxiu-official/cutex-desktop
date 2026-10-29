// The queue card's 「插入当前回合」 drop target (owner 2026-10-21: reordering a queued row while a turn
// ran inserted it by accident — the boundary card appeared at drag start right above row 1, next to the
// "move to the top" slot, and a drop on it steered at once). Owner 2026-10-23 (design 040 follow-up): no
// row of its own — while an owner row is dragged and a turn runs, the card's 「接下来」 header line itself
// becomes the target (an overlay on that line: nothing moves, and it is away from the "move to the top"
// slot), taking a drop only after the drag has stayed on it for INSERT_DWELL_MS. A drop anywhere else only
// reorders. 「全部合并插入」 sits at the right of the header line. Pure.
import type { InsertRefusal } from "./admissionOrder";
import { QUEUE_MERGE_MIN } from "../../../shared/queueMerge";

/** How long a drag must stay on the insert target before a drop there inserts. */
export const INSERT_DWELL_MS = 500;

/**
 * Whether the header line is the drop target: only while an owner row is dragged and a turn runs (a refused
 * insert — delegation turn / no steering — shows the reason there instead).
 */
export function insertTargetShown(running: boolean, hasOwnerTurn: boolean, _refusal: InsertRefusal, dragging: boolean): boolean {
  return running && hasOwnerTurn && dragging;
}

export type InsertTargetState = "idle" | "hold" | "armed" | "refused";

/** What the target says (idle: not under the drag; hold: under it, dwell not over yet). */
export function insertTargetState(over: boolean, armed: boolean, refusal: InsertRefusal): InsertTargetState {
  if (!over) return "idle";
  if (refusal) return "refused";
  return armed ? "armed" : "hold";
}

/**
 * 「全部合并插入」 (shared/queueMerge) at the right of the header line: while a turn runs that may take an
 * insert, at least QUEUE_MERGE_MIN owner messages are queued (delegations never count), and no drag
 * is on (the line then speaks for the drop).
 */
export function mergeInsertShown(running: boolean, ownerMessages: number, refusal: InsertRefusal, dragging: boolean, canMerge: boolean): boolean {
  return canMerge && running && refusal === null && !dragging && ownerMessages >= QUEUE_MERGE_MIN;
}
