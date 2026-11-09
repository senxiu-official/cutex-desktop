// 转为智能体: turn a quick chat into an agent, standalone or in a project, keeping its session, thread and
// history (cutex `quick-chat-promote-v1`, owner-only, /v2/human):
// `POST /v2/human/sessions/{id}/promote {requestId, expectedRevision, name, projectId?}`.
// cutex refuses while a runtime is bound (quick_chat_running): the desktop stops it first. `complete: false`
// = promoted, but the roster / project step is unfinished: only the identical request may be sent again
// (same requestId and body), never a new one. The name follows the own-name rules (shared/agentRename)
// and is unique host-wide.
import { FORMAL_NAME_MAX, nameLength } from "./agentRename";

export const QUICK_CHAT_PROMOTE_FEATURE = "quick-chat-promote-v1";
/** The same capability as a boolean in `/v2/capabilities` `features` (main/daemon folds it into featureList). */
export const QUICK_CHAT_PROMOTE_FLAG = "quickChatPromoteV1";

export interface PromoteRequest {
  requestId: string;
  expectedRevision: number;
  name: string;
  /** null: standalone (独立). */
  projectId: string | null;
}

export interface PromoteDone {
  cutexSessionId: string;
  name: string;
  projectId: string | null;
  revision: number;
  /** false: promoted, roster / project import unfinished — send the identical request again. */
  complete: boolean;
  error: string | null;
}

export interface PromoteError {
  /** cutex error code, or "transport" when no answer came back (it may or may not have happened). */
  code: string;
  message: string;
  /** The identical request may be sent again: transport errors and 503s. */
  retrySame: boolean;
}

export type PromoteResult = { ok: true; result: PromoteDone } | { ok: false; error: PromoteError };

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validPromoteTarget(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

export function validPromoteRequest(r: unknown): r is PromoteRequest {
  const v = r as PromoteRequest | null;
  return !!v && typeof v.requestId === "string" && v.requestId.length > 0 && v.requestId.length <= 256 && !CONTROL.test(v.requestId) &&
    Number.isSafeInteger(v.expectedRevision) && v.expectedRevision > 0 &&
    typeof v.name === "string" && nameLength(v.name.trim()) >= 1 && nameLength(v.name.trim()) <= FORMAL_NAME_MAX &&
    (v.projectId === null || (typeof v.projectId === "string" && v.projectId.length > 0 && v.projectId.length <= 200));
}

/** The 200 body as a PromoteDone; null when it does not answer this request. */
export function promoteDoneOf(body: unknown, request: PromoteRequest, id: string): PromoteDone | null {
  const b = body as Partial<PromoteDone & { requestId: string }> | null;
  if (!b || b.requestId !== request.requestId || b.cutexSessionId !== id || typeof b.complete !== "boolean") return null;
  return {
    cutexSessionId: id,
    name: typeof b.name === "string" ? b.name : request.name,
    projectId: typeof b.projectId === "string" ? b.projectId : null,
    revision: typeof b.revision === "number" ? b.revision : request.expectedRevision + 1,
    complete: b.complete,
    error: typeof b.error === "string" ? b.error : null,
  };
}

/** Plain-words message key of a refusal (i18n `promote.error.*`). */
export function promoteErrorKey(code: string): string {
  switch (code) {
    case "agent_name_invalid": return "promote.error.nameInvalid";
    case "agent_name_conflict": return "promote.error.nameConflict";
    case "agent_name_reserved": return "promote.error.nameReserved";
    case "invalid_request":
    case "request_id_payload_conflict": return "promote.error.malformed";
    case "session_not_found": return "promote.error.sessionGone";
    case "project_not_found": return "promote.error.projectGone";
    case "project_not_active": return "promote.error.projectInactive";
    case "revision_conflict": return "promote.error.stale";
    case "not_quick_chat": return "promote.error.notQuickChat";
    case "quick_chat_running": return "promote.error.running";
    case "ambiguous_native_identity":
    case "unsupported_quick_chat": return "promote.error.unsupported";
    case "promotion_in_progress": return "promote.error.inProgress";
    case "admission_busy":
    case "persistence_unavailable": return "promote.error.busy";
    case "owner_required": return "promote.error.ownerRequired";
    case "transport": return "promote.error.transport";
    default: return "promote.error.other";
  }
}
