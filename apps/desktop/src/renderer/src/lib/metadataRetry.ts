// cutex/session/metadata/update is fenced by the session revision, which also moves for things the
// owner did not touch (a turn starting, a status change) while a dialog is open. On a revision
// conflict the edit is retried against the fresh session, but only if the fields it changes
// still hold what the dialog started from; a real concurrent edit of those fields still fails.
//
// cutex's session store has a revision of its own (store-wide, every session's events): a write that
// loses that compare-and-swap to another writer — typically a just-created agent's startup events —
// fails as `event_persistence_unavailable: cutex session store revision conflict …; reload before
// retrying` and wrote nothing (owner 2026-10-23: 「Maid已创建，头像保存失败」). That is retried the same way,
// for every metadata writer, fenced or not.

/** Whether an error (after the IPC hop) is cutex's session `revision_conflict`. */
export function isRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(^|[^_\w])revision_conflict\b/.test(message);
}

/** Whether an error is cutex's store-wide compare-and-swap lost to another writer (nothing was written). */
export function isStoreConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session store revision conflict/i.test(message);
}

/** Whether `fresh` still has the values of `before` for every key of `before` (absent = null). */
export function fieldsUnchanged(before: Record<string, unknown>, fresh: Record<string, unknown>): boolean {
  const fields = new Set(Object.keys(before));
  // Mode and stored avatar are one backend CAS domain, including legacy callers.
  if (fields.has("avatar") || fields.has("avatarMode")) { fields.add("avatar"); fields.add("avatarMode"); }
  return [...fields].every((key) => JSON.stringify(fresh[key] ?? null) === JSON.stringify(before[key] ?? null));
}

/** Waits before each retry (a lost store CAS clears within one append; a few short tries). */
export const METADATA_RETRY_DELAYS_MS: readonly number[] = [150, 400, 1000];

export interface MetadataWrite<S extends object> {
  /** One attempt; `fresh` is the session re-read after a conflict (null on the first try). */
  write(fresh: S | null): Promise<unknown>;
  /** The session as cutex has it now (null: gone). */
  reread(): Promise<S | null>;
  /** The changed fields as the writer last saw them (resource field names); a retry needs them unchanged. */
  before: Record<string, unknown>;
  /** The write is fenced by `expectedRevision`: also retry the session's own `revision_conflict`. */
  fenced?: boolean;
  /** The error when those fields were changed meanwhile (or the session is gone). */
  changed(): Error;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A metadata write that survives conflicts nobody meant: a lost store CAS (always) and a moved session
 * revision (fenced writes). Each retry waits, re-reads the session and goes on only while the fields
 * being written still hold `before`; any other error, or the last conflict, is thrown as is.
 */
export async function writeMetadataRetrying<S extends object>(w: MetadataWrite<S>): Promise<void> {
  const delays = w.delays ?? METADATA_RETRY_DELAYS_MS;
  let fresh: S | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      await w.write(fresh);
      return;
    } catch (error) {
      const retryable = isStoreConflict(error) || (!!w.fenced && isRevisionConflict(error));
      if (!retryable || attempt >= delays.length) throw error;
      await (w.sleep ?? wait)(delays[attempt]!);
      fresh = await w.reread();
      if (!fresh || !fieldsUnchanged(w.before, fresh as Record<string, unknown>)) throw w.changed();
    }
  }
}
