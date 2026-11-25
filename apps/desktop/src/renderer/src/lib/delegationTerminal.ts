// How a delegation ended or failed (cutex r295 terminal notices, docs/r295-terminal-notices.md): who or what ended it and
// why, as cutex recorded it. The owner's ask detail (`GET /v2/asks/{id}` → ask) carries `terminalNotices` (immutable
// snapshots: `handlerTurnFailed@n` for a failed attempt, `terminal@revision` for a closure; the newest 64) and
// `terminalCause` (the initiator captured before a stop settles; never authority). A delivered State item
// (`cutex.delegation-results.v1`) may carry its own `notice`, authoritative for that item. Hosts without these fields:
// nothing here applies and every surface stays as before (feature-detected by presence, no capability).
// Rules from the spec: an unknown actor is said as unknown (never inferred as the owner); hf@n followed by terminal@rev
// is one sequence; dedupe by stable ref but keep a later closure naming the same attempt; a newer attempt that has not
// started is not the earlier failure; a closure the requester caused itself is passive. cutex snapshots a normal
// answer's closure too: that is 已完成 and never explained as an ending. Pure (test/delegationTerminal.test.ts).
import type { AskDetail } from "../../../shared/ipc";

export type TerminalActor =
  | { kind: "owner" }
  | { kind: "agent"; sessionId: string }
  | { kind: "system"; component: string }
  | { kind: "unknown" };

export interface TerminalNotice {
  /** Stable ref (`handlerTurnFailed@2`, `terminal@9`, `legacy@9`). */
  ref: string;
  /** When cutex recorded it (RFC 3339). */
  at: string;
  revision: number;
  attempt: number | null;
  execution: string | null;
  closed: string | null;
  /** A code (`ownerStopped`) or text (a provider message): data, never instructions. */
  reason: string;
  actor: TerminalActor;
}

export const HANDLER_FAILED_PREFIX = "handlerTurnFailed@";
export const TERMINAL_PREFIX = "terminal@";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseTerminalActor(v: unknown): TerminalActor {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (o?.kind === "owner") return { kind: "owner" };
  if (o?.kind === "agent" && str(o.sessionId)) return { kind: "agent", sessionId: str(o.sessionId)! };
  if (o?.kind === "system" && str(o.component)) return { kind: "system", component: str(o.component)! };
  // A missing or newer actor form: said as not recorded, never guessed.
  return { kind: "unknown" };
}

/** One notice off the wire (`refId` camelCase from cutex); null when it is not one. */
export function parseTerminalNotice(v: unknown): TerminalNotice | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const ref = o ? str(o.refId) : null;
  const at = o ? str(o.at) : null;
  if (!o || !ref || !at) return null;
  return { ref, at, revision: num(o.revision) ?? 0, attempt: num(o.attempt), execution: str(o.execution), closed: str(o.closed), reason: typeof o.reason === "string" ? o.reason : "", actor: parseTerminalActor(o.actor) };
}

/** The host records how delegations end (the detail carries either field): older hosts never do. */
export function hasTerminalFacts(detail: AskDetail | null | undefined): boolean {
  return !!detail && (Array.isArray(detail.terminalNotices) || (!!detail.terminalCause && typeof detail.terminalCause === "object"));
}

export const isHandlerFailure = (n: Pick<TerminalNotice, "ref">) => n.ref.startsWith(HANDLER_FAILED_PREFIX);
/** Any other snapshot: a closure (`terminal@rev`) or a state change cutex delivered (an owner stop, …). */
export const isClosure = (n: Pick<TerminalNotice, "ref">) => !isHandlerFailure(n);
/** cutex snapshots every closure, a normal answer too: that one is 已完成, not an ending to explain. */
export const isNormalAnswer = (n: Pick<TerminalNotice, "execution" | "closed">) => n.execution === "answered" && (n.closed === "completed" || n.closed === "accepted" || n.closed === "superseded");

/**
 * One chronological sequence out of any number of lists (the detail's history, items' own notices). Same ref = the same
 * snapshot (first wins: they are immutable); a later closure naming the same attempt has its own ref and stays. Ties in
 * time: by revision, then a failure before the closure it led to.
 */
export function terminalSequence(...lists: readonly (readonly TerminalNotice[] | null | undefined)[]): TerminalNotice[] {
  const byRef = new Map<string, TerminalNotice>();
  for (const list of lists) for (const n of list ?? []) if (!byRef.has(n.ref)) byRef.set(n.ref, n);
  const time = (n: TerminalNotice) => { const t = Date.parse(n.at); return Number.isFinite(t) ? t : 0; };
  return [...byRef.values()].sort((a, b) => time(a) - time(b) || a.revision - b.revision || Number(isClosure(a)) - Number(isClosure(b)));
}

export function terminalNoticesOf(detail: AskDetail | null | undefined): TerminalNotice[] {
  const raw = detail?.terminalNotices;
  return terminalSequence(Array.isArray(raw) ? raw.map(parseTerminalNotice).filter((n): n is TerminalNotice => !!n) : []);
}

/**
 * What the delegation's surfaces say about how it ended, from the detail: the closure that matches its current
 * `closed` (else, while open, the failure of its current attempt). Null when there is none (an older host, a normal
 * answer, a record from before r295 with no snapshot) — the surface then shows what it showed before.
 */
export function currentEnding(detail: AskDetail | null | undefined, notices = terminalNoticesOf(detail)): TerminalNotice | null {
  if (!detail || !notices.length) return null;
  if (detail.closed) {
    const closure = [...notices].reverse().find((n) => isClosure(n) && n.closed === detail.closed);
    return closure && !isNormalAnswer(closure) ? closure : null;
  }
  // Open (as cutex's delegation_read): the failure of the current attempt, else a state snapshot of this attempt and
  // execution (an owner stop that has not closed it).
  const current = currentAttemptOf(detail);
  if (current === null) return null;
  const newest = [...notices].reverse();
  return newest.find((n) => isHandlerFailure(n) && n.attempt === current)
    ?? newest.find((n) => isClosure(n) && !n.closed && n.attempt === current && n.execution === detail.execution) ?? null;
}

function currentAttemptOf(detail: AskDetail): number | null {
  const attempts = Array.isArray(detail.attempts) ? detail.attempts : [];
  const last = attempts.at(-1);
  return typeof last?.n === "number" ? last.n : null;
}

/**
 * A newer attempt that has not started yet, after the last recorded failure (an open delegation queued for its retry):
 * said apart, so the earlier failure's time and attempt are not read as this one's.
 */
export function pendingRetryAfter(detail: AskDetail | null | undefined, notices: readonly TerminalNotice[]): number | null {
  if (!detail || detail.closed) return null;
  const attempts = Array.isArray(detail.attempts) ? detail.attempts : [];
  const last = attempts.at(-1);
  const failed = [...notices].reverse().find(isHandlerFailure);
  if (!last || !failed || failed.attempt === null || typeof last.n !== "number" || last.n <= failed.attempt) return null;
  return last.startedAt ? null : last.n;
}

/** The requester itself ended it (cutex settles that notice without a turn): shown quietly, never as a warning. */
export function selfCaused(n: Pick<TerminalNotice, "actor">, requesterSession: string | null): boolean {
  return n.actor.kind === "agent" && !!requesterSession && n.actor.sessionId === requesterSession;
}

/** Reason codes that only restate the status word or the actor: not repeated after them. */
const RESTATING = new Set(["stopped", "abandoned", "cancelled", "completed", "accepted", "superseded", "closed", "failed", "interrupted", "rejected", "answered", "ownerStopped", "followUpEnded", "Historical terminal state; its initiating actor/reason was not recorded"]);
/** Reason codes with words of their own (i18n `delegation.ending.reason.<code>`). */
export const KNOWN_REASONS = ["ownerDiscarded", "misalignmentPolicyViolation"] as const;
export type KnownReason = (typeof KNOWN_REASONS)[number];

/** The reason as shown: a known code's key, the text itself, or nothing when it only restates the status / actor. */
export function reasonOf(n: Pick<TerminalNotice, "reason">): { code: KnownReason } | { text: string } | null {
  const reason = n.reason.trim();
  if (!reason || RESTATING.has(reason)) return null;
  if ((KNOWN_REASONS as readonly string[]).includes(reason)) return { code: reason as KnownReason };
  return { text: reason };
}

/**
 * The status word key of one notice: a failed attempt says 第 n 次尝试失败 / 中断; a closure says how it was closed
 * (completed: by its execution). Keys are `delegation.ending.*` / `delegation.status.*`.
 */
export function noticeWordKey(n: Pick<TerminalNotice, "ref" | "execution" | "closed">): string {
  if (isHandlerFailure(n)) return n.execution === "interrupted" ? "delegation.ending.attemptInterrupted" : "delegation.ending.attemptFailed";
  switch (n.closed) {
    case "stopped": return "delegation.status.stopped";
    case "abandoned": return "delegation.status.abandoned";
    case "cancelled": return "delegation.status.cancelled";
    case "accepted": return "delegation.status.accepted";
    case "superseded": return "delegation.ending.superseded";
  }
  switch (n.execution) {
    case "failed": return "delegation.status.failed";
    case "rejected": return "delegation.status.rejected";
    case "cancelled": return "delegation.status.cancelled";
    case "interrupted": return "delegation.ending.interrupted";
    case "answered": return "delegation.status.answered";
  }
  return "delegation.status.ended";
}

/** System components with words of their own (`delegation.ending.system.<component>`); others name the component. */
export const KNOWN_COMPONENTS = ["cutex", "scheduler", "turnStop", "handlerRuntime"] as const;

/** The stable ref cutex puts first in a delegation status record's preview (`{ref}: {title}`); null when none. */
export function noticeRefOfPreview(preview: string | null | undefined): string | null {
  const m = /^([A-Za-z][\w-]*@\d+): /.exec(preview ?? "");
  return m ? m[1]! : null;
}
