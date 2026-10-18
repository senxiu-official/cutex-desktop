import type { TurnView } from "./timeline";

/**
 * Where failed turns show their error (TurnErrorRow): after the last rendered segment of the turn.
 * A turn that failed before any output has only its input row (user message), and the "已工作"
 * header goes before a turn's first non-input row, so without this row such a turn showed nothing
 * at all (Claude quick chat, 2026-10-11: OAuth refresh failure on the first message looked like
 * "the message did not start a turn").
 *
 * `segmentTurnIds[i]` = the turn of rendered segment i (null for rows outside a turn).
 * Returns segment index → the failed turns (with an error text) whose last segment it is.
 */
export function turnErrorPlacement(segmentTurnIds: readonly (string | null | undefined)[], turns: readonly TurnView[]): Map<number, TurnView[]> {
  return placeAtTurnEnd(segmentTurnIds, turns, (turn) => turn.status === "failed" && !!turn.error);
}

/**
 * Where interrupted turns say so (TurnInterruptedRow): after the turn's last rendered segment, like a
 * failed turn's error. The "已停止" header sits above the turn's work, so a turn cut off mid-reply (a
 * stop, a runtime restart that settled the turn `interrupted`) ended on half a sentence with nothing
 * under it (r243 acceptance, claude-r17). Same in the live view and after a reload: both come from
 * the turn's status.
 */
export function turnInterruptedPlacement(segmentTurnIds: readonly (string | null | undefined)[], turns: readonly TurnView[]): Map<number, TurnView[]> {
  return placeAtTurnEnd(segmentTurnIds, turns, (turn) => turn.status === "interrupted");
}

function placeAtTurnEnd(
  segmentTurnIds: readonly (string | null | undefined)[],
  turns: readonly TurnView[],
  pick: (turn: TurnView) => boolean,
): Map<number, TurnView[]> {
  const chosen = new Map(turns.filter(pick).map((turn) => [turn.id, turn]));
  const placed = new Map<number, TurnView[]>();
  if (chosen.size === 0) return placed;
  const last = new Map<string, number>();
  segmentTurnIds.forEach((id, index) => {
    if (id && chosen.has(id)) last.set(id, index);
  });
  for (const [id, index] of last) {
    const list = placed.get(index) ?? [];
    list.push(chosen.get(id)!);
    placed.set(index, list);
  }
  return placed;
}
