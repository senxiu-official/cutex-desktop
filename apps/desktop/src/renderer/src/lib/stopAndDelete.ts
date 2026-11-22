/**
 * Delete a busy agent in one owner gesture (r290 P11 / B7): cutex refuses to delete during a
 * turn (`session_busy`), so the confirmed path stops the turn, waits (bounded) until cutex
 * reports the agent idle, then deletes the current revision. Nothing is deleted when the turn
 * does not end in time: the owner then sees the usual refusal.
 */
import type { SessionResource } from "@cutex-desktop/protocol";

export interface StopAndDeleteDeps {
  /** The agent as the desktop last read it (null: gone from the lists). */
  session(): SessionResource | null;
  /** Ask cutex to stop the running turn. */
  stop(): Promise<void>;
  /** Re-read the host's lists. */
  refresh(): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** How long to wait for the stopped turn to end before giving up (cutex then refuses again). */
export const STOP_FOR_DELETE_WAIT_MS = 20_000;
const POLL_MS = 500;

/** Stop the turn and wait until idle. Resolves the fresh idle session, or null (not idle in time / gone). */
export async function stopUntilIdle(deps: StopAndDeleteDeps, waitMs = STOP_FOR_DELETE_WAIT_MS): Promise<SessionResource | null> {
  await deps.stop();
  const until = deps.now() + waitMs;
  for (;;) {
    await deps.refresh().catch(() => undefined);
    const fresh = deps.session();
    if (!fresh) return null;
    if (!fresh.runtime.activeTurnId) return fresh;
    if (deps.now() >= until) return null;
    await deps.sleep(POLL_MS);
  }
}

/** cutex's refusal for deleting an agent in a turn (or while it launches). */
export const isBusyRefusal = (error: { code?: string } | null | undefined) => error?.code === "session_busy";
