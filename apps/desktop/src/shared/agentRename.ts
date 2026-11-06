// 自己的名字 (formal agent name) rename, cutex `formal-agent-name-rename-v1` (owner-only, /v2/human):
// `POST /v2/human/agents/{id}/rename {requestId, expectedRevision, name}` and the permanent
// `GET .../name-history?before=&limit=`. Separate from 显示名称 (`displayNameOverride`, lib/agentAlias),
// which the rename never touches. The session ID, tabs, Shelf and bookmarks stay; only the name changes.
import type { SessionResource } from "@cutex-desktop/protocol";
import { isOwnerFeatures } from "./users";

export const FORMAL_RENAME_FEATURE = "formal-agent-name-rename-v1";
/** The same capability as a boolean in `/v2/capabilities` `features` (main/daemon folds it into featureList). */
export const FORMAL_RENAME_FLAG = "formalAgentNameRenameV1";
/** cutex: trimmed, 1–128 Unicode characters, no control characters. */
export const FORMAL_NAME_MAX = 128;
export const NAME_HISTORY_PAGE = 50;

export type NameScope = { kind: "project"; projectId: string } | { kind: "unassigned" };

export interface NameHistoryEvent {
  sequence: number;
  eventId: string;
  requestId: string;
  cutexSessionId: string;
  oldName: string;
  newName: string;
  scope: NameScope;
  committedAt: string;
  /** Always "human-management" today: never shown as a person's name. */
  actor: string;
  previousRevision: number;
  revision: number;
}

export interface NameHistoryPage {
  events: NameHistoryEvent[];
  /** Pass as `before` for the next (older) page; null at the end. */
  next: number | null;
}

export interface FormalRenameRequest {
  requestId: string;
  expectedRevision: number;
  name: string;
}

export type FormalRenameResult =
  | { ok: true; event: NameHistoryEvent; replayed: boolean; session: SessionResource | null }
  | { ok: false; error: FormalRenameError };

export interface FormalRenameError {
  /** cutex error code, or "transport" when no answer came back (the rename may or may not have happened). */
  code: string;
  message: string;
  /** Same request (same requestId and body) may be sent again: transport errors and 503s. */
  retrySame: boolean;
  holderSessionIds?: string[];
}

/**
 * Offered only to the owner (not project members / restricted devices), on a host with the capability, for an
 * agent that has an own name. An archived agent gets the block read-only (history; cutex refuses agent_archived):
 * any archived non-quick-chat agent qualifies, also one without an own name (its log is empty: 还没有改过名).
 */
export type RenameTarget = Pick<SessionResource, "formalAgentName"> & Partial<Pick<SessionResource, "lifecycle" | "registrationClass">>;
export function canRenameFormal(features: ReadonlySet<string>, session: RenameTarget): boolean {
  if (!features.has(FORMAL_RENAME_FEATURE) || !isOwnerFeatures(features)) return false;
  return !!session.formalAgentName?.trim() || (session.lifecycle === "retired" && session.registrationClass !== "local_only");
}

/** Characters cutex counts (code points, not UTF-16 units). */
export function nameLength(name: string): number {
  return [...name].length;
}

/**
 * Local check before sending; null = send it (cutex has the final word). Only the exact same spelling is
 * unchanged: a case-only change (eva → Eva) is a real rename with its own history entry.
 */
export function formalNameProblem(raw: string, current: string): "empty" | "tooLong" | "control" | "unchanged" | null {
  const name = raw.trim();
  if (!name) return "empty";
  if (nameLength(name) > FORMAL_NAME_MAX) return "tooLong";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return "control";
  if (name === current.trim()) return "unchanged";
  return null;
}

/** Plain-words message key for a refusal (i18n `rename.error.*`). */
export function renameErrorKey(code: string): string {
  switch (code) {
    case "agent_name_conflict": return "rename.error.conflict";
    case "agent_name_reserved": return "rename.error.reserved";
    case "agent_name_unchanged": return "rename.error.unchanged";
    case "agent_name_invalid": return "rename.error.invalid";
    // Malformed body / requestId / revision (not the name): a desktop bug, not the owner's input.
    case "invalid_request": return "rename.error.malformed";
    case "agent_archived": return "rename.error.archived";
    case "owner_required": return "rename.error.ownerRequired";
    case "stale_session_revision": return "rename.error.stale";
    case "agent_permanently_retired": return "rename.error.retired";
    case "not_formal_agent": return "rename.error.notFormal";
    case "agent_not_found":
    case "session_not_found": return "rename.error.notFound";
    case "persistence_unavailable":
    case "admission_busy": return "rename.error.busy";
    case "transport": return "rename.error.transport";
    case "idempotency_conflict": return "rename.error.idempotency";
    default: return "rename.error.other";
  }
}

const ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function validRenameTarget(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

export function validRenameRequest(r: unknown): r is FormalRenameRequest {
  const v = r as FormalRenameRequest | null;
  return !!v && typeof v.requestId === "string" && v.requestId.length > 0 && v.requestId.length <= 200 &&
    Number.isSafeInteger(v.expectedRevision) && v.expectedRevision > 0 &&
    typeof v.name === "string" && nameLength(v.name.trim()) >= 1 && nameLength(v.name.trim()) <= FORMAL_NAME_MAX;
}

export function nameHistoryPath(id: string, before: number | null, limit = NAME_HISTORY_PAGE): string {
  const q = new URLSearchParams();
  if (before !== null) q.set("before", String(before));
  q.set("limit", String(limit));
  return `/v2/human/agents/${encodeURIComponent(id)}/name-history?${q}`;
}

export function holderIds(details: unknown): string[] | undefined {
  const ids = (details as { holderSessionIds?: unknown } | null | undefined)?.holderSessionIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : undefined;
}

/**
 * Restoring an archived agent whose own name is now another agent's (current name or reserved old name):
 * cutex refuses before preparing a runtime (agent_name_taken / agent_name_reserved; details holderSessionIds,
 * scope, renameRequired), and the owner can rename it while archived, then restore. Main turns the refusal into
 * a wire message (IPC keeps only the message), the renderer reads it back with `restoreNameBlock`.
 */
export const RESTORE_NAME_CODES: readonly string[] = ["agent_name_taken", "agent_name_reserved"];
const RESTORE_WIRE = "restore_name_blocked:";

export interface RestoreNameBlock {
  code: string;
  holderSessionIds?: string[];
  /** Where the name is held (a reserved old name is per project / unassigned). */
  scope?: NameScope;
  /** cutex: restoring needs a rename first; only an explicit false drops the 改名… offer. */
  renameRequired?: boolean;
}

function scopeOf(value: unknown): NameScope | undefined {
  const v = value as { kind?: unknown; projectId?: unknown } | null | undefined;
  if (v?.kind === "unassigned") return { kind: "unassigned" };
  return v?.kind === "project" && typeof v.projectId === "string" && v.projectId ? { kind: "project", projectId: v.projectId } : undefined;
}

function blockOf(code: string, details: unknown): RestoreNameBlock {
  const d = details as { renameRequired?: unknown; scope?: unknown } | null | undefined;
  const holders = holderIds(details);
  const scope = scopeOf(d?.scope);
  return { code, ...(holders?.length ? { holderSessionIds: holders } : {}), ...(scope ? { scope } : {}), ...(typeof d?.renameRequired === "boolean" ? { renameRequired: d.renameRequired } : {}) };
}

export function restoreNameWire(error: unknown): string | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (!e || typeof e.code !== "string" || !RESTORE_NAME_CODES.includes(e.code)) return null;
  return RESTORE_WIRE + JSON.stringify(blockOf(e.code, e.details));
}

export function restoreNameBlock(error: unknown): RestoreNameBlock | null {
  const direct = restoreNameWire(error);
  const message = (direct ?? (error instanceof Error ? error.message : String(error)))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  if (!message.startsWith(RESTORE_WIRE)) return null;
  try {
    const data = JSON.parse(message.slice(RESTORE_WIRE.length)) as { code?: unknown };
    if (typeof data.code !== "string" || !RESTORE_NAME_CODES.includes(data.code)) return null;
    return blockOf(data.code, data);
  } catch {
    return null;
  }
}
