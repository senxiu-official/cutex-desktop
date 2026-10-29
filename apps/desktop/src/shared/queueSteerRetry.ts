import { CutexApiError } from "@cutex-desktop/cutex-client";

/** cutex's capability gate refused before sending to the native runtime. A native refusal,
 * transport failure or uncertain result is never permission to submit again. */
export function retryableSteerPreflight(error: unknown): boolean {
  if (!(error instanceof CutexApiError) || error.status !== 409 || error.code !== "steer_unavailable" || error.retryable !== true) return false;
  const details = error.details as { reason?: unknown; nativeError?: unknown; resyncRequired?: unknown } | null | undefined;
  return details?.reason === "runtimeNoSteer" && details.nativeError === undefined && details.resyncRequired !== true;
}

/** A cold Claude capability query can fail transiently and be reported as runtimeNoSteer.
 * Retry that proven-unsent gate once, under the original queue id/revision and connection. */
export async function withSteerPreflightRetry<T>(send: () => Promise<T>, checkCurrent: () => void): Promise<T> {
  try { return await send(); }
  catch (error) {
    if (!retryableSteerPreflight(error)) throw error;
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    checkCurrent();
    return send();
  }
}
