// Project log (cutex capability `project-events`, cutex-desktop docs/design/022 §「桌面接口约定」): the
// newest-first pages of `GET /v2/projects/{id}/events`, the live `…/events/stream` (SSE, resumable by
// cursor, `lagged` → page with `after=` and reconnect, 409 `cursor_expired` → start over) and the
// running-now list `GET /v2/projects/{id}/background`. Shapes: cutex
// `src/management/v2/schema/export/project-events.json`.
import type { CutexClient } from "./client";
import { CutexApiError, CutexUnreachableError } from "./errors";
import { SseParser } from "./sse";

export const PROJECT_EVENTS_FEATURE = "project-events";
/** SSE event name of one row on `/events/stream`. */
export const PROJECT_EVENT_STREAM_EVENT = "cutex/projectEvents/event";
/** Host-feed hint (`cutex.host`): `{projectId, cursor}`, at most once per project every 5 s. */
export const PROJECT_EVENTS_APPENDED = "cutex/projectEvents/appended";
const STREAM_ERROR_EVENT = "cutex_management_stream_error";

export const PROJECT_EVENT_KINDS = [
  "turn.completed", "turn.failed", "turn.interrupted",
  "ask.created", "ask.answered", "ask.failed", "ask.closed",
  "subagent.started", "subagent.finished", "background.started", "background.finished",
  "approval.requested", "approval.decided",
  "artifact.published", "workflow.run", "ownerNotify.created", "job.finished",
  "runtime.online", "runtime.offline", "member.joined", "member.left", "journal.gap",
] as const;
export type ProjectEventKind = (typeof PROJECT_EVENT_KINDS)[number];

/** `kinds=` prefixes the route accepts (an unknown one is a 400). */
export const PROJECT_EVENT_PREFIXES = ["turn", "ask", "subagent", "background", "approval", "artifact", "workflow", "ownerNotify", "job", "runtime", "member", "journal"] as const;
export type ProjectEventPrefix = (typeof PROJECT_EVENT_PREFIXES)[number];

export interface ProjectEvent {
  /** `pe:<seq>`. */
  cursor: string;
  at: string;
  projectId: string;
  cutexSessionId: string | null;
  agentName: string | null;
  /** A kind this client does not know yet stays a string (render it as "other"). */
  kind: ProjectEventKind | (string & {});
  status: string | null;
  title: string | null;
  detail: string | null;
  parent: { turnId: string | null; taskId: string | null; threadId: string | null };
  refs: { askId: string | null; jobId: string | null; artifactId: string | null; workflowRunId: string | null; approvalId: string | null; notificationId: string | null };
  source: { method: string | null; eventCursor: string | null };
  durationMs?: number;
  toolCalls?: number;
  backfilled?: true;
  /** Positive turn-start provenance from cutex. Absent on older hosts/journal rows: unknown. */
  turnOrigin?: "owner" | "external";
}

export interface ProjectEventPage {
  projectId: string;
  streamId: string;
  /** Newest cursor of the whole journal. */
  cursor: string;
  earliestCursor: string;
  order: "newestFirst" | "oldestFirst";
  hasMore: boolean;
  /**
   * r252+: with `hasMore`, the cursor for the next page (`before=`; `after=` for oldestFirst). A page stops
   * after a bounded scan, so it can be short or even empty while `hasMore` is true. null without `hasMore`;
   * absent before r252 (continue from the last event). Use {@link projectNextCursor}.
   */
  nextCursor?: string | null;
  events: ProjectEvent[];
}

export interface ProjectEventFilter {
  kinds?: readonly string[];
  sessionId?: string | null;
}

export interface ProjectEventQuery extends ProjectEventFilter {
  before?: string | null;
  after?: string | null;
  limit?: number;
  streamId?: string | null;
}

export type BackgroundStop =
  | { kind: "native"; cutexSessionId: string; method: "claude/tasks/stop" | "thread/backgroundTerminals/terminate"; params: Record<string, unknown> }
  | { kind: "job"; jobId: string; expectedRevision: unknown };

export interface BackgroundItem {
  kind: "subagent" | "background" | "task" | "job";
  source: "claude" | "codex" | "job";
  /** Claude taskId, Codex processId or jobId. */
  id: string;
  title: string | null;
  detail: string | null;
  turnId: string | null;
  threadId: string | null;
  startedAt: string | null;
  state: "running" | "pending" | "unknown";
  /** Owner only; null for others and for unknown items. */
  stop: BackgroundStop | null;
}

export interface BackgroundAgent {
  cutexSessionId: string;
  agentName: string | null;
  backend: "claude" | "codex" | "dsh";
  runtime: "online" | "offline";
  /** false: the runtime did not answer; the list may be incomplete. */
  complete: boolean;
  items: BackgroundItem[];
}

export interface ProjectBackground {
  projectId: string;
  generatedAt: string;
  /** false: no Job Service on this host (jobs not listed). */
  jobsAvailable: boolean;
  agents: BackgroundAgent[];
}

/** `pe:<seq>` → seq (NaN when malformed). Cursors are compared only to drop duplicates. */
export function projectCursorSeq(cursor: string | null | undefined): number {
  const m = /^pe:(\d+)$/.exec(cursor ?? "");
  return m ? Number(m[1]) : NaN;
}

/**
 * Where the page after `page` starts, or null when there is none: r252+ `nextCursor`, else (older hosts) the
 * last event's cursor. Also null when that cursor does not move past `from` (the cursor the page was read
 * with), so a caller paging in a loop cannot spin on one page.
 */
export function projectNextCursor(page: Pick<ProjectEventPage, "hasMore" | "events" | "order" | "nextCursor">, from: string | null | undefined): string | null {
  if (!page.hasMore) return null;
  const next = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : (page.events[page.events.length - 1]?.cursor ?? null);
  if (!next || next === from) return null;
  const seq = projectCursorSeq(next);
  const fromSeq = projectCursorSeq(from);
  if (Number.isFinite(seq) && Number.isFinite(fromSeq) && (page.order === "oldestFirst" ? seq <= fromSeq : seq >= fromSeq)) return null;
  return next;
}

const projectPath = (projectId: string, tail: string) => `/v2/projects/${encodeURIComponent(projectId)}/${tail}`;

function filterQuery(f: ProjectEventFilter): Record<string, string | undefined> {
  return { kinds: f.kinds?.length ? f.kinds.join(",") : undefined, sessionId: f.sessionId ?? undefined };
}

/** `GET /v2/projects/{id}/events` (newest first; with `after`: oldest first). */
export function projectEventsPage(client: CutexClient, projectId: string, q: ProjectEventQuery = {}, signal?: AbortSignal, options: { retryable?: boolean } = {}): Promise<ProjectEventPage> {
  const query = { ...filterQuery(q), before: q.before ?? undefined, after: q.after ?? undefined, limit: q.limit, streamId: q.streamId ?? undefined };
  return client.request<ProjectEventPage>("GET", projectPath(projectId, "events"), { query, ...(signal ? { signal } : {}), ...options });
}

/** `GET /v2/projects/{id}/background` (phase 2; answers reused by cutex for 5 s). */
export function projectBackground(client: CutexClient, projectId: string, signal?: AbortSignal): Promise<ProjectBackground> {
  return client.request<ProjectBackground>("GET", projectPath(projectId, "background"), signal ? { signal } : {});
}

/** Open `GET /v2/projects/{id}/events/stream`. Throws `CutexApiError` on a non-2xx answer (409 = cursor expired). */
export async function openProjectEventStream(client: CutexClient, projectId: string, options: ProjectEventFilter & { after?: string | null; streamId?: string | null; signal?: AbortSignal; retryable?: boolean } = {}): Promise<Response> {
  const headers = client.headers({ Accept: "text/event-stream" });
  if (options.after) headers["Last-Event-ID"] = options.after;
  const query = { ...filterQuery(options), after: options.after ?? undefined, streamId: options.streamId ?? undefined };
  let response: Response;
  try {
    response = await client.fetchRaw(client.url(projectPath(projectId, "events/stream"), query), { headers, ...(options.signal ? { signal: options.signal } : {}) }, { retryable: options.retryable });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new CutexUnreachableError(client.endpoint.baseUrl, error);
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // raw
    }
    throw CutexApiError.fromBody(response.status, body);
  }
  return response;
}

export type ProjectFollowStatus = "connecting" | "live" | "retrying";

export interface ProjectFollowHandlers {
  /** A new row (oldest first, never one already delivered). */
  event(row: ProjectEvent): void;
  status?(status: ProjectFollowStatus): void;
  /** The cursor expired / the journal was recreated (409): read the newest page again. The follower stopped. */
  reset?(): void;
  /** A refusal that retrying won't fix (404 project not visible, 400, 401 / 403). The follower stopped. */
  failed?(error: CutexApiError): void;
}

export interface ProjectFollowOptions extends ProjectEventFilter {
  /** Deliver rows after this cursor (null: only future rows). */
  after: string | null;
  streamId?: string | null;
  /** Reconnect delays (ms), the last one repeating. */
  retryDelaysMs?: readonly number[];
  /** No frame or keepalive for this long = a half-open connection: reconnect (cutex keeps alive every 25 s). */
  idleTimeoutMs?: number;
  /** Rows per catch-up page after `lagged`. */
  catchUpLimit?: number;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

const DEFAULT_RETRY = [500, 1000, 2000, 5000, 10_000];

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

/**
 * Follow a project's log live: resumes from the last delivered cursor after any drop, catches up with
 * `after=` pages when cutex says `lagged`, and stops with `reset` on 409 (the caller re-reads the newest
 * page and starts a new follower from its cursor).
 */
export class ProjectEventFollower {
  private readonly stopped = new AbortController();
  private attempt: AbortController | null = null;
  private after: string | null;
  private lastSeq: number;

  constructor(
    private readonly client: CutexClient,
    private readonly projectId: string,
    private readonly handlers: ProjectFollowHandlers,
    private readonly options: ProjectFollowOptions,
  ) {
    this.after = options.after;
    this.lastSeq = projectCursorSeq(options.after);
  }

  /** The last cursor delivered (or the starting one). */
  get cursor(): string | null {
    return this.after;
  }

  start(): this {
    void this.run();
    return this;
  }

  stop(): void {
    this.stopped.abort();
    this.attempt?.abort();
  }

  /** Reconnect now (e.g. after wake): drops the current connection; resumes from the last cursor. */
  reconnectNow(): void {
    this.attempt?.abort();
  }

  private deliver(row: ProjectEvent): void {
    const seq = projectCursorSeq(row.cursor);
    if (Number.isFinite(seq) && Number.isFinite(this.lastSeq) && seq <= this.lastSeq) return;
    if (Number.isFinite(seq)) this.lastSeq = seq;
    this.after = row.cursor;
    this.handlers.event(row);
  }

  private async catchUp(from: string | null, signal: AbortSignal): Promise<void> {
    let after = from ?? this.after;
    for (let page = 0; page < 50 && after; page++) {
      const r = await projectEventsPage(this.client, this.projectId, { after, kinds: this.options.kinds, sessionId: this.options.sessionId, streamId: this.options.streamId, limit: this.options.catchUpLimit ?? 500 }, signal, { retryable: false });
      for (const row of r.events) this.deliver(row);
      // r252+: a bounded scan can end short (even empty) with hasMore; nextCursor says where to go on.
      after = projectNextCursor(r, after);
    }
  }

  private async run(): Promise<void> {
    const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY;
    const sleep = this.options.sleep ?? defaultSleep;
    let failures = 0;
    while (!this.stopped.signal.aborted) {
      const attempt = new AbortController();
      this.attempt = attempt;
      const abort = () => attempt.abort();
      this.stopped.signal.addEventListener("abort", abort, { once: true });
      let idle: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        if (!this.options.idleTimeoutMs) return;
        clearTimeout(idle);
        idle = setTimeout(() => attempt.abort(), this.options.idleTimeoutMs);
      };
      let lagged = false;
      try {
        this.handlers.status?.(failures ? "retrying" : "connecting");
        touch();
        const response = await openProjectEventStream(this.client, this.projectId, { after: this.after, streamId: this.options.streamId, kinds: this.options.kinds, sessionId: this.options.sessionId, signal: attempt.signal, retryable: false });
        failures = 0;
        this.handlers.status?.("live");
        touch();
        const parser = new SseParser(() => touch());
        const decoder = new TextDecoder();
        const reader = response.body!.getReader();
        try {
          read: for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            touch();
            for (const message of parser.push(decoder.decode(value, { stream: true }))) {
              if (message.event === PROJECT_EVENT_STREAM_EVENT) {
                let row: ProjectEvent;
                try {
                  row = JSON.parse(message.data) as ProjectEvent;
                } catch {
                  continue;
                }
                if (!row.cursor && message.id) row.cursor = message.id;
                this.deliver(row);
              } else if (message.event === STREAM_ERROR_EVENT) {
                let code = "";
                let last: string | null = null;
                try {
                  const err = (JSON.parse(message.data) as { error?: { code?: unknown; details?: { lastDeliveredCursor?: unknown } } }).error;
                  code = typeof err?.code === "string" ? err.code : "";
                  last = typeof err?.details?.lastDeliveredCursor === "string" ? err.details.lastDeliveredCursor : null;
                } catch {
                  // unreadable frame: treat as a drop
                }
                if (code === "lagged") {
                  lagged = true;
                  // Rows up to lastDeliveredCursor went out on this connection; ours may be further.
                  const from = last && projectCursorSeq(last) > this.lastSeq ? last : this.after;
                  clearTimeout(idle);
                  await this.catchUp(from, attempt.signal);
                }
                break read;
              }
            }
          }
        } finally {
          void reader.cancel().catch(() => undefined);
        }
      } catch (error) {
        if (this.stopped.signal.aborted) return;
        if (error instanceof CutexApiError) {
          if (error.status === 409) {
            this.stop();
            this.handlers.reset?.();
            return;
          }
          if (error.status < 500 && error.status !== 429 && error.status !== 408) {
            this.stop();
            this.handlers.failed?.(error);
            return;
          }
        }
        failures++;
      } finally {
        clearTimeout(idle);
        this.stopped.signal.removeEventListener("abort", abort);
      }
      if (this.stopped.signal.aborted) return;
      if (lagged) continue;
      if (failures === 0) failures = 1;
      this.handlers.status?.("retrying");
      await sleep(delays[Math.min(failures - 1, delays.length - 1)]!, this.stopped.signal);
    }
  }
}
