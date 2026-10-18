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

  /**
   * `viaProxy`: the response carried proxy headers (`Via`, `Proxy-Authenticate`, `Proxy-Agent`). An
   * answer without cutex's error shape that looks like a proxy's (407, 502, 504, or proxy headers)
   * says so in the message: a proxy between the desktop and cutex is a common cause of "nothing
   * works" on a machine with a system / environment proxy.
   */
  static fromBody(status: number, body: unknown, viaProxy = false): CutexApiError {
    const error = (body as Partial<CutexErrorBody> | undefined)?.error;
    if (error && typeof error.code === "string") {
      return new CutexApiError(status, error.code, error.message ?? "", !!error.retryable, error.details);
    }
    // Some cutex routers (peers-v2 `/v2/peers*`) answer a flat `{code, message, retryable, details}`.
    const flat = body as { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown } | null | undefined;
    if (flat && typeof flat === "object" && typeof flat.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(flat.code)) {
      return new CutexApiError(status, flat.code, typeof flat.message === "string" ? flat.message : "", flat.retryable === true, flat.details);
    }
    const raw = typeof body === "string" ? body : "request failed";
    if (viaProxy || status === 407 || status === 502 || status === 504) {
      return new CutexApiError(status, `http_${status}`, `${PROXY_HINT}${raw ? ` (${textSnippet(raw)})` : ""}`, false, { proxyLike: true });
    }
    return new CutexApiError(status, `http_${status}`, raw);
  }

  /** The answer did not look like cutex's but like a proxy's (see fromBody). */
  get proxyLike(): boolean {
    return (this.details as { proxyLike?: unknown } | null | undefined)?.proxyLike === true;
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
    const reason = causeText(cause);
    super(`cutex management API unreachable at ${baseUrl}${reason ? ` (${reason})` : ""}`, { cause });
    this.name = "CutexUnreachableError";
  }
}

/** Shown when an answer looks like a proxy's rather than cutex's. */
export const PROXY_HINT = "the answer did not come from cutex — a proxy may be in the way (requests to this host must not go through a proxy; check the system / HTTP(S)_PROXY settings)";

/** The low-level reason of a failed fetch (`ECONNREFUSED`, `UND_ERR_SOCKET`, …), short. */
function causeText(cause: unknown): string {
  const inner = (cause as { cause?: { code?: unknown; message?: unknown } } | null | undefined)?.cause;
  if (inner && typeof inner.code === "string") return inner.code;
  if (inner && typeof inner.message === "string") return inner.message.slice(0, 120);
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "";
}

/** A one-line, tag-free excerpt of a non-cutex body (an HTML error page of a proxy). */
function textSnippet(text: string): string {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
}
