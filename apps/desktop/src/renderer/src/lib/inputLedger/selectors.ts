// 054 §3.2: what each surface shows, read straight from cutex's records. No inference: `surface` decides.

import type { InputRecord } from "@cutex-desktop/protocol";
import type { InputLedgerSession } from "./alignment";
import { projectNextUp } from "./nextUpRegistry";

function byCreated(a: InputRecord, b: InputRecord): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.inputId < b.inputId ? -1 : a.inputId > b.inputId ? 1 : 0;
}

/** nextUp order: `order.position` (records without one after those with one), then `createdAt`, then id. */
export function compareNextUp(a: InputRecord, b: InputRecord): number {
  const pa = a.order?.position;
  const pb = b.order?.position;
  if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb;
  if (pa !== undefined && pb === undefined) return -1;
  if (pa === undefined && pb !== undefined) return 1;
  return byCreated(a, b);
}

function onSurface(session: InputLedgerSession, surface: InputRecord["surface"]): InputRecord[] {
  const out: InputRecord[] = [];
  for (const record of session.records.values()) if (record.surface === surface) out.push(record);
  return out;
}

/**
 * Chat: records on `timeline`, oldest first. The renderer joins each with its native item by
 * `timelineItemId` / clientUserMessageId (same React key); those without a native item are status rows at the end.
 */
export function timelineRecords(session: InputLedgerSession): InputRecord[] {
  return onSurface(session, "timeline").sort(byCreated);
}

/** The record joined to a native timeline item, by `timelineItemId` first, then by input id (owner clientUserMessageId). */
export function timelineRecordFor(session: InputLedgerSession, itemId: string, clientUserMessageId?: string | null): InputRecord | undefined {
  for (const record of session.records.values()) {
    if (record.surface === "timeline" && record.timelineItemId === itemId) return record;
  }
  if (clientUserMessageId) {
    const record = session.records.get(clientUserMessageId);
    if (record?.surface === "timeline") return record;
  }
  return undefined;
}

/**
 * 「接下来」: records on `nextUp` (owner queued items, delegation requests and ride-alongs in one list), by
 * `order.position`, then `createdAt`. Next Up registry 1.4: a read / dismissed / superseded record leaves at once (no
 * empty line), and a failed or unconfirmed one stays until the owner handles it (no 15-minute fade; owner decision 4 of
 * 2026-11-01 is replaced). `now` is kept for callers; membership never depends on time.
 */
export function nextUpRecords(session: InputLedgerSession, _options: { now?: number } = {}): InputRecord[] {
  return onSurface(session, "nextUp")
    .filter(record => projectNextUp(record).kind !== "hidden")
    .sort(compareNextUp);
}

/** 「待读留言」: records on `pendingNotes`, oldest first. The body comes from the bus store; state never does. */
export function pendingNoteRecords(session: InputLedgerSession): InputRecord[] {
  return onSurface(session, "pendingNotes").sort(byCreated);
}
