// Agent alarms (cutex `alarms-api`, r225): `alarm_set` reminders an agent set or that will wake it.
// Wire shapes of `GET /v2/alarms`, `DELETE /v2/alarms/{id}` and the host event
// `cutex/alarms/changed` (cutex schema export `alarms`). cutex validates again; the main process
// only passes well-formed ids.

import type { CutexRefusal } from "./ipc";

export const ALARMS_FEATURE = "alarms-api";
export const ALARMS_CHANGED_EVENT = "cutex/alarms/changed";
/** An alarm's unique id (its delivery message id, `alarm-<uuid>`). */
export const ALARM_ID = /^alarm-[A-Za-z0-9-]{1,94}$/;

/** scheduled = waiting for its time; queued = handed to the Agent Bus (delivered after the target's turn). */
export type AlarmState = "scheduled" | "queued" | "cancelled";
/** Seen from the agent asked about: it set the alarm (outgoing), it is woken by it (incoming), or both. */
export type AlarmRelation = "outgoing" | "incoming" | "self";

export interface AlarmView {
  id: string;
  /** The creator's own name for it (unique per creator only). */
  alarmId: string;
  ownerKind: "agent" | "human";
  ownerCutexSessionId: string | null;
  ownerName: string | null;
  targetCutexSessionId: string;
  targetName: string | null;
  /** Due time, RFC 3339. */
  at: string;
  delaySeconds: number | null;
  state: AlarmState;
  attempts: number;
  lastAttemptAt: string | null;
  /** The last failed send attempt (retried every 30 s while scheduled). */
  lastError: string | null;
  messagePreview: string;
  messageChars: number;
  messageTruncated: boolean;
  relation?: AlarmRelation;
  /** Full text (single-alarm read only). */
  message?: string;
}

export interface AlarmList {
  hostId: string;
  alarms: AlarmView[];
  /** Earliest scheduled `at` of the filtered set. */
  nextAt: string | null;
}

export type AlarmChangeReason = "created" | "scheduled" | "queued" | "cancelled" | "retrying" | "removed";

export interface AlarmChange {
  reason: AlarmChangeReason;
  id: string;
  alarm: AlarmView | null;
  ownerCutexSessionId: string | null;
  targetCutexSessionId: string;
  hostId: string;
}

/** A `cutex/alarms/changed` envelope's params, or null for any other event / a malformed one. */
export function alarmChangeOf(envelope: { cutex?: { method?: string; params?: unknown } | null } | null | undefined): AlarmChange | null {
  if (envelope?.cutex?.method !== ALARMS_CHANGED_EVENT) return null;
  const p = envelope.cutex.params as Partial<AlarmChange> | undefined;
  if (!p || typeof p.id !== "string" || typeof p.targetCutexSessionId !== "string") return null;
  return p as AlarmChange;
}

export type AlarmCancelResult = { ok: true; alarm: AlarmView } | { ok: false; error: CutexRefusal };
