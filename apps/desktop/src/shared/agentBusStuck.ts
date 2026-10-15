// Stuck Agent Bus messages (cutex `agent-bus-stuck-messages`): the wire adapter and the request the
// main process sends. Wire shape: cutex `src/management/v2/agent_bus_stuck.rs` +
// `agent_bus_state.rs` (`StuckAgentBusMessage`, camelCase) and docs/agent-bus-operations.md §3;
// every wire field the desktop reads is here and in the preview mock (modules/agent-bus/mock.ts).
// cutex validates again; this keeps renderer input well-formed and a changed wire from crashing the list.
import type { StuckBusDiscardRequest, StuckBusDiscarded, StuckBusMessage, StuckBusParty, StuckBusView } from "./ipc";

export const STUCK_MESSAGES_FEATURE = "agent-bus-stuck-messages";
/** What the owner's discard records (the error text of the record and the audit fact). Fixed: the renderer cannot choose it. */
export const STUCK_DISCARD_REASON = "Discarded by the owner in Cutex Desktop";
/** cutex's default for `minAgeSecs`. */
export const DEFAULT_MIN_AGE_SECS = 3600;
/** Longest age filter the client sends (31 days). */
export const MAX_MIN_AGE_SECS = 2_678_400;

const SHA256 = /^[0-9a-fA-F]{64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const secs = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

function party(v: unknown): StuckBusParty | null {
  if (typeof v === "string" && v) return { id: v, name: null };
  if (!isRecord(v)) return null;
  const id = str(v.id) ?? str(v.agentId);
  return id ? { id, name: str(v.name) ?? str(v.agentName) } : null;
}

/** One row; null without a message id (it could not be discarded anyway). */
export function asStuckMessage(raw: unknown): StuckBusMessage | null {
  if (!isRecord(raw)) return null;
  const messageId = str(raw.messageId);
  if (!messageId) return null;
  const error = isRecord(raw.error) ? raw.error : null;
  const sha = str(raw.semanticSha256);
  return {
    messageId,
    state: str(raw.state) ?? "unknown",
    durable: raw.durable !== false,
    to: party(raw.to) ?? party(raw.toCutexSessionId),
    from: party(raw.from) ?? party(raw.fromCutexSessionId),
    ageSecs: secs(raw.ageSecs),
    createdAtEpochSecs: secs(raw.createdAtEpochSecs),
    senderKind: str(raw.senderKind),
    protectedControl: raw.protectedControl === true,
    nativeSubmissionPresent: raw.nativeSubmissionPresent === true,
    semanticSha256: sha && SHA256.test(sha) ? sha : null,
    errorCode: error ? str(error.code) : null,
    errorMessage: error ? str(error.message) : null,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.filter((r): r is string => typeof r === "string" && r !== "") : [],
    contentPreview: typeof raw.contentPreview === "string" ? raw.contentPreview : "",
  };
}

/** `GET /v2/agent-bus/stuck-messages` reply → the list the page shows (oldest first, like cutex). */
export function asStuckView(raw: unknown, fallbackMinAgeSecs = DEFAULT_MIN_AGE_SECS): StuckBusView {
  const body = isRecord(raw) ? raw : {};
  const messages = (Array.isArray(body.messages) ? body.messages : []).map(asStuckMessage).filter((m): m is StuckBusMessage => m !== null);
  const live = isRecord(body.liveQueue) ? body.liveQueue : {};
  const total = secs(body.total);
  return {
    messages,
    total: total !== null && total >= messages.length ? total : messages.length,
    liveQueueAvailable: live.available !== false,
    liveQueueError: str(live.error),
    minAgeSecs: secs(body.minAgeSecs) ?? fallbackMinAgeSecs,
  };
}

/** `POST …/discard` reply. */
export function asStuckDiscarded(raw: unknown, messageId: string): StuckBusDiscarded {
  const body = isRecord(raw) ? raw : {};
  return { messageId: str(body.messageId) ?? messageId, changed: body.changed === true, liveWithdrawError: str(body.liveWithdrawError) };
}

/** `minAgeSecs` the client sends: a whole number of seconds in 0..31 days (anything else is the default). */
export function cleanMinAge(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(MAX_MIN_AGE_SECS, Math.floor(value))) : DEFAULT_MIN_AGE_SECS;
}

/** The body of the discard call. Throws on a malformed request (renderer bug, not a cutex refusal). */
export function stuckDiscardRequest(request: StuckBusDiscardRequest): { messageId: string; reason: string; expectedSemanticSha256?: string; allowProtected?: boolean } {
  if (!isRecord(request)) throw new Error("bad discard request");
  const messageId = (request as { messageId?: unknown }).messageId;
  if (typeof messageId !== "string" || !messageId || messageId.length > 512) throw new Error("bad message id");
  const sha = request.expectedSemanticSha256;
  if (sha !== undefined && sha !== null && (typeof sha !== "string" || !SHA256.test(sha))) throw new Error("bad semantic digest");
  return {
    messageId,
    reason: STUCK_DISCARD_REASON,
    ...(typeof sha === "string" ? { expectedSemanticSha256: sha } : {}),
    ...(request.allowProtected === true ? { allowProtected: true } : {}),
  };
}
