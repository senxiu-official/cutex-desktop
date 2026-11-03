// 054 §3.2: what each surface shows, read straight from cutex's records. No inference: `surface` decides.

import type { InputRecord } from "@cutex-desktop/protocol";
import { isInputSettled } from "@cutex-desktop/protocol";
import type { InputLedgerSession } from "./alignment";

/** Owner decision 4 (2026-11-01): nextUp shows records settled in the last 15 minutes. */
export const NEXT_UP_SETTLED_WINDOW_MS = 15 * 60 * 1000;

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
 * `order.position`, then `createdAt`. Settled ones show only within `settledWindowMs` of settling (`since`).
 */
export function nextUpRecords(session: InputLedgerSession, options: { now?: number; settledWindowMs?: number } = {}): InputRecord[] {
  const window = options.settledWindowMs ?? NEXT_UP_SETTLED_WINDOW_MS;
  const now = options.now;
  return onSurface(session, "nextUp")
    .filter(record => now === undefined || record.state === "uncertain" || !isInputSettled(record.state) || now - Date.parse(record.since) <= window)
    .sort(compareNextUp);
}

/** 「待读留言」: records on `pendingNotes`, oldest first. The body comes from the bus store; state never does. */
export function pendingNoteRecords(session: InputLedgerSession): InputRecord[] {
  return onSurface(session, "pendingNotes").sort(byCreated);
}
