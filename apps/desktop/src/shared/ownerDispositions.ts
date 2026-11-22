// Owner dispositions that do not depend on the target agent's session (cutex r289, plan
// .claude/agent-artifacts/state-surfaces-fix-plan.md WP-D0; contract D:/Workspace/agent-tmp/disposal-source-map/
// OWNER-DISPOSITIONS-HTTP.md). An archived or deleted agent's delegation, notice or safety block could not be closed:
// the session-scoped `cutex(sessionId, …)` path resolves only active sessions (404 session_not_found). These routes name
// the stored record instead. Each call prefers the new route when the host advertises it and keeps today's path on older
// hosts; what an older host cannot do (结束跟进) is refused with OWNER_DISPOSITION_UNSUPPORTED, never faked.
// Pure: shared by main (route choice) and the renderer (which buttons exist).
import type { CutexRefusal } from "./ipc";
import { userAccessOf, type CapabilitiesUser } from "@cutex-desktop/cutex-client";

/** Capability names: kebab in `featureList`, camel in `features` (or at the top level of the capabilities object). */
export const OWNER_DISPOSITION_FEATURES = {
  /** `POST /v2/asks/{askId}/close {outcome, actionId}`. */
  askDisposition: ["owner-ask-disposition-v1", "ownerAskDispositionV1"],
  /** `POST /v2/owner-notifications/{id}/{ack|dismiss|delete|safety-dismiss}`. */
  ownerNotifyDirect: ["owner-notify-direct-v1", "ownerNotifyDirectV1"],
  /** `POST /v2/agent-bus/stuck-messages/end-follow-up`. */
  messageEndFollowUp: ["agent-bus-owner-end-followup-v1", "agentBusOwnerEndFollowupV1"],
  /** Ask view `followUpEnded`, `attempt.stopDeadline`, `attempt.stopUnconfirmed`. */
  askStopSettlement: ["ask-stop-settlement-v1", "askStopSettlementV1"],
  /** Delegation Next Up items carry `eligible` / `held` (no snapshot-wide `ridealongsHeld` fallback for them). */
  stopAnswerAdmission: ["stop-answer-admission-v1", "stopAnswerAdmissionV1"],
} as const;

export type OwnerDispositionFeature = keyof typeof OWNER_DISPOSITION_FEATURES;
export type OwnerDispositionSupport = Record<OwnerDispositionFeature, boolean>;

/** Job Service `humanOperations` entry of 结束跟进 (`POST /v2/job-service/close-follow-up`). */
export const JOB_CLOSE_FOLLOW_UP = "closeFollowUp";

/** Refusal code when the host connection was replaced between the capability read and the write: nothing was sent, and
 *  trying again reads the new connection's capabilities (retryable). */
export const CONNECTION_CHANGED = "connection_changed";

/** Refusal code when the host predates the route (the renderer hides the button; main refuses a direct call). */
export const OWNER_DISPOSITION_UNSUPPORTED = "owner_disposition_unsupported";

/** A capabilities object (`GET /v2/capabilities`); only `featureList`, `features` and top-level flags are read. */
type CapsLike = { featureList?: readonly string[] | null; features?: object | null; user?: CapabilitiesUser | null } | null | undefined;

/** Which of these routes and fields the host offers. Older hosts: all false (today's paths). */
export function ownerDispositionSupport(caps: CapsLike): OwnerDispositionSupport {
  const list = caps?.featureList ?? [];
  const flags = (caps?.features ?? {}) as Record<string, unknown>;
  const top = (caps ?? {}) as Record<string, unknown>;
  const has = ([kebab, camel]: readonly [string, string]) => list.includes(kebab) || list.includes(camel) || flags[camel] === true || top[camel] === true;
  // The three routes are the owner's only (cutex access: OwnerOnly). A non-owner connection keeps today's session
  // commands (a send-granted member may still stop / close a delegation it sees) and never gets 结束跟进.
  const owner = userAccessOf(caps).isOwner;
  return {
    askDisposition: owner && has(OWNER_DISPOSITION_FEATURES.askDisposition),
    ownerNotifyDirect: owner && has(OWNER_DISPOSITION_FEATURES.ownerNotifyDirect),
    messageEndFollowUp: owner && has(OWNER_DISPOSITION_FEATURES.messageEndFollowUp),
    askStopSettlement: has(OWNER_DISPOSITION_FEATURES.askStopSettlement),
    stopAnswerAdmission: has(OWNER_DISPOSITION_FEATURES.stopAnswerAdmission),
  };
}

/** The kebab names to add to `featureList` (main normalises camel flags so the renderer can `features.has(kebab)`). */
export function ownerDispositionFeatureList(caps: CapsLike): string[] {
  const support = ownerDispositionSupport(caps);
  return (Object.keys(OWNER_DISPOSITION_FEATURES) as OwnerDispositionFeature[]).filter((k) => support[k]).map((k) => OWNER_DISPOSITION_FEATURES[k][0]);
}

/** Whether the Job Service offers 结束跟进 (its own capabilities read, not the host's). */
export function jobCanCloseFollowUp(caps: { humanOperations?: readonly string[] | null } | null | undefined): boolean {
  return caps?.humanOperations?.includes(JOB_CLOSE_FOLLOW_UP) === true;
}

// ---------- delegations ----------

/** stop / abandoned / accepted as today; followUpEnded = 结束跟进 (closed as stopped, execution unconfirmed; new hosts only). */
export type AskDisposeOutcome = "stop" | "abandoned" | "accepted" | "followUpEnded";
export const ASK_DISPOSE_OUTCOMES: readonly AskDisposeOutcome[] = ["stop", "abandoned", "accepted", "followUpEnded"];

/**
 * `route` = which path carried it: `ask` (`POST /v2/asks/{id}/close`, works for archived / deleted targets) or `session`
 * (older host: `cutex/ask/stop|close` on the target's session, which an archived target refuses). `ask` / `stopping` are
 * the new route's reply (`stopping`: the stop waits for the turn to end).
 */
export type AskDisposeResult =
  | { ok: true; route: "ask" | "session"; ask?: unknown; stopping?: boolean }
  | { ok: false; error: CutexRefusal };

// ---------- agent-bus messages ----------

export interface MessageEndFollowUpRequest {
  messageId: string;
  /** Idempotency key: the same body replays; another body with it is 409 action_id_conflict. */
  actionId: string;
  reason: string;
  expectedSemanticSha256?: string;
}

/** The settlement an owner 结束跟进 writes: closed, outcome unconfirmed, by the owner, no evidence. */
export interface OwnerMessageSettlement {
  state: "closed";
  outcome: "unconfirmed";
  by: "owner";
  canClose: false;
  evidence: null;
  evidenceToken: string;
  closure: { actor: string; closedAt: string; reason: string; requestId: string } | null;
  [key: string]: unknown;
}

export type MessageEndFollowUpResult =
  | { ok: true; result: { messageId: string; changed: boolean; settlement: OwnerMessageSettlement } }
  | { ok: false; error: CutexRefusal };

/** A live-only discard refused before withdrawing anything: the host's tombstone store is full. */
export const LIVE_DISCARD_CAPACITY = "live_discard_capacity";
/** Evidence refresh / evidence close on a retired or deleted recipient (409, not retryable): offer 结束跟进 instead. */
export const RUNTIME_GONE = "runtime_gone";

// ---------- Claude background task stop (Claude adapter C1) ----------

/** The stop of a Claude background task: `accepted` = the request was taken, not that the task ended
 *  (`terminalConfirmed` is always false here); `unknown` = the outcome could not be read. */
export interface ClaudeTaskStopResult {
  threadId: string;
  taskId: string;
  outcome: "accepted" | "refused" | "unknown";
  reason: string | null;
  stopRequested: boolean | null;
  terminalConfirmed: false;
}
