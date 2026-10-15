// Stuck Agent Bus messages (Settings → 协作 → 消息总线 → 卡住的消息): the pure parts — age filter
// choices, labels, what a discard's answer means, and the one-by-one 全部丢弃. The state lives in
// useStuckMessages.ts, the section in StuckMessagesSection.tsx.
import { DEFAULT_MIN_AGE_SECS } from "../../../../shared/agentBusStuck";
import type { CutexRefusal, StuckBusDiscardRequest, StuckBusDiscardResult, StuckBusMessage, StuckBusParty } from "../../../../shared/ipc";

/** Choices of the age filter (seconds; 0 = every undelivered message). cutex's own default is one hour. */
export const MIN_AGE_CHOICES = [300, 3600, 21_600, 86_400, 0] as const;
export const DEFAULT_MIN_AGE = DEFAULT_MIN_AGE_SECS;

export function isMinAgeChoice(value: unknown): value is (typeof MIN_AGE_CHOICES)[number] {
  return typeof value === "number" && (MIN_AGE_CHOICES as readonly number[]).includes(value);
}

/** Key of the label of an age filter choice (`agent-bus.stuck.age.<this>`): "5 分钟" … "全部". */
export function minAgeKey(secs: number): "m5" | "h1" | "h6" | "d1" | "all" {
  return secs === 300 ? "m5" : secs === 3600 ? "h1" : secs === 21_600 ? "h6" : secs === 86_400 ? "d1" : "all";
}

export type AgeUnit = "lt1m" | "min" | "hour" | "day";
/** An age as one rounded-down unit: "不到 1 分钟" / "12 分钟" / "5 小时" / "3 天". Null when cutex did not date it. */
export function ageParts(secs: number | null): { unit: AgeUnit; n: number } | null {
  if (secs === null || !Number.isFinite(secs) || secs < 0) return null;
  if (secs < 60) return { unit: "lt1m", n: 0 };
  if (secs < 3600) return { unit: "min", n: Math.floor(secs / 60) };
  if (secs < 172_800) return { unit: "hour", n: Math.floor(secs / 3600) };
  return { unit: "day", n: Math.floor(secs / 86_400) };
}

/** `cutex.7f3a…` → the name when there is one, else a shortened id. */
export function partyName(party: StuckBusParty | null): string | null {
  if (!party) return null;
  if (party.name) return party.name;
  return party.id.length > 18 ? `${party.id.slice(0, 16)}…` : party.id;
}

/** The sender labels cutex reports (`sender_label()`); anything else is shown as sent. */
export const KNOWN_KINDS = ["cutex", "user", "owner", "task_service", "job_service", "alarm_service", "unknown"] as const;
export type KnownKind = (typeof KNOWN_KINDS)[number];
export function knownKind(kind: string | null): KnownKind | null {
  return kind !== null && (KNOWN_KINDS as readonly string[]).includes(kind) ? (kind as KnownKind) : null;
}

/** Who sent it: a session's name (or shortened id), or a system / owner sender by its kind. Null when cutex says neither. */
export type SenderLabel = { name: string } | { kind: Exclude<KnownKind, "cutex" | "unknown"> } | null;
export function senderLabel(m: Pick<StuckBusMessage, "from" | "senderKind">): SenderLabel {
  if (m.from?.name) return { name: m.from.name };
  const kind = knownKind(m.senderKind);
  if (kind !== null && kind !== "cutex" && kind !== "unknown") return { kind };
  const id = partyName(m.from);
  return id ? { name: id } : null;
}

/** A hint line under a row, from the row's own fields (cutex's English `reasons` go to the tooltip). */
export type StuckHint = { key: "held" | "frozen" | "memoryOnly" | "error" | "quarantine" | "protected"; params?: Record<string, string> };

/** At most three hints, most useful first. */
export function stuckHints(m: StuckBusMessage): StuckHint[] {
  const hints: StuckHint[] = [];
  if (!m.durable) hints.push({ key: "memoryOnly" });
  else if (m.state === "stale_held") hints.push({ key: "held" });
  else if (m.nativeSubmissionPresent) hints.push({ key: "frozen" });
  if (m.errorCode) hints.push({ key: "error", params: { code: m.errorCode } });
  if (m.protectedControl) hints.push({ key: "protected" });
  else if (m.nativeSubmissionPresent) hints.push({ key: "quarantine" });
  return hints.slice(0, 3);
}

/** Every reason cutex gave, for the row's tooltip. */
export function reasonsTooltip(m: StuckBusMessage): string | undefined {
  return m.reasons.length > 0 ? m.reasons.join("\n") : undefined;
}

/** Rows 全部丢弃 covers: a Task / Job / control message is only ever discarded on its own row. */
export function bulkTargets(messages: readonly StuckBusMessage[]): StuckBusMessage[] {
  return messages.filter((m) => !m.protectedControl);
}

export function protectedCount(messages: readonly StuckBusMessage[]): number {
  return messages.filter((m) => m.protectedControl).length;
}

/** The request for one row: the digest pins it to what the list showed; a protected row is allowed explicitly. */
export function discardRequest(m: StuckBusMessage): StuckBusDiscardRequest {
  return { messageId: m.messageId, expectedSemanticSha256: m.semanticSha256, ...(m.protectedControl ? { allowProtected: true } : {}) };
}

// ---------- what a discard's answer means ----------

export type DiscardOutcome =
  | { kind: "discarded"; liveWithdrawError: string | null }
  /** Already gone: delivered, failed or discarded since the list was read. The refresh drops the row. */
  | { kind: "gone" }
  | { kind: "failed"; code: string; message: string };

/** Refusals that only mean "not stuck any more". */
const GONE_CODES = ["message_not_found", "message_not_discardable"];
/** Refusals the page words itself (agent-bus.stuck.error.<code>). */
export const KNOWN_ERRORS = ["message_digest_mismatch", "message_protected", "invalid_request"] as const;

export function discardOutcome(result: StuckBusDiscardResult): DiscardOutcome {
  if (result.ok) return { kind: "discarded", liveWithdrawError: result.discarded.liveWithdrawError };
  return GONE_CODES.includes(result.error.code) ? { kind: "gone" } : { kind: "failed", code: result.error.code, message: result.error.message };
}

export function failure(error: unknown): { code: string; message: string } {
  return { code: "error", message: error instanceof Error ? error.message : String(error) };
}

export function refusalText(error: Pick<CutexRefusal, "code" | "message">, known: (code: string) => string | null): string {
  return known(error.code) ?? `${error.code}: ${error.message}`;
}

// ---------- 全部丢弃 ----------

export interface BulkSummary {
  discarded: number;
  gone: number;
  /** Discards whose live-bus withdrawal failed (the record is terminal; the runtime drops it on its next poll). */
  liveWarnings: number;
  failed: { messageId: string; code: string; message: string }[];
  /** Left undone because the connection failed (a non-refusal error stops the run). */
  notAttempted: number;
}

export const emptySummary = (): BulkSummary => ({ discarded: 0, gone: 0, liveWarnings: 0, failed: [], notAttempted: 0 });

/**
 * Discard `messages` one by one (cutex discards one message per call). A refusal is counted and the run
 * goes on; an error that is not a refusal (connection lost) stops it, since the rest would fail the same way.
 * `onProgress(done, total)` after each message.
 */
export async function discardAll(
  messages: readonly StuckBusMessage[],
  discard: (request: StuckBusDiscardRequest) => Promise<StuckBusDiscardResult>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSummary> {
  const summary = emptySummary();
  for (const [i, m] of messages.entries()) {
    let outcome: DiscardOutcome;
    try {
      outcome = discardOutcome(await discard(discardRequest(m)));
    } catch (error) {
      summary.failed.push({ messageId: m.messageId, ...failure(error) });
      summary.notAttempted = messages.length - i - 1;
      onProgress?.(messages.length, messages.length);
      return summary;
    }
    if (outcome.kind === "discarded") {
      summary.discarded += 1;
      if (outcome.liveWithdrawError) summary.liveWarnings += 1;
    } else if (outcome.kind === "gone") summary.gone += 1;
    else summary.failed.push({ messageId: m.messageId, code: outcome.code, message: outcome.message });
    onProgress?.(i + 1, messages.length);
  }
  return summary;
}
