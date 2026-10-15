// The one entry for "something may notify the owner" (replaces lib/notify.ts and the planned
// `services.notify.os`). Shell code (store.ts, the owner-notify store) reports occurrences here; the
// core `notifications` module installs the handler that asks the host's tables (cutex notification
// levels) what to do and runs this device's methods (`notify.method` slot). Shell code never imports
// the module (docs/desktop-modules.md §8), so the module plugs in through this file.

/** One thing that happened, described by the registered events it matches (cutex registry ids). */
export interface NotifyOccurrence {
  /** Stable per occurrence (dedupe, replace tag, click routing). */
  key: string;
  /** The connected host it happened on when that is not the shown host (multi-host: its tables decide). */
  hostId?: string;
  /** Matching events (the highest level wins), e.g. ["native.approval"]. */
  events: string[];
  /** Already decided by cutex (owner_notify records carry their methods); skips evaluation. */
  decided?: { level: "urgent" | "needsYou" | "inform" | "record"; actions: string[] };
  /** Methods for a host without notification levels (r216 behaviour of this desktop). */
  fallback: string[];
  /** cutexSessionId it is about. */
  agentId: string | null;
  agentName: string | null;
  /** The agent's project: undefined = unknown, null = independent. */
  projectId?: string | null;
  title: string;
  body: string;
  /** The owner is looking at it right now (focused window on that agent / page): nothing pops up. */
  looking: boolean;
  /** Methods that run elsewhere for this occurrence (owner_notify big alerts: main). */
  skip?: string[];
  /**
   * The in-app mark this occurrence may leave (a finished turn's 「完成」 / 「出错」, lib/turnUnread).
   * Left when the host's tables turn the `mark` method on for the decided level, and whenever the
   * tables do not decide (a cutex without notification levels, tables / host unreachable, no handler):
   * nothing silently disappears there.
   */
  mark?(): void;
  onClick?(): void;
}

export type NotifyHandler = (occurrence: NotifyOccurrence) => void;

let handler: NotifyHandler | null = null;

/** The notifications module plugs in (returns the dispose). */
export function setNotifyHandler(next: NotifyHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Report an occurrence (dropped while no handler is installed). */
export function emitNotify(occurrence: NotifyOccurrence): void {
  try {
    if (handler) handler(occurrence);
    else occurrence.mark?.();
  } catch (error) {
    console.warn("[notifications] handler failed", error);
  }
}

// ---------- retract (the owner handled it in the app) ----------

/**
 * What no longer needs the owner: occurrence keys (as emitted, e.g. `req:<agent>:<requestId>`), key
 * prefixes ending with ":" (`req:<agent>:`), and owner_notify records the renderer saw closed (main
 * drops their big alert too, in case it missed the host event).
 */
export interface NotifyRetraction {
  keys?: string[];
  prefixes?: string[];
  notes?: { hostId: string; notificationId: string }[];
}

export type RetractHandler = (retraction: NotifyRetraction) => void;

let retractHandler: RetractHandler | null = null;

/** The notifications module plugs in (returns the dispose). */
export function setRetractHandler(next: RetractHandler): () => void {
  retractHandler = next;
  return () => {
    if (retractHandler === next) retractHandler = null;
  };
}

/** Take back an occurrence's popups (event big alert, desktop notification); dropped while no handler is installed. */
export function retractNotify(retraction: NotifyRetraction): void {
  if (!retraction.keys?.length && !retraction.prefixes?.length && !retraction.notes?.length) return;
  try {
    retractHandler?.(retraction);
  } catch (error) {
    console.warn("[notifications] retract failed", error);
  }
}

/** Key prefixes of an agent's own occurrences (its native requests, its turn ends). */
export function agentRetraction(agentId: string): NotifyRetraction {
  return { prefixes: [`req:${agentId}:`, `turn:${agentId}:`] };
}

// ---------- clicks (desktop notifications raised through main, event big alerts) ----------

const clicks = new Map<string, () => void>();
const MAX_CLICKS = 100;

/** Remember what a click on `key` does (bounded; the oldest are forgotten). */
export function rememberClick(key: string, onClick: (() => void) | undefined): void {
  clicks.delete(key);
  if (!onClick) return;
  clicks.set(key, onClick);
  while (clicks.size > MAX_CLICKS) clicks.delete(clicks.keys().next().value as string);
}

/** Main reported a click (`notifyClick`). */
export function runClick(key: string): void {
  const fn = clicks.get(key);
  clicks.delete(key);
  fn?.();
}
