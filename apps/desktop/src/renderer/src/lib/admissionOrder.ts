// Shared admission order (cutex `admission-order`, docs/cutex-agent-asks.md §5.3 *Shared admission
// order*), shown as turn groups (docs/research/queue-turn-groups-plan-20261012.md): what the agent
// reads next, turn by turn. The current turn (while one runs) holds the owner's inserts and the
// ride-along deliveries read at its next step or after it; idle, the ride-along items start one turn
// by themselves (「马上开始」); then one numbered group per owner queued message / delegation. Only
// owner groups move (to any slot); delegations keep their relative order. With
// `queue.ownerMayPassAsks` off a move may not put an owner message ahead of a delegation that is
// ahead of it now. Dragging an owner message into the current turn inserts it (steer), except into
// a delegation's turn.
// Pure (no React, no store) so it is unit-tested; the cached setting hook is admissionOrderView.ts.
import type { AdmissionCurrentTurn, AdmissionItem, AdmissionNextStep, AdmissionRef, QueueAdmission, QueueItem } from "@cutex-desktop/protocol";
import type { AskHold, AskSummary, GlobalSettings } from "../../../shared/ipc";
import { AGENT_MESSAGES_V2 } from "./agentMessages";

export const ADMISSION_ORDER_FEATURE = "admission-order";
/** cutex/userInput/queue/yield: the owner lets waiting ride-alongs go first once. */
export const OWNER_YIELD_FEATURE = "admission-owner-yield";

/** One numbered turn group. Owner groups carry their queue item (text, revision, hover actions). */
export type AdmissionRow =
  | { kind: "owner"; key: string; entry: AdmissionItem; item: QueueItem }
  /** `ask`: the asks API summary (null while not loaded, or when this client cannot see it). */
  | { kind: "ask"; key: string; entry: Extract<AdmissionItem, { kind: "ask" }>; ask: AskSummary | null };

export interface TurnGroups {
  /** One per turn, in admission order (turn number = index + 1). */
  turns: AdmissionRow[];
  /** Ride-along deliveries (the current turn's, or — idle — the turn that starts by itself). */
  nextStep: AdmissionNextStep[];
}

export const refOf = (entry: Pick<AdmissionItem, "kind" | "id">): AdmissionRef => ({ kind: entry.kind, id: entry.id });

const sameRef = (a: Pick<AdmissionItem, "kind" | "id">, b: AdmissionRef | null) => !!b && a.kind === b.kind && a.id === b.id;

const byPosition = (a: AdmissionItem, b: AdmissionItem) => a.position - b.position;

/** cutex/userInput admission rows carry `from` / `fromHost` / `preview` (cutex admission-ridealong-detail). */
export const RIDEALONG_DETAIL_FEATURE = "admission-ridealong-detail";

/** cutex's English fallback labels (management/v2/admission.rs, agent_bus_state.rs): they only repeat the
 *  kind the row's icon already says, so they are dropped. Older cutex sends nothing else for bus items. */
const GENERIC_RIDE_ALONG_LABELS: Readonly<Record<string, readonly string[]>> = {
  answer: ["Answer"],
  question: ["Question"],
  bus: ["Delegation status", "Bus delivery", "System message", "Message", "Job finished"],
  alarm: ["Alarm"],
  tell: ["Agent message", "Peer message"],
};

/** The label a ride-along row shows; null = nothing beyond the kind. */
export function rideAlongLabel(item: Pick<AdmissionNextStep, "deliveryKind" | "label">): string | null {
  const label = item.label?.trim() || null;
  return label && GENERIC_RIDE_ALONG_LABELS[item.deliveryKind]?.includes(label) ? null : label;
}

/** The kind icon of a ride-along row (components/AdmissionRows). */
export type RideAlongKind = "answer" | "question" | "status" | "tell" | "peer" | "alarm" | "bus";

/** What a ride-along row shows apart from its delegation parts and timing. */
export interface RideAlongView {
  kind: RideAlongKind;
  /** The sender (`from`), shown before the text; null = unknown / an alarm. */
  from: string | null;
  /** The most specific text: cutex `preview`, else a non-generic `label`; null = nothing specific. */
  text: string | null;
  /** A non-generic label that says more than `text` (a control-type description): the row's tooltip. */
  note: string | null;
}

/**
 * The row of a ride-along item. Kind: a cross-host tell (`fromHost`) is a peer message; a `bus` item of
 * a delegation (`askId`) is its status change. Text: `preview` (cutex admission-ridealong-detail), else
 * the label unless it only repeats the kind (older cutex); the row then falls back to kind + sender +
 * when it was enqueued (never only a kind word).
 */
export function rideAlongView(item: Pick<AdmissionNextStep, "deliveryKind" | "label" | "askId" | "from" | "fromHost" | "preview">): RideAlongView {
  const k = item.deliveryKind;
  const kind: RideAlongKind =
    k === "answer" ? "answer" : k === "question" ? "question" : k === "alarm" ? "alarm"
      : item.fromHost?.trim()
        ? "peer"
        : item.deliveryKind === "tell"
          ? "tell"
          : item.askId
            ? "status"
            : "bus";
  const label = rideAlongLabel(item);
  const preview = item.preview?.trim() || null;
  const text = preview ?? label;
  return { kind, from: item.from?.trim() || null, text, note: label && label !== text ? label : null };
}

/** What a ride-along row shows of its delegation (cutex `askId`): the other party and the title. */
export interface RideAlongAsk {
  askId: string;
  /** Whose name the row shows: the handler (results / questions / status reach the requester), or —
   *  when this agent is the delegation's handler — the requester. */
  party: "target" | "requester";
  /** The delegation's title; null = untitled (the row shows nothing beyond the party and #tag). */
  title: string | null;
}

/** The delegation of a ride-along row, or null (no `askId` — an older cutex / another source — or not loaded). */
export function rideAlongAsk(item: Pick<AdmissionNextStep, "askId">, ask: Pick<AskSummary, "askId" | "target" | "title"> | null | undefined, sessionId: string): RideAlongAsk | null {
  if (!item.askId || !ask || ask.askId !== item.askId) return null;
  return { askId: ask.askId, party: ask.target === sessionId ? "requester" : "target", title: ask.title?.trim() || null };
}

/**
 * The turn groups. Owner entries whose queue item is not shown (removal / edit / 立即 in flight,
 * lib/outbox `visibleQueue`) are left out. An owner queue item the admission list does not have yet
 * (only a stale list) goes last: new items are admitted after every existing one. A `delivery` entry
 * of an older draft is read as a ride-along item.
 */
export function turnGroups(admission: QueueAdmission, queue: readonly QueueItem[], asks: Readonly<Record<string, AskSummary>>): TurnGroups {
  const items = new Map(queue.map((q) => [q.queueId, q]));
  const turns: AdmissionRow[] = [];
  const nextStep: AdmissionNextStep[] = [...(admission.nextStep ?? [])];
  const listed = new Set<string>();
  for (const entry of [...admission.items].sort(byPosition)) {
    const key = `${entry.kind}:${entry.id}`;
    if (entry.kind === "owner") {
      listed.add(entry.id);
      const item = items.get(entry.id);
      if (item) turns.push({ kind: "owner", key: item.clientUserMessageId || key, entry, item });
    } else if (entry.kind === "ask") turns.push({ kind: "ask", key, entry, ask: asks[entry.id] ?? null });
    else nextStep.push({ id: entry.id, deliveryKind: entry.deliveryKind, label: entry.label ?? null, enqueuedAt: entry.enqueuedAt });
  }
  let position = admission.items.length;
  for (const item of queue)
    if (!listed.has(item.queueId))
      turns.push({ kind: "owner", key: item.clientUserMessageId || item.queueId, entry: { kind: "owner", id: item.queueId, position: ++position, enqueuedAt: item.createdAt, state: "waiting" }, item });
  return { turns, nextStep };
}

/** How a ride-along item joins the running turn (shown as a symbol, the words in its tooltip). */
export type RideAlongTiming =
  /** Waits for the turn end (an alarm, or a wake without a switch time). */
  | { kind: "afterTurn" }
  /** A bus wake waiting for the turn end; at `nextStepAt` it is read at the next step. `left` 1 → 0. */
  | { kind: "waitInsert"; secs: number; left: number }
  /** Read at the running turn's next step. */
  | { kind: "nextStep" };

/**
 * The timing of a ride-along item at `now` (ms) while a turn runs. Without `timing` (older drafts):
 * alarms after the turn, everything else at the next step. A wake past its `nextStepAt` is at the next
 * step even before cutex lists it so. `left` = the share of the wait still to go (nextStepAt −
 * enqueuedAt is the whole wait).
 */
export function rideAlongTiming(item: AdmissionNextStep, now: number): RideAlongTiming {
  const timing = item.timing ?? (item.deliveryKind === "alarm" ? "afterTurn" : "nextStep");
  if (timing === "nextStep") return { kind: "nextStep" };
  const at = item.nextStepAt ? Date.parse(item.nextStepAt) : NaN;
  if (!Number.isFinite(at)) return { kind: "afterTurn" };
  const ms = at - now;
  if (ms <= 0) return { kind: "nextStep" };
  const total = at - Date.parse(item.enqueuedAt);
  const left = Number.isFinite(total) && total > 0 ? Math.min(1, ms / total) : 1;
  return { kind: "waitInsert", secs: Math.ceil(ms / 1000), left };
}

/** Why the current turn takes no insert (null = it does): a delegation's turn, or a runtime without steering. */
export type InsertRefusal = "askTurn" | "noSteer" | null;

export function insertRefusal(currentTurn: AdmissionCurrentTurn | null, canSteer: boolean): InsertRefusal {
  if (currentTurn?.kind === "ask") return "askTurn";
  return canSteer ? null : "noSteer";
}

/**
 * The insertion slot for a drag over turn group `index` (`fraction` = pointer height in the group,
 * 0 top … 1 bottom): an owner group splits in halves; a delegation group takes a drop only near its
 * edges (null in the middle: dropping onto a delegation is not accepted).
 */
export function slotForGroup(kind: AdmissionRow["kind"], index: number, fraction: number): number | null {
  if (kind === "owner") return fraction < 0.5 ? index : index + 1;
  if (fraction < 0.3) return index;
  if (fraction > 0.7) return index + 1;
  return null;
}

/** Up to this many rows the queue card shows them all (queue redesign 2026-10-15). */
export const ROW_CAP = 3;
/** Rows shown before 「还有 N 项」 once there are more than ROW_CAP. */
export const FOLDED_ROWS = 2;

/**
 * How many of the `queueRows` rows after the boundary section show: all of them up to ROW_CAP rows in
 * all; past that the first FOLDED_ROWS (the boundary section — what enters the running turn — always
 * shows fully, and counts against them). All of them when expanded.
 */
export function foldQueueRows(boundaryRows: number, queueRows: number, expanded: boolean): { shown: number; hidden: number } {
  const shown = expanded || boundaryRows + queueRows <= ROW_CAP ? queueRows : Math.min(queueRows, Math.max(0, FOLDED_ROWS - boundaryRows));
  return { shown, hidden: queueRows - shown };
}

/**
 * The 「还有 N 项」 row: only while something is folded, or as 「收起」 after the owner expanded a list
 * that would fold. Never while a drag expands it (no 「还有 0 项」).
 */
export function foldRow(boundaryRows: number, queueRows: number, expanded: boolean, dragging: boolean): { show: boolean; hidden: number } {
  const { hidden } = foldQueueRows(boundaryRows, queueRows, expanded || dragging);
  const wouldFold = foldQueueRows(boundaryRows, queueRows, false).hidden > 0;
  return { show: hidden > 0 || (expanded && wouldFold), hidden };
}

/**
 * The old 待读留言 section (agent-messages-v2) in the queue area: only without admission-order — with
 * it those unread bus messages are the turn frame's ride-along items (admission.nextStep).
 */
export function pendingMessagesSectionShown(features: ReadonlySet<string>, pending: number): boolean {
  return features.has(AGENT_MESSAGES_V2) && !features.has(ADMISSION_ORDER_FEATURE) && pending > 0;
}

/** Whether a turn will not start by itself (paused, or an owner item held). */
export function turnStopped(row: AdmissionRow, held: ReadonlySet<string>): boolean {
  return row.entry.state === "paused" || (row.kind === "owner" && held.has(row.item.queueId));
}

/**
 * After a ride-along-started turn (`currentTurn.kind` "delivery"), waiting owner input goes first
 * (cutex user-input-delivery §3; numbered asks ahead of it keep their place): a ride-along that is
 * still waiting for the turn end then joins the next numbered turn at its boundary instead of
 * starting its own. That turn's number (1-based), or null when the rule does not apply.
 */
export function rideAlongsFollowTurn(running: boolean, currentTurn: AdmissionCurrentTurn | null, turns: readonly AdmissionRow[], held: ReadonlySet<string>): number | null {
  if (!running || currentTurn?.kind !== "delivery") return null;
  if (!turns.some((r) => r.kind === "owner" && !turnStopped(r, held))) return null;
  const next = turns.findIndex((r) => !turnStopped(r, held));
  return next < 0 ? null : next + 1;
}

/**
 * Where the 「队列已暂停」 divider goes: the start of the trailing run of turns that will not start by
 * themselves; -1 = none. A stopped turn doesn't block the ones after it (cutex admission order), so a
 * stopped turn above a startable one is marked on its own row instead (`turnStopped`).
 */
export function pausedFrom(turns: readonly AdmissionRow[], held: ReadonlySet<string>): number {
  let at = turns.length;
  while (at > 0 && turnStopped(turns[at - 1]!, held)) at--;
  return at === turns.length ? -1 : at;
}

/** Ask ids the merged list shows (the rest of the pending delegations keep their own section). */
export function admittedAskIds(admission: QueueAdmission | null): ReadonlySet<string> {
  return new Set((admission?.items ?? []).filter((e) => e.kind === "ask").map((e) => e.id));
}

/**
 * The ask as its row shows it: a `targetBusy` hold names the merged list's position (cutex keeps them
 * equal; an older list may still name the asks-only one), so the status mark matches the row order.
 */
export function askWithAdmissionPosition(ask: AskSummary, entry: AdmissionItem): AskSummary {
  const hold: AskHold | null | undefined = ask.hold;
  if (hold?.reason !== "targetBusy" || hold.position === entry.position) return ask;
  return { ...ask, hold: { ...hold, position: entry.position }, queuePosition: entry.position };
}

/**
 * Whether the owner item at `from` may go to insertion slot `slot` (0 … length: before entry `slot`,
 * `length` = the end). False for a no-op (its own slot or the one right after it), for a non-owner
 * item, and — `mayPass` false — for a slot that puts it ahead of a non-owner entry now ahead of it.
 */
export function canMoveTo(entries: readonly Pick<AdmissionItem, "kind">[], from: number, slot: number, mayPass: boolean): boolean {
  if (entries[from]?.kind !== "owner" || slot < 0 || slot > entries.length || slot === from || slot === from + 1) return false;
  if (slot > from || mayPass) return true;
  for (let i = slot; i < from; i++) if (entries[i]!.kind !== "owner") return false;
  return true;
}

/** `before` of a move to insertion slot `slot` (null = to the end). */
export function beforeForSlot(entries: readonly AdmissionItem[], slot: number): AdmissionRef | null {
  const at = entries[slot];
  return at ? refOf(at) : null;
}

/** A move the menu / keyboard offers: `before` to send. */
export interface MoveTarget {
  before: AdmissionRef | null;
}

/**
 * 上移 / 下移 / 移到最后 for the owner item `queueId` (undefined = not offered right now). 上移 passes
 * the row right before it (not offered over a non-owner row with `mayPass` false); 下移 goes after the
 * row right after it; 移到最后 = to the end. Moving later is always allowed.
 */
export function moveTargets(entries: readonly AdmissionItem[], queueId: string, mayPass: boolean): { up?: MoveTarget; down?: MoveTarget; last?: MoveTarget } {
  const from = entries.findIndex((e) => e.kind === "owner" && e.id === queueId);
  if (from < 0) return {};
  const at = (slot: number): MoveTarget | undefined => (canMoveTo(entries, from, slot, mayPass) ? { before: beforeForSlot(entries, slot) } : undefined);
  return { up: at(from - 1), down: at(from + 2), last: at(entries.length) };
}

/**
 * The admission list after moving owner item `queueId` before `before` (null = to the end), positions
 * renumbered from 1 (the optimistic order; cutex's answer replaces it). The same object when nothing
 * changes (unknown item, unknown `before`, or the same place).
 */
export function applyMove(admission: QueueAdmission, queueId: string, before: AdmissionRef | null): QueueAdmission {
  const sorted = [...admission.items].sort(byPosition);
  const from = sorted.findIndex((e) => e.kind === "owner" && e.id === queueId);
  if (from < 0 || (before && before.kind === "owner" && before.id === queueId)) return admission;
  const moved = sorted[from]!;
  const rest = sorted.filter((_, i) => i !== from);
  const slot = before ? rest.findIndex((e) => sameRef(e, before)) : rest.length;
  if (slot < 0) return admission;
  const next = [...rest.slice(0, slot), moved, ...rest.slice(slot)];
  if (next.every((e, i) => e === sorted[i])) return admission;
  return { ...admission, items: next.map((e, i) => (e.position === i + 1 ? e : { ...e, position: i + 1 })) };
}

/** `queue.ownerMayPassAsks` of a `/v2/settings` view; undefined = older cutex / not loaded (cutex default: true). */
export function readOwnerMayPassAsks(settings: Pick<GlobalSettings, "queue"> | null | undefined): boolean | undefined {
  const v = settings?.queue?.ownerMayPassAsks;
  return typeof v === "boolean" ? v : undefined;
}

/**
 * Ride-along items of the 「下个工具边界」 card while a turn runs: those read at its next step and
 * wakes still waiting for the turn end (their ring). The rest (alarms; wakes that never switch) wait
 * for the turn end: the queue card's 「本回合结束后」 group.
 */
export function atBoundary(item: AdmissionNextStep): boolean {
  const timing = item.timing ?? (item.deliveryKind === "alarm" ? "afterTurn" : "nextStep");
  return timing === "nextStep" || !!item.nextStepAt;
}

/** The running turn's owner when cutex does not say (older drafts): the delegation the timeline shows, else the owner. */
export function currentTurnOf(running: boolean, listed: AdmissionCurrentTurn | null | undefined, delegationAskId: string | null): AdmissionCurrentTurn | null {
  if (!running) return null;
  if (listed) return listed;
  return delegationAskId ? { kind: "ask", askId: delegationAskId } : { kind: "owner" };
}
