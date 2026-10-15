import type { CutexErrorBody } from "@cutex-desktop/protocol";

/** Error returned by the cutex Management v2 API (`{contractVersion, error:{...}}`). */
export class CutexApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, retryable = false, details?: unknown) {
    super(`${code}: ${message}`);
    this.name = "CutexApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }

  static fromBody(status: number, body: unknown): CutexApiError {
    const error = (body as Partial<CutexErrorBody> | undefined)?.error;
    if (error && typeof error.code === "string") {
      return new CutexApiError(status, error.code, error.message ?? "", !!error.retryable, error.details);
    }
    // Some cutex routers (peers-v2 `/v2/peers*`) answer a flat `{code, message, retryable, details}`.
    const flat = body as { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown } | null | undefined;
    if (flat && typeof flat === "object" && typeof flat.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(flat.code)) {
      return new CutexApiError(status, flat.code, typeof flat.message === "string" ? flat.message : "", flat.retryable === true, flat.details);
    }
    return new CutexApiError(status, `http_${status}`, typeof body === "string" ? body : "request failed");
  }

  /** Errors that mean our cursor/stream view is invalid and the session must be re-bootstrapped. */
  get requiresResync(): boolean {
    return this.code === "stream_changed" || this.code === "cursor_expired";
  }

  /**
   * `503 idempotency_capacity_exceeded`: cutex's request store is full of unresolved requests. The
   * request was neither recorded nor forwarded, so sending it again (same ids) is safe.
   */
  get capacityExceeded(): boolean {
    return this.code === IDEMPOTENCY_CAPACITY_EXCEEDED;
  }

  /** `details.retryAfterMs` of a capacity error (cutex's hint; may be long), else null. */
  get retryAfterMs(): number | null {
    const ms = (this.details as { retryAfterMs?: unknown } | null | undefined)?.retryAfterMs;
    return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
}

/** Error code of the capacity refusal above; it survives the IPC hop as the message prefix. */
export const IDEMPOTENCY_CAPACITY_EXCEEDED = "idempotency_capacity_exceeded";

/** The daemon could not be reached at all (not running, wrong port, ...). */
export class CutexUnreachableError extends Error {
  constructor(readonly baseUrl: string, cause: unknown) {
    super(`cutex management API unreachable at ${baseUrl}`, { cause });
    this.name = "CutexUnreachableError";
  }
}
