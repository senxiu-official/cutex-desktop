// cutex/session/metadata/update is fenced by the session revision, which also moves for things the
// owner did not touch (a turn starting, a status change) while a dialog is open. On a revision
// conflict the edit is retried once against the fresh session, but only if the fields it changes
// still hold what the dialog started from; a real concurrent edit of those fields still fails.

/** Whether an error (after the IPC hop) is cutex's session `revision_conflict`. */
export function isRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(^|[^_\w])revision_conflict\b/.test(message);
}

/** Whether `fresh` still has the values of `before` for every key of `before` (absent = null). */
export function fieldsUnchanged(before: Record<string, unknown>, fresh: Record<string, unknown>): boolean {
  return Object.keys(before).every((key) => JSON.stringify(fresh[key] ?? null) === JSON.stringify(before[key] ?? null));
}
