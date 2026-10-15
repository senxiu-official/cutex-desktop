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
  const failed = new Map(turns.filter((turn) => turn.status === "failed" && turn.error).map((turn) => [turn.id, turn]));
  const placed = new Map<number, TurnView[]>();
  if (failed.size === 0) return placed;
  const last = new Map<string, number>();
  segmentTurnIds.forEach((id, index) => {
    if (id && failed.has(id)) last.set(id, index);
  });
  for (const [id, index] of last) {
    const list = placed.get(index) ?? [];
    list.push(failed.get(id)!);
    placed.set(index, list);
  }
  return placed;
}
