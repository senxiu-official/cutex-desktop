// Claude quota auto-continue (cutex `claude-quota-auto-continue`): when a Claude agent's turn fails on
// an exhausted usage limit, cutex sends it one continuation when the limit resets (+ 30–119 s), per
// agent, default on. Wire shapes of `GET /v2/quota-auto-continue?sessionId=`, `PATCH
// /v2/quota-auto-continue/{sessionId}`, `DELETE /v2/quota-auto-continue/{sessionId}/pending` and the host
// event `cutex/quotaAutoContinue/changed` (cutex schema export `quota-auto-continue`).

import type { CutexRefusal } from "./ipc";

export const QUOTA_CONTINUE_FEATURE = "claude-quota-auto-continue";
export const QUOTA_CONTINUE_CHANGED_EVENT = "cutex/quotaAutoContinue/changed";

export interface QuotaContinuePending {
  /** When the continuation is sent (the reset + jitter), RFC 3339. */
  at: string;
  /** When the exhausted limit resets. */
  resetAt: string | null;
  accountId: string | null;
  /** The turn that hit the limit. */
  turnId: string | null;
  scheduledAt: string;
}

export interface QuotaContinueOutcome {
  at: string;
  result: "fired" | "skipped" | "cancelled" | "failed";
  /** e.g. resetUnknown, windowAlreadyContinued, offline, ownerMessage, owner, turnCompleted; a submit disposition when fired. */
  reason: string | null;
  resetAt: string | null;
}

export interface QuotaContinueView {
  cutexSessionId: string;
  enabled: boolean;
  pending: QuotaContinuePending | null;
  last: QuotaContinueOutcome | null;
}

export type QuotaContinueChangeReason = "scheduled" | "cancelled" | "fired" | "skipped" | "failed" | "enabled" | "disabled";

export interface QuotaContinueChange {
  cutexSessionId: string;
  reason: QuotaContinueChangeReason;
  quotaAutoContinue: QuotaContinueView;
  hostId: string;
}

/** A `cutex/quotaAutoContinue/changed` envelope's params, or null for any other event / a malformed one. */
export function quotaContinueChangeOf(envelope: { cutex?: { method?: string; params?: unknown } | null } | null | undefined): QuotaContinueChange | null {
  if (envelope?.cutex?.method !== QUOTA_CONTINUE_CHANGED_EVENT) return null;
  const p = envelope.cutex.params as Partial<QuotaContinueChange> | undefined;
  const view = p?.quotaAutoContinue;
  if (!p || typeof p.cutexSessionId !== "string" || !view || typeof view.enabled !== "boolean" || view.cutexSessionId !== p.cutexSessionId) return null;
  return p as QuotaContinueChange;
}

/** The answer of a switch / cancel: the new view, or cutex's refusal. */
export type QuotaContinueResult = { ok: true; view: QuotaContinueView } | { ok: false; error: CutexRefusal };

/** HH:MM of the continuation (明天 / Tomorrow prefix when it is not today), local time. */
export function continueClock(at: string, now: number, locale: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 86_400_000;
  if (ms < dayStart + day) return clock;
  const zh = locale === "zh-CN";
  if (ms < dayStart + 2 * day) return zh ? `明天 ${clock}` : `tomorrow ${clock}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}
