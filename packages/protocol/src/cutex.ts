// Hand-written types for cutex Management v2 (contractVersion 2).
// Source of truth: upstream/cutex/src/management/v2/{model,session,server,user_input}.rs.
// Fields we do not consume yet are typed loosely (`unknown`) on purpose.

export const CONTRACT_VERSION = 2;

export type JsonObject = { [key: string]: unknown };

// ---------- errors ----------

export interface CutexErrorBody {
  contractVersion: 2;
  error: {
    source: string;
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
}

// ---------- host ----------

export interface HostInfo {
  hostId: string;
  schema: "cutex/host/v1";
  platform: string;
  executable: string;
}

// ---------- sessions ----------

export type SessionLifecycle = "active" | "retired";
export type RuntimeStatus = "online" | "offline" | "error" | (string & {});

export interface AppServerSchemaInfo {
  /**
   * `claude-app-server-subset`: a Claude agent (cutex Claude adapter) serving part of the Codex v2
   * surface; `capabilities.features` then lists it (false = unsupported, null = unknown).
   */
  protocol: "codex-app-server" | "claude-app-server-subset";
  majorVersion: number;
  version: string;
  sha256: string;
  channel: "stable" | "experimental";
  capabilities: unknown;
  extensions: string[];
}

export interface SessionRuntime {
  backend: string;
  status: RuntimeStatus;
  appServerConnected: boolean;
  runtimeGeneration: number;
  runtimeAgentId: string | null;
  activeTurnId: string | null;
  activeTurnObservedAt: string | null;
  threadStatus: unknown;
  threadSettings: JsonObject | null;
  requiresVisibleTerminal: boolean;
  tuiAttached: boolean;
  lastEventAt: string | null;
  lastError: unknown;
}


/** Display-only avatar set via `cutex/session/metadata/update`. */
export interface SessionAvatar {
  kind: "emoji" | "color" | "icon";
  value: string;
  /** Circle colour `#rrggbb` of an `emoji` / `icon` avatar (cutex capability `agent-avatar-color`; a `color` avatar keeps its colour in `value`). */
  color?: string;
}
export interface SessionResource {
  contractVersion: 2;
  cutexSessionId: string;
  revision: number;
  lifecycle: SessionLifecycle;
  retiredAt: string | null;
  hostId: string;
  displayName: string;
  /** Identity name (bus / authority); `displayName` resolves override > formal > hint > thread name. */
  formalAgentName?: string | null;
  displayNameOverride?: string | null;
  note?: string | null;
  avatar?: SessionAvatar | null;
  threadName: string | null;
  cwd: string | null;
  profile: string | null;
  configuredProfile: string | null;
  launchedProfile: string | null;
  effectiveNextLaunch: { profile: string | null; source: string; model?: string };
  groups: string[];
  registrationClass: unknown;
  visible: boolean;
  native: { threadId: string | null; schema: AppServerSchemaInfo | null };
  runtime: SessionRuntime;
  runtimeDefaults: JsonObject | null;
  activity: JsonObject | null;
  focus: unknown;
  management: unknown;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SessionList {
  contractVersion: 2;
  hostId: string;
  management: unknown;
  sessions: SessionResource[];
}

/** Row from POST /v2/host/sessions (root token). Carries appearance + project. */
export interface HostSessionRow {
  id: string;
  name: string;
  kind: string;
  hostId: string;
  profile: string | null;
  provider?: string | null;
  profileStyle?: JsonObject | null;
  projectId?: string | null;
  projectName?: string | null;
  cwd: string | null;
  state: string;
  generation: number;
  nativeId: string | null;
  [key: string]: unknown;
}

export interface HostSessionPage {
  schema: "cutex/host-sessions/v1";
  data: HostSessionRow[];
  nextCursor: string | null;
}

// ---------- bootstrap ----------

export interface EventCheckpoint {
  streamId: string;
  sequence: number;
  cursor: string | null;
}

export interface QueueItem {
  queueId: string;
  clientUserMessageId: string;
  origin: InputOrigin;
  input: unknown[];
  position: number;
  revision: number;
  state: string;
  createdAt: string;
  updatedAt: string;
  /** Sent even while the queue is paused (offline submit that started the runtime; queue-pause). */
  bypassPause?: boolean;
}

/** A paused queue (capability `queue-pause`): cutex does not auto-send it until resumed. */
export interface QueuePause {
  pausedAt: string;
  reason: "interrupted" | "manual";
  turnId: string | null;
}

export interface QueueListResult {
  revision: number;
  items: QueueItem[];
  /** queue-pause; absent on older cutex. */
  paused?: boolean;
  pause?: QueuePause | null;
  /** asks-pause-v2: the owner's delegation pause; absent on older cutex. */
  asksPaused?: AsksPause | null;
  /** admission-order: every waiting turn-starting item of the session in admission order; absent on older cutex. */
  admission?: QueueAdmission;
}

/**
 * admission-order (docs/cutex-agent-asks.md §5.3 *Shared admission order*; turn groups:
 * docs/research/queue-turn-groups-plan-20261012.md): what this session will read next, by turn.
 * `items` = the turn-owning items (owner queued messages, asks waiting for this target) in admission
 * order, `position` = the turn number (1 = the next turn). `nextStep` = ride-along deliveries
 * (alarms, notes / bus messages, tells, delegation results) that join the running turn or — idle —
 * start one turn together. `revision` is the CAS token of `cutex/userInput/queue/move`.
 */
export interface QueueAdmission {
  /** Changes on any snapshot change (ride-alongs, timing, current turn). */
  revision: number;
  /** Changes only when the numbered owner / ask order or membership changes: a move's CAS value.
   * Absent on the first admission-order drafts (the desktop then sends `revision`). */
  orderRevision?: number;
  items: AdmissionItem[];
  /** Ride-along deliveries, in read order; absent on the first admission-order drafts. */
  nextStep?: AdmissionNextStep[];
  /** Whose turn runs now; null = idle; absent = unknown (the desktop infers it). */
  currentTurn?: AdmissionCurrentTurn | null;
  /**
   * stop-holds-ridealongs: `ownerStop` = an owner stop holds every ride-along (none starts a turn by
   * itself) until 继续发送 (queue resume), `cutex/asks/resume` or the owner's next turn-starting
   * message. Absent when nothing is held (and on older cutex).
   */
  ridealongsHeld?: "ownerStop";
  /**
   * admission-owner-yield: the owner let waiting ride-alongs go first once (`cutex/userInput/queue/yield`):
   * the next ride-along-started turn end gives owner input no first opportunity. Absent = not yielded.
   */
  ownerYielded?: boolean;
}

/** Why a ride-along waits: the owner's stop hold, or an explicit 暂停委托 (ask results only). */
export type AdmissionHeld = "ownerStop" | "ownerPause";

export type AdmissionKind = "owner" | "ask" | "delivery";
export type AdmissionState = "waiting" | "held" | "paused";
export type AdmissionDeliveryKind = "answer" | "question" | "alarm" | "tell" | "bus";

interface AdmissionItemBase {
  /** owner: the queueId; ask: the askId. */
  id: string;
  /** 1-based admission position = turn number. */
  position: number;
  enqueuedAt: string;
  state: AdmissionState;
}

export type AdmissionItem =
  | (AdmissionItemBase & { kind: "owner" })
  /**
   * `hold`: the ask's current hold name (as in the asks API). `includedNotes`: passive tells the
   * scheduler submits with this ask (labels only). Title etc. come from the asks API.
   */
  | (AdmissionItemBase & { kind: "ask"; hold?: string | null; includedNotes?: AdmissionNote[] })
  /** Older drafts listed deliveries here; the desktop reads them as ride-along items. */
  | (AdmissionItemBase & { kind: "delivery"; deliveryKind: AdmissionDeliveryKind | (string & {}); label?: string | null });

export interface AdmissionNote {
  label: string;
}

/**
 * A ride-along delivery. `timing` while a turn runs: `afterTurn` = waits for the running turn to end
 * (alarms always; a bus wake to a busy recipient for up to `agentBus.wakeBusyWaitSecs`, then
 * `nextStepAt` says when it switches), `nextStep` = read at the running turn's next step. Idle: they
 * start one turn together.
 */
export interface AdmissionNextStep {
  id: string;
  deliveryKind: AdmissionDeliveryKind | (string & {});
  /** A short label without the body. */
  label?: string | null;
  enqueuedAt: string;
  timing?: "afterTurn" | "nextStep";
  /** ISO time a waiting wake switches to `nextStep`; null / absent = only at the turn end. */
  nextStepAt?: string | null;
  /** stop-holds-ridealongs: held until released (absent = not held / older cutex). */
  held?: AdmissionHeld;
  /** The delegation an answer / question / delegation-status ride-along belongs to (absent = another
   *  source, or an older cutex). admission-ridealong-detail: also a Job completion bound to one. */
  askId?: string;
  /** admission-ridealong-detail: who it comes from — the sending agent's name, `name@host` for a
   *  cross-host tell, the delegate of a delegation result, or the system service (`Cutex Job Service`).
   *  Absent / null for an alarm and on an older cutex. */
  from?: string | null;
  /** admission-ridealong-detail: the sending host's label of a cross-host tell (`from` = `name@host`). */
  fromHost?: string | null;
  /** admission-ridealong-detail: the first non-empty line of the message (≤ 80 chars, never more). */
  preview?: string | null;
}

/** The running turn's owner (decides whether an insert is possible and the group title). */
export interface AdmissionCurrentTurn {
  kind: "owner" | "ask" | "delivery";
  askId?: string | null;
}

/** `before` of a move: the item the moved owner item goes in front of (any kind). */
export interface AdmissionRef {
  kind: AdmissionKind;
  id: string;
}

/** `cutex/userInput/queue/move` (admission-order). `before: null` = to the end. */
export interface QueueMoveParams {
  queueId: string;
  /** The admission `orderRevision` the move was made against. */
  expectedRevision: number;
  before: AdmissionRef | null;
}

/** The move's reply: cutex may return the new list (else the client lists again). */
/** `cutex/userInput/queue/yield` (admission-owner-yield). */
export interface QueueYieldResult {
  admission?: QueueAdmission;
  [key: string]: unknown;
}

export interface QueueMoveResult {
  revision?: number;
  orderRevision?: number;
  admission?: QueueAdmission;
  [key: string]: unknown;
}

/** asks-pause-v2 (r208): the owner paused delegation (委托) for this session — no asks admitted, no
 * results delivered — until `cutex/asks/resume` or the owner's next message. */
export interface AsksPause {
  since: string;
  by: "owner" | "planMode";
  /**
   * `legacy`: a pause from before r208 (a turn stop). `ownerStop` (stop-holds-ridealongs): the owner's
   * stop holds asks and every ride-along until queue resume, asks resume or the owner's next
   * turn-starting message. `runtimeGate` (cutex `runtime-gate-pause`): the agent's runtime closed its input
   * gate after an interrupted / failed turn (tool effects may be uncertain) and refused a delivery; asks
   * wait `heldByRuntime(gate_closed)` until `cutex/asks/resume`, queue resume or the owner's next message
   * (each reopens the gate).
   */
  origin: "ownerPause" | "ownerStop" | "runtimeGate" | "legacy";
  /** stop-holds-ridealongs: a stop hold is on (also on an explicit `ownerPause` the owner then stopped). */
  stopHold?: boolean;
}

/** `cutex/asks/pauseChanged` params. */
export interface AsksPauseChanged {
  asksPaused: AsksPause | null;
  reason: "paused" | "ownerStop" | "runtimeGate" | "runtimeRestart" | "turnStarted" | "resumed" | "ownerMessage";
}

/** `cutex/asks/pause` / `cutex/asks/resume`. */
export interface AsksPauseResult {
  asksPaused: AsksPause | null;
  changed: boolean;
}

/** `cutex/turn/stop`: pause the queue (if non-empty), then interrupt the active turn. */
export interface TurnStopResult {
  revision: number;
  paused: boolean;
  pause: QueuePause | null;
  /** The queue was already paused before this stop. */
  alreadyPaused: boolean;
  interruptedTurnId: string | null;
}

/**
 * `cutex/userInput/queue/steer` (capability `queue-steer`, r223): the queued item is steered into the
 * running turn (or, idle with `ifIdle: "start"`, started as a new turn) and only then removed. A
 * refusal leaves the queue unchanged (`steer_unavailable` with `details.reason`, `turn_conflict`, …).
 */
export interface QueueSteerResult {
  disposition: "steered" | "started";
  turnId: string | null;
  clientUserMessageId: string;
  queueRevision: number;
}

/** `details.reason` of a `steer_unavailable` refusal. */
export type QueueSteerRefusal = "runtimeNoSteer" | "runtimeRefused" | "delegationTurn" | "noActiveTurn";

export interface QueueResumeResult {
  revision: number;
  paused: false;
  pause: null;
  resumed: boolean;
  affectedQueueIds: string[];
}

/**
 * Bootstrap `cutexState.pendingServerRequests[]` item (cutex `server_requests::snapshot`). Unlike
 * live events and request / response bodies (`native: {message}`), `native` here IS the raw native
 * JSON-RPC request `{id, method, params}`.
 */
export interface PendingServerRequest {
  runtimeGeneration: number;
  native: { id: string | number; method: string; params?: unknown };
  [key: string]: unknown;
}

export interface SessionBootstrap {
  contractVersion: 2;
  cutexSessionId: string;
  hostId: string;
  checkpoint: EventCheckpoint;
  schema: AppServerSchemaInfo | null;
  management: unknown;
  /** `{method: "thread/read", result}` when the runtime is connected. */
  native: { method: "thread/read"; result: unknown } | null;
  /**
   * history-pages (`?turnLimit=`): `native` holds only the newest turns; older ones via
   * `GET /v2/sessions/{id}/history?cursor=<nextCursor>`. Null while offline; absent when not
   * requested or on older cutex (then `native` has every turn).
   */
  historyPage?: HistoryPage | null;
  cutexState: {
    sessionRevision: number;
    runtime: { status: RuntimeStatus; runtimeGeneration: number };
    focus: unknown;
    userInputQueue: QueueItem[];
    /** queue-pause; absent on older cutex. */
    userInputQueuePause?: QueuePause | null;
    /** asks-pause-v2; absent on older cutex. */
    asksPaused?: AsksPause | null;
    pendingServerRequests: PendingServerRequest[];
    agentBusMessages: unknown[];
    /** The agent's latest sent agent-bus messages, compact (agent-messages-v2); absent on older cutex. */
    agentBusSentMessages?: unknown[];
    /** The thread's last accepted `update_plan` (session-latest-plan); absent on older cutex. */
    latestPlan?: LatestPlan | null;
    /** The thread's newest token usage recovered from the rollout (bootstrap-token-usage); absent on older cutex. */
    latestTokenUsage?: LatestTokenUsage | null;
    /** owner-notify: this agent's last 50 agent → owner messages, oldest first; absent on older cutex (= []). */
    ownerNotifications?: OwnerNotification[];
  };
}

// ---------- owner notify (capability `owner-notify`; docs/research/owner-notify.md) ----------

export const OWNER_NOTIFY_FEATURE = "owner-messages";
export const OWNER_NOTIFY_CREATED = "cutex/ownerNotify/created";
export const OWNER_NOTIFY_UPDATED = "cutex/ownerNotify/updated";
/** `{notificationId, agentId}`: the owner deleted the record (capability owner-notify-delete). */
export const OWNER_NOTIFY_DELETED = "cutex/ownerNotify/deleted";
/** Records carry `origin`, `cutex/ownerNotify/delete` exists, reply refuses records without needsReply / from cutex. */
export const OWNER_NOTIFY_DELETE_FEATURE = "owner-notify-delete";
/** Who wrote the record: the agent (`owner_notify` tool) or cutex itself (delivery failures, reminders). */
export type OwnerNotifyOrigin = "agent" | "system";

export type OwnerNotifyLevel = "info" | "attention" | "urgent";
export type OwnerNotifyChannel = "desktop" | "phone" | "bigAlert";
export type OwnerNotifyState = "open" | "acknowledged" | "answered" | "dismissed";
export const OWNER_NOTIFY_LEVELS: readonly OwnerNotifyLevel[] = ["info", "attention", "urgent"];
export const OWNER_NOTIFY_CHANNELS: readonly OwnerNotifyChannel[] = ["desktop", "phone", "bigAlert"];

/** One agent → owner message (`owner_notify` tool). */
export interface OwnerNotification {
  /** "ntf-<hex>" */
  notificationId: string;
  /** cutexSessionId of the sender (origin system: the agent the notice is about). */
  agentId: string;
  agentName: string | null;
  /** owner-notify-delete; older cutex: absent (= agent). */
  origin?: OwnerNotifyOrigin;
  text: string;
  /** Effective level (after a downgrade). */
  level: OwnerNotifyLevel;
  /** What the agent asked for. */
  requestedLevel: OwnerNotifyLevel;
  downgraded: null | { from: OwnerNotifyLevel; reason: "rateLimit" | "urgentQuota" };
  /** Agent override "mute": no channel fired. */
  muted: boolean;
  /** Resolved at creation (settings + override + downgrade). */
  channels: OwnerNotifyChannel[];
  needsReply: boolean;
  delegation: string | null;
  job: string | null;
  /** Sender's native turn when known (timeline placement). */
  turnId: string | null;
  state: OwnerNotifyState;
  /** RFC 3339 UTC. */
  createdAt: string;
  acknowledgedAt: string | null;
  reply: { text: string; repliedAt: string; clientUserMessageId: string } | null;
  /** answered / dismissed */
  closedAt: string | null;
  /** notification-levels: the level decided at creation (absent on older records / cutex). */
  notificationLevel?: "urgent" | "needsYou" | "inform" | "record";
  /** notification-levels: the registered event that decided it (e.g. `ownerNotify.urgent`). */
  notificationEvent?: string;
  /** notification-levels: methods decided at creation (`needsYou`, `mark`, `desktop`, `phone`, `sound`, `bigAlert`); absent = r216 rules. */
  actions?: string[];
  /** Kind of a cutex notice (origin system): `quarantine`, `deliveryFailed`, `idleDelegation`, `safetyBlock`, … */
  systemKind?: string;
  /** claude-safety-grants: the runtime safety check this notice is about (`systemKind: safetyBlock`). */
  safetyBlock?: SafetyBlock;
}

// ---------- safety grants (capability `claude-safety-grants`; cutex docs/SAFETY-GRANTS.md) ----------

/** Owner-only session methods `cutex/safetyCheck/grant|dismiss {blockId}`; `GET /v2/safety-checks`. */
export const SAFETY_GRANTS_FEATURE = "claude-safety-grants";
export const SAFETY_CHECK_GRANT = "cutex/safetyCheck/grant";
export const SAFETY_CHECK_DISMISS = "cutex/safetyCheck/dismiss";
/** `systemKind` of a safety-block notice. */
export const SAFETY_BLOCK_KIND = "safetyBlock";
/** blocked → granted → used (or expired); blocked → dismissed. */
export type SafetyBlockState = "blocked" | "granted" | "used" | "dismissed" | "expired";

/** A tool call a runtime safety check declined under full access, and the owner's decision on it. */
export interface SafetyBlock {
  blockId: string;
  /** Runtime family (`claude`). */
  runtime: string;
  threadId: string;
  turnId: string | null;
  /** The declined tool call (timeline item id). */
  itemId: string | null;
  toolName: string;
  /** The exact tool input that was declined. */
  toolInput: unknown;
  /** Display form (the shell command for Bash). */
  command: string;
  /** The runtime's own reason (Claude Code's text). */
  reason: string;
  state: SafetyBlockState;
  blockedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  /** How long a grant stays valid (1800). */
  grantSeconds: number;
}

/** `GET /v2/owner-notifications` */
export type OwnerNotifyFilter = "pending" | "alerting" | "all";
export interface OwnerNotificationList {
  notifications: OwnerNotification[];
}

/** Params of `cutex/ownerNotify/created` / `cutex/ownerNotify/updated`. */
export interface OwnerNotifyEventParams {
  notification: OwnerNotification;
}

export type OwnerNotifyToolAudience = "ownerFacing" | "everyone" | "directors" | "none";
export type OwnerNotifyAgentOverride = "mute" | "force";

/** `/v2/settings` → `ownerNotify`. */
export interface OwnerNotifySettings {
  delivery: Record<OwnerNotifyLevel, OwnerNotifyChannel[]>;
  deliveryDefault: Record<OwnerNotifyLevel, OwnerNotifyChannel[]>;
  bigAlertSound: boolean;
  toolAudience: OwnerNotifyToolAudience;
  rateLimit: { perHour: number; urgentPerHour: number };
  agentOverrides: Record<string, OwnerNotifyAgentOverride>;
  /** A device token exists (the phone channel is meaningful). */
  phonePaired: boolean;
  /** Channel names cutex knows (newer cutex; read-only). */
  channels?: OwnerNotifyChannel[];
  /** Accepted toolAudience values (read-only). */
  toolAudienceOptions?: OwnerNotifyToolAudience[];
}

/** `PATCH /v2/settings {ownerNotify}`: every field optional; `agentOverrides` replaces the map (null value deletes a key). */
export interface OwnerNotifySettingsPatch {
  delivery?: Partial<Record<OwnerNotifyLevel, OwnerNotifyChannel[]>>;
  bigAlertSound?: boolean;
  toolAudience?: OwnerNotifyToolAudience;
  rateLimit?: Partial<{ perHour: number; urgentPerHour: number }>;
  agentOverrides?: Record<string, OwnerNotifyAgentOverride | null>;
}

/** `cutex/ownerNotify/ack` / `dismiss` result. */
export interface OwnerNotifyChangeResult {
  notification: OwnerNotification;
  changed: boolean;
}

/** `cutex/ownerNotify/delete` result (the removed record). */
export interface OwnerNotifyDeleteResult {
  notification: OwnerNotification;
  deleted: true;
}

/** `cutex/ownerNotify/reply` result. */
export interface OwnerNotifyReplyResult {
  notification: OwnerNotification;
  submit: unknown;
}

/**
 * Newest native `token_count` recovered from the rollout: the `thread/tokenUsage/updated` params
 * shape plus `updatedAt`. `turnId` is null only for histories without turn markers.
 */
export interface LatestTokenUsage {
  threadId: string;
  turnId: string | null;
  tokenUsage: import("./codex/v2/ThreadTokenUsage").ThreadTokenUsage;
  updatedAt: unknown;
}

/** Last successful `update_plan` call recovered from the rollout (shape of `turn/plan/updated`). */
export interface LatestPlan {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: { step: string; status: "pending" | "inProgress" | "completed" }[];
  updatedAt: unknown;
}

// ---------- events ----------

export type EventSource = "app_server" | "cutex";

export interface EventCorrelation {
  runtimeGeneration?: number;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  clientUserMessageId?: string;
  managementRequestId?: string;
  queueId?: string;
  agentBusMessageId?: string;
  nativeRequestId?: string | number;
}

export interface NativeEventPayload {
  kind: "notification" | "serverRequest";
  /** Raw app-server message ({method, params} or {id, method, params}). */
  message: { id?: string | number; method: string; params?: unknown };
}

export interface CutexEventPayload {
  method: string;
  params: JsonObject;
}

export interface EventEnvelope {
  contractVersion: 2;
  eventId: string;
  cursor: string;
  streamId: string;
  sequence: number;
  receivedAt: string;
  cutexSessionId: string;
  hostId: string;
  source: EventSource;
  sensitivity: "owner";
  schema?: AppServerSchemaInfo;
  correlation: EventCorrelation;
  native?: NativeEventPayload;
  cutex?: CutexEventPayload;
}

export interface EventPage {
  contractVersion: 2;
  hostId: string;
  streamId: string;
  scope: { cutexSessionId: string | null };
  events: EventEnvelope[];
  nextCursor: string | null;
  checkpoint: EventCheckpoint;
  scannedCount: number;
  hasMore: boolean;
}

export const SSE_EVENT = "cutex_management_event_v2";
export const SSE_STREAM_ERROR = "cutex_management_stream_error";

// ---------- requests ----------

export interface NativeRequestBody {
  requestId: string;
  native: { message: { id: string | number; method: string; params: unknown } };
}

export interface NativeRequestResult {
  contractVersion: 2;
  requestId: string;
  cutexSessionId: string;
  native: { message: { id: string | number; result?: unknown; error?: unknown } };
}

export interface ServerRequestResponseBody {
  responseId: string;
  native: { message: { id: string | number; result?: unknown; error?: unknown } };
}

export interface CutexRequestBody<P = JsonObject> {
  requestId: string;
  method: string;
  params: P;
}

export interface CutexRequestResult<R = unknown> {
  contractVersion: 2;
  requestId: string;
  cutexSessionId: string;
  cutex: { method: string; result: R };
}

export type InputOriginKind = "android" | "backend" | "tui" | "agent_bus" | "automation" | "other";
export interface InputOrigin {
  kind: InputOriginKind;
  clientId: string;
}

export type SubmitStrategy = "auto" | "queue" | "interrupt";

export interface UserInputSubmitParams {
  clientUserMessageId: string;
  origin: InputOrigin;
  strategy: SubmitStrategy;
  /** cute-codex v2 UserInput[] */
  input: unknown[];
  expectedTurnId?: string;
  /** offline-submit: when the runtime is offline, queue the input and start it. */
  startIfOffline?: boolean;
}

/** One page of native turns: pages go newest first, turns within a page oldest first. */
export interface HistoryPage {
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
}

/** `GET /v2/sessions/{id}/history` (offline-history): stored turns, newest page first. */
export interface SessionHistory {
  contractVersion: 2;
  cutexSessionId: string;
  threadId: string;
  source: "live" | "offline";
  native: { method: "thread/read"; result: unknown };
  page: HistoryPage;
  /** As in the bootstrap (session-latest-plan); absent on older cutex. */
  cutexState?: { latestPlan?: LatestPlan | null; latestTokenUsage?: LatestTokenUsage | null };
}

export interface UserInputSubmitResult {
  disposition: "started" | "steered" | "queued" | "deduplicated";
  turnId?: string | null;
  queue?: unknown;
  /** offline-submit: the runtime is being started for this input. */
  runtimeStarting?: boolean;
  /**
   * queue-idle-start: with `queue`, the item waits in a paused queue (after 停止) until resumed /
   * flushed. Absent on older cutex (treat as unknown).
   */
  paused?: boolean;
}

// ---------- agent management (snake_case on the wire) ----------

export interface ProjectPresentation {
  display_name: string;
  badge_label: string;
  /** cyan|blue|green|magenta|yellow|red|#RRGGBB */
  color: string;
  revision?: number;
  stored?: boolean;
}

export interface ProjectSummary {
  project_id: string;
  authority_epoch: number;
  /** Absent/null: the project has no Director (cutex `project-optional-director`). */
  director_cutex_session_id?: string | null;
  director_name?: string | null;
  access_role?: string;
  operator_count?: number;
  presentation: ProjectPresentation;
  active_member_count: number;
  archived_member_count?: number;
  retired_member_count?: number;
  lifecycle: string;
  project_revision?: number;
  /** Absolute project root (set via project mutation `set_workspace_root`). */
  workspace_root?: string | null;
}

export interface ProjectsResponse {
  schema: string;
  projects: ProjectSummary[];
  /** Wire keys are snake_case like the rest of this collection (cutex HumanManagementProjectCollection). */
  archived_projects?: ProjectSummary[];
  available_agents?: { cutex_session_id: string; name: string; current_project_id: string | null }[];
}

// ---------- agent bus events (cutex/agentBus/*) ----------

export type DeliveryMode = "after_turn" | "soon" | "passive" | "interrupt";

export interface AgentBusMessageEvent {
  messageId: string;
  fromCutexSessionId: string | null;
  toCutexSessionId: string;
  fromRuntimeAgentId?: string | null;
  toRuntimeAgentId?: string | null;
  deliveryMode: DeliveryMode;
  content: string;
  sentAt?: string;
  queuedAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  error?: unknown;
}

// ---------- notifications (src/notify/{state,session}.rs) ----------

/** Per-session notification preference (`/v2/notifications/session`, keyed by thread id). */
export type NotificationLevel = "important" | "normal" | "off";

/** One row of `GET /v2/notifications/states` (no message content). */
export interface NotificationSessionState {
  agentId: string;
  agentName: string;
  threadId: string;
  /** Null when the preference cannot be read (`preferenceError`). */
  priority: NotificationLevel | null;
  preferenceError: boolean;
  /** `attention` = failed turn or a pending native approval / question. */
  state: "working" | "waiting" | "attention" | "inactive";
  reason: string | null;
  /** Unix seconds. */
  lastActivityAt: number;
  inactiveAt: number;
  reminderId: string | null;
  unread: boolean;
}

/** `GET /v2/notifications/states` (schema `cutex/notification-state/v1`). */
export interface NotificationStates {
  schema: string;
  /** Unix seconds. */
  generatedAt: number;
  expiresAt: number;
  healthy: boolean;
  sourceHeartbeat: number | null;
  checkpoint: unknown;
  retentionGapObserved: boolean;
  sessions: NotificationSessionState[];
}

/** `POST /v2/notifications/ack` → whether `reminderId` was still the session's current reminder. */
export interface NotificationAckResult {
  acknowledged: boolean;
  threadId: string;
  reminderId: string;
}
