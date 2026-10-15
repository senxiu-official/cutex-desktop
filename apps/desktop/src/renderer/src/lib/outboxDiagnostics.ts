// Why did a pending send (lib/outbox) stay on screen? One metadata record per send that was visible
// for more than OUTBOX_LINGER_MS — when it leaves, or while still visible after OUTBOX_STUCK_MS —
// through the renderer's reported-record channel (errors.jsonl). Never the message text: only
// states, placements, ages and whether its id / turn is in the timeline. Pure.
import { hasClientId, untaggedCount, type OutboxEntry } from "./outbox";
import type { TimelineState } from "./timeline";

export const OUTBOX_LINGER_MS = 3000;
export const OUTBOX_STUCK_MS = 30_000;

export interface OutboxLingerRecord {
  source: "outbox-linger";
  /** "left": gone from the outbox (landed, discarded or replaced); "visible": still shown at OUTBOX_STUCK_MS. */
  outcome: "left" | "visible";
  sessionId?: string;
  clientUserMessageId?: string;
  state: OutboxEntry["state"];
  placement: OutboxEntry["placement"];
  strategy: OutboxEntry["strategy"];
  stage: OutboxEntry["stage"] | null;
  waitingForPrevious: boolean;
  promoted: boolean;
  visibleMs: number;
  /** After it was shown: the turn stop returned / the submit started / cutex answered (null = not yet). */
  stoppedAfterMs: number | null;
  dispatchedAfterMs: number | null;
  confirmedAfterMs: number | null;
  clientIdInTimeline: boolean;
  turnIdKnown: boolean;
  /** Status of the turn cutex said it started, "absent" when not in the timeline, null when unknown. */
  turnStatus: string | null;
  turnIsActive: boolean;
  activeTurn: boolean;
  /** New untagged user messages with the same text since the send (the no-echo fallback), as a count. */
  untaggedSinceSend: number;
}

const safeId = (value: unknown): string | undefined => (typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined);
const after = (at: number | undefined, from: number | undefined) => (at === undefined || from === undefined ? null : Math.max(0, Math.round(at - from)));

/** Null when the entry was not visible long enough to be worth a record. */
export function outboxLingerRecord(
  sessionId: string,
  entry: OutboxEntry,
  timeline: TimelineState | null,
  now: number,
  outcome: OutboxLingerRecord["outcome"],
): OutboxLingerRecord | null {
  if (entry.createdAt === undefined) return null;
  const visibleMs = Math.max(0, Math.round(now - entry.createdAt));
  if (visibleMs <= OUTBOX_LINGER_MS) return null;
  const turn = entry.turnId && timeline ? timeline.turns.find((t) => t.id === entry.turnId) : undefined;
  return {
    source: "outbox-linger",
    outcome,
    sessionId: safeId(sessionId),
    clientUserMessageId: safeId(entry.id),
    state: entry.state,
    placement: entry.placement,
    strategy: entry.strategy,
    stage: entry.stage ?? null,
    waitingForPrevious: !!entry.waitingForPrevious,
    promoted: !!entry.promoted,
    visibleMs,
    stoppedAfterMs: after(entry.stoppedAt, entry.createdAt),
    dispatchedAfterMs: after(entry.dispatchedAt, entry.createdAt),
    confirmedAfterMs: after(entry.confirmedAt, entry.createdAt),
    clientIdInTimeline: !!timeline && hasClientId(timeline, entry.id),
    turnIdKnown: !!entry.turnId,
    turnStatus: entry.turnId ? (turn ? turn.status : "absent") : null,
    turnIsActive: !!entry.turnId && timeline?.activeTurnId === entry.turnId,
    activeTurn: !!timeline?.activeTurnId,
    untaggedSinceSend: timeline ? Math.max(0, untaggedCount(timeline, entry.text) - entry.baseline) : 0,
  };
}
