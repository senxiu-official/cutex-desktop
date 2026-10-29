// What the parts around a conversation's rows (the composer, its status row) read from a timeline that
// is updated in place: every field by identity, collections by size, the last turn's state. A streamed
// delta replaces one entry's text and changes none of these, so the composer can skip that render
// (perf baseline 2026-10-20, fix order 4); anything else that moves bumps the revision.
import { useRef } from "react";
import type { TimelineState } from "./timeline";

export function timelineShape(timeline: TimelineState | null): unknown[] {
  if (!timeline) return [];
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(timeline)) {
    out.push(key, value instanceof Map || value instanceof Set ? value.size : Array.isArray(value) ? value.length : value);
  }
  const last = timeline.turns[timeline.turns.length - 1];
  out.push(last?.id, last?.status, last?.startedAt, last?.completedAt, last?.error, last?.retry);
  return out;
}

export function sameShape(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/** A number that changes whenever `timelineShape` does (a prop for a memo'd reader of the timeline). */
export function useTimelineShapeRev(timeline: TimelineState | null): number {
  const seen = useRef<{ shape: unknown[]; rev: number }>({ shape: [], rev: 0 });
  const shape = timelineShape(timeline);
  if (!sameShape(seen.current.shape, shape)) seen.current = { shape, rev: seen.current.rev + 1 };
  return seen.current.rev;
}
