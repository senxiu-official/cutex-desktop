// Agent-note delivery in 接下来 (owner decision 2026-11-19; cutex fix/nextup-delivery, docs/next-up-delivery-ui-handoff.md).
// Passive notes not opening a turn is correct; what was missing is saying where a note is, what it waits for and what
// blocks it. This reads the host's optional diagnostics — never a new Next Up state, label or action, never a
// delivery-time promise, never "read" without the ledger's own read evidence. Pure (test/noteDelivery.test.ts).
import type { InputRecord } from "@cutex-desktop/protocol";

// ---------- capabilities (Management v2 featureList names; the camelCase `features` field names accepted too) ----------

const has = (features: Iterable<string> | null | undefined, ...names: string[]) => {
  for (const feature of features ?? []) if (names.includes(feature)) return true;
  return false;
};
/** 现在读取 sends the clicked notes as a fixed `inputIds` set, carried with the owner input atomically. */
export const readsSelectedNotes = (features: Iterable<string> | null | undefined) => has(features, "agent-bus-read-notes-v1", "agentBusReadNotesV1");
/** Turn starts report which accepted notes they carried (`passiveNotes`). */
export const reportsPreTurnNotes = (features: Iterable<string> | null | undefined) => has(features, "pre-turn-passive-notes-v1", "preTurnPassiveNotesV1");
/** Note rows carry `details.deliveryDiagnostics` (stage, since, what it waits for, blocker, last error). */
export const hasNoteDiagnostics = (features: Iterable<string> | null | undefined) => has(features, "passive-note-diagnostics-v1", "passiveNoteDiagnosticsV1");

// ---------- shapes (all optional: an older host or a lost CAS leaves them out) ----------

export const NOTE_STAGES = ["bus", "inbox", "context"] as const;
export type NoteStage = (typeof NOTE_STAGES)[number];

/** The `waitingFor` values the host sends today; any other reads the generic line (never "read"). */
export const WAITING_FOR = [
  "nativeInbox", "nativeAcceptance", "projection", "nextBoundaryBudget", "runtimeCapabilityOrBinding", "nativeReconciliation",
  "ownerResume", "staleReview", "earlierInput", "nativeRelease", "nextTurn", "nextInputBoundary", "contextReceipt",
  "runtimeConnection", "bindingReconciliation", "complete",
] as const;
export type WaitingFor = (typeof WAITING_FOR)[number];

/** The `lastAttemptKind` values the host sends today; another one keeps only its time. */
export const ATTEMPT_KINDS = ["nativeAdmission", "nativeStatus", "preTurnAdmission"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export interface NoteDiagnostics {
  stage: NoteStage | null;
  /** When it entered this stage (local first evidence for inbox / context, not a native creation time). */
  since: string | null;
  lastAttemptAt: string | null;
  /** What the last try was (a known kind; null when absent or unknown — a projection may give only the time). */
  lastAttemptKind: AttemptKind | null;
  lastError: string | null;
  /** A known value, `"other"` for one this desktop does not know, null when absent. */
  waitingFor: WaitingFor | "other" | null;
  /** The exact earlier input this one waits behind. */
  blockedByInputId: string | null;
  /** Projection trouble (`external_projection_failed` / `_blocked`): its message and real failed attempts. */
  projection: { code: string; message: string | null; attempts: number } | null;
  /** cutex asks-start-catchup: `deliveryDiagnostics.retryBlocked: true` — the note is already an item in the recipient's
   *  conversation, which is why Retry is gone. Only the explicit marker counts (never inferred from missing actions). */
  retryBlocked?: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A record's delivery diagnostics, or null when it carries none. Malformed fields are dropped, never guessed. */
export function noteDiagnostics(record: Pick<InputRecord, "details">): NoteDiagnostics | null {
  const details = obj(record.details) ?? {};
  const d = obj(details.deliveryDiagnostics);
  const failure = obj(details.projectionFailure);
  if (!d && !failure && !str(details.blockedByInputId)) return null;
  const stage = str(d?.stage);
  const waiting = str(d?.waitingFor);
  const code = str(failure?.code);
  return {
    stage: stage && (NOTE_STAGES as readonly string[]).includes(stage) ? (stage as NoteStage) : null,
    since: str(d?.since),
    lastAttemptAt: str(d?.lastAttemptAt) ?? str(failure?.lastAttemptAt),
    lastAttemptKind: (ATTEMPT_KINDS as readonly string[]).includes(str(d?.lastAttemptKind) ?? "") ? (d!.lastAttemptKind as AttemptKind) : null,
    lastError: str(d?.lastError),
    waitingFor: waiting ? ((WAITING_FOR as readonly string[]).includes(waiting) ? (waiting as WaitingFor) : "other") : null,
    blockedByInputId: str(d?.blockedByInputId) ?? str(details.blockedByInputId) ?? str(failure?.blockedByInputId),
    projection: code ? { code, message: str(failure?.message), attempts: typeof failure?.attempts === "number" ? failure.attempts : 0 } : null,
    ...(d?.retryBlocked === true ? { retryBlocked: true } : {}),
  };
}

/** A normal wait (an idle agent reads it at its next turn): said calmly, never as stuck. */
export function calmWait(d: NoteDiagnostics | null): boolean {
  return d?.waitingFor === "nextTurn" || d?.waitingFor === "complete";
}

// ---------- passiveNotes report (a turn start / 现在读取) ----------

export interface PassiveNotesReport {
  /** Notes with native pending / context admission evidence this time — not a read receipt. */
  admitted: string[];
  /** Left out or not clearly admitted this time, with what they wait for. */
  skipped: { inputId: string; waitingFor: WaitingFor | "other" | null; error: string | null }[];
  errors: string[];
}

export function passiveNotesReport(value: unknown): PassiveNotesReport | null {
  const v = obj(value);
  if (!v) return null;
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s) : []);
  const skipped = (Array.isArray(v.skipped) ? v.skipped : []).flatMap((entry) => {
    const e = obj(entry);
    const id = str(e?.inputId);
    if (!id) return [];
    const w = str(e?.waitingFor);
    return [{ inputId: id, waitingFor: w ? ((WAITING_FOR as readonly string[]).includes(w) ? (w as WaitingFor) : "other" as const) : null, error: str(e?.error) }];
  });
  return { admitted: ids(v.admitted), skipped, errors: ids(v.errors) };
}

/** The 现在读取 answer (`{pendingNotes, started, submit}`): the fixed set's size, whether a turn started or steered, and
 *  the turn's note report. None of it says a note was read. */
export function readNowResult(value: unknown): { pendingNotes: number | null; started: boolean; passiveNotes: PassiveNotesReport | null } {
  const v = obj(value) ?? {};
  return {
    pendingNotes: typeof v.pendingNotes === "number" ? v.pendingNotes : null,
    started: v.started === true,
    passiveNotes: passiveNotesReport(obj(v.submit)?.passiveNotes),
  };
}

/** The 现在读取 params: the clicked notes when the host takes a fixed set, else the old capture-what-is-pending call. */
export function readNowParams(inputIds: readonly string[], selected: boolean): Record<string, unknown> {
  return selected ? { inputIds: [...new Set(inputIds)] } : {};
}

// ---------- releaseHold effect ----------

/** 允许发送 on a note the owner paused that also waits at an old boundary: this click only lifts the owner's pause. */
export function releaseLiftsPauseOnly(record: Pick<InputRecord, "details">): boolean {
  const details = obj(record.details);
  return details?.ownerHold === true && details.releaseEffect === "removeOwnerPauseOnly";
}

/** Codes this flow handles in its own words (handoff §错误码); anything else keeps the generic failure. */
export const NOTE_ACTION_CODES = ["read_notes_unsupported", "read_notes_unavailable", "bus_redrive_failed", "revision_conflict", "input_not_holdable", "input_not_found", "request_outcome_unknown"] as const;
export type NoteActionCode = (typeof NOTE_ACTION_CODES)[number];

/** The handled cutex code in an action error (after the IPC hop the message holds `code: text` somewhere). */
export function noteActionCode(error: unknown): NoteActionCode | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return NOTE_ACTION_CODES.find((code) => new RegExp(`(^|[^_\\w])${code}\\b`).test(message)) ?? null;
}
