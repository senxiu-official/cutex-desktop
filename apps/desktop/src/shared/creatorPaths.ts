/**
 * An agent created by another agent refuses to start (or come online) when its folders changed since it was
 * created — e.g. the owner moved a workspace and left a junction behind (cutex blocks a symlink swap that way):
 * HTTP 409 `creator_paths_changed`, `details.cutexSessionId`. The owner re-approves the current folders with
 * `POST /v2/sessions/{id}/reapprove-paths` (owner full token; capability `session-path-reapproval`) or
 * `cutex session reapprove-paths <id>`. Main turns the refusal into a wire message (IPC keeps only the message),
 * the renderer reads it back with `creatorPathsBlock`.
 */
export const CREATOR_PATHS_CODE = "creator_paths_changed";
export const REAPPROVE_PATHS_FEATURE = "session-path-reapproval";
const WIRE = "creator_paths_blocked:";
const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export interface CreatorPathsBlock {
  /** The refused agent, when cutex named it (else the caller's own session). */
  cutexSessionId?: string;
}

function blockOf(details: unknown): CreatorPathsBlock {
  const id = (details as { cutexSessionId?: unknown } | null | undefined)?.cutexSessionId;
  return typeof id === "string" && SESSION_ID.test(id) ? { cutexSessionId: id } : {};
}

/** Main: the refusal as a fixed-shape message (no daemon text crosses IPC), else null. */
export function creatorPathsWire(error: unknown): string | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (!e || e.code !== CREATOR_PATHS_CODE) return null;
  return WIRE + JSON.stringify(blockOf(e.details));
}

/** Renderer: the refusal read back from an IPC error (or a store's saved message), else null. */
export function creatorPathsBlock(error: unknown): CreatorPathsBlock | null {
  const direct = creatorPathsWire(error);
  const message = (direct ?? (error instanceof Error ? error.message : String(error)))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  if (!message.startsWith(WIRE)) return null;
  try {
    const data = JSON.parse(message.slice(WIRE.length)) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? blockOf(data) : null;
  } catch {
    return null;
  }
}

/** What the owner runs on the host when the desktop cannot re-approve (older cutex). */
export function reapprovePathsCommand(sessionId: string): string {
  return `cutex session reapprove-paths ${sessionId}`;
}

export function validReapproveTarget(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID.test(id);
}

export interface ReapprovePathsResult {
  cutexSessionId: string;
  revision: number;
}

/**
 * Why `reapprove-paths` failed, as a fixed code (main maps the daemon's answer; no daemon text or folder path
 * crosses IPC). Codes cutex names for this route, plus forbidden (401/403: not the owner's full token),
 * unreachable (no answer) and failed (anything else).
 */
export const REAPPROVE_ERROR_CODES = [
  "session_not_found",
  "session_not_agent_created",
  "session_retired",
  "session_configuration_changed",
  "creator_paths_changed",
  "admission_busy",
  "session_store_unavailable",
  "forbidden",
  "unreachable",
  "failed",
] as const;
export type ReapproveErrorCode = (typeof REAPPROVE_ERROR_CODES)[number];
const REAPPROVE_WIRE = "reapprove_paths_failed:";

function reapproveErrorCode(error: unknown): ReapproveErrorCode {
  const e = error as { code?: unknown; status?: unknown; name?: unknown } | null | undefined;
  if (e?.name === "CutexUnreachableError") return "unreachable";
  if (typeof e?.code === "string" && (REAPPROVE_ERROR_CODES as readonly string[]).includes(e.code) && e.code !== "failed") return e.code as ReapproveErrorCode;
  if (e?.status === 401 || e?.status === 403) return "forbidden";
  return "failed";
}

/** Main: any reapprove failure as a fixed-shape message. */
export function reapproveFailureWire(error: unknown): string {
  return REAPPROVE_WIRE + reapproveErrorCode(error);
}

/** Renderer: the failure code read back from an IPC error, else null (not a reapprove failure). */
export function reapproveFailure(error: unknown): ReapproveErrorCode | null {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  if (!message.startsWith(REAPPROVE_WIRE)) return null;
  const code = message.slice(REAPPROVE_WIRE.length);
  return (REAPPROVE_ERROR_CODES as readonly string[]).includes(code) ? (code as ReapproveErrorCode) : null;
}

/**
 * Main, before an event reaches the renderer: a queued send's failed start (`cutex/userInput/startFailed`) refused
 * for moved folders keeps only the code and the session id (its message and details name folders).
 */
export function withoutCreatorPathsDetail<T>(envelope: T): T {
  const cutex = (envelope as { cutex?: { method?: unknown; params?: unknown } } | null)?.cutex;
  const params = cutex?.params as { error?: { code?: unknown; details?: unknown } } | null | undefined;
  if (cutex?.method !== "cutex/userInput/startFailed" || params?.error?.code !== CREATOR_PATHS_CODE) return envelope;
  const error = { code: CREATOR_PATHS_CODE, message: "", retryable: false, details: blockOf(params.error.details) };
  return { ...envelope, cutex: { ...cutex, params: { ...params, error } } } as T;
}
