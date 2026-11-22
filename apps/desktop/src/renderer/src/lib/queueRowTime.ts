// A 接下来 row's age and full-text tip (owner report 2026-11-19; cross-review of 040eefe42).
// Times are the host's own, never guessed:
//   sent     — the message's confirmed time: an Agent Bus note's queuedAt / sentAt, a delegation request's createdAt.
//   queued   — an owner's queue item createdAt, an older host's ride-along enqueuedAt.
//   recorded — only the ledger record's createdAt: cutex writes it when the record is first created, which for a
//              backfilled or repaired record (input_ledger_bus backfill_batch) is long after the message. It is said as
//              「记录于」 in the tips and never drives the row's age.
// The full text is the app's tip (lib/tips `data-tip` + `data-tip-overflow`: only while the row text is cut off) on a
// focusable trigger, and the whole text on click (components/RowFullText), never a native `title` repeating the row.
import { useI18n } from "../i18n";
import { formatAbsolute, useClock } from "./time";

export type RowTimeKind = "sent" | "queued" | "recorded";

/** The age key and count of an input created at `ms` (null: unknown time). */
export function rowAge(ms: number | null | undefined, now: number): { key: "queue.row.justNow" | "queue.row.minutesAgo" | "queue.row.hoursAgo" | "queue.row.daysAgo"; n: number } | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return { key: "queue.row.justNow", n: 0 };
  if (diff < 3_600_000) return { key: "queue.row.minutesAgo", n: Math.floor(diff / 60_000) };
  if (diff < 86_400_000) return { key: "queue.row.hoursAgo", n: Math.floor(diff / 3_600_000) };
  return { key: "queue.row.daysAgo", n: Math.floor(diff / 86_400_000) };
}

/** Longest row text a tip shows (a preview: the tip is a small float); the whole text opens on click (RowFullText). */
export const ROW_TIP_MAX = 600;

/** A row's tip: its full text (trimmed, blank-line runs folded, capped) and any extra lines (the exact time). */
export function rowTip(text: string | null | undefined, ...lines: (string | null | undefined)[]): string {
  const body = (text ?? "").replace(/^[\s⏎↵]+|[\s⏎↵]+$/gu, "").replace(/\n\s*\n\s*\n+/g, "\n\n");
  const cut = body.length > ROW_TIP_MAX ? `${body.slice(0, ROW_TIP_MAX - 1).trimEnd()}…` : body;
  return [cut, ...lines].filter(Boolean).join("\n");
}

/** Parse an ISO time / epoch ms; null when absent or invalid. */
export function timeMs(at: string | number | null | undefined): number | null {
  if (at == null) return null;
  const ms = typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/** The best time a ledger row has: the confirmed message time, else the record's creation as 「记录于」. */
export function ledgerRowTime(messageAt: string | number | null | undefined, recordCreatedAt: string, confirmed: "sent" | "queued" = "sent"): { at: string | number | null; kind: RowTimeKind } {
  return timeMs(messageAt) !== null ? { at: messageAt!, kind: confirmed } : { at: recordCreatedAt, kind: "recorded" };
}

const EXACT = { sent: "queue.row.sentAt", queued: "queue.row.queuedAt", recorded: "queue.row.recordedAt" } as const;

/**
 * The words for a row's time: `age` (「3 小时前」, on the row; only for a confirmed time) and `exact`
 * (「2026-11-19 09:12:05 发出」 / 「记录于 …」, in the tips and the full-text view); both null without a time.
 */
export function useRowTime(at: string | number | null | undefined, kind: RowTimeKind = "sent"): { age: string | null; exact: string | null } {
  const { t } = useI18n();
  const ms = timeMs(at);
  // The shared 30 s clock only re-renders the row; the age is read against the time now (the clock keeps its last tick).
  useClock(ms !== null && kind !== "recorded");
  const age = kind === "recorded" ? null : rowAge(ms, Date.now());
  if (ms === null) return { age: null, exact: null };
  return { age: age ? t(age.key, { n: age.n }) : null, exact: t(EXACT[kind], { time: formatAbsolute(ms / 1000) }) };
}
