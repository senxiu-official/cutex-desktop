import { CutexApiError } from "./errors";

export const HTTP_RETRY_MAX_ATTEMPTS = 5;
export const HTTP_RETRY_BUDGET_MS = 5_000;
const MAX_ERROR_BYTES = 64 * 1024;

export interface HttpRetryOptions {
  /** Explicitly safe non-GET request, or false to disable retries. POST still needs an idempotency key. */
  retryable?: boolean;
  /** Media bytes never inspect undeclared error payloads. */
  jsonErrorsOnly?: boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function aborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function wait(ms: number, signal: AbortSignal | null | undefined, sleep?: HttpRetryOptions["sleep"]): Promise<void> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (error?: unknown) => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error !== undefined) reject(error); else resolve();
    };
    const cancel = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    if (sleep) Promise.resolve().then(() => sleep(ms)).then(() => done(), done);
    else timer = setTimeout(() => done(), ms);
  });
}

/** Only inspect a bounded error clone; leave the original response available to its caller. */
export async function errorOf(response: Response, signal: AbortSignal | null | undefined, remaining: number): Promise<CutexApiError | null> {
  const copy = response.clone();
  const reader = copy.body?.getReader();
  if (!reader) return CutexApiError.fromBody(response.status, undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_ERROR_BYTES) return null;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown = new TextDecoder().decode(bytes);
    try { body = JSON.parse(body as string); } catch { /* A plain 429 can still be retried for reads. */ }
    return CutexApiError.fromBody(response.status, body);
  };
  try {
    return await Promise.race([read(), new Promise<null>((resolve, reject) => {
      timer = setTimeout(() => resolve(null), Math.max(0, remaining));
      cancel = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
  }
}

const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
function keyed(url: string, init: RequestInit): boolean {
  if (nonempty(new Headers(init.headers).get("Idempotency-Key"))) return true;
  if (typeof init.body !== "string") return false;
  let body: Record<string, unknown>;
  try { body = JSON.parse(init.body); } catch { return false; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (["action_id", "idempotencyKey", "idempotency_key"].some(key => nonempty(body[key]))) return true;
  // These two native/cutex envelopes document requestId as their idempotency key.
  return /\/(?:app-server|cutex)\/requests$/.test(new URL(url).pathname) && nonempty(body.requestId);
}

function replayable(body: RequestInit["body"]): boolean {
  return body == null || typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof URLSearchParams;
}

function delayHint(response: Response, error: CutexApiError): number {
  if (error.retryAfterMs !== null) return error.retryAfterMs;
  const header = response.headers.get("Retry-After")?.trim();
  if (!header) return 0;
  const ms = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

/** Retry only explicit overload refusals, never transport failures or uncertain submissions. */
export async function fetchWithRetry(fetchOnce: typeof fetch, url: string, init: RequestInit, options: HttpRetryOptions = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const read = method === "GET" || method === "HEAD";
  const hasKey = keyed(url, init);
  const allowed = options.retryable !== false && replayable(init.body) && (read || hasKey || (method !== "POST" && options.retryable === true));
  const started = Date.now();
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    aborted(init.signal);
    const response = await fetchOnce(url, init);
    if (!allowed || ![429, 503].includes(response.status) || attempt >= HTTP_RETRY_MAX_ATTEMPTS) return response;
    const remaining = HTTP_RETRY_BUDGET_MS - Math.max(waited, Date.now() - started);
    if (remaining <= 0) return response;
    const declaredJson = /^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "");
    let error: CutexApiError | null;
    try {
      error = options.jsonErrorsOnly && !declaredJson
        ? CutexApiError.fromBody(response.status, undefined)
        : await errorOf(response, init.signal, remaining);
    } catch (error) {
      void response.body?.cancel().catch(() => {});
      throw error;
    }
    // The input-submit path already owns this separate capacity policy and its tracing.
    if (!error || error.capacityExceeded || (response.status === 503 && !error.retryable) || (!read && !error.retryable)) return response;
    // A definite admission rejection can be cached against this wire requestId. The owner
    // operation must retry with unchanged consent/fences but a new wire ID, not replay this fetch.
    if (error.code === "admission_busy" && (error.details as { reason?: unknown } | null)?.reason === "hostBusy") return response;
    const base = Math.max(100 * 2 ** (attempt - 1), delayHint(response, error));
    const jitter = Math.min(base * 0.2, 100) * Math.min(1, Math.max(0, (options.random ?? Math.random)()));
    const delay = Math.ceil(base + jitter);
    if (delay > HTTP_RETRY_BUDGET_MS - Math.max(waited, Date.now() - started)) return response;
    try { await wait(delay, init.signal, options.sleep); }
    catch (error) {
      void response.body?.cancel().catch(() => {});
      throw error;
    }
    waited += delay;
    // A suspended tab or a delayed timer must not start another attempt past the window.
    // Keep the original final response readable, just as for attempt-count exhaustion.
    if (Math.max(waited, Date.now() - started) >= HTTP_RETRY_BUDGET_MS) return response;
    void response.body?.cancel().catch(() => {});
  }
}
