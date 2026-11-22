// Errors a host read can recover from by itself (owner 2026-11-16: the 文件 panel showed only red
// `git_status_busy: git status is busy; retry shortly`, with no reload and no retry). Panels retry these
// with a capped backoff and keep what they last showed; anything else waits for 重新加载.
//
// Errors reach the renderer as Error.message only (Electron drops every other field), so the
// classification reads cutex's error code — the `<code>: <message>` prefix CutexApiError puts on every
// message (see bridge.cleanIpcMessage) — and Node's transport codes, never the English text. The
// codes are the ones cutex sends with `retryable: true` and `details.retryAfterMs` (r285:
// git_status_busy from the git-status pool, heavy_read_capacity_exceeded from read admission), the
// other admission refusals, and timeouts.

/** Waits before the 1st, 2nd, … retry; the last one repeats. */
export const RETRY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export function retryDelay(attempt: number): number {
  return RETRY_BACKOFF_MS[Math.min(Math.max(0, attempt), RETRY_BACKOFF_MS.length - 1)]!;
}

const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;
const CODE = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+):/;
/** cutex codes sent as retryable (capacity / admission). */
const TRANSIENT_CODES = new Set(["git_status_busy", "heavy_read_capacity_exceeded", "admission_busy", "idempotency_capacity_exceeded"]);
/** Node / undici transport failures: the connection dropped or timed out (the host may be back in a moment). */
const TRANSPORT = /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CLOSED|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)\b/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

/** cutex's error code of a failed call (`git_status_busy`), or null for an uncoded failure. */
export function errorCode(error: unknown): string | null {
  return CODE.exec(messageOf(error).replace(IPC_PREFIX, ""))?.[1] ?? null;
}

/** Whether a failed host read is worth retrying by itself. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "CutexUnreachableError")) return true;
  const code = errorCode(error);
  if (code) return TRANSIENT_CODES.has(code) || code.endsWith("_busy") || code.endsWith("_timeout") || code.endsWith("_timed_out");
  return TRANSPORT.test(messageOf(error));
}

/** A failed read as panels show it: the plain line comes from the panel; code and raw text go in a tooltip. */
export interface ReadIssue {
  code: string | null;
  /** The raw message (tooltip / detail). */
  detail: string;
  /** Retrying by itself (transient); otherwise it waits for 重新加载. */
  retrying: boolean;
}

export function readIssue(error: unknown): ReadIssue {
  const detail = messageOf(error).replace(IPC_PREFIX, "") || String(error);
  return { code: errorCode(error), detail, retrying: isTransientError(error) };
}
