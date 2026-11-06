import { runtimePruneBody, type RuntimePrunePlan, type RuntimePruneResult } from "./runtimePrune";
import type { MobileProfile, ProfileQuota, MobileUsageReport, UsageDimension, MobileService, HumanSessionCreate, HumanAgentCreate } from "./mobileManagement";
import { userAccessOf } from "./users";
import type { SessionPageQuery, SessionCatalogPage, SessionChangePage, SessionResync } from "./sessionDeltas";
import { pageQuery, pageResponse, type PageQuery, type OwnerNotificationsPageQuery, type SafetyChecksPageQuery } from "./pagination";
import type { ApprovalsPage, OwnerNotificationList, SafetyChecksPage } from "@cutex-desktop/protocol";
export type { PageQuery, OwnerNotificationsPageQuery, SafetyChecksPageQuery } from "./pagination";
export type { ApprovalsPage, OwnerNotificationList, SafetyChecksPage } from "@cutex-desktop/protocol";
import { delegationControlRoute, delegationId, requireDelegationCapability } from "./delegation";
import { DELEGATION_CAPABILITIES, type DelegationTreeQuery, type DelegationTreePage, type DelegationAttempts, type DelegationPolicy, type DelegationGrants, type DelegationApproval, type ProjectRunControl, type DelegationControlRequest, type DelegationOperationResult, type DelegationOperationLookup, type PermanentRetirementReviewRequest, type PermanentRetirementReview, type PermanentRetirementRequest, type AgentArchiveReceipt } from "@cutex-desktop/protocol";
import { INPUT_HOLD, INPUT_DISMISS, INPUT_GET, INPUT_GET_MAX_IDS, INPUT_LEASE_RELEASE, INPUT_LIST, INPUT_RETRY, INPUT_INTERRUPT_SEND } from "@cutex-desktop/protocol";
import type {
  InputHoldParams,
  InputHoldResult,
  InputInterruptSendParams,
  InputInterruptSendResult,
  InputDismissParams,
  InputDismissResult,
  UserInputQueueMergeParams,
  UserInputQueueMergeResult,
  InputGetParams,
  InputGetResult,
  InputLease,
  InputLeaseReleaseParams,
  InputListParams,
  InputListResult,
  InputRetryParams,
  CutexRequestResult,
  EventPage,
  HostInfo,
  HostSessionPage,
  HostSessionRow,
  NativeRequestResult,
  ProjectsResponse,
  AdmissionRef,
  QueueListResult,
  QueueMoveResult,
  QueueYieldResult,
  QueueResumeResult,
  QueueSteerResult,
  AsksPauseResult,
  JsonObject,
  NotificationAckResult,
  NotificationLevel,
  NotificationStates,
  TurnStopResult,
  SessionBootstrap,
  SessionHistory,
  SessionLifecycle,
  SessionList,
  SessionResource,
  UserInputSubmitParams,
  UserInputSubmitResult,
} from "@cutex-desktop/protocol";
import { messageSettlementCloseBody, messageSettlementEvidenceBody, STALE_ACK_SETTLEMENT_FEATURE, type MessageSettlementEvidenceResponse } from "./messageSettlement";
import type { MessageSettlementCloseRequest, MessageSettlementCloseResponse } from "@cutex-desktop/protocol";
import type { DaemonEndpoint } from "./endpoint";
import type { OperatorActionReceipt, OperatorActionRequest, OperatorProjectWorkspace } from "./operators";
import type { ClientTokenList, ClientTokenRenamed, HostSummary, PairingCode, PairRequest, PairResponse, SummaryReadResult } from "./summary";
import { CutexApiError, CutexUnreachableError } from "./errors";
import { errorOf, fetchWithRetry, type HttpRetryOptions } from "./retry";
import { admittedResponse, finiteRead, ReadLoad, subscriptionRead } from "./readLoad";
import { CLIENT_INSTANCE_ID, clientPresenceBody, closeGraceSeconds, readClientPresenceReply, readClientState, readOnlineClients, type ClientClosingOutcome, type ClientPresence, type ClientPresenceReply, type ClientState, type OnlineClient } from "./clients";
import { componentName, readComponentOperation, readComponentsList, type ComponentOperation, type ComponentsList } from "./components";
import { readHostServiceInfo, UPGRADE_RUN_ID, upgradeApplyBody, upgradeRefusalOf, upgradeRollbackBody, upgradeSettingsBody, upgradeStageBody, type HostServiceInfo, type UpgradeApplyRequest, type UpgradeResult, type UpgradeRollbackRequest, type UpgradeRollbackResult, type UpgradeRun, type UpgradeSettings, type UpgradeSettingsPatch, type UpgradeStaging, type UpgradeStatus } from "./upgrade";
import { HOME_COVER_MAX_BYTES, TILE_IMAGE_MAX_BYTES, homeCoverBody, homePutBody, readHomeView, readServiceTileAnswer, type HomeCoverUpload, type HomeDoc, type HomeView, type ServiceTileAnswer } from "./home";
import { AVATAR_CONTENT_TYPES, AVATAR_ETAG, AVATAR_MAX_BYTES, grantBody, PROFILE_IMAGE_KINDS, PROFILE_IMAGE_MAX_BYTES, profileImagePath, type AvatarUpload, type ProfileImageKind, PERSON_PUBLIC_KEY, PERSON_SIGNATURE, personKeysBody, selfProfileBody, DISPLAY_NAME_MAX, IDENTITY_CLAIM_OUTCOMES, type IdentityChallenge, type IdentityClaimOutcome, type IdentityClaimResult, type PersonKeyInput, type PersonKeysResult, type TokenPersonAckResult, userColorBody, userNameBody, USER_ID, type AvatarContentType, type SelfProfile, type SelfProfilePatch, type UserAvatar, type PeerBindingResult, type TokenBindingResult, type UserCreate, type UserPatch, type UsersList, type UsersSettings, type UserWriteResult, type OwnDevices, type OwnDeviceRevoked, DEVICE_SCOPES, type DeviceScope } from "./users";

/** Web Crypto UUID: available in Node ≥ 19, Electron, browsers and Android WebView (secure context). */
function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/** A route the daemon does not have (older cutex): 404 / 405 from the router. */
function isMissingRoute(error: unknown, statuses: readonly number[] = [404, 405]): boolean {
  return error instanceof CutexApiError && statuses.includes(error.status);
}

/** `GET /v2/asks` filter. Values over 200 chars are dropped; `limit` is clamped to 1..1000. */
export interface AskQuery {
  project?: string;
  /** A cutex session id or "owner". */
  requester?: string;
  target?: string;
  /** Requester or target (cutex `delegation-views`). */
  involving?: string;
  /** "open" | "closed" | an execution state. */
  state?: string;
  limit?: number;
}

/** `GET /v2/alarms` filter (cutex `alarms-api`). */
export interface AlarmQuery {
  /** Alarms this agent set or that wake it. */
  sessionId?: string;
  /** "pending" (default) = scheduled only; "all" adds queued / cancelled ones. */
  state?: "pending" | "all";
  limit?: number;
}

export type ApprovalState = "pending" | "all";
export type ApprovalDecisionKind = "approve" | "deny";

/** Reply of `POST /v2/sessions/{id}/attachments` (session-attachments). */
export interface UploadedAttachment {
  attachmentId: string;
  /** Host-side path to send as a `localImage` input. */
  path: string;
  mime: string;
  size: number;
}

/** Body accepted by `uploadAttachment` (no Node `Buffer`: pass `new Uint8Array(buffer)`). */
export type AttachmentBody = Uint8Array<ArrayBuffer> | ArrayBuffer | Blob;

// Ids that may hold dots never consist of dots only: `.` / `..` as a path segment would be normalised
// away by the URL parser and send the request to another route.
const ASK_ID = /^(?!\.+$)[A-Za-z0-9._:-]{1,120}$/;
const APPROVAL_ID = /^apr-[A-Za-z0-9-]{1,60}$/;
const TOKEN_ID = /^(?!\.+$)[A-Za-z0-9._:-]{1,128}$/;
const RUN_ID = /^rpu-[A-Za-z0-9-]{1,80}$/;
const ROTATION_ID = /^rot-[A-Za-z0-9-]{1,80}$/;
const CLAUDE_ACCOUNT_ID = /^(default|ca-[a-z0-9]{1,32})$/;
const SESSION_ID = /^(?!\.+$)[A-Za-z0-9._:-]{1,200}$/;
/** An alarm's unique id (its delivery message id). */
const ALARM_ID = /^alarm-[A-Za-z0-9-]{1,94}$/;
const WORKFLOW_RUN_ID = /^wr-[A-Za-z0-9-]{1,61}$/;

/** Whether a request path (before `?` / `#`) has a `.` / `..` segment, also percent-encoded (`%2e`). */
export function hasDotSegment(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  return pathname.split(/[\\/]/).some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
}

/** Agent ids for a runtime package run: non-empty, well-formed, de-duplicated. */
function runtimeAgentIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000) throw new Error("bad agent ids");
  if (!ids.every((id) => typeof id === "string" && SESSION_ID.test(id))) throw new Error("bad agent id");
  return [...new Set(ids as string[])];
}

export interface EventQuery {
  streamId?: string;
  after?: string;
  limit?: number;
  cutexSessionId?: string;
}

export interface CutexClientOptions {
  /** Enables admission for reads explicitly marked background. Foreground reads always bypass it. */
  backgroundReads?: boolean;
  /** Defaults to the global `fetch` (looked up per call, never called with the client as `this`). */
  fetch?: typeof fetch;
  /** Identifies this desktop instance in `origin.clientId` of submitted input. */
  clientId?: string;
  /**
   * Waits before each retry of a `503 idempotency_capacity_exceeded` user-input submit (one retry per
   * entry, same ids). Default `CAPACITY_RETRY_DELAYS_MS`; `[]` = no retry.
   */
  capacityRetryDelaysMs?: readonly number[];
  /** Replaces waits for HTTP overload and input-capacity retries (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Replaces HTTP retry jitter (tests). */
  retryRandom?: () => number;
}

/** 3 retries over about 4 s: cutex frees capacity within seconds or not for a long while. */
export const CAPACITY_RETRY_DELAYS_MS: readonly number[] = [400, 1200, 2400];
/** A longer `retryAfterMs` hint from cutex (it can be up to an hour) is not waited for in a send. */
const CAPACITY_RETRY_MAX_HINT_MS = 3000;

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Local scheduling metadata; never sent to the daemon. */
export type ReadOptions = { signal?: AbortSignal; background?: boolean; retryable?: boolean };
type RequestOptions = ReadOptions & { body?: unknown; query?: Record<string, string | number | undefined>; headers?: Record<string, string> };

/** Metadata only, emitted once when each HTTP stage settles. Attempts start at 1; retries reuse requestId. */
export interface SubmitHttpTraceEvent {
  requestId: string;
  attempt: number;
  stage: "fetch-headers" | "fetch-body" | "response-parse";
  elapsedMs: number;
  outcome: "completed" | "failed";
  /** Available after response headers arrive, including HTTP error responses. */
  status?: number;
  /** False means invalid JSON kept as raw text, as for unobserved requests. Empty bodies count as parsed. */
  parsed?: boolean;
}

export type SubmitHttpTraceObserver = (event: SubmitHttpTraceEvent) => void | Promise<void>;
type SubmitHttpTrace = { requestId: string; attempt: number; observer: SubmitHttpTraceObserver };

/** Diagnostics must never change HTTP, error, or retry behavior. No observer result is awaited. */
function emitSubmitHttpTrace(trace: SubmitHttpTrace | undefined, event: Omit<SubmitHttpTraceEvent, "requestId" | "attempt">): void {
  if (!trace) return;
  try {
    const result = trace.observer({ requestId: trace.requestId, attempt: trace.attempt, ...event });
    if (result) void Promise.resolve(result).catch(() => {});
  } catch { /* A failing diagnostics sink must not fail a send. */ }
}

/**
 * Thin typed client for cutex Management v2. Platform-neutral (fetch + Web Streams + Web Crypto):
 * runs in the Electron main process and in a browser / Capacitor WebView (the latter needs CORS on
 * the cutex side). Streaming/resync lives in `EventFeed`; desktop read admission is opt-in.
 */
/** Largest history media (one generated image) read back through `historyMedia`. */
export const HISTORY_MEDIA_MAX_BYTES = 64 * 1024 * 1024;
/** Descriptor-backed event media uses a tighter cap than legacy history refs. */
export const HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES = 32 * 1024 * 1024;
export interface HistoryMediaBytes {
  bytes: Uint8Array;
  mime: string;
  size: number;
}
export interface MediaBytesExpected { mime: string; size: number }
export interface HistoryMediaBytesOptions {
  transport: "bytes";
  expected?: MediaBytesExpected;
}
const HISTORY_MEDIA_SHA256 = /^[0-9a-f]{64}$/;
const historyMediaMime = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(value);
function mediaBytesExpected(expected: MediaBytesExpected | undefined): MediaBytesExpected | undefined {
  if (expected === undefined) return undefined;
  if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).some(key => key !== "mime" && key !== "size") || !historyMediaMime(expected.mime) || !Number.isSafeInteger(expected.size) || expected.size < 0 || expected.size > HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES) throw new Error("bad expected media descriptor");
  return { mime: expected.mime.toLowerCase(), size: expected.size };
}

/** A response too large to hold as one string (V8 ~512 M characters; design 025). */
export class ResponseTooLargeError extends Error {
  readonly code = "response_too_large";
  constructor(readonly path: string, cause: unknown) {
    super(`response_too_large: the host's answer for ${path.split("?")[0]} is too large to load (update the host's cutex for history-media-refs)`, { cause });
    this.name = "ResponseTooLargeError";
  }
}

export class CutexClient {
  private delegationDiscovery: Promise<{featureList: string[]; user?: unknown} | null> | undefined;
  private readonly readLoad: ReadLoad | undefined;
  readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly httpRetry: HttpRetryOptions;
  private readonly capacityRetryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(readonly endpoint: DaemonEndpoint, options: CutexClientOptions = {}) {
    this.readLoad = options.backgroundReads ? new ReadLoad(options.retryRandom) : undefined;
    // Browsers throw "Illegal invocation" when fetch is called with a foreign `this`
    // (e.g. `this.fetchImpl(...)` holding the bare global), so always call through a wrapper.
    const injected = options.fetch;
    this.fetchImpl = injected ? (input, init) => injected(input, init) : (input, init) => globalThis.fetch(input, init);
    this.httpRetry = { sleep: options.sleep, random: options.retryRandom };
    this.clientId = options.clientId ?? `cutex-desktop-${randomUUID()}`;
    this.capacityRetryDelaysMs = options.capacityRetryDelaysMs ?? CAPACITY_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // ---------- low level ----------

  /** Stop pending background reads when this desktop host connection is replaced. */
  dispose(): void { this.readLoad?.dispose(); }

  async fetchRaw(url: string, init: RequestInit, options: Pick<HttpRetryOptions, "retryable" | "jsonErrorsOnly"> & { background?: boolean } = {}): Promise<Response> {
    const load = this.readLoad;
    // Mutations keep their existing outcome policy; only background requests belong to this queue.
    const read = finiteRead(url, init);
    // Scheduling is additive and independent of the optional local limiter.
    // Do not forward a stale caller-supplied marker on foreground/mutations.
    const headers = new Headers(init.headers);
    if (read && options.background) {
      headers.set("X-Cutex-Read-Priority", "background");
      init = { ...init, headers };
    } else if (headers.has("X-Cutex-Read-Priority")) {
      headers.delete("X-Cutex-Read-Priority");
      init = { ...init, headers };
    }
    if (read && load) init = { ...init, signal: init.signal ? AbortSignal.any([init.signal, load.signal]) : load.signal };
    if (!load || !options.background) return fetchWithRetry(this.fetchImpl, url, init, { ...this.httpRetry, ...options });
    const streaming = subscriptionRead(url, init);
    let release: (() => void) | undefined;
    if (read) {
      if (streaming) await load.opening(init.signal);
      else release = await load.acquire(init.signal);
    }
    try {
      // Stores/feeds own the next refresh. A refused read is never multiplied into five attempts.
      const response = await fetchWithRetry(this.fetchImpl, url, init, { ...this.httpRetry, ...options, ...(read ? { retryable: false } : {}) });
      if (read && (response.status === 503 || response.status === 429)) {
        const error = await errorOf(response, init.signal, 5_000);
        const header = response.headers.get("Retry-After")?.trim();
        const fromHeader = !header ? 0 : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
        if (!error?.capacityExceeded) load.overload(Math.max(error?.retryAfterMs ?? 0, Number.isFinite(fromHeader) ? fromHeader : 0));
      }
      if (release) {
        const result = admittedResponse(response, release, init.signal);
        release = undefined;
        return result;
      }
      return response;
    } finally { release?.(); }
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", ...extra };
    if (this.endpoint.token) headers.Authorization = `Bearer ${this.endpoint.token}`;
    return headers;
  }

  url(path: string, query?: Record<string, string | number | undefined>): string {
    // An id that is `.` / `..` (or `%2e` forms) would be resolved away by the URL parser and reroute
    // the request (e.g. `/v2/sessions/..` → `/v2/`): refuse dot segments outright.
    if (hasDotSegment(path)) throw new Error("bad path: dot segment");
    const url = new URL(path, this.endpoint.baseUrl + "/");
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(
    method: Method,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.performRequest<T>(method, path, options);
  }

  private async performRequest<T>(method: Method, path: string, options: RequestOptions, trace?: SubmitHttpTrace): Promise<T> {
    const init: RequestInit = {
      method,
      headers: this.headers(options.body === undefined ? options.headers : { "Content-Type": "application/json", ...options.headers }),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal) init.signal = options.signal;

    // Outside the try: a bad path is a caller error, not an unreachable daemon.
    const url = this.url(path, options.query);
    let response: Response;
    const headersStarted = trace ? performance.now() : 0;
    try {
      response = await this.fetchRaw(url, init, { retryable: options.retryable, background: options.background });
    } catch (error) {
      if (trace) emitSubmitHttpTrace(trace, { stage: "fetch-headers", elapsedMs: performance.now() - headersStarted, outcome: "failed" });
      if ((error as Error).name === "AbortError" || options.signal?.aborted) throw error;
      throw new CutexUnreachableError(this.endpoint.baseUrl, error);
    }
    if (trace) emitSubmitHttpTrace(trace, { stage: "fetch-headers", elapsedMs: performance.now() - headersStarted, outcome: "completed", status: response.status });
    const bodyStarted = trace ? performance.now() : 0;
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (trace) emitSubmitHttpTrace(trace, { stage: "fetch-body", elapsedMs: performance.now() - bodyStarted, outcome: "failed", status: response.status });
      // V8 caps a string at ~512 M characters (design 025: a 1.5 GB image conversation): say what happened.
      if (error instanceof RangeError || /string longer than/i.test(String((error as Error)?.message))) throw new ResponseTooLargeError(path, error);
      throw error;
    }
    if (trace) emitSubmitHttpTrace(trace, { stage: "fetch-body", elapsedMs: performance.now() - bodyStarted, outcome: "completed", status: response.status });
    const parseStarted = trace ? performance.now() : 0;
    let body: unknown = text;
    let parsed = true;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // keep raw text
      parsed = false;
    }
    if (trace) emitSubmitHttpTrace(trace, { stage: "response-parse", elapsedMs: performance.now() - parseStarted, outcome: "completed", status: response.status, parsed });
    if (!response.ok) throw CutexApiError.fromBody(response.status, body, viaProxy(response));
    return body as T;
  }

  // Paired owner devices: reads accept read/chat/full; creation/open require full.
  profiles(options: ReadOptions = {}): Promise<{ defaultProfile: string | null; profiles: MobileProfile[] }> {
    return this.request("GET", "/v2/profiles", options);
  }
  profileQuota(id: string, options: ReadOptions = {}): Promise<ProfileQuota> {
    return this.request("GET", `/v2/profiles/${encodeURIComponent(id)}/quota`, options);
  }
  usage(query: { from?: string; to?: string; groupBy?: UsageDimension[]; source?: string } = {}, options: ReadOptions = {}): Promise<MobileUsageReport> {
    return this.request("GET", "/v2/usage", { ...options, query: { from: query.from, to: query.to, groupBy: query.groupBy?.join(","), source: query.source } });
  }
  profileQuotaConfig(id: string, options: ReadOptions = {}): Promise<JsonObject> {
    return this.request("GET", `/v2/profiles/${encodeURIComponent(id)}/quota-config`, options);
  }
  usagePrices(options: ReadOptions = {}): Promise<JsonObject> {
    return this.request("GET", "/v2/usage/prices", options);
  }
  usageSources(options: ReadOptions = {}): Promise<JsonObject> {
    return this.request("GET", "/v2/usage/sources", options);
  }
  profilePresets(options: ReadOptions = {}): Promise<JsonObject> {
    return this.request("GET", "/v2/profile-presets", options);
  }
  profileAutoPick(query: Record<string, string> = {}, options: ReadOptions = {}): Promise<JsonObject> {
    return this.request("GET", "/v2/profile-auto-pick", { ...options, query });
  }
  services(options: ReadOptions = {}): Promise<{ hostId: string; services: MobileService[] }> {
    return this.request("GET", "/v2/services", options);
  }
  openService(slug: string): Promise<{ slug: string; url: string; localUrl: string; health: string; service: MobileService }> {
    return this.request("POST", `/v2/services/${encodeURIComponent(slug)}/open`);
  }
  /** Keep requestId on retry; never retry creation with a new identity after a transport failure. */
  createHumanSession(body: HumanSessionCreate): Promise<{ cutexSessionId: string }> {
    return this.request("POST", "/v2/human/sessions", { body });
  }
  createHumanAgent(body: HumanAgentCreate): Promise<{ cutexSessionId: string }> {
    return this.request("POST", "/v2/human/agents", { body });
  }

  // ---------- reads ----------

  host(options: { signal?: AbortSignal } = {}): Promise<HostInfo> {
    return this.request("GET", "/v2/host", options);
  }

  /**
   * `includeHidden` (capability `include-hidden`, root credential only): also agents created with
   * `expose_to_im: false` (rows carry `visible: false`). Older cutex answers 400, a non-root token 403.
   */
  sessions(lifecycle: SessionLifecycle = "active", options: ReadOptions & { includeHidden?: boolean } = {}): Promise<SessionList> {
    const { includeHidden, ...rest } = options;
    return this.request("GET", "/v2/sessions", { query: { lifecycle, ...(includeHidden ? { includeHidden: "true" } : {}) }, ...rest });
  }

  session(id: string, lifecycle?: SessionLifecycle, options: ReadOptions = {}): Promise<SessionResource> {
    return this.request("GET", `/v2/sessions/${encodeURIComponent(id)}`, { query: { lifecycle }, ...options });
  }

  /** session-deltas-v1; negotiate capability AND owner access before using. */
  sessionPage(query: SessionPageQuery = {}, options: ReadOptions = {}): Promise<SessionCatalogPage | SessionResync> {
    return this.request("GET", "/v2/sessions/page", { query: { ...query }, ...options });
  }

  sessionChanges(cursor: string, query: { limit?: number; maxBytes?: number } = {}, options: ReadOptions = {}): Promise<SessionChangePage | SessionResync> {
    return this.request("GET", "/v2/sessions/changes", { query: { cursor, ...query }, ...options });
  }

  /**
   * `turnLimit` (history-pages): only the newest turns + `historyPage`. Older cutex ignores the
   * parameter and returns every turn without `historyPage`. `compact` (capability
   * `compact-history`): large item fields (command / tool output, diffs) cut to 2 KB with
   * `truncated: true` on the item; `?compact=1` is only sent when true.
   */
  bootstrap(id: string, opts: { turnLimit?: number; compact?: boolean; mediaRefs?: boolean; signal?: AbortSignal } = {}): Promise<SessionBootstrap> {
    const query: Record<string, string> = {};
    if (opts.turnLimit) query.turnLimit = String(opts.turnLimit);
    if (opts.compact) query.compact = "1";
    // history-media-refs (design 025): media over 64 KiB as cutex-media: references (historyMedia).
    if (opts.mediaRefs) query.media = "ref";
    return this.request("GET", `/v2/sessions/${encodeURIComponent(id)}/bootstrap`, { query, ...(opts.signal ? { signal: opts.signal } : {}) });
  }

  events(query: EventQuery = {}, options: ReadOptions = {}): Promise<EventPage> {
    return this.request("GET", "/v2/events", { query: { ...query }, ...options });
  }

  hostSessions(query = "", cursor?: string, limit = 200, options: ReadOptions = {}): Promise<HostSessionPage> {
    return this.request("POST", "/v2/host/sessions", { body: { query, cursor, limit }, ...options });
  }

  /** session-deltas-host-v1 (owner): exact-ID projection, empty when absent/ineligible. */
  async hostSession(id: string, options: ReadOptions = {}): Promise<HostSessionRow | null> {
    const page = await this.request<HostSessionPage>("GET", `/v2/host/sessions/${encodeURIComponent(id)}`, options);
    return page.data.find(row => row.id === id) ?? null;
  }

  projects(options: ReadOptions = {}): Promise<ProjectsResponse> {
    return this.request("GET", "/v2/agent-management/projects", options);
  }

  project(projectId: string, options: ReadOptions = {}): Promise<OperatorProjectWorkspace> {
    return this.request("GET", `/v2/agent-management/projects/${encodeURIComponent(projectId)}`, options);
  }

  /** Owner/full only. CAS values and the retry action ID are forwarded unchanged. */
  operatorAction(request: OperatorActionRequest): Promise<OperatorActionReceipt> {
    return this.request("POST", "/v2/agent-management/operator-actions", { body: request });
  }

  // ---------- native app-server forwarding ----------

  /** Forward an allowlisted cute-codex request (turn/start, thread/read, ...). Returns `result`. */
  async native<R = unknown>(sessionId: string, method: string, params: unknown): Promise<R> {
    const requestId = randomUUID();
    const response = await this.request<NativeRequestResult>(
      "POST",
      `/v2/sessions/${encodeURIComponent(sessionId)}/app-server/requests`,
      { body: { requestId, native: { message: { id: requestId, method, params } } } },
    );
    const message = response.native.message;
    if (message.error !== undefined) {
      const error = message.error as { code?: number; message?: string };
      throw new CutexApiError(502, `native_${error.code ?? "error"}`, error.message ?? "native request failed", false, message.error);
    }
    return message.result as R;
  }

  /**
   * Answer an app-server server request (approval, requestUserInput, elicitation, ...).
   * `options.responseId`: pass the same id when retrying the same answer (cutex replays it as
   * `deduplicated` / `202 request_in_progress` instead of answering twice); default: a new UUID.
   */
  respondServerRequest(
    sessionId: string,
    runtimeGeneration: number,
    nativeRequestId: string | number,
    reply: { result: unknown } | { error: { code: number; message: string } },
    options: { responseId?: string } = {},
  ): Promise<{ disposition: "submitted" | "deduplicated" }> {
    return this.request("POST", `/v2/sessions/${encodeURIComponent(sessionId)}/app-server/server-request-responses`, {
      headers: { "If-Match": `"cutex-runtime-generation:${runtimeGeneration}"` },
      body: { responseId: options.responseId ?? randomUUID(), native: { message: { id: nativeRequestId, ...reply } } },
    });
  }

  // ---------- cutex methods ----------

  /**
   * A cutex method on a session. `options.requestId`: reuse it when retrying the same call (cutex
   * dedupes on method + session + requestId); default: a new UUID.
   */
  async cutex<R = unknown>(sessionId: string, method: string, params: object = {}, options: { requestId?: string } = {}): Promise<R> {
    const response = await this.request<CutexRequestResult<R>>(
      "POST",
      `/v2/sessions/${encodeURIComponent(sessionId)}/cutex/requests`,
      { body: { requestId: options.requestId ?? randomUUID(), method, params } },
    );
    return response.cutex.result;
  }

  /**
   * `strategy` is required: "auto" starts (idle) or steers (busy); "queue" waits for the running
   * turn (cutex before queue-idle-start leaves it queued on an idle agent); "interrupt" stops the
   * turn and sends this instead.
   *
   * `503 idempotency_capacity_exceeded` (nothing recorded or forwarded) is retried a few times with a
   * short backoff under the same `requestId` and `clientUserMessageId`; only then does it throw.
   */
  submitInput(
    sessionId: string,
    input: unknown[],
    strategy: UserInputSubmitParams["strategy"],
    extra: {
      joinDelegation?: UserInputSubmitParams["joinDelegation"];
      clientUserMessageId?: string; expectedTurnId?: string; startIfOffline?: boolean; origin?: UserInputSubmitParams["origin"];
      /** Per-submit observer, not sent to the daemon. At most 3 metadata-only events per attempt. */
      onHttpTrace?: SubmitHttpTraceObserver;
      /** Caller has checked owner-admission-held-v1 (or ownerAdmissionHeldV1). */
      allowHeld?: boolean;
    } = {},
  ): Promise<UserInputSubmitResult> {
    const params: UserInputSubmitParams = {
      clientUserMessageId: extra.clientUserMessageId ?? randomUUID(),
      // A queued item re-submitted as a steer keeps its stored origin: cutex's idempotency identity
      // is (clientUserMessageId → origin + input), so the same id then cannot run twice.
      origin: extra.origin ?? { kind: "other", clientId: this.clientId },
      strategy,
      input,
    };
    if (extra.expectedTurnId) params.expectedTurnId = extra.expectedTurnId;
    if (extra.startIfOffline) params.startIfOffline = true;
    if (extra.joinDelegation) params.joinDelegation = extra.joinDelegation;
    if (extra.allowHeld) params.allowHeld = true;
    // The same requestId on every attempt (the idempotency key); clientUserMessageId is fixed in params.
    const requestId = randomUUID();
    return this.retryWhenFull(async (attempt) => {
      const response = await this.performRequest<CutexRequestResult<UserInputSubmitResult>>(
        "POST", `/v2/sessions/${encodeURIComponent(sessionId)}/cutex/requests`,
        { body: { requestId, method: "cutex/userInput/submit", params } },
        extra.onHttpTrace ? { requestId, attempt, observer: extra.onHttpTrace } : undefined,
      );
      return response.cutex.result;
    });
  }

  /** Run `attempt` again after `503 idempotency_capacity_exceeded`, waiting `capacityRetryDelaysMs` in turn. */
  private async retryWhenFull<T>(attempt: (attempt: number) => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry++) {
      try {
        return await attempt(retry + 1);
      } catch (error) {
        const delay = this.capacityRetryDelaysMs[retry];
        if (delay === undefined || !(error instanceof CutexApiError) || !error.capacityExceeded) throw error;
        await this.sleep(Math.max(delay, Math.min(error.retryAfterMs ?? 0, CAPACITY_RETRY_MAX_HINT_MS)));
      }
    }
  }

  /** Stored history; works while the runtime is offline (capability offline-history). */
  history(sessionId: string, page: { limit?: number; cursor?: string | null; compact?: boolean; mediaRefs?: boolean } = {}): Promise<SessionHistory> {
    const q = new URLSearchParams({ limit: String(page.limit ?? 20) });
    if (page.cursor) q.set("cursor", page.cursor);
    if (page.compact) q.set("compact", "1");
    if (page.mediaRefs) q.set("media", "ref");
    return this.request("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/history?${q}`);
  }

  queueList(sessionId: string): Promise<QueueListResult> {
    return this.cutex(sessionId, "cutex/userInput/queue/list");
  }

  /** queue-pause: clear the pause and send the next item if the thread is idle. */
  queueResume(sessionId: string): Promise<QueueResumeResult> {
    return this.cutex(sessionId, "cutex/userInput/queue/resume");
  }

  /** asks-pause-v2: pause delegation (委托) for this session (owner only). */
  asksPause(sessionId: string): Promise<AsksPauseResult> {
    return this.cutex(sessionId, "cutex/asks/pause");
  }

  /** asks-pause-v2: resume delegation for this session. */
  asksResume(sessionId: string): Promise<AsksPauseResult> {
    return this.cutex(sessionId, "cutex/asks/resume");
  }

  /** queue-pause: pause the queue (if non-empty), then interrupt the active turn and wait for it. */
  turnStop(sessionId: string): Promise<TurnStopResult> {
    return this.cutex(sessionId, "cutex/turn/stop");
  }

  queueUpdate(sessionId: string, queueId: string, expectedRevision: number, input: unknown[]): Promise<unknown> {
    return this.cutex(sessionId, "cutex/userInput/queue/update", { queueId, expectedRevision, input });
  }

  queueRemove(sessionId: string, queueId: string, expectedRevision: number): Promise<unknown> {
    return this.cutex(sessionId, "cutex/userInput/queue/remove", { queueId, expectedRevision });
  }

  /**
   * queue-steer: send a queued item into the running turn now (idle: `ifIdle` "start" starts it as a
   * new turn, "fail" refuses). Never re-queued: a refusal leaves the queue unchanged. A capacity
   * refusal is retried like `submitInput`, under the same requestId.
   */
  queueSteer(
    sessionId: string,
    queueId: string,
    expectedRevision: number,
    extra: { expectedTurnId?: string; ifIdle?: "start" | "fail"; joinDelegation?: UserInputSubmitParams["joinDelegation"] } = {},
  ): Promise<QueueSteerResult> {
    const params: Record<string, unknown> = { queueId, expectedRevision };
    if (extra.expectedTurnId) params.expectedTurnId = extra.expectedTurnId;
    if (extra.ifIdle) params.ifIdle = extra.ifIdle;
    if (extra.joinDelegation) params.joinDelegation = extra.joinDelegation;
    const requestId = randomUUID();
    return this.retryWhenFull(() => this.cutex(sessionId, "cutex/userInput/queue/steer", params, { requestId }));
  }

  /**
   * admission-order: move an owner queued item in the session's admission order, in front of `before`
   * (any kind) or to the end (`null`). CAS on the admission revision (`revision_conflict` when it
   * changed); `passing_not_allowed` when `queue.ownerMayPassAsks` is off and the move would pass a
   * non-owner item ahead of it. A capacity refusal is retried under the same requestId.
   */
  queueMove(sessionId: string, queueId: string, expectedRevision: number, before: AdmissionRef | null): Promise<QueueMoveResult> {
    const params = { queueId, expectedRevision, before: before ? { kind: before.kind, id: before.id } : null };
    const requestId = randomUUID();
    return this.retryWhenFull(() => this.cutex(sessionId, "cutex/userInput/queue/move", params, { requestId }));
  }

  /**
   * admission-owner-yield: let the waiting ride-alongs (delegation results, messages) go before the
   * owner's queued input once, at the end of a ride-along-started turn.
   */
  queueYield(sessionId: string): Promise<QueueYieldResult> {
    const requestId = randomUUID();
    return this.retryWhenFull(() => this.cutex(sessionId, "cutex/userInput/queue/yield", {}, { requestId }));
  }

  // ---------- input ledger (input-ledger-v1, docs/design/054) ----------

  /** `cutex/input/get`: records by id (1..100), request order; unknown ids in `missing`. Takes no host-wide lock. */
  inputGet(sessionId: string, inputIds: readonly string[]): Promise<InputGetResult> {
    if (inputIds.length < 1 || inputIds.length > INPUT_GET_MAX_IDS) {
      return Promise.reject(new RangeError(`cutex/input/get takes 1..${INPUT_GET_MAX_IDS} inputIds, got ${inputIds.length}`));
    }
    const params: InputGetParams = { inputIds: [...inputIds] };
    return this.cutex(sessionId, INPUT_GET, params);
  }

  /**
   * `cutex/input/list`: with `sinceRevision` the records changed after it (`resyncRequired` when compacted
   * away → read without it); without, every unsettled record plus those settled in `includeSettledSecs`.
   */
  inputList(sessionId: string, query: InputListParams = {}): Promise<InputListResult> {
    const params: InputListParams = {};
    if (query.sinceRevision !== undefined) params.sinceRevision = query.sinceRevision;
    if (query.includeSettledSecs !== undefined) params.includeSettledSecs = query.includeSettledSecs;
    return this.cutex(sessionId, INPUT_LIST, params);
  }

  /** Server-offered owner action: interrupt and continue this existing input id, under CAS. */
  inputInterruptSend(sessionId: string, params: InputInterruptSendParams): Promise<InputInterruptSendResult> {
    return this.cutex(sessionId, INPUT_INTERRUPT_SEND, params);
  }

  /** owner-carries-v1: daemon-owned per-notice hold under record CAS. */
  inputHold(sessionId: string, params: InputHoldParams): Promise<InputHoldResult> {
    return this.cutex(sessionId, INPUT_HOLD, params);
  }

  inputRetry(sessionId: string, inputId: string, expectedRev: number): Promise<unknown> {
    const params: InputRetryParams = { inputId, expectedRev };
    return this.cutex(sessionId, INPUT_RETRY, params);
  }

  /** Durable uncertain / waiting dismissal; HTTP success can still contain per-input failures. */
  inputDismiss(sessionId: string, inputId: string, expectedRev: number): Promise<InputDismissResult> {
    const params: InputDismissParams = { inputId, expectedRev };
    return this.cutex(sessionId, INPUT_DISMISS, params);
  }

  /** Release a stale lease (CAS on the whole lease as last read). */
  inputLeaseRelease(sessionId: string, expectedLease: InputLease): Promise<unknown> {
    const params: InputLeaseReleaseParams = { expectedLease };
    return this.cutex(sessionId, INPUT_LEASE_RELEASE, params);
  }

  queueMerge(sessionId: string, params: UserInputQueueMergeParams): Promise<UserInputQueueMergeResult> {
    if (params.items.length < 2 || params.items.length > 20) return Promise.reject(new RangeError("queue/merge takes 2..20 items"));
    return this.cutex(sessionId, "cutex/userInput/queue/merge", params);
  }

  interrupt(sessionId: string, threadId: string, turnId: string): Promise<unknown> {
    return this.native(sessionId, "turn/interrupt", { threadId, turnId });
  }

  // ---------- capabilities ----------

  /**
   * `GET /v2/capabilities` (`cutexBuild` (see `readCutexBuild`), `hostId`, `featureList`, ...). Null on a cutex
   * without the route (404). Readable with a client token.
   */
  async capabilities<T = JsonObject>(options: { signal?: AbortSignal } = {}): Promise<T | null> {
    try {
      return await this.request<T>("GET", "/v2/capabilities", options);
    } catch (error) {
      if (isMissingRoute(error, [404])) return null;
      throw error;
    }
  }

  // ---------- mobile API (device-pairing, host-summary) ----------

  /**
   * `POST /v2/pair` (public route, no credential): trade a one-time pairing code for a device token.
   * Static because the caller has no token yet; `baseUrl` is one of the pairing URLs.
   */
  static pair(baseUrl: string, request: PairRequest, options: CutexClientOptions = {}, signal?: AbortSignal): Promise<PairResponse> {
    const client = new CutexClient({ baseUrl: baseUrl.replace(/\/+$/, ""), token: null }, options);
    return client.request<PairResponse>("POST", "/v2/pair", { body: request, ...(signal ? { signal } : {}) });
  }

  // ---------- desktop presence / remote close (capability `client-remote-close`, clients.ts) ----------

  /** `POST /v2/clients/presence`: register this client instance; a repeat is the heartbeat. */
  async clientPresence(presence: ClientPresence, options: { signal?: AbortSignal } = {}): Promise<ClientPresenceReply> {
    const body = clientPresenceBody(presence);
    return readClientPresenceReply(await this.request<unknown>("POST", "/v2/clients/presence", { body, ...(options.signal ? { signal: options.signal } : {}) }), body.instanceId);
  }

  /** `GET /v2/clients`: the owner sees every registered client, other users only their own. */
  async onlineClients(): Promise<OnlineClient[]> {
    return readOnlineClients(await this.request<unknown>("GET", "/v2/clients"));
  }

  /** `POST /v2/clients/{instanceId}/close` → 202 `{instanceId, state}`; 403 client_close_forbidden / 409 remote_close_disabled / 404 client_not_found throw. */
  async closeClient(instanceId: string, graceSeconds?: number): Promise<{ instanceId: string; state: ClientState }> {
    if (!CLIENT_INSTANCE_ID.test(instanceId)) throw new Error("bad instance id");
    const body = graceSeconds === undefined ? {} : { graceSeconds: closeGraceSeconds(graceSeconds) };
    const r = await this.request<{ instanceId?: unknown; state?: unknown }>("POST", `/v2/clients/${encodeURIComponent(instanceId)}/close`, { body });
    return { instanceId: typeof r?.instanceId === "string" ? r.instanceId : instanceId, state: r?.state === undefined ? "closeRequested" : readClientState(r.state) };
  }

  /** `POST /v2/clients/{instanceId}/closing` `{outcome}`: only the closing client itself may report (`exited`: lifecycle hosts only). */
  async reportClientClosing(instanceId: string, outcome: ClientClosingOutcome, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (!CLIENT_INSTANCE_ID.test(instanceId)) throw new Error("bad instance id");
    if (outcome !== "closing" && outcome !== "cancelled" && outcome !== "exited") throw new Error("bad outcome");
    await this.request<unknown>("POST", `/v2/clients/${encodeURIComponent(instanceId)}/closing`, { body: { outcome }, ...(options.signal ? { signal: options.signal } : {}) });
  }

  /**
   * `POST /v2/pairing-codes` (capability `device-pairing`; root or client token on the loopback
   * listener — 403 `loopback_only` elsewhere). The reply's `code` is a one-time secret: never log it.
   */
  async createPairingCode(label?: string, options: { userId?: string; scope?: DeviceScope } = {}): Promise<PairingCode> {
    const text = label?.trim();
    const body: Record<string, string> = text ? { label: text.slice(0, 60) } : {};
    // users: the user the paired device is bound to (cutex default: owner). Only sent when given.
    if (options.userId !== undefined) {
      if (!USER_ID.test(options.userId)) throw new Error("bad user id");
      body.userId = options.userId;
    }
    // device-scope: the paired device's scope (cutex default: full). Only sent when given.
    if (options.scope !== undefined) {
      if (!DEVICE_SCOPES.includes(options.scope)) throw new Error("bad scope");
      body.scope = options.scope;
    }
    return this.request("POST", "/v2/pairing-codes", { body });
  }

  /** `GET /v2/client-tokens`: issued client / device tokens (metadata only, never the secret). */
  clientTokens(): Promise<ClientTokenList> {
    return this.request("GET", "/v2/client-tokens");
  }

  /** `DELETE /v2/client-tokens/{id}`: revoke; open streams using it get `cutex/device/revoked` and close. */
  revokeClientToken(tokenId: string): Promise<{ tokenId: string; revoked: boolean }> {
    if (!TOKEN_ID.test(tokenId)) throw new Error("bad token id");
    return this.request("DELETE", `/v2/client-tokens/${encodeURIComponent(tokenId)}`);
  }

  /**
   * `PATCH /v2/client-tokens/{id}` `{name}` (owner, capability `client-token-rename`): set the token's
   * display name, or clear it with null / a blank string. 400 `invalid_client_token_name`, 404
   * `client_token_not_found`. The label never changes.
   */
  renameClientToken(tokenId: string, name: string | null): Promise<ClientTokenRenamed> {
    if (!TOKEN_ID.test(tokenId)) throw new Error("bad token id");
    const text = name?.trim() ?? "";
    return this.request("PATCH", `/v2/client-tokens/${encodeURIComponent(tokenId)}`, { body: { name: text ? text : null } });
  }

  /** `GET /v2/summary` (capability `host-summary`). */
  summary(signal?: AbortSignal, options: ReadOptions = {}): Promise<HostSummary> {
    return this.request("GET", "/v2/summary", { ...options, ...(signal ? { signal } : {}) });
  }

  /**
   * `POST /v2/summary/read` (capability `summary-read`): the owner read this agent. Clears its
   * `unreadTurns` and acknowledges its notification reminder (no `reminderId` needed). Idempotent;
   * 404 `session_not_found` for an unknown agent.
   */
  summaryRead(agentId: string, signal?: AbortSignal): Promise<SummaryReadResult> {
    return this.request("POST", "/v2/summary/read", { body: { agentId }, ...(signal ? { signal } : {}) });
  }

  /**
   * Open `GET /v2/summary/events` (SSE). Resumes after `after` (sent as `Last-Event-ID`; with
   * `streamId` also as query so cutex can check it). Throws `CutexApiError` on a non-2xx answer
   * (409 `cursor_expired` → re-read the summary). Read the body with `readSse`.
   */
  async summaryEvents(options: { after?: string | null; streamId?: string | null; signal?: AbortSignal } = {}): Promise<Response> {
    const headers = this.headers({ Accept: "text/event-stream" });
    const query: Record<string, string | undefined> = {};
    if (options.after) {
      headers["Last-Event-ID"] = options.after;
      if (options.streamId) query.streamId = options.streamId;
    }
    let response: Response;
    try {
      response = await this.fetchRaw(this.url("/v2/summary/events", query), { headers, ...(options.signal ? { signal: options.signal } : {}) });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new CutexUnreachableError(this.endpoint.baseUrl, error);
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

  // ---------- owner approvals (owner-approvals) ----------

  /** Legacy complete-list API, preserved for existing callers. Hosts advertising
   * owner-notify-approval-pages-v1 should be read with approvalsPage instead.
   * Null when the daemon has no approvals route (404 / 405). */
  async approvals<T = JsonObject>(state: ApprovalState = "pending"): Promise<T[] | null> {
    try {
      const r = await this.request<{ approvals?: T[] }>("GET", "/v2/approvals", { query: { state: state === "all" ? "all" : "pending" } });
      return r.approvals ?? [];
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /**
   * One bounded approvals page; caller gates owner-notify-approval-pages-v1. Null for 404 / 405.
   * Follow nextCursor even on empty/short pages (256 KiB backend budget).
   * Errors, including resync_required, propagate without a legacy full-list fallback.
   */
  async approvalsPage<T = JsonObject>(state: ApprovalState = "pending", query: PageQuery = {}): Promise<ApprovalsPage<T> | null> {
    try {
      const response = await this.request<Omit<ApprovalsPage<T>, "nextCursor"> & { nextCursor?: string | null }>("GET", "/v2/approvals", {
        query: { state: state === "all" ? "all" : "pending", ...pageQuery(query) },
      });
      return pageResponse<ApprovalsPage<T>>(response);
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** One bounded notifications page; caller gates capability and follows nextCursor, including on short/empty pages. */
  async ownerNotificationsPage(query: OwnerNotificationsPageQuery = {}): Promise<OwnerNotificationList | null> {
    try {
      const response = await this.request<OwnerNotificationList>("GET", "/v2/owner-notifications", {
        query: { filter: query.filter ?? "all", agentId: query.agentId, ...pageQuery(query) },
      });
      return pageResponse<OwnerNotificationList>(response);
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** One bounded safety-check page (notification records); same cursor/error semantics as approvalsPage. */
  async safetyChecksPage(query: SafetyChecksPageQuery = {}): Promise<SafetyChecksPage | null> {
    try {
      const response = await this.request<SafetyChecksPage>("GET", "/v2/safety-checks", {
        query: { state: query.state ?? "open", agentId: query.agentId, ...pageQuery(query) },
      });
      return pageResponse<SafetyChecksPage>(response);
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /**
   * `POST /v2/approvals/{id}/{approve|deny}` with an optional note (trimmed, ≤1000 chars). Returns `approval`.
   * `client` (cutex `approval-decided-by` only; an older cutex refuses the field): what this client says
   * about itself (`app`, `version`, `device`, `surface`, `input`; one line, ≤ 80 chars each).
   */
  async decideApproval<T = JsonObject>(approvalId: string, decision: ApprovalDecisionKind, note?: string, client?: Record<string, string>): Promise<T> {
    if (!APPROVAL_ID.test(approvalId)) throw new Error("bad approval id");
    if (decision !== "approve" && decision !== "deny") throw new Error("bad decision");
    const text = note?.trim();
    const body: JsonObject = text ? { note: text.slice(0, 1000) } : {};
    if (client) {
      const facts: Record<string, string> = {};
      for (const key of ["app", "version", "device", "surface", "input"]) {
        const value = client[key]?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
        if (value) facts[key] = value;
      }
      if (Object.keys(facts).length) body.client = facts;
    }
    const r = await this.request<{ approval: T }>("POST", `/v2/approvals/${approvalId}/${decision}`, { body });
    return r.approval;
  }

  // ---------- runtime package upgrade (runtime-package-upgrade, root) ----------

  /** `GET /v2/runtime-packages` (selected bundle, outdated agents, active / last run). Null when the daemon has no such route (404 / 405). */
  async runtimePackages<T = JsonObject>(): Promise<T | null> {
    try {
      return await this.request<T>("GET", "/v2/runtime-packages");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/runtime-packages/runs?limit=` newest first (limit clamped to 1..100). Null when the route is missing. */
  async runtimePackageRuns<T = JsonObject>(limit?: number): Promise<T[] | null> {
    const query = typeof limit === "number" && Number.isFinite(limit) ? { limit: Math.max(1, Math.min(100, Math.floor(limit))) } : undefined;
    try {
      const r = await this.request<{ runs?: T[] }>("GET", "/v2/runtime-packages/runs", query ? { query } : {});
      return r.runs ?? [];
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/runtime-packages/runs/{runId}`. Null when unknown (`run_not_found`) or the route is missing. */
  async runtimePackageRun<T = JsonObject>(runId: string): Promise<T | null> {
    if (!RUN_ID.test(runId)) throw new Error("bad run id");
    try {
      const r = await this.request<{ run: T }>("GET", `/v2/runtime-packages/runs/${runId}`);
      return r.run;
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /**
   * `POST /v2/runtime-packages/runs` with `{all: true}` or `{agentIds}`. Returns the started `run`;
   * 409 `run_in_progress` / `nothing_to_upgrade` / `selected_unavailable` throw a CutexApiError.
   */
  async startRuntimePackageRun<T = JsonObject>(target: { all: true } | { agentIds: string[] }): Promise<T> {
    const body = "all" in target ? { all: true } : { agentIds: runtimeAgentIds(target.agentIds) };
    const r = await this.request<{ run: T }>("POST", "/v2/runtime-packages/runs", { body });
    return r.run;
  }

  /** `POST /v2/runtime-packages/runs/{runId}/revert` (all moved items, or a subset). Returns the revert `run`. */
  async revertRuntimePackageRun<T = JsonObject>(runId: string, agentIds?: string[]): Promise<T> {
    if (!RUN_ID.test(runId)) throw new Error("bad run id");
    const body = agentIds ? { agentIds: runtimeAgentIds(agentIds) } : {};
    const r = await this.request<{ run: T }>("POST", `/v2/runtime-packages/runs/${runId}/revert`, { body });
    return r.run;
  }

  // ---------- owner-initiated Director rotation (owner-rotation, root) ----------

  /** `GET /v2/director-rotations?projectId=&limit=` newest first. Null when the route is missing. */
  async directorRotations<T = JsonObject>(projectId?: string, limit?: number): Promise<T[] | null> {
    const query: Record<string, string | number> = {};
    if (projectId) query.projectId = projectId;
    if (typeof limit === "number" && Number.isFinite(limit)) query.limit = Math.max(1, Math.min(100, Math.floor(limit)));
    try {
      const r = await this.request<{ rotations?: T[] }>("GET", "/v2/director-rotations", { query });
      return r.rotations ?? [];
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/director-rotations/{id}`. Null when unknown (`rotation_not_found`) or the route is missing. */
  async directorRotation<T = JsonObject>(rotationId: string): Promise<T | null> {
    if (!ROTATION_ID.test(rotationId)) throw new Error("bad rotation id");
    try {
      const r = await this.request<{ rotation: T }>("GET", `/v2/director-rotations/${rotationId}`);
      return r.rotation;
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `POST /v2/director-rotations` (202; a replayed `requestId` returns the same rotation). 4xx throw a CutexApiError. */
  async startDirectorRotation<T = JsonObject>(request: object): Promise<T> {
    const r = await this.request<{ rotation: T }>("POST", "/v2/director-rotations", { body: request });
    return r.rotation;
  }

  /** `POST /v2/director-rotations/{id}/cancel` or `/continue`. */
  async directorRotationAction<T = JsonObject>(rotationId: string, action: "cancel" | "continue"): Promise<T> {
    if (!ROTATION_ID.test(rotationId)) throw new Error("bad rotation id");
    if (action !== "cancel" && action !== "continue") throw new Error("bad rotation action");
    const r = await this.request<{ rotation: T }>("POST", `/v2/director-rotations/${rotationId}/${action}`, { body: {} });
    return r.rotation;
  }

  // ---------- agent alarms (alarms-api, root) ----------

  /**
   * `GET /v2/alarms?sessionId=&state=&limit=`: `{hostId, alarms, nextAt}`. `sessionId` keeps the
   * alarms that agent set or that wake it; `state` "pending" (default) = scheduled only; `limit` is
   * clamped to 1..1000. Null when the daemon has no alarms route (404 / 405).
   */
  async alarms<T = JsonObject>(query: AlarmQuery = {}): Promise<T | null> {
    const q: Record<string, string | number> = {};
    if (query.sessionId !== undefined) {
      if (!SESSION_ID.test(query.sessionId)) throw new Error("bad session id");
      q.sessionId = query.sessionId;
    }
    if (query.state === "all") q.state = "all";
    if (typeof query.limit === "number" && Number.isFinite(query.limit)) q.limit = Math.max(1, Math.min(1000, Math.floor(query.limit)));
    try {
      return await this.request<T>("GET", "/v2/alarms", { query: q });
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/alarms/{id}` (full message). Null when unknown (`alarm_not_found`) or the route is missing. */
  async alarm<T = JsonObject>(alarmId: string): Promise<T | null> {
    if (!ALARM_ID.test(alarmId)) throw new Error("bad alarm id");
    try {
      const r = await this.request<{ alarm: T }>("GET", `/v2/alarms/${alarmId}`);
      return r.alarm;
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `DELETE /v2/alarms/{id}` (owner cancel). Returns `alarm`; 404 `alarm_not_found` / 409 `alarm_already_queued` throw a CutexApiError. */
  async cancelAlarm<T = JsonObject>(alarmId: string): Promise<T> {
    if (!ALARM_ID.test(alarmId)) throw new Error("bad alarm id");
    const r = await this.request<{ alarm: T }>("DELETE", `/v2/alarms/${alarmId}`);
    return r.alarm;
  }

  // ---------- workflow runs (workflows, root) ----------

  /**
   * `GET /v2/workflows/runs?state=&sessionId=&projectId=&limit=`: `{hostId, runs}` (newest first).
   * Null when the daemon has no workflows route.
   */
  async workflowRuns<T = JsonObject>(query: { state?: "open" | "closed" | "all"; sessionId?: string; projectId?: string; limit?: number } = {}): Promise<T | null> {
    const q: Record<string, string | number> = {};
    if (query.state && ["open", "closed", "all"].includes(query.state)) q.state = query.state;
    if (query.sessionId !== undefined) {
      if (!SESSION_ID.test(query.sessionId)) throw new Error("bad session id");
      q.sessionId = query.sessionId;
    }
    if (query.projectId !== undefined) {
      if (!/^(?!\.+$)[A-Za-z0-9._:-]{1,200}$/.test(query.projectId)) throw new Error("bad project id");
      q.projectId = query.projectId;
    }
    if (typeof query.limit === "number" && Number.isFinite(query.limit)) q.limit = Math.max(1, Math.min(500, Math.floor(query.limit)));
    try {
      return await this.request<T>("GET", "/v2/workflows/runs", { query: q });
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/workflows/runs/{id}?include=`: the run with phase progress, steps and the log tail. */
  async workflowRun<T = JsonObject>(runId: string, include: readonly ("steps" | "log" | "result" | "script")[] = []): Promise<T> {
    if (!WORKFLOW_RUN_ID.test(runId)) throw new Error("bad run id");
    const q: Record<string, string> = {};
    const allowed = include.filter((i) => ["steps", "log", "result", "script"].includes(i));
    if (allowed.length) q.include = allowed.join(",");
    const r = await this.request<{ run: T }>("GET", `/v2/workflows/runs/${runId}`, { query: q });
    return r.run;
  }

  /** `POST /v2/workflows/runs/{id}/stop|resume` (owner); `DELETE /v2/workflows/runs/{id}` (finished runs). */
  async workflowRunAction<T = JsonObject>(runId: string, action: "stop" | "resume" | "delete"): Promise<T> {
    if (!WORKFLOW_RUN_ID.test(runId)) throw new Error("bad run id");
    if (action === "delete") return this.request<T>("DELETE", `/v2/workflows/runs/${runId}`);
    if (action !== "stop" && action !== "resume") throw new Error("bad workflow action");
    return this.request<T>("POST", `/v2/workflows/runs/${runId}/${action}`, { body: {} });
  }

  // ---------- restore after an unclean stop (runtime-restore-candidates, root) ----------

  /**
   * `GET /v2/runtimes/restore-candidates`: `{hostId, uncleanSince, reason, items}` — agents that were
   * online before an unclean stop and are still offline. Null when the daemon has no such route.
   */
  async restoreCandidates<T = JsonObject>(): Promise<T | null> {
    try {
      return await this.request<T>("GET", "/v2/runtimes/restore-candidates");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  // ---------- Claude quota auto-continue (claude-quota-auto-continue, root) ----------

  /**
   * `GET /v2/quota-auto-continue?sessionId=`: that agent's `{cutexSessionId, enabled, pending, last}`
   * (defaults filled in). Null when the daemon has no such route (404 / 405).
   */
  async quotaAutoContinue<T = JsonObject>(sessionId: string): Promise<T | null> {
    if (!SESSION_ID.test(sessionId)) throw new Error("bad session id");
    try {
      const r = await this.request<{ sessions: T[] }>("GET", "/v2/quota-auto-continue", { query: { sessionId } });
      return r.sessions?.[0] ?? null;
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `DELETE /v2/runtimes/restore-candidates`: forget the list (and those agents' online intent). */
  async dismissRestoreCandidates(): Promise<{ dismissed: number }> {
    return this.request<{ dismissed: number }>("DELETE", "/v2/runtimes/restore-candidates");
  }

  /** `PATCH /v2/quota-auto-continue/{sessionId} {enabled}` → the new view (404 `session_not_found` throws). */
  async setQuotaAutoContinue<T = JsonObject>(sessionId: string, enabled: boolean): Promise<T> {
    if (!SESSION_ID.test(sessionId)) throw new Error("bad session id");
    const r = await this.request<{ quotaAutoContinue: T }>("PATCH", `/v2/quota-auto-continue/${encodeURIComponent(sessionId)}`, { body: { enabled: enabled === true } });
    return r.quotaAutoContinue;
  }

  /** `DELETE /v2/quota-auto-continue/{sessionId}/pending`: the owner cancels the pending continuation (idempotent). */
  async cancelQuotaAutoContinue<T = JsonObject>(sessionId: string): Promise<T> {
    if (!SESSION_ID.test(sessionId)) throw new Error("bad session id");
    const r = await this.request<{ quotaAutoContinue: T }>("DELETE", `/v2/quota-auto-continue/${encodeURIComponent(sessionId)}/pending`);
    return r.quotaAutoContinue;
  }

  // ---------- stuck Agent Bus messages (agent-bus-stuck-messages, root) ----------

  /**
   * `GET /v2/agent-bus/stuck-messages?minAgeSecs=` (oldest first; cutex caps the list at its default
   * limit and reports `total`). `minAgeSecs` is clamped to 0..31 days. Null when the route is missing.
   */
  async stuckBusMessages<T = JsonObject>(minAgeSecs?: number): Promise<T | null> {
    const query: Record<string, string | number> = {};
    if (typeof minAgeSecs === "number" && Number.isFinite(minAgeSecs)) query.minAgeSecs = Math.max(0, Math.min(2_678_400, Math.floor(minAgeSecs)));
    try {
      return await this.request<T>("GET", "/v2/agent-bus/stuck-messages", { query });
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /**
   * `POST /v2/agent-bus/stuck-messages/discard`: the record becomes terminal (`owner_message_discarded`) and
   * is withdrawn from the live queue; idempotent. 4xx (message_not_found, message_protected,
   * message_not_discardable, message_digest_mismatch) throw a CutexApiError.
   */
  async discardStuckBusMessage<T = JsonObject>(request: { messageId: string; reason: string; expectedSemanticSha256?: string; allowProtected?: boolean }): Promise<T> {
    if (typeof request.messageId !== "string" || !request.messageId || request.messageId.length > 512) throw new Error("bad message id");
    const reason = typeof request.reason === "string" ? request.reason.trim() : "";
    if (!reason) throw new Error("bad discard reason");
    const body: Record<string, unknown> = { messageId: request.messageId, reason: reason.slice(0, 300) };
    if (request.expectedSemanticSha256 !== undefined) {
      if (!/^[0-9a-fA-F]{64}$/.test(request.expectedSemanticSha256)) throw new Error("bad semantic digest");
      body.expectedSemanticSha256 = request.expectedSemanticSha256;
    }
    if (request.allowProtected) body.allowProtected = true;
    return this.request<T>("POST", "/v2/agent-bus/stuck-messages/discard", { body });
  }

  /** agent-bus-message-settlement-v1. Read an uncertain write before an explicit same-key retry. */
  async busMessageEvidence(request: { messageId: string }): Promise<MessageSettlementEvidenceResponse> {
    const body = messageSettlementEvidenceBody(request);
    const caps = await this.delegationCapabilities();
    if (!caps?.featureList?.includes(STALE_ACK_SETTLEMENT_FEATURE)) throw new Error("stale ACK settlement unsupported");
    if (!userAccessOf(caps).isOwner) throw new Error("owner settlement route required");
    return this.request("POST", "/v2/agent-bus/stuck-messages/evidence", { body, retryable: false });
  }

  async closeBusMessage(request: MessageSettlementCloseRequest): Promise<MessageSettlementCloseResponse> {
    const body = messageSettlementCloseBody(request);
    await this.delegationFeature(DELEGATION_CAPABILITIES.settlement);
    return this.request("POST", "/v2/agent-bus/stuck-messages/close", { body, retryable: false });
  }

  // ---------- installed runtimes (runtimes-view) ----------

  /** `GET /v2/runtimes` (installed native / Claude runtimes and their pinned agents). Null when the route is missing. */
  async runtimes<T = JsonObject>(): Promise<T | null> {
    try {
      return await this.request<T>("GET", "/v2/runtimes");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  runtimePrunePlan(): Promise<RuntimePrunePlan> {
    return this.request("GET", "/v2/runtimes/prune");
  }

  pruneRuntimes(ids: string[]): Promise<RuntimePruneResult> {
    return this.request("POST", "/v2/runtimes/prune", { body: runtimePruneBody(ids), retryable: false });
  }

  // ---------- Claude accounts (claude-accounts) ----------
  // No login over HTTP and no `apiKey` from here: the desktop never handles a Claude credential.

  /** `GET /v2/claude/accounts` (`default` first). Null when the route is missing. */
  async claudeAccounts<T = JsonObject>(): Promise<T | null> {
    try {
      return await this.request<T>("GET", "/v2/claude/accounts");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `POST /v2/claude/accounts` → 201 item. `apiKey` (API accounts) is write-only: cutex never returns it. */
  async createClaudeAccount<T = JsonObject>(body: { label: string; kind: "subscription" | "api"; baseUrl?: string; keyEnv?: string; env?: Record<string, string>; apiKey?: string }): Promise<T> {
    if (body.apiKey !== undefined && (body.kind !== "api" || typeof body.apiKey !== "string" || !body.apiKey)) throw new Error("apiKey is for API accounts only");
    return this.request<T>("POST", "/v2/claude/accounts", { body });
  }

  /** `PATCH /v2/claude/accounts/{id}`: rename (`label`) or set / replace the write-only `apiKey` (owner 2026-10-27). */
  async updateClaudeAccount<T = JsonObject>(id: string, patch: { label: string } | { apiKey: string }): Promise<T> {
    if (!CLAUDE_ACCOUNT_ID.test(id)) throw new Error("bad Claude account id");
    const body = "apiKey" in patch ? { apiKey: patch.apiKey } : { label: patch.label };
    if ("apiKey" in body && (typeof body.apiKey !== "string" || !body.apiKey)) throw new Error("bad apiKey");
    return this.request<T>("PATCH", `/v2/claude/accounts/${encodeURIComponent(id)}`, { body });
  }

  /** `DELETE /v2/claude/accounts/{id}`: deregisters; the home (login, Claude history) is kept. */
  async deleteClaudeAccount<T = JsonObject>(id: string): Promise<T> {
    if (!CLAUDE_ACCOUNT_ID.test(id)) throw new Error("bad Claude account id");
    return this.request<T>("DELETE", `/v2/claude/accounts/${encodeURIComponent(id)}`);
  }

  /** `POST /v2/claude/accounts/{id}/status`: `claude auth status` (subscription, ≤ 30 s) or key presence (api). */
  async checkClaudeAccount<T = JsonObject>(id: string): Promise<T> {
    if (!CLAUDE_ACCOUNT_ID.test(id)) throw new Error("bad Claude account id");
    return this.request<T>("POST", `/v2/claude/accounts/${encodeURIComponent(id)}/status`, { body: {} });
  }

  // ---------- backend upgrade (backend-upgrade, owner only; upgrade.ts) ----------
  // Refusals (upgrade_blocked {reason}, one_way_unconfirmed {migrations}, not_staged, no_trusted_keys
  // 503, signature_invalid 502, …) come back as values; an uncoded failure (network, bare http_5xx) throws.

  private async upgradeCall<T>(run: () => Promise<T>): Promise<UpgradeResult<T>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      if (!(error instanceof CutexApiError) || error.code.startsWith("http_")) throw error;
      const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
      return { ok: false, error: upgradeRefusalOf(error.status, error.code, message, error.details) };
    }
  }

  // ---------- optional components (cutex `components`, owner only; components spec v2 §4) ----------

  /** `GET /v2/components`. Null on a cutex without the route (404 / 405). */
  async components(): Promise<ComponentsList | null> {
    try {
      return readComponentsList(await this.request<unknown>("GET", "/v2/components"));
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /**
   * `POST /v2/components/{name}/install|remove` with an empty body → 202 `{operation}`; progress via
   * `cutex/components/updated`. Refusals (`unmanaged_install`, `component_external`,
   * `component_source_only`, `component_unsupported_platform`, `upgrade_blocked {reason}`, …) as values.
   */
  async componentAction(name: string, action: "install" | "remove"): Promise<UpgradeResult<ComponentOperation | null>> {
    if (action !== "install" && action !== "remove") throw new Error("bad component action");
    const path = `/v2/components/${encodeURIComponent(componentName(name))}/${action}`;
    return this.upgradeCall(async () => readComponentOperation((await this.request<{ operation?: unknown }>("POST", path, { body: {} }))?.operation));
  }

  /** `GET /v2/upgrade`. Null on a cutex without the route (404 / 405). */
  async upgradeStatus(): Promise<UpgradeStatus | null> {
    try {
      return await this.request<UpgradeStatus>("GET", "/v2/upgrade");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `POST /v2/upgrade/check`: read the channel now → the status. */
  upgradeCheck(): Promise<UpgradeResult<UpgradeStatus>> {
    return this.upgradeCall(() => this.request<UpgradeStatus>("POST", "/v2/upgrade/check", { body: {} }));
  }

  /** `POST /v2/upgrade/stage` (default: the available release) → 202 `{staging}`; progress in the status / events. */
  upgradeStage(release?: string | null): Promise<UpgradeResult<UpgradeStaging>> {
    const body = upgradeStageBody(release);
    return this.upgradeCall(async () => (await this.request<{ staging: UpgradeStaging }>("POST", "/v2/upgrade/stage", { body })).staging);
  }

  /** `POST /v2/upgrade/apply` → 202 `{run}`. */
  upgradeApply(request: UpgradeApplyRequest = {}): Promise<UpgradeResult<UpgradeRun>> {
    const body = upgradeApplyBody(request);
    return this.upgradeCall(async () => (await this.request<{ run: UpgradeRun }>("POST", "/v2/upgrade/apply", { body })).run);
  }

  /** `POST /v2/upgrade/cancel` → `{run}` (cancelRequested). */
  upgradeCancel(): Promise<UpgradeResult<UpgradeRun>> {
    return this.upgradeCall(async () => (await this.request<{ run: UpgradeRun }>("POST", "/v2/upgrade/cancel", { body: {} })).run);
  }

  /** `POST /v2/upgrade/rollback`: dry run 200 `{preview}`; else 202 `{run, preview}`. */
  upgradeRollback(request: UpgradeRollbackRequest = {}): Promise<UpgradeResult<UpgradeRollbackResult>> {
    const body = upgradeRollbackBody(request);
    return this.upgradeCall(() => this.request<UpgradeRollbackResult>("POST", "/v2/upgrade/rollback", { body }));
  }

  /** `GET /v2/upgrade/runs?limit=` (current run first, then newest first; limit 1..200). */
  upgradeRuns(limit?: number): Promise<UpgradeResult<UpgradeRun[]>> {
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : undefined;
    return this.upgradeCall(async () => {
      const r = await this.request<{ runs?: UpgradeRun[] }>("GET", "/v2/upgrade/runs", { query: { limit: n } });
      return Array.isArray(r?.runs) ? r.runs : [];
    });
  }

  /** `GET /v2/upgrade/runs/{runId}`; 404 run_not_found as a value. */
  upgradeRun(runId: string): Promise<UpgradeResult<UpgradeRun>> {
    if (typeof runId !== "string" || !UPGRADE_RUN_ID.test(runId)) throw new Error("bad upgrade run id");
    return this.upgradeCall(async () => (await this.request<{ run: UpgradeRun }>("GET", `/v2/upgrade/runs/${runId}`)).run);
  }

  /** `GET /v2/upgrade/settings`. */
  upgradeSettings(): Promise<UpgradeResult<UpgradeSettings>> {
    return this.upgradeCall(async () => (await this.request<{ settings: UpgradeSettings }>("GET", "/v2/upgrade/settings")).settings);
  }

  /** `PATCH /v2/upgrade/settings` (never `source`: 400 source_not_editable, host CLI only). */
  patchUpgradeSettings(patch: UpgradeSettingsPatch): Promise<UpgradeResult<UpgradeSettings>> {
    const body = upgradeSettingsBody(patch);
    return this.upgradeCall(async () => (await this.request<{ settings: UpgradeSettings }>("PATCH", "/v2/upgrade/settings", { body })).settings);
  }

  /** `GET /v2/host` → `serviceManager` / `runtimes` (null each on an older cutex; `runtimes` null for non-owners). */
  async hostServiceInfo(): Promise<HostServiceInfo> {
    return readHostServiceInfo(await this.request<unknown>("GET", "/v2/host"));
  }

  // ---------- users and grants (users, owner only) ----------
  // Non-owner callers get 403 owner_required; refusals throw a CutexApiError with their code.

  /** `GET /v2/users`: users, every token with its binding, peers with theirs, settings. Null when the route is missing. */
  async users(): Promise<UsersList | null> {
    try {
      return await this.request<UsersList>("GET", "/v2/users");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `POST /v2/users` → 201 `{user, revision}`. */
  async createUser(request: UserCreate): Promise<UserWriteResult> {
    const body: Record<string, unknown> = { name: userNameBody(request.name) };
    if (request.color !== undefined) body.color = userColorBody(request.color);
    if (request.grant !== undefined) body.grant = grantBody(request.grant);
    return this.request("POST", "/v2/users", { body });
  }

  /** `PATCH /v2/users/{id}` (name / color / grant; a grant on the owner is refused with 400 owner_immutable). */
  async patchUser(userId: string, patch: UserPatch): Promise<UserWriteResult> {
    if (!USER_ID.test(userId)) throw new Error("bad user id");
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = userNameBody(patch.name);
    if (patch.color !== undefined) body.color = userColorBody(patch.color);
    if (patch.grant !== undefined) body.grant = grantBody(patch.grant);
    if (Object.keys(body).length === 0) throw new Error("empty user patch");
    return this.request("PATCH", `/v2/users/${encodeURIComponent(userId)}`, { body });
  }

  /** `DELETE /v2/users/{id}`; 409 `user_in_use` (details `{tokens, peers}`) while anything is bound to it. */
  async deleteUser(userId: string): Promise<{ userId: string; deleted: boolean }> {
    if (!USER_ID.test(userId) || userId === "owner") throw new Error("bad user id");
    return this.request("DELETE", `/v2/users/${encodeURIComponent(userId)}`);
  }

  /** `PUT /v2/users/token-bindings/{tokenId}`: bind a token to a user (null = back to pending). */
  async bindTokenUser(tokenId: string, userId: string | null): Promise<TokenBindingResult> {
    if (!TOKEN_ID.test(tokenId)) throw new Error("bad token id");
    if (userId !== null && !USER_ID.test(userId)) throw new Error("bad user id");
    return this.request("PUT", `/v2/users/token-bindings/${encodeURIComponent(tokenId)}`, { body: { userId } });
  }

  /** `PUT /v2/users/peer-bindings/{peerId}`: the local user a paired peer acts as. */
  async bindPeerUser(peerId: string, userId: string): Promise<PeerBindingResult> {
    if (!/^ci-[A-Za-z0-9]{1,64}$/.test(peerId)) throw new Error("bad peer id");
    if (!USER_ID.test(userId)) throw new Error("bad user id");
    return this.request("PUT", `/v2/users/peer-bindings/${encodeURIComponent(peerId)}`, { body: { userId } });
  }

  /** `PATCH /v2/users/settings`. */
  async patchUsersSettings(patch: UsersSettings): Promise<{ settings: UsersSettings }> {
    if (typeof patch?.ownerRequiresApproval !== "boolean") throw new Error("bad users settings");
    return this.request("PATCH", "/v2/users/settings", { body: { ownerRequiresApproval: patch.ownerRequiresApproval } });
  }

  // ---------- self-service profile (users-self-profile; any assigned user, its own record) ----------

  /** `GET /v2/users/me`. Null on a cutex without the route (404 / 405; an older non-owner gets 403). */
  async usersMe(): Promise<SelfProfile | null> {
    try {
      return await this.request<SelfProfile>("GET", "/v2/users/me");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /**
   * `GET /v2/users/me/devices` (cutex `user-own-devices`): the caller's own devices — the owner (or root)
   * gets the owner user's. Null on a cutex without the route; a pending device gets 403 `user_pending`
   * (older self routes: `access_pending`).
   */
  async usersMeDevices(): Promise<OwnDevices | null> {
    let reply: Partial<OwnDevices>;
    try {
      reply = await this.request<Partial<OwnDevices>>("GET", "/v2/users/me/devices");
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const devices = Array.isArray(reply?.devices) ? reply.devices.filter((d) => d && typeof d.tokenId === "string").map((d) => ({ ...d, current: d.current === true })) : [];
    return { hostId: str(reply?.hostId), userId: str(reply?.userId), devices };
  }

  /**
   * `DELETE /v2/users/me/devices/{tokenId}` (cutex `user-own-devices`): remove one of the caller's own
   * devices; 404 `client_token_not_found` for anyone else's. Removing the current token is allowed: this
   * connection's requests get 401 afterwards.
   */
  usersMeRemoveDevice(tokenId: string): Promise<OwnDeviceRevoked> {
    if (!TOKEN_ID.test(tokenId)) throw new Error("bad token id");
    return this.request("DELETE", `/v2/users/me/devices/${encodeURIComponent(tokenId)}`);
  }

  // ---------- home page (user-home) and service tiles (service-tiles) ----------

  /** `GET /v2/users/me/home`. Null on a cutex without the route (404 / 405). */
  userLayout(): Promise<import("./userLayout").UserLayout> {
    return this.request("GET", "/v2/users/me/layout");
  }

  putUserLayout(section: string, revision: number, data: Record<string, unknown> | null): Promise<import("./userLayout").LayoutWritten> {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(section) || section === "pointer" || !Number.isSafeInteger(revision) || revision < 0) throw new Error("bad layout write");
    return this.request("PUT", `/v2/users/me/layout/${section}`, { body: { revision, data } });
  }

  putLayoutPointer(pointer: import("./userLayout").MemoryHost): Promise<import("./userLayout").LayoutPointer> {
    return this.request("PUT", "/v2/users/me/layout/pointer", { body: { memoryHost: pointer.instanceId, label: pointer.label } });
  }

  async userHome(): Promise<HomeView | null> {
    try {
      return readHomeView(await this.request<unknown>("GET", "/v2/users/me/home"));
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `PUT /v2/users/me/home` `{revision, home}`; 409 `home_revision_conflict` (`details.revision`), 400 `invalid_home`, 413 `home_too_large`. */
  async putUserHome(revision: number, home: HomeDoc | null): Promise<HomeView> {
    return readHomeView(await this.request<unknown>("PUT", "/v2/users/me/home", { body: homePutBody(revision, home) }));
  }

  /** `GET /v2/users/me/home/cover` (null: no cover, or an older cutex). */
  homeCover(): Promise<UserAvatar | null> {
    return this.fetchImage("/v2/users/me/home/cover", HOME_COVER_MAX_BYTES);
  }

  /** `PUT /v2/users/me/home/cover` `{contentType, data}`; 400 `invalid_cover`, 413 `cover_too_large`. */
  async putHomeCover(upload: HomeCoverUpload): Promise<HomeView> {
    return readHomeView(await this.request<unknown>("PUT", "/v2/users/me/home/cover", { body: homeCoverBody(upload) }));
  }

  /** `DELETE /v2/users/me/home/cover` (idempotent). */
  async deleteHomeCover(): Promise<HomeView> {
    return readHomeView(await this.request<unknown>("DELETE", "/v2/users/me/home/cover"));
  }

  /** `GET /v2/services/{slug}/tile` (template sanitised). Null on a cutex without the route. */
  async serviceTile(slug: string): Promise<ServiceTileAnswer | null> {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error("bad service slug");
    try {
      return readServiceTileAnswer(await this.request<unknown>("GET", `/v2/services/${encodeURIComponent(slug)}/tile`));
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/services/{slug}/tile/image` (PNG / JPEG / WebP ≤ 512 KiB; null: none / unsupported). */
  async serviceTileImage(slug: string): Promise<UserAvatar | null> {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error("bad service slug");
    try {
      return await this.fetchImage(`/v2/services/${encodeURIComponent(slug)}/tile/image`, TILE_IMAGE_MAX_BYTES);
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 415 || error.status === 502)) return null;
      throw error;
    }
  }

  // ---------- person identity (person-identity; weak auth: who a paired token belongs to) ----------

  /** `GET /v2/identity/challenge` → `{nonce, hostId, expiresAt}` (one-use, short-lived; pending tokens too). */
  async identityChallenge(): Promise<IdentityChallenge> {
    const reply = await this.request<Partial<IdentityChallenge>>("GET", "/v2/identity/challenge");
    const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !v.includes("\n");
    if (!ok(reply?.nonce) || !ok(reply.hostId) || !ok(reply.tokenId)) throw new Error("bad identity challenge");
    return { nonce: reply.nonce, hostId: reply.hostId, tokenId: reply.tokenId, expiresAt: typeof reply.expiresAt === "string" ? reply.expiresAt : "" };
  }

  /**
   * `POST /v2/identity/claim` `{publicKey, signature, nonce, displayName?}`: present this desktop's person
   * key for the caller's credential. 400 `challenge_invalid` / `invalid_signature`, 404
   * `client_token_not_found`, 429 `too_many_challenges`, 503 `users_unavailable`.
   */
  async identityClaim(claim: { publicKey: string; signature: string; nonce: string; displayName?: string | null }): Promise<IdentityClaimResult> {
    if (!PERSON_PUBLIC_KEY.test(claim.publicKey)) throw new Error("bad public key");
    if (!PERSON_SIGNATURE.test(claim.signature)) throw new Error("bad signature");
    if (typeof claim.nonce !== "string" || !claim.nonce) throw new Error("bad nonce");
    const body: Record<string, unknown> = { publicKey: claim.publicKey, signature: claim.signature, nonce: claim.nonce };
    const name = typeof claim.displayName === "string" ? claim.displayName.trim() : "";
    if (name && [...name].length <= DISPLAY_NAME_MAX && !/\p{Cc}/u.test(name)) body.displayName = name;
    const reply = await this.request<Partial<IdentityClaimResult>>("POST", "/v2/identity/claim", { body });
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const outcome = IDENTITY_CLAIM_OUTCOMES.includes(reply?.outcome as IdentityClaimOutcome) ? (reply!.outcome as IdentityClaimOutcome) : "recorded";
    return {
      outcome,
      tokenId: str(reply?.tokenId),
      userId: str(reply?.userId),
      pending: reply?.pending === true,
      personUserId: str(reply?.personUserId),
      publicKey: str(reply?.publicKey) ?? claim.publicKey,
      fingerprint: str(reply?.fingerprint) ?? "",
    };
  }

  /** `PUT /v2/users/{id}/person-keys` `{personKeys}` (owner only): the whole list; 409 `person_key_in_use` `{publicKey, userId}`. */
  async putUserPersonKeys(userId: string, keys: readonly PersonKeyInput[]): Promise<PersonKeysResult> {
    if (!USER_ID.test(userId)) throw new Error("bad user id");
    return this.request("PUT", `/v2/users/${encodeURIComponent(userId)}/person-keys`, { body: personKeysBody(keys) });
  }

  /**
   * `DELETE /v2/users/token-persons/{tokenId}/previous` (owner only, `person-identity-ack`): acknowledge
   * a device's key change; 404 `client_token_not_found`.
   */
  async ackTokenPersonChange(tokenId: string): Promise<TokenPersonAckResult> {
    if (!TOKEN_ID.test(tokenId)) throw new Error("bad token id");
    return this.request("DELETE", `/v2/users/token-persons/${encodeURIComponent(tokenId)}/previous`);
  }

  /** `PATCH /v2/users/me` `{displayName?, avatar?}` (null = clear); 400 invalid_avatar, 413 avatar_too_large, 403 access_pending. */
  async patchUsersMe(patch: SelfProfilePatch): Promise<SelfProfile> {
    return this.request("PATCH", "/v2/users/me", { body: selfProfileBody(patch) });
  }

  /**
   * `GET /v2/users/{id}/avatar`: the image (null: none, not visible to this caller, or an older
   * cutex). Only PNG / JPEG / WebP up to the cutex limit are accepted.
   */
  async userAvatar(userId: string): Promise<UserAvatar | null> {
    if (!USER_ID.test(userId)) throw new Error("bad user id");
    return this.fetchImage(`/v2/users/${encodeURIComponent(userId)}/avatar`, AVATAR_MAX_BYTES);
  }

  /**
   * cutex `profile-avatar`: `GET /v2/profiles/{id}/avatar | intro-portrait` (null: none, or a cutex
   * without the route). Owner only, like every profile route.
   */
  async profileImage(profileId: string, kind: ProfileImageKind): Promise<UserAvatar | null> {
    if (!PROFILE_IMAGE_KINDS.includes(kind)) throw new Error("bad profile image kind");
    return this.fetchImage(profileImagePath(profileId, kind), PROFILE_IMAGE_MAX_BYTES[kind]);
  }

  /**
   * cutex `profile-avatar`: `PUT` (upload) / `DELETE` (null) a profile's picture or intro portrait →
   * the stored ETag (null = none). 400 invalid_avatar, 413 avatar_too_large, 404 profile_not_found.
   */
  async putProfileImage(profileId: string, kind: ProfileImageKind, upload: AvatarUpload | null): Promise<{ etag: string | null }> {
    if (!PROFILE_IMAGE_KINDS.includes(kind)) throw new Error("bad profile image kind");
    const path = profileImagePath(profileId, kind);
    const reply = upload
      ? await this.request<Record<string, unknown>>("PUT", path, { body: { contentType: upload.contentType, data: upload.data } })
      : await this.request<Record<string, unknown>>("DELETE", path);
    const etag = reply[kind === "avatar" ? "avatarEtag" : "introPortraitEtag"];
    return { etag: typeof etag === "string" && AVATAR_ETAG.test(etag) ? etag : null };
  }

  /** An image route: PNG / JPEG / WebP up to `maxBytes`, else null; 404 / 403 / 405 = null. */
  /**
   * An image a history read with `media=ref` replaced by `cutex-media:<session>/<sha256>`
   * (`GET /v2/sessions/{id}/media/{sha256}`, history-media-refs). Null when the host no longer has
   * it (evicted: read the turn again) or it is not an image.
   */
  historyMedia(sessionId: string, sha256: string): Promise<UserAvatar | null>;
  historyMedia(sessionId: string, sha256: string, options: HistoryMediaBytesOptions): Promise<HistoryMediaBytes | null>;
  async historyMedia(sessionId: string, sha256: string, options?: HistoryMediaBytesOptions): Promise<UserAvatar | HistoryMediaBytes | null> {
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) throw new Error("bad media session id");
    if (typeof sha256 !== "string" || !HISTORY_MEDIA_SHA256.test(sha256)) throw new Error("bad media hash");
    const path = `/v2/sessions/${encodeURIComponent(sessionId)}/media/${sha256}`;
    if (options === undefined) return this.fetchImage(path, HISTORY_MEDIA_MAX_BYTES);
    if (!options || typeof options !== "object" || Array.isArray(options) || options.transport !== "bytes" || Object.keys(options).some(key => key !== "transport" && key !== "expected")) throw new Error("bad media transport options");
    // A history media ref's sha is cutex's cache key (SHA-256 of the base64 payload, or of a saved-image descriptor), not a
    // hash of the served bytes: verifying it rejected every generated / pasted image on reopen (live diagnosis 2026-10-26).
    return this.fetchHistoryMediaBytes(path, sha256, mediaBytesExpected(options.expected), HISTORY_MEDIA_MAX_BYTES, false);
  }

  /** A granted event blob on the visible-session route; never falls back to owner-only history media. */
  async eventBlob(sessionId: string, sha256: string, expected?: MediaBytesExpected): Promise<HistoryMediaBytes | null> {
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) throw new Error("bad media session id");
    if (typeof sha256 !== "string" || !HISTORY_MEDIA_SHA256.test(sha256)) throw new Error("bad media hash");
    const path = `/v2/sessions/${encodeURIComponent(sessionId)}/blobs/${sha256}`;
    return this.fetchHistoryMediaBytes(path, sha256, mediaBytesExpected(expected), HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES, true);
  }

  /** Streaming, authenticated bytes only: no arrayBuffer/text/base64 detour, including errors. `verifyDigest`: the sha names the
   *  bytes themselves (event blobs) and a mismatch is refused; history media refs are cache keys and are not hashed. */
  private async fetchHistoryMediaBytes(path: string, sha256: string, expected: MediaBytesExpected | undefined, maxBytes: number, verifyDigest: boolean): Promise<HistoryMediaBytes | null> {
    const controller = new AbortController();
    const deadline = Date.now() + 15000;
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => {
      controller.abort();
      try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}); } catch { /* already closed */ }
    };
    const timeoutError = () => new CutexApiError(408, "history_media_timeout", "history media read timed out", true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancel(); reject(timeoutError()); }, 15000);
    });
    const read = async (): Promise<HistoryMediaBytes | null> => {
      try {
        response = await this.fetchRaw(this.url(path), { headers: this.headers({ Accept: "*/*" }), redirect: "error", signal: controller.signal }, { jsonErrorsOnly: true });
        if (controller.signal.aborted || Date.now() >= deadline) { cancel(); throw timeoutError(); }
        if (response.status === 403 || response.status === 404 || response.status === 405) { cancel(); return null; }
        if (!response.ok) {
          cancel();
          throw new CutexApiError(response.status, `http_${response.status}`, `history media request failed (${response.status})`, response.status >= 500);
        }
        const rawMime = response.headers.get("content-type") ?? "";
        const mime = rawMime.length <= 512 ? rawMime.split(";", 1)[0]!.trim().toLowerCase() : "";
        if (!historyMediaMime(mime) || (expected && mime !== expected.mime)) { cancel(); return null; }
        const cap = expected?.size ?? maxBytes;
        const rawLength = response.headers.get("content-length");
        const length = rawLength === null ? null : /^[0-9]+$/.test(rawLength) ? Number(rawLength) : NaN;
        if (length !== null && (!Number.isSafeInteger(length) || length <= 0 || length > cap || (expected && length !== expected.size))) { cancel(); return null; }
        if (!response.body) return null;
        reader = response.body.getReader();
        // Grow a bounded contiguous buffer instead of retaining arbitrarily many tiny chunks.
        let buffer = new Uint8Array(0);
        let size = 0;
        for (;;) {
          const chunk = await reader.read();
          if (controller.signal.aborted || Date.now() >= deadline) throw timeoutError();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > cap - size) { cancel(); return null; }
          const nextSize = size + chunk.value.byteLength;
          if (nextSize > buffer.length) {
            const grown = new Uint8Array(Math.min(cap, Math.max(65536, buffer.length * 2, nextSize)));
            grown.set(buffer.subarray(0, size));
            buffer = grown;
          }
          buffer.set(chunk.value, size);
          size = nextSize;
        }
        if (size === 0 || (expected && size !== expected.size) || (length !== null && size !== length)) { cancel(); return null; }
        const bytes = buffer.length === size ? buffer : buffer.slice(0, size);
        if (!verifyDigest) return { bytes, mime, size };
        if (!globalThis.crypto?.subtle) { cancel(); return null; }
        const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
        if (controller.signal.aborted || Date.now() >= deadline) throw timeoutError();
        const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== sha256) { cancel(); return null; }
        return { bytes, mime, size };
      } catch (error) {
        cancel();
        if (error instanceof CutexApiError) throw error;
        throw new CutexUnreachableError(this.endpoint.baseUrl, error);
      } finally {
        reader?.releaseLock();
      }
    };
    try {
      return await Promise.race([read(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchImage(path: string, maxBytes: number): Promise<UserAvatar | null> {
    const url = this.url(path);
    let response: Response;
    try {
      response = await this.fetchRaw(url, { headers: this.headers({ Accept: "image/*" }) });
    } catch (error) {
      throw new CutexUnreachableError(this.endpoint.baseUrl, error);
    }
    if (response.status === 404 || response.status === 403 || response.status === 405) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch { /* raw */ }
      throw CutexApiError.fromBody(response.status, body);
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() as AvatarContentType;
    if (!AVATAR_CONTENT_TYPES.includes(contentType)) {
      await response.body?.cancel();
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxBytes) return null;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const etag = response.headers.get("etag")?.replace(/^W\//, "").replace(/"/g, "") ?? null;
    return { contentType, data: btoa(binary), etag };
  }

  // r266 owner controls. Probe capability before EVERY new route; older daemons see only discovery.
  /** Coalesce concurrent new-feature discovery only; no retained authority/capability cache. */
  private delegationCapabilities(): Promise<{featureList: string[]; user?: unknown} | null> {
    if (this.delegationDiscovery) return this.delegationDiscovery;
    const pending=this.capabilities<{featureList: string[]; user?: unknown}>();
    this.delegationDiscovery=pending;
    const clear=()=>{if(this.delegationDiscovery===pending)this.delegationDiscovery=undefined;};
    pending.then(clear,clear);
    return pending;
  }
  private async delegationFeature(feature: typeof DELEGATION_CAPABILITIES[keyof typeof DELEGATION_CAPABILITIES]): Promise<void> {
    const caps = await this.delegationCapabilities();
    requireDelegationCapability(caps, feature);
    if (!userAccessOf(caps).isOwner) throw new Error("owner delegation route required");
  }
  async delegationTree(projectId: string, query: DelegationTreeQuery = {}): Promise<DelegationTreePage> {
    const id = delegationId(projectId); const q: Record<string, string> = {};
    if (query.cursor !== undefined) { if (typeof query.cursor !== "string" || query.cursor.length > 1024) throw new Error("bad tree cursor"); q.cursor = query.cursor; }
    if (query.limit !== undefined) { if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) throw new Error("bad tree limit"); q.limit = String(query.limit); }
    if (query.rootId !== undefined) q.rootId = delegationId(query.rootId);
    if (query.rootHostId !== undefined) { if (!query.rootId) throw new Error("rootId required"); q.rootHostId = delegationId(query.rootHostId); }
    await this.delegationFeature(DELEGATION_CAPABILITIES.tree);
    return this.request("GET", `/v2/projects/${id}/delegations`, { query: q });
  }
  async delegationAttempts(id: string, cursor?: string): Promise<DelegationAttempts> {
    delegationId(id); if (cursor !== undefined && !/^\d{1,16}$/.test(cursor)) throw new Error("bad attempt cursor");
    await this.delegationFeature(DELEGATION_CAPABILITIES.tree);
    return this.request("GET", `/v2/delegations/${id}/attempts`, { query: cursor === undefined ? {} : { cursor } });
  }
  async delegationPolicy(projectId: string): Promise<DelegationPolicy> {
    delegationId(projectId); await this.delegationFeature(DELEGATION_CAPABILITIES.routing);
    return this.request("GET", `/v2/projects/${projectId}/delegation-policy`);
  }
  async delegationGrants(projectId: string): Promise<DelegationGrants> {
    delegationId(projectId); await this.delegationFeature(DELEGATION_CAPABILITIES.routing);
    return this.request("GET", `/v2/projects/${projectId}/delegation-grants`);
  }
  async delegationApprovals(projectId: string): Promise<{ routingApprovals: DelegationApproval[] }> {
    delegationId(projectId); await this.delegationFeature(DELEGATION_CAPABILITIES.routing);
    return this.request("GET", `/v2/projects/${projectId}/delegation-approvals`);
  }
  async delegationApproval(id: string): Promise<DelegationApproval> {
    delegationId(id); await this.delegationFeature(DELEGATION_CAPABILITIES.routing);
    return this.request("GET", `/v2/delegation-approvals/${id}`);
  }
  async projectRunControl(projectId: string): Promise<ProjectRunControl> {
    delegationId(projectId); await this.delegationFeature(DELEGATION_CAPABILITIES.runControl);
    return this.request("GET", `/v2/projects/${projectId}/run-control`);
  }
  async delegationControl(request: DelegationControlRequest): Promise<DelegationOperationResult> {
    const route = delegationControlRoute(request);
    await this.delegationFeature(route.capability);
    return this.request(route.method, route.path, { body: route.body, retryable: false });
  }
  async delegationOperation(actionId: string): Promise<DelegationOperationLookup> {
    delegationId(actionId);
    const caps = await this.delegationCapabilities();
    if (!userAccessOf(caps).isOwner) throw new Error("owner delegation route required");
    if (![DELEGATION_CAPABILITIES.routing, DELEGATION_CAPABILITIES.tree, DELEGATION_CAPABILITIES.runControl, DELEGATION_CAPABILITIES.continuation].some(f => caps?.featureList?.includes(f))) throw new Error("unsupported delegation receipts");
    return this.request("GET", `/v2/delegation-operations/${actionId}`);
  }
  async permanentRetirementReview(request: PermanentRetirementReviewRequest): Promise<PermanentRetirementReview> {
    const body = { cutex_session_id: delegationId(request.cutex_session_id) };
    const caps = await this.delegationCapabilities();
    if (!userAccessOf(caps).isOwner) throw new Error("owner delegation route required");
    if (!caps?.featureList?.includes("agent-archive-kind-v1")) throw new Error("unsupported permanent retirement");
    return this.request("POST", "/v2/agent-management/permanent-retirement/review", { body, retryable: false });
  }
  async permanentRetirement(request: PermanentRetirementRequest): Promise<AgentArchiveReceipt> {
    delegationId(request.action_id); delegationId(request.cutex_session_id);
    if (typeof request.confirmed_name !== "string" || typeof request.confirmation_token !== "string" || !request.confirmation_token || !Number.isSafeInteger(request.expected_revision) || request.expected_revision < 0) throw new Error("bad retirement request");
    const body = { action_id: request.action_id, cutex_session_id: request.cutex_session_id, confirmed_name: request.confirmed_name, confirmation_token: request.confirmation_token, expected_revision: request.expected_revision };
    const caps = await this.delegationCapabilities();
    if (!userAccessOf(caps).isOwner) throw new Error("owner delegation route required");
    if (!caps?.featureList?.includes("agent-archive-kind-v1")) throw new Error("unsupported permanent retirement");
    return this.request("POST", "/v2/agent-management/permanent-retirement/execute", { body, retryable: false });
  }

  // ---------- delegations (asks, delegation-views) ----------

  /** `GET /v2/asks`. Null when the daemon has no asks route (404 / 405). */
  async asks<T = JsonObject>(filter: AskQuery = {}, options: ReadOptions = {}): Promise<T[] | null> {
    const query: Record<string, string> = {};
    for (const key of ["project", "requester", "target", "involving", "state"] as const) {
      const v = filter[key];
      if (typeof v === "string" && v && v.length <= 200) query[key] = v;
    }
    if (typeof filter.limit === "number" && filter.limit > 0) query.limit = String(Math.min(1000, Math.floor(filter.limit)));
    try {
      const r = await this.request<{ asks?: T[] }>("GET", "/v2/asks", { query, ...options });
      return r.asks ?? [];
    } catch (error) {
      if (isMissingRoute(error)) return null;
      throw error;
    }
  }

  /** `GET /v2/asks/{id}` → `ask`. Null on 404 (unknown ask or no route). */
  async ask<T = JsonObject>(askId: string): Promise<T | null> {
    if (!ASK_ID.test(askId)) throw new Error("bad ask id");
    try {
      const r = await this.request<{ ask: T }>("GET", `/v2/asks/${encodeURIComponent(askId)}`);
      return r.ask ?? null;
    } catch (error) {
      if (isMissingRoute(error, [404])) return null;
      throw error;
    }
  }

  /** `GET /v2/asks/{id}/answer[?cursor=]`: one page of the answer text. Null on 404. */
  async askAnswer<T = JsonObject>(askId: string, cursor?: number): Promise<T | null> {
    if (!ASK_ID.test(askId)) throw new Error("bad ask id");
    const query = typeof cursor === "number" && cursor > 0 ? { cursor: String(Math.floor(cursor)) } : undefined;
    try {
      return await this.request<T>("GET", `/v2/asks/${encodeURIComponent(askId)}/answer`, { query });
    } catch (error) {
      if (isMissingRoute(error, [404])) return null;
      throw error;
    }
  }

  // ---------- notifications ----------

  /** `GET /v2/notifications/states`: per-session working / waiting / attention / inactive + unread reminder. */
  notificationStates(): Promise<NotificationStates> {
    return this.request("GET", "/v2/notifications/states");
  }

  /** `POST /v2/notifications/ack`: mark the session's current reminder read (no-op if it changed meanwhile). */
  ackNotification(threadId: string, reminderId: string): Promise<NotificationAckResult> {
    return this.request("POST", "/v2/notifications/ack", { body: { threadId, reminderId } });
  }

  /** `GET /v2/notifications/session?thread_id=`: the session's notification level. */
  async notificationLevel(threadId: string): Promise<NotificationLevel> {
    const r = await this.request<{ level: NotificationLevel }>("GET", "/v2/notifications/session", { query: { thread_id: threadId } });
    return r.level;
  }

  /** `POST /v2/notifications/session`: set the level; returns the stored level. */
  async setNotificationLevel(threadId: string, level: NotificationLevel): Promise<NotificationLevel> {
    const r = await this.request<{ level: NotificationLevel }>("POST", "/v2/notifications/session", { body: { thread_id: threadId, level } });
    return r.level;
  }

  // ---------- attachments (session-attachments) ----------

  /**
   * Upload raw bytes as a host-side file for `sessionId` (`POST /v2/sessions/{id}/attachments`,
   * body = the bytes, `Content-Type` = `mime`). The returned `path` is sent as a `localImage` input.
   * A cutex without the route (404 / 405 other than a session error) throws a plain Error saying so.
   */
  async uploadAttachment(sessionId: string, bytes: AttachmentBody, mime: string): Promise<UploadedAttachment> {
    const url = this.url(`/v2/sessions/${encodeURIComponent(sessionId)}/attachments`);
    let response: Response;
    try {
      response = await this.fetchRaw(url, {
        method: "POST",
        headers: this.headers({ "Content-Type": mime }),
        body: bytes,
      });
    } catch (error) {
      throw new CutexUnreachableError(this.endpoint.baseUrl, error);
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // raw text
    }
    if (!response.ok) {
      const error = CutexApiError.fromBody(response.status, body);
      // A missing route (older cutex) vs a real refusal (session_not_found, attachment_too_large, …).
      if ((response.status === 404 || response.status === 405) && !["session_not_found", "session_not_local"].includes(error.code)) {
        throw new Error("the remote cutex cannot receive images (needs session-attachments; update cutex on that host)");
      }
      throw error;
    }
    const r = body as { attachmentId?: unknown; path?: unknown; mime?: unknown; size?: unknown };
    if (typeof r?.path !== "string" || !r.path) throw new Error("session-attachments: no path in the reply");
    const length = bytes instanceof Blob ? bytes.size : bytes.byteLength;
    return { attachmentId: String(r.attachmentId ?? ""), path: r.path, mime: String(r.mime ?? mime), size: Number(r.size ?? length) };
  }
}

/** The response passed a proxy (or came from one): headers no cutex answer carries. */
function viaProxy(response: Response): boolean {
  const headers = response.headers;
  return !!headers && (headers.has("via") || headers.has("proxy-authenticate") || headers.has("proxy-agent"));
}
