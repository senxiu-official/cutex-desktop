// "Model still working (Ns)": the running turn sent nothing for a while. Typical cause: the model
// streams a freeform tool input (apply_patch) for 10–25 s and the native reports no item until it is
// complete (docs/research/send-latency-r233-20261014.md), so the timeline looks finished while a
// message sent now is queued / steered behind that step. Pure; the live line (Timeline.tsx TurnTail)
// keeps the clock.
import type { TimelineState } from "./timeline";

/** Quiet time before the live line says so. */
export const SILENT_GAP_MS = 3000;

type TimelineView = Pick<TimelineState, "activeTurnId" | "turns" | "entries">;

/**
 * Changes whenever the active turn shows progress: a new entry, or the newest entry's streaming /
 * status / text length (deltas). Null when no turn runs. Comparing marks across renders tells when
 * the last progress arrived without timestamps on every event.
 */
export function turnProgressMark(timeline: TimelineView): string | null {
  const turnId = timeline.activeTurnId;
  if (!turnId) return null;
  const ids = timeline.turns.find((t) => t.id === turnId)?.entryIds ?? [];
  const lastId = ids[ids.length - 1];
  const last = lastId === undefined ? undefined : timeline.entries.get(lastId);
  let detail = "";
  if (last) {
    if (last.kind === "tool" || last.kind === "other") detail = String((last.item as { status?: unknown }).status ?? "");
    else if (last.kind === "agent" || last.kind === "plan") detail = `${last.streaming}:${last.text.length}`;
    else if (last.kind === "reasoning") detail = `${last.streaming}:${last.summary.join("").length}:${last.content.join("").length}`;
  }
  return `${turnId}|${ids.length}|${lastId ?? ""}|${last?.kind ?? ""}|${detail}`;
}

/** Tracks when the progress mark last changed. Feed it each render; `now` in ms. */
export function nextProgressAt(previous: { mark: string | null; at: number } | null, mark: string | null, now: number): { mark: string | null; at: number } {
  return previous && previous.mark === mark ? previous : { mark, at: now };
}

/**
 * Whole seconds of silence to show, or null: only when the turn is plainly "working" (nothing
 * running or streaming that would explain the wait — a long command, an approval, reasoning) and
 * the silence reached `threshold`.
 */
export function silentGapSeconds(activity: string | null, lastProgressAt: number | null, now: number, threshold = SILENT_GAP_MS): number | null {
  if (activity !== "working" || lastProgressAt === null) return null;
  const quiet = now - lastProgressAt;
  return quiet >= threshold ? Math.floor(quiet / 1000) : null;
}
