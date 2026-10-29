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
import type { AgentRuntime } from "./agentFeatures";
import { isAcpRuntime } from "./acpRuntimes";
import type { TimelineState } from "./timeline";

export interface PendingSteer {
  /** clientUserMessageId sent to cutex (cute-codex echoes it as userMessage.clientId). */
  id: string;
  text: string;
  imageCount: number;
  turnId: string | null;
  /** Identical user messages already in that turn when it was sent (text fallback only). */
  baseline: number;
  /** User messages already in that turn when it was sent: a merged message is one after them (absent: any). */
  usersBefore?: number;
  /** Image / skill input items sent with it (re-sent with it). */
  extra?: unknown[];
  /**
   * image-input-steering receipt of the steer (submit / queue-steer success, `cutex/userInput/submitted`):
   * how the native took its images. Absent = cutex said nothing (no guess).
   */
  imageDelivery?: "pathText" | "nativeImage";
  /**
   * waiting: in the running turn, not read yet. checking: its turn ended without it, history is
   * being re-read. undelivered: the native dropped it; the panel offers resend / dismiss.
   */
  state?: "waiting" | "checking" | "undelivered";
  /**
   * Restored after a desktop restart (lib/pendingSteerStore): its turn may be older than the loaded
   * history page, so a turn that is neither shown nor running counts as ended (re-checked, never dropped).
   */
  restored?: boolean;
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

/**
 * How a waiting steer reaches the agent. `toolBoundary`: read at the running turn's next tool boundary
 * (Codex; a Claude text steer — several are read there together). `nextTurn`: a Claude steer with
 * images, which an older adapter / cutex never inserts into a running turn: it runs as its own next turn
 * (cute_claude/protocol.py `turn/steer`). With cutex image-input-steering (r264) a Claude image steer
 * rides the tool boundary as its file path when the steer's receipt says so (`imageDelivery`) or the
 * session declares `pathText` (`imageSteering`, lib/imageSteer imageSteerMode); `unsupported` / absent
 * keeps `nextTurn`.
 */
export function steerDelivery(p: Pick<PendingSteer, "imageCount" | "extra" | "imageDelivery">, runtime: AgentRuntime, imageSteering?: "pathText" | "nativeImage" | "unsupported" | null): "toolBoundary" | "nextTurn" {
  if (isAcpRuntime(runtime)) return "nextTurn";
  if (runtime !== "claude") return "toolBoundary";
  const images = p.imageCount > 0 || (p.extra ?? []).some((x) => { const t = (x as { type?: unknown } | null)?.type; return t === "image" || t === "localImage"; });
  if (!images) return "toolBoundary";
  return p.imageDelivery || imageSteering === "pathText" || imageSteering === "nativeImage" ? "toolBoundary" : "nextTurn";
}

/** `from`: the steer it continues (carried over to another turn): its other fields are kept. */
export function newPendingSteer(timeline: TimelineState, id: string, text: string, imageCount: number, turnId: string | null, from?: PendingSteer): PendingSteer {
  const target = turnId ?? timeline.activeTurnId;
  return { ...from, id, text, imageCount, turnId: target, baseline: untaggedTexts(timeline, target).filter((t) => t === norm(text)).length, usersBefore: userEntries(timeline, target).length, state: "waiting" };
}

/**
 * Which of `steers` the timeline has recorded: by clientUserMessageId anywhere in the thread, else
 * (no echo) by text in their turn — one recorded item per steer, older identical ones excluded.
 * Several steers read together may come back as one user message (the Claude runtime merges the ones a
 * tool boundary read; owner 2026-10-26: two inserts stayed 「已插入当前回合」): a message of their turn
 * whose id is none of theirs and whose text holds two or more of them, in the order sent, records them all.
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
  for (const id of mergedSteers(steers.filter((p) => !out.has(p.id)), steers, timeline)) out.add(id);
  return out;
}

/** The steers (of `rest`, by turn) that one merged user message holds; see recordedSteers. */
function mergedSteers(rest: readonly PendingSteer[], all: readonly PendingSteer[], timeline: TimelineState): string[] {
  const own = new Set(all.map((p) => p.id));
  const byTurn = new Map<string | null, PendingSteer[]>();
  for (const p of rest) if (norm(p.text)) byTurn.set(p.turnId, [...(byTurn.get(p.turnId) ?? []), p]);
  const out: string[] = [];
  for (const [turnId, group] of byTurn) {
    if (group.length < 2) continue;
    const taken = new Set<string>();
    const after = Math.min(...group.map((p) => p.usersBefore ?? 0));
    for (const entry of userEntries(timeline, turnId).slice(after)) {
      if (entry.clientId && own.has(entry.clientId)) continue;
      const text = norm(entry.text);
      // Greedy in send order: each steer's text after the previous one's (frames or blank lines between are fine).
      let at = 0;
      const held: string[] = [];
      for (const p of group) {
        if (taken.has(p.id)) continue;
        const i = text.indexOf(norm(p.text), at);
        if (i < 0) continue;
        held.push(p.id);
        at = i + norm(p.text).length;
      }
      if (held.length < 2) continue;
      for (const id of held) taken.add(id);
      out.push(...held);
    }
  }
  return out;
}

export interface SteerSettlement {
  /** Still shown (same array instance when nothing changed); lost ones come back as "checking". */
  pending: PendingSteer[];
  /** Waiting steers whose turn ended without recording them. */
  lost: PendingSteer[];
  /** When (unix s) a carried steer of an idle agent is due for its check (`carriesUnread`); null = none. */
  recheckAt?: number | null;
}

/**
 * A Claude agent idle this long after its last turn with a carried steer still unrecorded: re-checked as
 * lost. An idle Claude adapter starts a waiting input at once, so this only covers a steer it no longer has.
 */
export const CARRIED_STEER_IDLE_S = 20;

export interface SettleOptions {
  /**
   * The runtime keeps a steer its turn did not read (the Claude adapter, cute_claude/protocol.py
   * `turn/steer`: a steer waits in its inbox for the turn's next tool call; one with images never rides
   * a tool call; whatever a completed turn did not read runs as the next ordinary turns, and only a turn
   * ending interrupted or failed drops it, store.py `drop_unread_steers`). A steer whose turn completed
   * is then not lost: it waits for the running turn, or — idle — CARRIED_STEER_IDLE_S before the check.
   * cute-codex records leftovers at a normal end and drops them on an abort: a turn's end settles them.
   */
  carriesUnread?: boolean;
  /** Unix s (carried steers of an idle agent). */
  now?: number;
}

/** The agent's last turn end (unix s), null if none ended. */
function lastEnd(timeline: TimelineState): number | null {
  let at: number | null = null;
  for (const t of timeline.turns) if (t.status !== "inProgress" && t.completedAt !== null && (at === null || t.completedAt > at)) at = t.completedAt;
  return at;
}

/**
 * Settle steers against the live timeline: recorded ones leave the panel; waiting ones whose turn
 * ended unrecorded are reported lost (and kept, as "checking"); the rest keep waiting. With
 * `carriesUnread` a steer whose turn completed moves on to the running turn instead
 * (re-targeted, so 打断并发送 still takes it), and with no turn running it waits CARRIED_STEER_IDLE_S
 * after the last one (`recheckAt`).
 */
export function settlePendingSteers(pending: readonly PendingSteer[], timeline: TimelineState, opts: SettleOptions = {}): SteerSettlement {
  if (pending.length === 0) return { pending: pending as PendingSteer[], lost: [] };
  const recorded = recordedSteers(pending, timeline);
  let changed = false;
  let recheckAt: number | null = null;
  const keep: PendingSteer[] = [];
  const lost: PendingSteer[] = [];
  for (const p of pending) {
    if (recorded.has(p.id)) {
      changed = true;
      continue;
    }
    const waiting = (p.state ?? "waiting") === "waiting";
    const turn = p.turnId ? timeline.turns.find((t) => t.id === p.turnId) : undefined;
    const ended = p.turnId ? (turn ? turn.status !== "inProgress" : !!p.restored && timeline.activeTurnId !== p.turnId) : !timeline.activeTurnId;
    // Unknown turn (restored, older than the loaded page): carried too; the idle check still covers it.
    if (waiting && ended && opts.carriesUnread && (!turn || turn.status === "completed")) {
      const active = timeline.activeTurnId;
      if (active) {
        keep.push(newPendingSteer(timeline, p.id, p.text, p.imageCount, active, p));
        changed = true;
        continue;
      }
      const end = lastEnd(timeline);
      const due = end === null ? null : end + CARRIED_STEER_IDLE_S;
      if (due !== null && (opts.now ?? Date.now() / 1000) < due) {
        recheckAt = recheckAt === null ? due : Math.min(recheckAt, due);
        keep.push(p);
        continue;
      }
    }
    if (waiting && ended) {
      const checking: PendingSteer = { ...p, state: "checking" };
      lost.push(checking);
      keep.push(checking);
      changed = true;
      continue;
    }
    keep.push(p);
  }
  return { pending: changed ? keep : (pending as PendingSteer[]), lost, ...(recheckAt !== null ? { recheckAt } : {}) };
}

/** `settlePendingSteers(...).pending`. */
export function reconcilePendingSteers(pending: readonly PendingSteer[], timeline: TimelineState, opts?: SettleOptions): PendingSteer[] {
  return settlePendingSteers(pending, timeline, opts).pending;
}

/** Apply a history re-check: drop the recorded ids, set `state` on the others listed in `ids`. */
export function resolveChecked(pending: readonly PendingSteer[], ids: ReadonlySet<string>, recorded: ReadonlySet<string>, state: "undelivered" | null): PendingSteer[] {
  return pending.flatMap((p) => {
    if (!ids.has(p.id)) return [p];
    if (recorded.has(p.id) || state === null) return [];
    return [{ ...p, state }];
  });
}
