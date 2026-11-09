// Undo of a Codex turn's file changes: cutex `cutex/session/files/revert` (feature
// `session-files-revert`, upstream/cutex docs/FILES-REVERT.md). A dry run returns the plan; executing
// it needs that plan's digest. History, commands and subagent changes are never reverted.

export const SESSION_FILES_REVERT_FEATURE = "session-files-revert";
export const FILES_REVERT_METHOD = "cutex/session/files/revert";

/** Per-file status: only `ok` / `alreadyReverted` permit execution, and at least one must be `ok`. */
export type FilesRevertStatus = "ok" | "alreadyReverted" | "conflict" | "missing" | "outsideWorkspace" | "unsupported";
/** What the revert does to the file: restore its content, delete a created file, recreate a deleted one, move it back. */
export type FilesRevertAction = "restore" | "delete" | "recreate" | "moveBack";

export interface FilesRevertFile {
  path: string;
  relativePath: string | null;
  movePath: string | null;
  action: FilesRevertAction | string;
  status: FilesRevertStatus | string;
  reason: string | null;
  added: number;
  deleted: number;
}

export interface FilesRevertWarning {
  kind: "laterTurnsTouchedFiles" | "laterTurnsNotFullyScanned" | string;
  turnIds?: string[];
  paths?: string[];
  unscannedTurns?: number;
  partialTurns?: number;
}

export interface FilesRevertPlan {
  turnId: string;
  planDigest: string;
  applicable: boolean;
  files: FilesRevertFile[];
  warnings: FilesRevertWarning[];
  applied: boolean;
  actionId: string | null;
  journalPath: string | null;
  /** Interrupted earlier reverts cutex restored before this one. */
  recovered: string[];
}

export type FilesRevertRequest = { dryRun: true } | { dryRun: false; expectedPlanDigest: string };

/**
 * `code`: the cutex error code (`plan_changed`, `revert_conflict`, `nothing_to_revert`, `session_busy`,
 * `turn_in_progress`, `turn_history_too_large`, `revert_rolled_back`, `revert_partial`, …), `unreachable`.
 * `plan`: the fresh plan cutex returns with `plan_changed` / `revert_conflict` / `nothing_to_revert`.
 */
export type FilesRevertResult =
  | { ok: true; plan: FilesRevertPlan }
  | { ok: false; code: string; message: string; plan: FilesRevertPlan | null; journalPath: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A cutex result (or the plan in an error's details) as the desktop reads it; null when it isn't one. */
export function filesRevertPlan(raw: unknown): FilesRevertPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const digest = str(r.planDigest);
  const turnId = str(r.turnId);
  if (!digest || !turnId || !Array.isArray(r.files)) return null;
  const files = r.files.flatMap((f): FilesRevertFile[] => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    const path = str(o.path);
    if (!path) return [];
    return [{ path, relativePath: str(o.relativePath), movePath: str(o.movePath), action: str(o.action) ?? "restore", status: str(o.status) ?? "unsupported", reason: str(o.reason), added: num(o.added), deleted: num(o.deleted) }];
  });
  const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w): w is FilesRevertWarning => !!w && typeof w === "object" && typeof (w as { kind?: unknown }).kind === "string") : [];
  return {
    turnId,
    planDigest: digest,
    applicable: r.applicable === true,
    files,
    warnings,
    applied: r.applied === true,
    actionId: str(r.actionId),
    journalPath: str(r.journalPath),
    recovered: Array.isArray(r.recovered) ? r.recovered.filter((x): x is string => typeof x === "string") : [],
  };
}

/** Error details: the plan itself (plan_changed, revert_conflict, …) or a journal path (revert_partial). */
export function filesRevertFailure(code: string, message: string, details: unknown): Extract<FilesRevertResult, { ok: false }> {
  const d = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const inner = d.originalDetails && typeof d.originalDetails === "object" ? (d.originalDetails as Record<string, unknown>) : d;
  const text = message.startsWith(`${code}: `) ? message.slice(code.length + 2) : message;
  return { ok: false, code, message: text, plan: filesRevertPlan(inner), journalPath: str(inner.journalPath) };
}
