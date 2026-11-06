/** Per-connection read admission. Mutations never wait behind background reads. */
export class ReadLoad {
  private readonly lifetime = new AbortController();
  readonly signal = this.lifetime.signal;
  private active = 0;
  private until = 0;
  private lastOverload = Number.NEGATIVE_INFINITY;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: { signal?: AbortSignal | null; resolve(release: () => void): void; reject(error: unknown): void; cancel(): void }[] = [];

  constructor(private readonly random: () => number = Math.random, private readonly limit = 2) {}

  dispose(): void { this.lifetime.abort(new DOMException("Connection replaced", "AbortError")); }

  overload(hintMs: number): void {
    const now = Date.now();
    if (now - this.lastOverload > 60_000) this.failures = 0;
    this.lastOverload = now;
    const base = Math.max(Number.isFinite(hintMs) ? Math.max(0, hintMs) : 0, Math.min(30_000, 3_000 * 2 ** Math.min(this.failures++, 4)));
    const jitter = Math.min(1_000, base * 0.2) * Math.min(1, Math.max(0, this.random()));
    this.until = Math.max(this.until, now + base + jitter);
    this.pump();
  }

  acquire(signal?: AbortSignal | null): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const entry = { signal, resolve, reject, cancel: () => {
        const at = this.queue.indexOf(entry);
        if (at < 0) return;
        this.queue.splice(at, 1);
        signal?.removeEventListener("abort", entry.cancel);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        this.pump();
      } };
      signal?.addEventListener("abort", entry.cancel, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }

  /** SSE headers wait for a host cooldown, but an open stream never owns a finite-read slot. */
  opening(signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      const check = () => {
        if (signal?.aborted) return cancel();
        const wait = this.until - Date.now();
        if (wait > 0) timer = setTimeout(check, Math.min(wait, 2_147_483_647));
        else { cleanup(); resolve(); }
      };
      signal?.addEventListener("abort", cancel, { once: true });
      check();
    });
  }

  private pump(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length || this.active >= this.limit) return;
    const wait = this.until - Date.now();
    if (wait > 0) {
      // Long server hints may exceed the platform's 32-bit timer range; never wake early.
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, Math.min(wait, 2_147_483_647));
      return;
    }
    while (this.queue.length && this.active < this.limit) {
      const next = this.queue.shift()!;
      next.signal?.removeEventListener("abort", next.cancel);
      this.active++;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.pump();
      });
    }
  }
}

const BACKGROUND_METHODS = new Set([
  "cutex/session/get", "cutex/focus/get", "cutex/userInput/queue/list",
  "thread/read", "thread/list", "thread/turns/list", "thread/items/list", "thread/loaded/list", "thread/goal/get",
  "thread/searchOccurrences", "thread/backgroundTerminals/list", "model/list", "config/read",
  "account/read", "account/rateLimits/read", "collaborationMode/list", "experimentalFeature/list",
  "skills/list", "mcpServerStatus/list", "windowsSandbox/readiness", "claude/model/status",
]);

/** A side chat's bounded long poll waits for a revision, like an SSE subscription. */
export function subscriptionRead(url: string, init: RequestInit): boolean {
  if (new Headers(init.headers).get("Accept")?.includes("text/event-stream")) return true;
  const parsed = new URL(url);
  return /^\/v2\/sessions\/[^/]+\/side-chats\/[^/]+$/.test(parsed.pathname) &&
    Number(parsed.searchParams.get("waitMs")) > 0;
}

/** Read-only POST envelopes used by background stores; unknown methods retain the mutation policy. */
export function finiteRead(url: string, init: RequestInit): boolean {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST") return false;
  const path = new URL(url).pathname;
  if (path === "/v2/host/sessions") return true;
  if (!path.endsWith("/requests") || typeof init.body !== "string") return false;
  try {
    const body = JSON.parse(init.body) as { method?: string; native?: { message?: { method?: string } } };
    const operation = body.native?.message?.method ?? body.method;
    return typeof operation === "string" && BACKGROUND_METHODS.has(operation);
  } catch { return false; }
}

/** Release only when a finite response is consumed/cancelled, including abort during body reads. */
export function admittedResponse(response: Response, release: () => void, signal?: AbortSignal | null): Response {
  if (!response.body) { release(); return response; }
  const reader = response.body.getReader();
  let output: ReadableStreamDefaultController<Uint8Array>;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    signal?.removeEventListener("abort", abort);
    release();
  };
  const abort = () => {
    output.error(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    void reader.cancel(signal?.reason).catch(() => {});
    finish();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { output = controller; },
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) { controller.close(); finish(); }
        else controller.enqueue(part.value);
      } catch (error) { controller.error(error); finish(); }
    },
    cancel(reason) { finish(); return reader.cancel(reason); },
  });
  if (signal?.aborted) abort();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
