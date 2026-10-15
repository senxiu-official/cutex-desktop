// Pending steers: a message sent while a turn runs is steered into it by cutex (disposition
// "steered"), but cute-codex only records the userMessage item at its next sampling boundary (or
// when the turn finishes). Until then the composer's queue panel lists it as "steered, waiting".
//
// cute-codex drops unread steer input when the turn is interrupted (core `clear_pending` in
// abort_all_tasks / finish_turn_abort; the upstream TUI restores such steers locally for the same
// reason). A normally finished turn records leftovers (on_task_finished), so it never drops them.
// When a steer's turn ends without the item, it is "lost" here; the store re-checks the recorded
// history (thread/read), then re-sends it ("interrupt & send") or keeps it in the panel as
// undelivered with "resend" — a pending steer is never dropped silently. Pure.
import type { TimelineState } from "./timeline";

export interface PendingSteer {
  /** clientUserMessageId sent to cutex (cute-codex echoes it as userMessage.clientId). */
  id: string;
  text: string;
  imageCount: number;
  turnId: string | null;
  /** Identical user messages already in that turn when it was sent (text fallback only). */
  baseline: number;
  /** Image / skill input items sent with it (re-sent with it). */
  extra?: unknown[];
  /**
   * waiting: in the running turn, not read yet. checking: its turn ended without it, history is
   * being re-read. undelivered: the native dropped it; the panel offers resend / dismiss.
   */
  state?: "waiting" | "checking" | "undelivered";
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function userEntries(timeline: TimelineState, turnId: string | null) {
  const turn = turnId ? timeline.turns.find((t) => t.id === turnId) : undefined;
  if (!turn) return [];
  return turn.entryIds.flatMap((id) => {
    const e = timeline.entries.get(id);
    return e?.kind === "user" ? [e] : [];
  });
}

/** Text of user messages in that turn that carry no clientId (natives without the echo). */
function untaggedTexts(timeline: TimelineState, turnId: string | null): string[] {
  return userEntries(timeline, turnId)
    .filter((e) => !e.clientId)
    .map((e) => norm(e.text));
}

function hasClientId(timeline: TimelineState, id: string): boolean {
  for (const e of timeline.entries.values()) if (e.kind === "user" && e.clientId === id) return true;
  return false;
}

export function newPendingSteer(timeline: TimelineState, id: string, text: string, imageCount: number, turnId: string | null): PendingSteer {
  const target = turnId ?? timeline.activeTurnId;
  return { id, text, imageCount, turnId: target, baseline: untaggedTexts(timeline, target).filter((t) => t === norm(text)).length, state: "waiting" };
}

/**
 * Which of `steers` the timeline has recorded: by clientUserMessageId anywhere in the thread, else
 * (no echo) by text in their turn — one recorded item per steer, older identical ones excluded.
 */
export function recordedSteers(steers: readonly PendingSteer[], timeline: TimelineState): Set<string> {
  const out = new Set<string>();
  const used = new Map<string, number>();
  for (const p of steers) {
    if (hasClientId(timeline, p.id)) {
      out.add(p.id);
      continue;
    }
    const key = `${p.turnId}\u0000${norm(p.text)}`;
    const seen = untaggedTexts(timeline, p.turnId).filter((t) => t === norm(p.text)).length;
    const claimed = used.get(key) ?? 0;
    if (seen - p.baseline > claimed) {
      used.set(key, claimed + 1);
      out.add(p.id);
    }
  }
  return out;
}

export interface SteerSettlement {
  /** Still shown (same array instance when nothing changed); lost ones come back as "checking". */
  pending: PendingSteer[];
  /** Waiting steers whose turn ended without recording them. */
  lost: PendingSteer[];
}

/**
 * Settle steers against the live timeline: recorded ones leave the panel; waiting ones whose turn
 * ended unrecorded are reported lost (and kept, as "checking"); the rest keep waiting.
 */
export function settlePendingSteers(pending: readonly PendingSteer[], timeline: TimelineState): SteerSettlement {
  if (pending.length === 0) return { pending: pending as PendingSteer[], lost: [] };
  const recorded = recordedSteers(pending, timeline);
  let changed = false;
  const keep: PendingSteer[] = [];
  const lost: PendingSteer[] = [];
  for (const p of pending) {
    if (recorded.has(p.id)) {
      changed = true;
      continue;
    }
    const waiting = (p.state ?? "waiting") === "waiting";
    const turn = p.turnId ? timeline.turns.find((t) => t.id === p.turnId) : undefined;
    const ended = p.turnId ? !!turn && turn.status !== "inProgress" : !timeline.activeTurnId;
    if (waiting && ended) {
      const checking: PendingSteer = { ...p, state: "checking" };
      lost.push(checking);
      keep.push(checking);
      changed = true;
      continue;
    }
    keep.push(p);
  }
  return { pending: changed ? keep : (pending as PendingSteer[]), lost };
}

/** `settlePendingSteers(...).pending`. */
export function reconcilePendingSteers(pending: readonly PendingSteer[], timeline: TimelineState): PendingSteer[] {
  return settlePendingSteers(pending, timeline).pending;
}

/** Apply a history re-check: drop the recorded ids, set `state` on the others listed in `ids`. */
export function resolveChecked(pending: readonly PendingSteer[], ids: ReadonlySet<string>, recorded: ReadonlySet<string>, state: "undelivered" | null): PendingSteer[] {
  return pending.flatMap((p) => {
    if (!ids.has(p.id)) return [p];
    if (recorded.has(p.id) || state === null) return [];
    return [{ ...p, state }];
  });
}
