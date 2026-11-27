// 输入优化 (input-refinement): one `POST /v2/text-rewrite` (v1, shared/textRewrite.ts) or `/v2/text-rewrite/structured` (v2,
// shared/textRewriteV2.ts) per renderer request. The host credential stays
// here; the renderer names its call by requestId and can drop it (Esc): aborting the fetch closes the Management
// connection, which cutex reads as a cancel and uses to stop the provider call (cutex docs/text-rewrite.md).
// Never retried: a second attempt may be charged again. Nothing here logs the text.
// A cancel can overtake its own start over IPC: a cancelled id unknown here is remembered for a while (tombstone) and
// a later start with it is refused. A call is also bound to the renderer that asked (`RewriteOwner`): its reload,
// navigation, crash or close (macOS keeps the app and its hosts) cancels it.
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import { isTextRewriteRequestId, textRewriteAttempts, textRewriteBody, textRewriteErrorCode, textRewriteReply, type TextRewriteAttempt, type TextRewriteErrorCode, type TextRewriteResult } from "../shared/textRewrite";
import { parseStructuredRewriteReply, structuredRewriteBody, type StructuredRewriteResult } from "../shared/textRewriteV2";

/** cutex ends the whole operation at 20 s; this only frees the slot if a reply never comes. */
export const TEXT_REWRITE_MAIN_TIMEOUT_MS = 30_000;
/** cutex admits two calls per host; a few more may be waiting to be cancelled. */
const MAX_IN_FLIGHT = 8;
/** How long a cancelled, not-yet-started id is refused, and how many are kept. */
export const TEXT_REWRITE_TOMBSTONE_MS = 60_000;
const MAX_TOMBSTONES = 256;

/** The renderer a call belongs to (Electron's WebContents is one). */
export interface RewriteOwner {
  isDestroyed(): boolean;
  on(event: "did-navigate" | "render-process-gone" | "destroyed", listener: () => void): unknown;
  removeListener(event: "did-navigate" | "render-process-gone" | "destroyed", listener: () => void): unknown;
}
const OWNER_GONE = ["did-navigate", "render-process-gone", "destroyed"] as const;

type Failure = { ok: false; code: TextRewriteErrorCode; attempts: TextRewriteAttempt[] };
const CANCELLED: Failure = { ok: false, code: "cancelled", attempts: [] };

export class TextRewrites {
  readonly #inFlight = new Map<string, AbortController>();
  /** Cancelled before they started: id → until (ms). */
  readonly #tombstones = new Map<string, number>();

  constructor(private readonly timeoutMs = TEXT_REWRITE_MAIN_TIMEOUT_MS, private readonly now: () => number = Date.now) {}

  /** v1 `POST /v2/text-rewrite` (提示词增强 on hosts without text-rewrite-v2). */
  run(client: CutexClient, input: unknown, owner?: RewriteOwner): Promise<TextRewriteResult> {
    const body = textRewriteBody(input);
    return this.#call(client, input, owner, "/v2/text-rewrite", body, (reply) => textRewriteReply(reply));
  }

  /** v2 `POST /v2/text-rewrite/structured` (shared/textRewriteV2.ts): a template, suggestions, corrections. */
  runStructured(client: CutexClient, input: unknown, owner?: RewriteOwner): Promise<StructuredRewriteResult> {
    const body = structuredRewriteBody(input);
    return this.#call(client, input, owner, "/v2/text-rewrite/structured", body, (reply) => parseStructuredRewriteReply(reply, body.text));
  }

  async #call<R extends { ok: true }>(client: CutexClient, input: unknown, owner: RewriteOwner | undefined, path: string, body: object, parse: (reply: unknown) => R | null): Promise<R | Failure> {
    const requestId = (input as { requestId?: unknown } | null)?.requestId;
    if (!isTextRewriteRequestId(requestId)) throw new Error("invalid text rewrite request id");
    this.#sweep();
    if (this.#tombstones.delete(requestId)) return CANCELLED;
    if (owner?.isDestroyed()) return CANCELLED;
    if (this.#inFlight.has(requestId)) throw new Error("text rewrite request id in use");
    if (this.#inFlight.size >= MAX_IN_FLIGHT) return { ok: false, code: "rewrite_busy", attempts: [] };
    const abort = new AbortController();
    this.#inFlight.set(requestId, abort);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, this.timeoutMs);
    const gone = () => abort.abort();
    if (owner) for (const event of OWNER_GONE) owner.on(event, gone);
    try {
      const reply = await client.request<unknown>("POST", path, { body, signal: abort.signal, retryable: false });
      return parse(reply) ?? { ok: false, code: "failed", attempts: [] };
    } catch (error) {
      if (abort.signal.aborted) return timedOut ? { ok: false, code: "timeout", attempts: [] } : CANCELLED;
      if (error instanceof CutexApiError) {
        const code = textRewriteErrorCode(error.code, error.status);
        return { ok: false, code, attempts: code === "rewrite_failed" ? textRewriteAttempts(error.details) : [] };
      }
      return { ok: false, code: "unreachable", attempts: [] };
    } finally {
      clearTimeout(timer);
      if (owner && !owner.isDestroyed()) for (const event of OWNER_GONE) owner.removeListener(event, gone);
      this.#inFlight.delete(requestId);
    }
  }

  /** Drop one call (Esc / the composer went away). Not started yet: its start is refused for a while. */
  cancel(requestId: unknown): void {
    if (!isTextRewriteRequestId(requestId)) return;
    const live = this.#inFlight.get(requestId);
    if (live) return live.abort();
    this.#sweep();
    this.#tombstones.set(requestId, this.now() + TEXT_REWRITE_TOMBSTONE_MS);
    while (this.#tombstones.size > MAX_TOMBSTONES) this.#tombstones.delete(this.#tombstones.keys().next().value!);
  }

  /** The connection to this host is going away. */
  cancelAll(): void {
    for (const abort of this.#inFlight.values()) abort.abort();
  }

  #sweep(): void {
    const now = this.now();
    for (const [id, until] of this.#tombstones) if (until <= now) this.#tombstones.delete(id);
  }

  get size(): number { return this.#inFlight.size; }
  get tombstones(): number { return this.#tombstones.size; }
}
