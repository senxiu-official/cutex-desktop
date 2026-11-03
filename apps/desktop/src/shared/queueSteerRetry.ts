import { CutexApiError } from "@cutex-desktop/cutex-client";

export const HOST_BUSY_BACKOFF_MS = [300, 600, 1200, 2000] as const;

/** Only explicit pre-send admission contention is safe to replay. A generic 503 is not. */
export function retryableHostBusy(error: unknown): boolean {
  if (!(error instanceof CutexApiError) || !error.retryable) return false;
  const details = error.details as { reason?: unknown; nativeError?: unknown; resyncRequired?: unknown; originalCode?: unknown } | null | undefined;
  if (details?.resyncRequired === true || details?.nativeError !== undefined || details?.originalCode === "outcome_unknown") return false;
  return (error.status === 503 && error.code === "admission_busy" && details?.reason === "hostBusy")
    || (error.status === 409 && error.code === "steer_unavailable" && details?.reason === "admissionBusy")
    || (error.status === 503 && error.code === "event_persistence_unavailable" && /^event_persistence_unavailable: admission_deferred:/.test(error.message))
    || (error.status === 503 && error.code === "admission_deferred");
}

/** A valid host hint is a minimum wait; malformed timer values do not override backoff. */
export function hostBusyRetryDelay(error: unknown, retry: number): number {
  const fallback = HOST_BUSY_BACKOFF_MS[retry] ?? HOST_BUSY_BACKOFF_MS.at(-1)!;
  const hint = error instanceof CutexApiError ? (error.details as { retryAfterMs?: unknown } | null)?.retryAfterMs : undefined;
  return typeof hint === "number" && Number.isSafeInteger(hint) && hint >= 0 && hint <= 2_147_483_647 ? Math.max(fallback, hint) : fallback;
}

export async function withHostBusyRetry<T>(send: () => Promise<T>, checkCurrent: () => void, onRetry: (error: CutexApiError, attempt: number) => void = () => {}): Promise<T> {
  for (let retry = 0; ; retry++) {
    try { return await send(); }
    catch (error) {
      if (!retryableHostBusy(error) || retry >= HOST_BUSY_BACKOFF_MS.length) throw error;
      onRetry(error as CutexApiError, retry + 2);
      await new Promise<void>(resolve => setTimeout(resolve, hostBusyRetryDelay(error, retry)));
      checkCurrent();
    }
  }
}

/** cutex's capability gate refused before sending to the native runtime. A native refusal,
 * transport failure or uncertain result is never permission to submit again. */
export function retryableSteerPreflight(error: unknown): boolean {
  if (!(error instanceof CutexApiError) || error.status !== 409 || error.code !== "steer_unavailable" || error.retryable !== true) return false;
  const details = error.details as { reason?: unknown; nativeError?: unknown; resyncRequired?: unknown } | null | undefined;
  return details?.reason === "runtimeNoSteer" && details.nativeError === undefined && details.resyncRequired !== true;
}

/** A cold Claude capability query can fail transiently and be reported as runtimeNoSteer.
 * Retry that proven-unsent gate once, under the original queue id/revision and connection. */
export async function withSteerPreflightRetry<T>(send: () => Promise<T>, checkCurrent: () => void, onRetry: (error: CutexApiError, attempt: number) => void = () => {}): Promise<T> {
  let hostRetries = 0, capabilityRetried = false, attempt = 1;
  for (;;) {
    try { return await send(); }
    catch (error) {
      let delay: number;
      if (retryableHostBusy(error) && hostRetries < HOST_BUSY_BACKOFF_MS.length) delay = hostBusyRetryDelay(error, hostRetries++);
      else if (retryableSteerPreflight(error) && !capabilityRetried) { capabilityRetried = true; delay = 150; }
      else throw error;
      onRetry(error as CutexApiError, ++attempt);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
      checkCurrent();
    }
  }
}
