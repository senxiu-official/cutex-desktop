// Owner-initiated runtime starts in flight (启动运行时 from the agent menu, the title bar's ⏻, the
// conversation's 启动 link, 重启运行时). cutex answers `cutex/runtime/online` only once the native is
// up or the start failed, which can take a while on a slow host (or never, behind a stuck start), and
// its session resource keeps saying `offline` meanwhile — so without this the click looked like
// nothing happened. The store's sessionAction marks the start here; menus and the conversation read it.
import { useEffect, useState, useSyncExternalStore } from "react";

const starts = new Map<string, number>();
const listeners = new Set<() => void>();
const keyOf = (host: string, sessionId: string) => `${host}\u0000${sessionId}`;
const emit = () => {
  for (const listener of listeners) listener();
};

/** Mark a start of `sessionId` on `host` as running; the returned function ends it (idempotent). */
export function beginRuntimeStart(host: string, sessionId: string, now = Date.now()): () => void {
  const key = keyOf(host, sessionId);
  starts.set(key, now);
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (starts.get(key) !== now) return; // a newer start of the same agent owns the mark
    starts.delete(key);
    emit();
  };
}

/** When the running start began (ms), or null when none is running. */
export function runtimeStartSince(host: string, sessionId: string): number | null {
  return starts.get(keyOf(host, sessionId)) ?? null;
}

export function useRuntimeStartSince(host: string, sessionId: string | null): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (sessionId ? runtimeStartSince(host, sessionId) : null),
  );
}

/**
 * The status of a `cutex/runtime/online` answer that is not a start: cutex reports `online`, or
 * `starting` while it finishes; anything else (`error`, `offline`, `closed`, …) means the runtime did
 * not come up although the request itself succeeded. null = fine (or no status to judge).
 */
export function failedStartStatus(result: unknown): string | null {
  const status = (result as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== "string" || status === "online" || status === "starting") return null;
  return status;
}

/** Tests only. */
export function resetRuntimeStarts(): void {
  starts.clear();
  emit();
}

/** A runtime status with no running native (thread settings, model lists… cannot be asked). */
export function offlineRuntime(status: string | null | undefined): boolean {
  return status === "offline" || status === "closed" || status === "closing" || status === "error";
}

/** After this long, a start still waiting says it is slow and where to look. */
export const SLOW_START_MS = 30_000;

/** True once `ms` have passed since `since` (null: never); re-renders at that moment. */
export function useElapsed(since: number | null, ms: number): boolean {
  const [, tick] = useState(0);
  const due = since === null ? null : since + ms;
  useEffect(() => {
    if (due === null) return;
    const left = due - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left + 10);
    return () => clearTimeout(timer);
  }, [due]);
  return due !== null && Date.now() >= due;
}
