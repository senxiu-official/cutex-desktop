// Host events that should make something happen now (auto-open a publish, a service reveal card) must
// be live: received during this app run and recently. A reconnect's catch-up of older events is not.

/** A host event older than this (by its envelope's receivedAt) is a replay. */
export const LIVE_WINDOW_MS = 2 * 60_000;

/** `receivedAt` / `now` / `startedAt` in ms; null receivedAt = unknown = not live. */
export function isLiveEvent(receivedAt: number | null, now: number, startedAt: number, windowMs = LIVE_WINDOW_MS): boolean {
  if (receivedAt === null || !Number.isFinite(receivedAt)) return false;
  return receivedAt >= startedAt - 5_000 && now - receivedAt <= windowMs;
}

/** An envelope's receivedAt (ISO) in ms, or null. */
export function receivedAtOf(envelope: { receivedAt?: unknown } | null | undefined): number | null {
  const at = typeof envelope?.receivedAt === "string" ? Date.parse(envelope.receivedAt) : NaN;
  return Number.isFinite(at) ? at : null;
}
