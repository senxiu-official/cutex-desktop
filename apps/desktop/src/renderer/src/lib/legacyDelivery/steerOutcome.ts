// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
// A queue-tray 插话 whose outcome cutex does not know (`request_outcome_unknown`, details.resyncRequired:
// the request went far enough that it may have reached the native). Nothing is ever resent by itself:
// the store resyncs the session (recorded history + cutex's queue list) and decides from cutex's state.
//   landed  — the history holds it (its clientUserMessageId, else lib/pendingSteers recordedSteers: the
//             same-turn text fallback and the merged-steer match) → 已送达, it leaves like any steer;
//   queued  — cutex's queue still lists it (same clientUserMessageId / queue id) with no unresolved send → a plain queued row;
//   unsure  — neither, its listing says an earlier send is unresolved (`delivery` sending / unknown), or nothing could
//             be read → the owner decides (再发一次 / 已送达 / 删除), while the desktop keeps checking: gone from the queue,
//             not in the history yet, idle or a timeout never prove it was not sent — cutex's events can be minutes late
//             (Kestrel, 2026-10-26: native accepted in 0.4 s, the daemon heard it 125 s later). Pure.
import type { QueueItem } from "@cutex-desktop/protocol";
import type { TimelineState } from "../timeline";
import { recordedSteers, type PendingSteer } from "./pendingSteers";

export type SteerOutcome = "landed" | "queued" | "unsure";

/** Resync attempts after the answer (ms after it): the turn may still be settling. */
export const OUTCOME_CHECK_DELAYS_MS = [0, 1500, 5000] as const;
/** Quiet polls of an unsure one after those (ms after the last fast attempt), for events that arrive minutes late. */
export const OUTCOME_SLOW_POLLS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;
/** The session's own events (turn ended, input submitted, a user message recorded) recheck it, at most this often. */
export const OUTCOME_EVENT_MIN_GAP_MS = 3000;

/** cutex's listing-only `delivery` of a queue item: `sending` / `unknown` = an earlier native send is unresolved. */
const unresolved = (q: QueueItem): boolean => {
  const d = (q as QueueItem & { delivery?: unknown }).delivery;
  return d === "sending" || d === "unknown";
};

export interface OutcomeSources {
  /** Timelines to search: the live one and the re-read history (either may be missing). */
  timelines: readonly TimelineState[];
  /** The session's other pending steers (a merged user message records several together). */
  others?: readonly PendingSteer[];
  /** cutex's queue list; null = it could not be read. */
  queue: readonly QueueItem[] | null;
  /** The queue item the 插话 was for. */
  queueId?: string;
}

/** `probe`: the steer as it was sent (lib/pendingSteers newPendingSteer before the request). History wins over the queue. */
export function steerOutcome(probe: PendingSteer, { timelines, others = [], queue, queueId }: OutcomeSources): SteerOutcome {
  // In send order (the merged match reads them greedily in that order): the earlier ones, then this one.
  const steers = [...others.filter((p) => p.id !== probe.id), probe];
  if (timelines.some((timeline) => recordedSteers(steers, timeline).has(probe.id))) return "landed";
  const listed = queue?.find((q) => q.clientUserMessageId === probe.id || (!!queueId && q.queueId === queueId));
  if (listed && !unresolved(listed)) return "queued";
  return "unsure";
}

/** An error message as the backend said it, without Electron's IPC wrapper (详情 only). */
export function rawErrorText(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "").replace(/\s+/g, " ").trim().slice(0, 300);
}
