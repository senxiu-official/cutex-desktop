// Local 结束跟进 marks of jobs (state surfaces WP-D4, fix plan S7): an older Job Service cannot record 结束跟进,
// so the desktop keeps a durable mark on this device only (localStorage, bounded). lib/jobs jobStatus reads it: the
// job leaves 进行中 and reads 结果未确认 (this device only). A later real outcome from the Job Service still shows.
import { useSyncExternalStore } from "react";

const KEY = "cutex-desktop.jobFollowUpEnded.v1";
/** Most marks kept; the oldest go first. */
export const MAX_LOCAL_MARKS = 500;

/** Job id → when it was marked (ms). Job ids are random per Job Service, so one map serves every host. */
export type LocalMarks = Readonly<Record<string, number>>;

const listeners = new Set<() => void>();
let marks: LocalMarks = load();

function load(): LocalMarks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    return {};
  }
}

/** Add a mark, keeping the newest `max`. Pure. */
export function withMark(current: LocalMarks, jobId: string, at: number, max = MAX_LOCAL_MARKS): LocalMarks {
  const entries = Object.entries({ ...current, [jobId]: at }).sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, max));
}

function save(next: LocalMarks): void {
  marks = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best effort: the mark still holds for this session
  }
  for (const l of [...listeners]) l();
}

export function isJobLocallyEnded(jobId: string | undefined): boolean {
  return !!jobId && marks[jobId] !== undefined;
}

export function markJobLocallyEnded(jobId: string, now = Date.now()): void {
  save(withMark(marks, jobId, now));
}

/** Replace the marks (persisted); tests and the preview. */
export function setLocalJobMarks(next: LocalMarks): void {
  save(next);
}

/** Re-read storage (tests: a "restart"). */
export function reloadLocalJobMarks(): void {
  marks = load();
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-render on a local mark (rows read jobStatus, which consults the marks). */
export function useLocalJobMarks(): LocalMarks {
  return useSyncExternalStore(subscribe, () => marks);
}
