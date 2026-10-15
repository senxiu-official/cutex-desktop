// Owner notify in the renderer (docs/research/owner-notify.md): where each agent → owner message
// sits in its sender's timeline, and which ones count in 需要你. Pure (unit-tested); the records live
// in lib/ownerNotifyStore, the card is components/OwnerNotifyCard.
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { canReply, isAlerting, isPending } from "../../../shared/ownerNotify";

/**
 * How a note sits in the timeline (quiet pass, owner 2026-10-14): a card only while it asks for a
 * decision — an unread 紧急 note, or one still waiting for the owner's reply. Everything else (read
 * notes, 告知 / 需要你 notes, cutex's own notices) is one quiet row whose actions show on hover / focus.
 */
export function notePresentation(n: Pick<OwnerNotification, "level" | "needsReply" | "origin" | "state">): "card" | "row" {
  return canReply(n) || (n.level === "urgent" && n.state === "open") ? "card" : "row";
}

export { canReply, isAlerting, isFinal, isPending, isSystemNotice, OWNER_NOTIFY_DELETE_FEATURE, previewText } from "../../../shared/ownerNotify";

export interface OwnerNotePlacement {
  /** Before the first rendered row (older than every loaded turn, and nothing older to load). */
  head: OwnerNotification[];
  /** After the rendered row at that index. */
  after: Map<number, OwnerNotification[]>;
}

const byCreated = (a: OwnerNotification, b: OwnerNotification) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.notificationId.localeCompare(b.notificationId);

/**
 * Place an agent's records among the rendered rows (`rowTurnIds[i]` = turn of row i): after the last
 * row of the record's turn (`turnId`), else of the latest turn started before it was created. A
 * record whose turn is loaded but outside the rendered window is left out (it shows when the window
 * widens); one older than every loaded turn goes to the head only when no older history is left.
 */
export function placeOwnerNotes(
  records: readonly OwnerNotification[],
  rowTurnIds: readonly (string | null | undefined)[],
  turns: readonly { id: string; startedAt: number | null }[],
  opts: { olderHistory: boolean },
): OwnerNotePlacement {
  const head: OwnerNotification[] = [];
  const after = new Map<number, OwnerNotification[]>();
  const lastRow = new Map<string, number>();
  rowTurnIds.forEach((id, i) => id && lastRow.set(id, i));
  const known = new Set(turns.map((t) => t.id));
  const put = (i: number, r: OwnerNotification) => after.set(i, [...(after.get(i) ?? []), r]);
  for (const r of [...records].sort(byCreated)) {
    if (rowTurnIds.length === 0) {
      head.push(r);
      continue;
    }
    const turn = noteTurnOf(r, turns, known);
    if (turn) {
      const i = lastRow.get(turn);
      if (i !== undefined) put(i, r);
      // The newest turn has no rendered row yet (it just started): below everything.
      else if (turn === turns[turns.length - 1]?.id) put(rowTurnIds.length - 1, r);
      // else: in a turn hidden by the window
    } else if (!opts.olderHistory) head.push(r);
  }
  return { head, after };
}

/** The loaded turn a record belongs to: its `turnId`, else the latest turn started before it was created. */
export function noteTurnOf(r: Pick<OwnerNotification, "turnId" | "createdAt">, turns: readonly { id: string; startedAt: number | null }[], known: ReadonlySet<string> = new Set(turns.map((t) => t.id))): string | null {
  if (r.turnId && known.has(r.turnId)) return r.turnId;
  const at = Date.parse(r.createdAt) / 1000;
  if (!Number.isFinite(at)) return null;
  let turn: string | null = null;
  for (const t of turns) if (t.startedAt !== null && t.startedAt <= at) turn = t.id;
  return turn;
}

/** 需要你 reason of a pending record (cutex's own notices are never pending, see isPending). */
export function ownerNeedReason(n: Pick<OwnerNotification, "needsReply">): "ownerReply" | "ownerMessage" {
  return n.needsReply ? "ownerReply" : "ownerMessage";
}

/** Pending records per sender, oldest first. */
export function pendingByAgent(records: Iterable<OwnerNotification>): Map<string, OwnerNotification[]> {
  const out = new Map<string, OwnerNotification[]>();
  for (const r of records) if (isPending(r)) out.set(r.agentId, [...(out.get(r.agentId) ?? []), r]);
  for (const list of out.values()) list.sort(byCreated);
  return out;
}

/** An agent's records, oldest first. */
export function recordsOf(byId: Readonly<Record<string, OwnerNotification>>, agentId: string): OwnerNotification[] {
  return Object.values(byId).filter((r) => r.agentId === agentId).sort(byCreated);
}

/**
 * Methods of a new record on this device: what cutex decided (`actions`, notification-levels), else
 * its channels (r216: desktop / big alert). Records that are not alerting (cutex notices, closed) none.
 */
export function ownerNoteActions(record: Pick<OwnerNotification, "state" | "channels" | "origin" | "actions">): string[] {
  if (!isAlerting(record)) return [];
  return record.actions ?? record.channels;
}
