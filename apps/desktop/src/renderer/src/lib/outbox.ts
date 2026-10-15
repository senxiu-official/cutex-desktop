// Optimistic sends ("outbox"). A message the user sends shows up at once where it will end up —
// the queue panel (queued follow-up), the steers section (steered into the running turn) or the
// end of the timeline, above the running turn's live line (a new turn; timelineTail) — marked
// 发送中…, and is replaced in place by cutex's real item:
//
//   key: the clientUserMessageId the desktop generates per send. cutex stores it on the queue item
//   (QueueItem.clientUserMessageId), passes it to cute-codex turn/start + turn/steer (echoed as
//   userMessage.clientId) and dedupes a re-send under the same id, so retry is safe.
//
// An entry leaves the outbox as soon as the real thing is visible, whichever arrives first:
//   - the timeline has a user message with that clientId (or, for natives without the echo, a new
//     untagged one with the same text / in the started turn),
//   - the cutex queue lists an item with that clientUserMessageId,
//   - the submit response says "steered" (the pending-steer row takes over under the same id) or
//     "deduplicated".
// A "queued" response keeps the entry as a confirmed queue row carrying cutex's item (full actions)
// until a queue list fetched after the response has it — or no longer has it (flushed / removed).
// A failed send stays where it was with the error: retry (same id) / back into the composer / discard.
// Pure, unit-tested (test/outbox.test.ts).
import type { QueueItem, SubmitStrategy, UserInputSubmitResult } from "@cutex-desktop/protocol";
import { messageImages } from "../../../shared/input";
import type { TimelineEntry, TimelineState } from "./timeline";

export type OutboxPlacement = "turn" | "steer" | "queue";

export interface OutboxEntry {
  /** clientUserMessageId (the reconciliation key). */
  id: string;
  text: string;
  /** Image / skill input items sent with it. */
  extra: unknown[];
  imageCount: number;
  strategy: SubmitStrategy;
  startIfOffline: boolean;
  /** Where it is shown; predicted on send, corrected by the submit response. */
  placement: OutboxPlacement;
  /** sending: waiting to dispatch or in flight. confirmed: cutex accepted it, the real item is not visible yet. */
  state: "sending" | "confirmed" | "failed";
  /** Still queued in the desktop behind an earlier submit acknowledgement. */
  waitingForPrevious?: boolean;
  /**
   * Interrupt & send, before the submit goes out: "stopping" while cutex stops the running turn,
   * "checking" while the history is re-read for steers the native recorded before the stop.
   */
  stage?: "stopping" | "checking";
  /** Diagnostics (ms, Date.now): shown, submit started, cutex answered, the turn stop returned. */
  createdAt?: number;
  dispatchedAt?: number;
  confirmedAt?: number;
  stoppedAt?: number;
  error?: string;
  /** Confirmed "queued": cutex's queue item (shown as a normal queue row meanwhile). */
  queueItem?: QueueItem;
  /** Confirmed "started": the turn it started (text fallback for natives without the clientId echo). */
  turnId?: string | null;
  /** Untagged user messages with the same text already in the timeline when sent (text fallback). */
  baseline: number;
  /** Order stamp of the confirmation (queue lists fetched later may drop a confirmed queue entry). */
  confirmedTick?: number;
  /** A queued item being steered ("立即"): its queue row is hidden meanwhile, so the queue's own copy
   *  of the id must not count as "landed". */
  promoted?: boolean;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function untaggedCount(timeline: TimelineState, text: string): number {
  const target = norm(text);
  let n = 0;
  for (const e of timeline.entries.values()) if (e.kind === "user" && !e.clientId && norm(e.text) === target) n++;
  return n;
}

export function hasClientId(timeline: TimelineState, id: string): boolean {
  for (const e of timeline.entries.values()) if (e.kind === "user" && e.clientId === id) return true;
  return false;
}

/**
 * Where a send will most likely end up. cutex: "queue" queues while a turn runs; "auto" steers into a
 * running turn (agents without same-turn steering — Claude — queue it instead) or starts one;
 * "interrupt" starts a new turn; an offline submit (startIfOffline) is queued while the runtime starts.
 */
export function predictPlacement(strategy: SubmitStrategy, busy: boolean, opts: { offlineQueued?: boolean; noSteer?: boolean } = {}): OutboxPlacement {
  if (opts.offlineQueued) return "queue";
  if (!busy || strategy === "interrupt") return "turn";
  if (strategy === "queue" || opts.noSteer) return "queue";
  return "steer";
}

const imageCount = (extra: readonly unknown[]) => (extra as { type?: string }[]).filter((x) => x.type === "image" || x.type === "localImage").length;

export function newOutboxEntry(
  timeline: TimelineState | null,
  e: { id: string; text: string; extra?: unknown[]; strategy: SubmitStrategy; placement: OutboxPlacement; startIfOffline?: boolean; promoted?: boolean; stage?: OutboxEntry["stage"] },
  now = Date.now(),
): OutboxEntry {
  const extra = e.extra ?? [];
  return {
    id: e.id,
    text: e.text,
    extra,
    imageCount: imageCount(extra),
    strategy: e.strategy,
    startIfOffline: !!e.startIfOffline,
    placement: e.placement,
    state: "sending",
    baseline: timeline ? untaggedCount(timeline, e.text) : 0,
    createdAt: now,
    ...(e.promoted ? { promoted: true } : {}),
    ...(e.stage ? { stage: e.stage } : {}),
  };
}

const replace = (list: readonly OutboxEntry[], id: string, fn: (e: OutboxEntry) => OutboxEntry | null): OutboxEntry[] => {
  if (!list.some((e) => e.id === id)) return list as OutboxEntry[];
  return list.flatMap((e) => {
    if (e.id !== id) return [e];
    const next = fn(e);
    return next ? [next] : [];
  });
};

/** Apply cutex's submit response. A no-op when the entry already left (its item arrived first). */
export function confirmOutbox(list: readonly OutboxEntry[], id: string, result: UserInputSubmitResult | null, tick: number, now = Date.now()): OutboxEntry[] {
  return replace(list, id, (e) => {
    switch (result?.disposition) {
      case "queued": {
        // cutex flushed it already (flushOutbox ran on its submitted event first): stay in the timeline.
        if (e.placement === "turn" && e.state === "confirmed" && e.promoted) return e;
        const item = result.queue && typeof result.queue === "object" ? (result.queue as QueueItem) : undefined;
        return { ...e, state: "confirmed", placement: "queue", error: undefined, confirmedTick: tick, confirmedAt: now, ...(item ? { queueItem: item } : {}) };
      }
      case "started":
        return { ...e, state: "confirmed", placement: "turn", error: undefined, confirmedTick: tick, confirmedAt: now, turnId: result.turnId ?? null };
      // steered: the pending-steer row (same id) takes over; deduplicated: already there.
      default:
        return null;
    }
  });
}

/**
 * The submit landed in a queue a stop paused (cutex queue-idle-start `paused: true`): it waits for
 * 继续发送. Older cutex has no `paused` field → false (nothing to say).
 */
export function submitLandedPaused(result: UserInputSubmitResult | null | undefined): boolean {
  return result?.disposition === "queued" && result.paused === true;
}

/**
 * Text of a failed send for the user. cutex's `503 idempotency_capacity_exceeded` (its request store
 * is full; the client already retried a few times, nothing was recorded) becomes `capacityText()`;
 * the code survives the IPC hop as the message prefix. Other errors keep their message.
 */
/** cutex refusals of a non-owner's input (users-p2-access): shown in words, not as the raw code. */
export type SendRefusal = "attachment_not_owned" | "input_type_not_allowed";

export function sendErrorText(e: unknown, capacityText: () => string, refusalText?: (code: SendRefusal) => string): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/(?:^|\s)idempotency_capacity_exceeded\b/.test(message)) return capacityText();
  const refusal = refusalText && /(?:^|\s)(attachment_not_owned|input_type_not_allowed)\b/.exec(message);
  return refusal ? refusalText(refusal[1] as SendRefusal) : message;
}

export function failOutbox(list: readonly OutboxEntry[], id: string, error: string): OutboxEntry[] {
  return replace(list, id, (e) => ({ ...e, state: "failed", error }));
}

/** Back to "sending" for a retry (same id: cutex dedupes it if the first attempt did land). */
export function retryOutbox(list: readonly OutboxEntry[], id: string, strategy: SubmitStrategy, placement: OutboxPlacement): OutboxEntry[] {
  return replace(list, id, (e) => ({ ...e, state: "sending", waitingForPrevious: false, error: undefined, strategy, placement, queueItem: undefined, confirmedTick: undefined, confirmedAt: undefined, stage: undefined }));
}

export function markOutboxWaiting(list: readonly OutboxEntry[], id: string, waitingForPrevious: boolean): OutboxEntry[] {
  return replace(list, id, (e) => e.state === "sending" ? { ...e, waitingForPrevious } : e);
}

/** Interrupt & send: the stop returned, the history re-check runs (`stoppedAt` for diagnostics). */
export function setOutboxStage(list: readonly OutboxEntry[], id: string, stage: "checking", now = Date.now()): OutboxEntry[] {
  return replace(list, id, (e) => (e.state === "sending" ? { ...e, stage, stoppedAt: now } : e));
}

/** The submit request starts now: no longer stopping / checking / waiting for an earlier send. */
export function markOutboxDispatched(list: readonly OutboxEntry[], id: string, now = Date.now()): OutboxEntry[] {
  return replace(list, id, (e) => {
    if (e.state !== "sending") return e;
    const { stage: _stage, ...rest } = e;
    return { ...rest, waitingForPrevious: false, dispatchedAt: now };
  });
}

export type OutboxStatusCopy = {
  label: "outbox.confirmed" | "outbox.confirmedSilent" | "outbox.waiting" | "outbox.sending" | "outbox.stopping" | "outbox.checking";
  hint: "outbox.confirmedHint" | "outbox.waitingHint" | "outbox.sendingHint" | "outbox.stoppingHint" | "outbox.checkingHint";
  vars?: { n: number };
};

/**
 * Shared by timeline bubbles and queue/steer rows. Distinguishes: not sent yet (stopping the turn /
 * checking steers / behind an earlier send), in flight (发送中…), and accepted by cutex while its
 * conversation entry has not arrived — with how long the agent has been silent (lib/silentGap) when
 * it is.
 */
export function outboxStatusCopy(entry: OutboxEntry, opts: { silentSeconds?: number | null } = {}): OutboxStatusCopy {
  if (entry.state === "confirmed") {
    if (opts.silentSeconds != null) return { label: "outbox.confirmedSilent", hint: "outbox.confirmedHint", vars: { n: opts.silentSeconds } };
    return { label: "outbox.confirmed", hint: "outbox.confirmedHint" };
  }
  if (entry.state === "sending" && entry.stage === "stopping") return { label: "outbox.stopping", hint: "outbox.stoppingHint" };
  if (entry.state === "sending" && entry.stage === "checking") return { label: "outbox.checking", hint: "outbox.checkingHint" };
  if (entry.state === "sending" && entry.waitingForPrevious) return { label: "outbox.waiting", hint: "outbox.waitingHint" };
  return { label: "outbox.sending", hint: "outbox.sendingHint" };
}

export function removeOutbox(list: readonly OutboxEntry[], id: string): OutboxEntry[] {
  return replace(list, id, () => null);
}

/** Patch the content of an entry (interrupt & send: the merged text is known only after the stop). */
export function updateOutbox(list: readonly OutboxEntry[], id: string, patch: { text: string; extra: unknown[] }): OutboxEntry[] {
  return replace(list, id, (e) => ({ ...e, text: patch.text, extra: patch.extra, imageCount: imageCount(patch.extra) }));
}

function landed(e: OutboxEntry, timeline: TimelineState, queueIds: ReadonlySet<string>, queueTick: number | null, textClaims: Map<string, number>): boolean {
  if (hasClientId(timeline, e.id)) return true;
  if (!e.promoted && queueIds.has(e.id)) return true;
  if (e.state !== "confirmed") return false;
  if (e.placement === "queue") return queueTick !== null && e.confirmedTick !== undefined && queueTick > e.confirmedTick;
  if (e.placement !== "turn") return false;
  // No clientId echo: a new untagged user message with this text (one per entry), or the turn it
  // started has a user message / is already over (never leave a stale bubble behind).
  const key = norm(e.text);
  const claimed = textClaims.get(key) ?? 0;
  if (untaggedCount(timeline, e.text) - e.baseline > claimed) {
    textClaims.set(key, claimed + 1);
    return true;
  }
  if (!e.turnId) return false;
  const turn = timeline.turns.find((t) => t.id === e.turnId);
  if (!turn) return false;
  if (turn.status !== "inProgress") return true;
  return turn.entryIds.some((id) => {
    const entry = timeline.entries.get(id);
    return entry?.kind === "user" && !entry.clientId;
  });
}

/**
 * Drop the entries whose real item is visible now. `queueTick`: order stamp of the queue list in
 * `queue` when it was just fetched (taken before the request), else null. Same array when nothing
 * changed (idempotent: duplicate events are no-ops).
 */
export function reconcileOutbox(list: readonly OutboxEntry[], timeline: TimelineState, queue: readonly QueueItem[], queueTick: number | null = null): OutboxEntry[] {
  if (list.length === 0) return list as OutboxEntry[];
  const queueIds = new Set(queue.map((q) => q.clientUserMessageId));
  const textClaims = new Map<string, number>();
  const keep = list.filter((e) => !landed(e, timeline, queueIds, queueTick, textClaims));
  return keep.length === list.length ? (list as OutboxEntry[]) : keep;
}

/** A send that will start (or has started) a turn whose message is not in the timeline yet. */
export function hasUnlandedTurn(list: readonly OutboxEntry[] | undefined): boolean {
  return !!list?.some((e) => e.placement === "turn" && e.state !== "failed");
}

/** Entries shown at `placement` (confirmed queue entries render as queue items, see visibleQueue). */
export function outboxAt(list: readonly OutboxEntry[] | undefined, placement: OutboxPlacement): OutboxEntry[] {
  return (list ?? []).filter((e) => e.placement === placement && !(placement === "queue" && e.state === "confirmed" && e.queueItem));
}

/**
 * The queue the panel shows: cutex's list without the rows being removed / edited / steered
 * (`hidden` queue ids) or already handed over to a pending bubble elsewhere (an outbox entry with
 * the same clientUserMessageId placed in the turn / the steers: one message is one row, never two),
 * then the confirmed queued sends cutex's list does not have yet. `timeline`: queue rows whose message
 * is already in it are left out too (a flush whose userMessage arrived before the queue list refresh).
 */
export function visibleQueue(queue: readonly QueueItem[], hidden: readonly string[] | undefined, list: readonly OutboxEntry[] | undefined, timeline: TimelineState | null = null): QueueItem[] {
  const hide = new Set(hidden ?? []);
  const known = new Set(queue.map((q) => q.clientUserMessageId));
  const away = new Set((list ?? []).flatMap((e) => (e.placement !== "queue" ? [e.id] : [])));
  // Flushed and already in the timeline (its userMessage beat the queue list refresh): one row, the bubble.
  if (timeline) for (const q of queue) if (q.clientUserMessageId && hasClientId(timeline, q.clientUserMessageId)) away.add(q.clientUserMessageId);
  const confirmed = (list ?? []).flatMap((e) => (e.placement === "queue" && e.state === "confirmed" && e.queueItem && !known.has(e.id) && !hide.has(e.queueItem.queueId) ? [e.queueItem] : []));
  const shown = hide.size || away.size ? queue.filter((q) => !hide.has(q.queueId) && !away.has(q.clientUserMessageId)) : (queue as QueueItem[]);
  return confirmed.length ? [...shown, ...confirmed] : shown;
}

/**
 * A queued message cutex just submitted to the native (`cutex/userInput/submitted`, the queue flush
 * at a turn boundary): its queue row goes at once, and until the native records the userMessage
 * (seconds later, after the turn's pre-sampling work) it shows as a pending bubble at the timeline
 * tail — never in neither place. Only for a turn it started (`disposition: "started"`) and a
 * clientUserMessageId the timeline does not have yet; null otherwise.
 */
export function flushedOutboxEntry(
  timeline: TimelineState | null,
  params: { clientUserMessageId?: unknown; input?: unknown; disposition?: unknown; turnId?: unknown } | undefined,
  tick: number,
  now = Date.now(),
): OutboxEntry | null {
  const id = params?.clientUserMessageId;
  if (typeof id !== "string" || !id || params?.disposition !== "started") return null;
  if (timeline && hasClientId(timeline, id)) return null;
  const input = Array.isArray(params.input) ? (params.input as { type?: string; text?: unknown }[]) : [];
  const text = input.flatMap((x) => (x.type === "text" && typeof x.text === "string" ? [x.text] : [])).join("\n");
  const extra = input.filter((x) => x.type !== "text");
  const entry = newOutboxEntry(timeline, { id, text, extra, strategy: "auto", placement: "turn", promoted: true }, now);
  return { ...entry, state: "confirmed", confirmedTick: tick, confirmedAt: now, turnId: typeof params.turnId === "string" ? params.turnId : null };
}

/**
 * `cutex/userInput/submitted` (a turn started) for a send still in the outbox at another placement —
 * a queued send cutex flushed before its queue row was listed, or one the submit response has not
 * placed yet: it moves to the timeline tail as a confirmed new-turn send with that turn, `promoted`
 * so a stale queue list still holding its id does not count as landed. Same list when nothing applies.
 */
export function flushOutbox(
  list: readonly OutboxEntry[],
  timeline: TimelineState | null,
  params: { clientUserMessageId?: unknown; disposition?: unknown; turnId?: unknown } | undefined,
  tick: number,
  now = Date.now(),
): OutboxEntry[] {
  const id = params?.clientUserMessageId;
  if (typeof id !== "string" || params?.disposition !== "started" || (timeline && hasClientId(timeline, id))) return list as OutboxEntry[];
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const current = list.find((e) => e.id === id);
  if (!current || current.placement === "turn" || current.state === "failed") return list as OutboxEntry[];
  return replace(list, id, (e) =>
    e.placement === "turn" || e.state === "failed"
      ? e
      : { ...e, placement: "turn", state: "confirmed", promoted: true, turnId, error: undefined, queueItem: undefined, confirmedTick: tick, confirmedAt: e.confirmedAt ?? now, stage: undefined, waitingForPrevious: false },
  );
}

/** React key of a send's row: one key for the optimistic bubble and the native userMessage that replaces it. */
export const sendRowKey = (clientUserMessageId: string): string => `send:${clientUserMessageId}`;

/** A timeline entry's row key: the user's messages by their clientUserMessageId (the handoff key), the rest by id. */
export const timelineRowKey = (entry: TimelineEntry): string => (entry.kind === "user" && entry.clientId ? sendRowKey(entry.clientId) : entry.id);

/**
 * The pending new-turn sends shown at the timeline tail: placement "turn", minus any whose message is
 * already in the timeline (reconciliation runs right after; meanwhile the real row is the only one).
 */
export function pendingTail(list: readonly OutboxEntry[] | undefined, timeline: TimelineState): OutboxEntry[] {
  return outboxAt(list, "turn").filter((e) => !hasClientId(timeline, e.id));
}

const pendingEntries = new WeakMap<OutboxEntry, Extract<TimelineEntry, { kind: "user" }>>();

/**
 * A pending send as a user timeline entry (stable per outbox entry object, so the memoized row
 * re-renders only when the send changes). Rendered by the same row component as the real message,
 * under the same key (sendRowKey): the handoff changes props, never the element.
 */
export function pendingUserEntry(e: OutboxEntry): Extract<TimelineEntry, { kind: "user" }> {
  let entry = pendingEntries.get(e);
  if (!entry) {
    // Its images as the message will show them (same thumbnails / file chips): nothing grows at the handoff.
    const images = messageImages(e.extra as { type: string }[]);
    entry = { kind: "user", id: `pending:${e.id}`, text: e.text, turnId: e.turnId ?? "", clientId: e.id, ...(images.length ? { images } : {}) };
    pendingEntries.set(e, entry);
  }
  return entry;
}

/** Hidden queue ids still worth hiding (the item is still listed); same array when unchanged. */
export function pruneHidden(hidden: readonly string[], queue: readonly QueueItem[]): string[] {
  const listed = new Set(queue.map((q) => q.queueId));
  const keep = hidden.filter((id) => listed.has(id));
  return keep.length === hidden.length ? (hidden as string[]) : keep;
}

export type TailSlot = "pending" | "header" | "tail";

/**
 * What follows the timeline's entries, in order. Pending new-turn sends always come before the
 * running turn's header / live line (TurnTail): a send that started a turn is shown before the
 * native records its userMessage — cute-codex emits that item only after the turn's pre-sampling
 * work (auto-compaction, MCP startup, prompt hooks), seconds after turn/started — and must never sit
 * below "工作中". The real message lands in that same place (the turn's first input), so nothing jumps.
 * `headed`: turns whose header was already rendered among the entries.
 */
export function timelineTail(activeTurnId: string | null, headed: ReadonlySet<string>): TailSlot[] {
  if (!activeTurnId) return ["pending"];
  return headed.has(activeTurnId) ? ["pending", "tail"] : ["pending", "header", "tail"];
}
