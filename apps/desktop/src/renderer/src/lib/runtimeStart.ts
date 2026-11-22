// Owner-initiated runtime starts in flight (启动运行时 from the agent menu, the title bar's ⏻, the
// conversation's 启动 link, 重启运行时). cutex answers `cutex/runtime/online` only once the native is
// up or the start failed, which can take a while on a slow host (or never, behind a stuck start), and
// its session resource keeps saying `offline` meanwhile — so without this the click looked like
// nothing happened. The store's sessionAction marks the start here; menus and the conversation read it.
//
// Deadline (state surfaces S11, 2026-11-17): a start has a fixed deadline from its FIRST start (START_DEADLINE_MS);
// a start that begins while another of the same agent is still in flight keeps the first one's time, so nothing
// renews it. Past the deadline the agent menu says 启动未确认 and offers 重新读取 and 停止 (an offline request with
// the expected runtime generation; lib/menus runtimeItem). A runtime cutex itself reports `starting` (no start of
// ours in flight) is timed from the first time this desktop saw that generation starting (`noteRuntimeStarting`).
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * How long 启动中 may last before it reads 启动未确认. A normal start answers within seconds and a slow one is called
 * out at SLOW_START_MS (30 s); five minutes leaves room for a first start that unpacks a runtime or signs in, while a
 * start that has not answered by then is no longer something to keep waiting on without a way out.
 */
export const START_DEADLINE_MS = 5 * 60_000;

interface Start {
  /** When the first start of the run began (ms): the deadline counts from here. */
  since: number;
  /** Starts still in flight (each begin adds one, each end removes its own). */
  open: Set<symbol>;
}

const starts = new Map<string, Start>();
/** First time a cutex-reported `starting` was seen, by agent: its runtime generation and when (ms). */
const seenStarting = new Map<string, { generation: number; since: number }>();
const listeners = new Set<() => void>();
const keyOf = (host: string, sessionId: string) => `${host}\u0000${sessionId}`;
const emit = () => {
  for (const listener of listeners) listener();
};

/**
 * Mark a start of `sessionId` on `host` as running; the returned function ends it (idempotent). A start while one is
 * in flight joins it: the mark keeps the first start's time and goes when every start of the run has ended.
 */
export function beginRuntimeStart(host: string, sessionId: string, now = Date.now()): () => void {
  const key = keyOf(host, sessionId);
  const token = Symbol("start");
  const run = starts.get(key) ?? { since: now, open: new Set<symbol>() };
  run.open.add(token);
  starts.set(key, run);
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (starts.get(key) !== run) return; // given up (abandonRuntimeStart) or replaced by a later run
    run.open.delete(token);
    if (run.open.size > 0) return;
    starts.delete(key);
    emit();
  };
}

/** Forget the start in flight of an agent (its 停止 after 启动未确认 was sent): a late answer no longer ends anything. */
export function abandonRuntimeStart(host: string, sessionId: string): void {
  const key = keyOf(host, sessionId);
  const had = starts.delete(key);
  const seen = seenStarting.delete(key);
  if (had || seen) emit();
}

/** When the running start began (ms), or null when none is running. */
export function runtimeStartSince(host: string, sessionId: string): number | null {
  return starts.get(keyOf(host, sessionId))?.since ?? null;
}

/**
 * cutex reports the runtime `starting` (no start of ours in flight): when this desktop first saw that generation
 * starting (recorded now if not yet; a new generation starts a new clock). Any other status forgets it.
 */
export function noteRuntimeStarting(host: string, sessionId: string, status: string, generation: number, now = Date.now()): number | null {
  const key = keyOf(host, sessionId);
  if (status !== "starting") {
    seenStarting.delete(key);
    return null;
  }
  const seen = seenStarting.get(key);
  if (seen && seen.generation === generation) return seen.since;
  seenStarting.set(key, { generation, since: now });
  return now;
}

export type StartPhase = "starting" | "unconfirmed";

/** 启动中 until START_DEADLINE_MS after `since`, then 启动未确认; null when no start is running. */
export function startPhase(since: number | null, now: number): StartPhase | null {
  if (since === null) return null;
  return now - since >= START_DEADLINE_MS ? "unconfirmed" : "starting";
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

/**
 * The start an agent's runtime is in, for the menus: a start of ours in flight (any status but online), else a
 * cutex-reported `starting` (timed from when first seen). null: online, or nothing starting.
 */
export function runtimeStartView(host: string, sessionId: string, runtime: { status: string; runtimeGeneration: number }, now = Date.now()): { phase: StartPhase; since: number } | null {
  const seen = noteRuntimeStarting(host, sessionId, runtime.status, runtime.runtimeGeneration, now);
  if (runtime.status === "online") return null;
  const since = runtimeStartSince(host, sessionId) ?? seen;
  const phase = startPhase(since, now);
  return phase && since !== null ? { phase, since } : null;
}

/** Tests only. */
export function resetRuntimeStarts(): void {
  starts.clear();
  seenStarting.clear();
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
