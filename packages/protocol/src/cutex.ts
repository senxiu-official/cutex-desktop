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
  /** Stable per-cutex-home identity (r224+). */
  instanceId?: string;
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
   * `dsh-acp-subset` / `kimi-acp-subset`: the DSH / Kimi Code ACP runtimes; structural actions require explicit feature support.
   */
  protocol: "codex-app-server" | "claude-app-server-subset" | "dsh-acp-subset" | "kimi-acp-subset";
  majorVersion: number;
  version: string;
  sha256: string;
  channel: "stable" | "experimental";
  capabilities: unknown;
  extensions: string[];
}

export interface SessionRuntime {
  /** In-memory runtime work, gated by `session-background-work` (r276+). */
  backgroundWork?: SessionBackgroundWork | null;
  continuationWakeKinds?: string[];
  continuationChildKinds?: string[];
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
  /**
   * Claude sessions (cutex `session-claude-runtime`): the pinned Claude runtime (`claude-r17`) and a
   * repin waiting for the next fresh runtime start. Absent on other sessions and on older cutex.
   */
  claudeRuntime?: SessionClaudeRuntime;
}

export interface SessionBackgroundWork {
  running: boolean;
  subagents?: number;
  shells?: number;
  terminals?: number;
  complete?: boolean;
}

export interface SessionClaudeRuntime {
  release: string;
  pendingRelease: string | null;
}

/** `GET /v2/sessions` `claudeRuntime` (cutex `session-claude-runtime`): the release for new Claude sessions. */
export interface HostClaudeRuntime {
  /** null: no usable Claude runtime installed. */
  selectedRelease: string | null;
}


/** Full Profile style (profile-avatar-style); null means the desktop default. */
export type AvatarStyle =
  | { kind: "portrait"; portraitThemes: string[] }
  | { kind: "emoji"; emojiThemes: string[] | null }
  | { kind: "letter" };
/** session-avatar-mode: absent/null retains legacy assignment behavior. */
export type AvatarMode = "fixed" | "inherit" | null;

/** Display-only avatar set via `cutex/session/metadata/update`. */
export interface SessionAvatar {
  kind: "emoji" | "color" | "icon";
  value: string;
  /** Circle colour `#rrggbb` of an `emoji` / `icon` avatar (cutex capability `agent-avatar-color`; a `color` avatar keeps its colour in `value`). */
  color?: string;
}
export interface SessionBadge {
  text: string;
  tint?: "blue" | "green" | "amber" | "pink" | "violet";
}
/**
 * Who created a session (cutex capability `session-created-by`, r258): fixed at create time; null = not known (sessions
 * from before r258, restores, adopted native sessions). An agent creator names its own session and its role then.
 */
export type SessionCreatedBy = null | { kind: "owner" } | { kind: "system" } | { kind: "agent"; cutexSessionId: string; role?: "director" | "member" };

/** `GET/PUT /v2/human/preferences/guides` (capability `guides.preferences`): the owner's guide choice, shared by their devices. */
export interface GuidesPreferences {
  schema: 1;
  /** The guides version the owner chose 全部跳过 at (null: not skipped / reset). */
  skippedThrough: string | null;
  updatedAt: string | null;
}

/**
 * cutex `profile-runtime-variants` (r265): what the session was created with — fixed forever (resume / restart never
 * re-resolve the profile's default variant, runtime or credential source). No secret. Absent on older cutex and on
 * sessions created before r265 (they run on their profile's primary variant).
 */
export interface SessionLaunchBinding {
  profileId: string;
  variantId: string;
  runtime: "codex" | "claude" | "dsh" | "kimi";
  credential: { source: "stored" | "env" | "chatgptLogin" | "claudeAccount" | "kimiAccount" | "none"; envName?: string | null; version?: number | null; /** r266 Kimi-kind profiles. */ kimiAccountId?: string | null };
  model: string | null;
  reasoningEffort: string | null;
  runtimePackageVersion?: string | null;
  boundAt?: string | null;
}

/** Daemon-owned retry wait; never inferred from a failed turn or elapsed time. */
export interface AutoRetryWait {
  attempt: number;
  maxAttempts: number;
  /** Current retry deadline; scheduledAt is the plan creation time. */
  at?: string;
  scheduledAt: string;
  turnId: string;
  planId: string;
  phase: "pending" | "firing" | "binding" | "uncertain";
  holdsAdmission: boolean;
  runtimeGeneration?: number;
  threadId?: string;
}

export interface SessionResource {
  /** model-overload-retry-visible: current occurrence only; absent/null otherwise. */
  autoRetry?: AutoRetryWait | null;
  /** Additive r266 conversation activity / existing archive lifecycle projection. */
  lastActivityAt?: string | null;
  activitySource?: "conversation" | "unknown";
  observedAt?: string;
  busySince?: string | null;
  activityStatus?: "busy" | "idle" | "offline" | "unknown";
  idleThresholdSeconds?: number;
  archiveKind?: "active" | "soft" | "permanent" | "unknown";
  restorable?: boolean;
  restoreBlockers?: string[];
  /** Lifecycle candidates, never caller permissions. */
  allowedActions?: ("archive" | "restore" | "permanentRetire" | "start" | "send")[];

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
  avatarMode?: AvatarMode;
  /** cutex capability session-badge. */
  badge?: SessionBadge | null;
  /** cutex capability session-created-by; absent on older cutex. */
  createdBy?: SessionCreatedBy;
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
  /** cutex profile-runtime-variants; absent on older cutex / older sessions. */
  launchBinding?: SessionLaunchBinding | null;
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
  /** cutex `session-claude-runtime`; absent on older cutex. */
  claudeRuntime?: HostClaudeRuntime;
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

/** owner-admission-state-v1: committed owner admission snapshot, independent of runtime gates. */
export interface OwnerAdmission {
  state: "idle" | "turn" | "finishing" | "held";
  reason?: "hostBusy" | "stopHold" | "paused" | "delegationLease";
  turnKind?: string;
  heldCount?: number;
  heldUntil?: string;
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
  ownerAdmission?: OwnerAdmission;
  /** false: items/admission are the last committed snapshot while mutations are busy. */
  admissionFresh?: boolean;
  /** input-ledger-v1: the session's ledger head when `inputs` was read. */
  stateRevision?: number;
  ledgerEpoch?: string;
  delivery?: SessionDelivery;
  /** input-ledger-v1: the unsettled records with surface nextUp / pendingNotes (always fresh). */
  inputs?: InputRecord[];
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
  /** model-overload-retry-visible: explains an actual retry admission hold. */
  autoRetry?: AutoRetryWait | null;
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
  /** input-ledger-v1: `admissionFresh: false` — use this snapshot for ordering only, not to decide which rows show. */
  stale?: boolean;
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
  /** agent-bus-message-settlement-v1: server evidence, independent of transport receipts. */
  settlement?: MessageSettlement;
  id: string;
  deliveryKind: AdmissionDeliveryKind | (string & {});
  /** A short label without the body. */
  label?: string | null;
  enqueuedAt: string;
  timing?: "afterTurn" | "nextStep";
  /** ISO time a waiting wake switches to `nextStep`; null / absent = only at the turn end. */
  nextStepAt?: string | null;
  /** admission-wait-reasons: actual idle batching deadline, or native receipt still pending. */
  waitReason?: "resultCoalescing" | "nativeReceipt" | (string & {});
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
  /** The sending agent's cutexSessionId on this host (a tell's sender, a local delegate), for its avatar; absent =
   *  not an agent of this host (alarm, system service, cross-host tell) or a cutex that does not send it yet — the
   *  row then shows the name only. Proposed for cutex (admission-ridealong-detail); desktop reads it when present. */
  fromCutexSessionId?: string | null;
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
  /** input-ledger-v1. */
  input?: InputRecord;
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
  /** input-ledger-v1: the steered item's record. */
  input?: InputRecord;
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
  /** history-media-refs: media payloads replaced by references in this page; absent on older cutex. */
  mediaRefs?: number;
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
  /**
   * safety-grant-delivery (newer cutex + adapter with safetyGrantReadWindow; absent on older ones): the ledger
   * input id of the grant's approval notice; when the agent first read it; the cap (approval + 2 h). Before the
   * read `expiresAt` is the cap, after it read + 30 min (never past the cap).
   */
  noticeInputId?: string | null;
  noticeReadAt?: string | null;
  hardExpiresAt?: string | null;
}

/** `GET /v2/owner-notifications` */
export type OwnerNotifyFilter = "pending" | "alerting" | "all";
export interface OwnerNotificationList {
  notifications: OwnerNotification[];
  nextCursor?: string;
}

/** One bounded `GET /v2/approvals?limit=&cursor=` page. */
export interface ApprovalsPage<T = JsonObject> {
  approvals: T[];
  nextCursor?: string;
}

/** Safety checks are owner notification records carrying a safety block. */
export interface SafetyChecksPage {
  blocks: OwnerNotification[];
  nextCursor?: string;
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

/** owner-join-delegation: one-shot consent bound to the exact running attempt. */
export interface OwnerJoinDelegation {
  askId: string;
  attempt: number;
  expectedTurnId: string;
  runtimeGeneration: number;
}
export type OwnerJoinRefusal = "joinChanged" | "agentPaused" | "runtimeNoSteer" | "runtimeRefused" | "sessionOffline" | "turnConflict" | "turnFinishing";

export interface UserInputSubmitParams {
  clientUserMessageId: string;
  origin: InputOrigin;
  strategy: SubmitStrategy;
  /** cute-codex v2 UserInput[] */
  input: unknown[];
  expectedTurnId?: string;
  joinDelegation?: OwnerJoinDelegation;
  /** offline-submit: when the runtime is offline, queue the input and start it. */
  startIfOffline?: boolean;
  /** Opt in only with owner-admission-held-v1; delivery then belongs to the daemon worker. */
  allowHeld?: boolean;
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
  /** history-media-refs: media payloads replaced by references in this page; absent on older cutex. */
  mediaRefs?: number;
  /** As in the bootstrap (session-latest-plan); absent on older cutex. */
  cutexState?: { latestPlan?: LatestPlan | null; latestTokenUsage?: LatestTokenUsage | null };
}

export interface UserInputSubmitResult {
  /** The explicit join was refused; the input is retained as ordinary queued input. */
  joinRefusal?: OwnerJoinRefusal;
  disposition: "started" | "steered" | "queued" | "deduplicated" | "held";
  clientUserMessageId?: string;
  heldBy?: "hostBusy";
  heldSince?: string;
  heldUntil?: string;
  appServerAccepted?: boolean;
  nativeRequestId?: string | null;
  queuedReason?: "explicitQueue" | "paused" | "hostBusy" | "delegationLease" | "turnRunning" | "imageBusy" | "adapterQueued" | "ownerQueueAhead" | "joinRefused" | "turnFinishing";
  turnId?: string | null;
  queue?: unknown;
  /** offline-submit: the runtime is being started for this input. */
  runtimeStarting?: boolean;
  /**
   * queue-idle-start: with `queue`, the item waits in a paused queue (after 停止) until resumed /
   * flushed. Absent on older cutex (treat as unknown).
   */
  paused?: boolean;
  /** input-ledger-v1: this submit's record (also on `deduplicated`: the existing one). */
  input?: InputRecord;
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

/** Owner follow-up disposition. Closing never asserts successful delivery or processing. */
export interface MessageSettlement {
  state: "outcome_unknown" | "closed";
  canClose: boolean;
  evidenceToken: string;
  evidence: {
    runtime: string;
    runtimeGeneration: number;
    threadId: string;
    actualTurnId: string;
    terminalStatus: string;
    observedAt: string;
  };
  closure: null | { actor: string; closedAt: string; reason: string; requestId: string };
}

export interface MessageSettlementCloseRequest {
  messageId: string;
  expectedEvidenceToken: string;
  requestId: string;
  reason: string;
}

export interface MessageSettlementCloseResponse {
  messageId: string;
  changed: boolean;
  settlement: MessageSettlement;
}

export interface MessageSettlementUpdatedEvent {
  messageId: string;
  requestId: string;
  /** null explicitly clears an unclosed observation; known owner closure remains durable. */
  settlement: MessageSettlement | null;
}

export interface AgentBusMessageEvent {
  settlement?: MessageSettlement;
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

// ---------- input ledger (input-ledger-v1, cutex-desktop docs/design/054) ----------
//
// Mirrors cutex `src/management/v2/schema/cutex-methods-v2.json` `$defs` (inputKind … inputLedgerEventConditions)
// and `schema/export/input-states.json`. Every value list is append only: a client shows an unknown value as its
// code and reports it, never guesses (050 invariant 4). `reason` keeps a `(string & {})` escape so the desktop
// survives codes a newer cutex appends; the other enums are exact.

export const INPUT_LEDGER_FEATURE = "input-ledger-v1";
export const OWNER_IDLE_BUSY_TIMELINE_FEATURE = "owner-idle-busy-timeline-v1";
export const OWNER_CARRIES_FEATURE = "owner-carries-v1";
export const INPUT_GET = "cutex/input/get";
export const INPUT_LIST = "cutex/input/list";
/** Schema only (C5): not served until cutex advertises `input-ledger-v1`. */
export const INPUT_RETRY = "cutex/input/retry";
/** Schema only (C5): not served until cutex advertises `input-ledger-v1`. */
export const INPUT_DISMISS = "cutex/input/dismiss";
export const INPUT_HOLD = "cutex/input/hold";
export const INPUT_INTERRUPT_SEND = "cutex/input/interruptSend";
/** Schema only (C4): not served until cutex advertises `input-ledger-v1`. */
export const INPUT_LEASE_RELEASE = "cutex/input/lease/release";
export const INPUT_STATE_CHANGED = "cutex/input/stateChanged";
export const SESSION_DELIVERY_CHANGED = "cutex/session/deliveryChanged";
/** `cutex/input/get` takes 1..100 ids. */
export const INPUT_GET_MAX_IDS = 100;

export const INPUT_KINDS = ["owner", "agentMessage", "peerMessage", "alarm", "systemNotice", "delegationRequest", "delegationResult", "delegationQuestion", "delegationStatus"] as const;
export const INPUT_SENDER_KINDS = ["owner", "agent", "peer", "alarm", "jobService", "management", "claudeTask", "approval", "cutex"] as const;
export const INPUT_STATES = ["received", "held", "waiting", "sending", "accepted", "inContext", "uncertain", "failed", "rejected", "discarded", "superseded"] as const;
export const INPUT_TERMINAL_STATES = ["inContext", "failed", "rejected", "discarded", "superseded"] as const;
/** Terminal states plus `uncertain`: cutex takes no further automatic action. */
export const INPUT_SETTLED_STATES = ["inContext", "uncertain", "failed", "rejected", "discarded", "superseded"] as const;
export const INPUT_HELD_REASONS = ["hostBusy"] as const;
export const INPUT_SENDING_REASONS = ["interruptSend"] as const;
export const INPUT_CARRIED_REASONS = ["carriedByOwner"] as const;
export const INPUT_WAITING_REASONS = ["explicitQueue", "afterTurn", "nextStep", "passive", "turnRunning", "turnFinishing", "adapterQueued", "ownerQueueAhead", "rideAlongAhead", "delegationLease", "eventLease", "paused", "stopHold", "ownerPause", "agentOffline", "runtimeDisconnected", "hostBusy", "resultCoalescing", "autoRetry", "reviewPending", "targetBusy", "staleHeld", "nativeHeld", "nativeRetry", "returned", "ownerRetry"] as const;
export const INPUT_UNCERTAIN_REASONS = ["turnInterrupted", "turnFailed", "runtimeLost", "receiptTimeout", "outcomeUnknown", "leaseReleased", "nativeConflict"] as const;
export const INPUT_FAILED_REASONS = ["admission_timeout", "notDelivered", "runtimeRefused", "routeLost", "interrupt_timeout", "session_offline", "tooLarge"] as const;
export const INPUT_REJECTED_REASONS = ["targetUnavailable", "quarantined", "provenance", "invalid", "askRejected", "peerRefused", "owner_required"] as const;
export const INPUT_DISCARDED_REASONS = ["ownerRemoved", "ownerDiscarded", "settlementClosed", "askCancelled", "senderRevoked", "archived"] as const;
export const INPUT_SUPERSEDED_REASONS = ["mergedInsert", "revised"] as const;
/** `stalled.reason` (input-states.json `stalledReason`; the methods schema types it as a plain string). */
export const INPUT_STALLED_REASONS = ["runtimeDisconnected", "noProgress", "leaseHeld", "hostBusy", "agentOffline"] as const;
export const INPUT_SURFACES = ["timeline", "nextUp", "pendingNotes", "none"] as const;
export const INPUT_STAGES = ["registered", "offered"] as const;
export const INPUT_EVIDENCE = ["clientIdEcho", "turnStartInput", "contextPersisted", "externalInputPersisted", "a4Receipt", "historyRead", "claimedByWait", "readByTool"] as const;
export const INPUT_ACTIONS = ["retry", "dismiss", "cancel", "sendNow", "edit", "releaseLease", "interruptSend", "hold", "releaseHold"] as const;
export const INPUT_STRATEGIES = ["auto", "queue", "interrupt"] as const;
export const INPUT_DELIVERY_MODES = ["after_turn", "soon", "passive", "interrupt"] as const;
export const INPUT_TIMINGS = ["afterTurn", "nextStep", "passive"] as const;
export const SESSION_DELIVERY_STATES = ["offline", "starting", "disconnected", "idle", "turn", "finishing", "held"] as const;
export const SESSION_DELIVERY_HELD_REASONS = ["hostBusy", "stopHold", "paused", "delegationLease", "eventLease"] as const;
export const SESSION_TURN_KINDS = ["owner", "ask", "delivery", "unknown"] as const;
export const INPUT_LEASE_HOLDERS = ["ask", "event", "owner"] as const;
export const INPUT_LEASE_RECONCILE_STATES = ["waitingTurn", "checking", "stale"] as const;

export type InputKind = (typeof INPUT_KINDS)[number];
export type InputSenderKind = (typeof INPUT_SENDER_KINDS)[number];
export type InputState = (typeof INPUT_STATES)[number];
export type InputTerminalState = (typeof INPUT_TERMINAL_STATES)[number];
export type InputSettledState = (typeof INPUT_SETTLED_STATES)[number];
export type InputSendingReason = (typeof INPUT_SENDING_REASONS)[number];
export type InputHeldReason = (typeof INPUT_HELD_REASONS)[number];
export type InputWaitingReason = (typeof INPUT_WAITING_REASONS)[number];
export type InputUncertainReason = (typeof INPUT_UNCERTAIN_REASONS)[number];
export type InputFailedReason = (typeof INPUT_FAILED_REASONS)[number];
export type InputRejectedReason = (typeof INPUT_REJECTED_REASONS)[number];
export type InputDiscardedReason = (typeof INPUT_DISCARDED_REASONS)[number];
export type InputSupersededReason = (typeof INPUT_SUPERSEDED_REASONS)[number];
export type InputStalledReason = (typeof INPUT_STALLED_REASONS)[number];
/** Schema `inputReason`: the union of the per-state reason codes. */
export type InputReason =
  | (typeof INPUT_CARRIED_REASONS)[number] | InputSendingReason | InputHeldReason | InputWaitingReason | InputUncertainReason | InputFailedReason
  | InputRejectedReason | InputDiscardedReason | InputSupersededReason;
export type InputSurface = (typeof INPUT_SURFACES)[number];
export type InputStage = (typeof INPUT_STAGES)[number];
export type InputEvidence = (typeof INPUT_EVIDENCE)[number];
export type InputAction = (typeof INPUT_ACTIONS)[number];
export type InputStrategy = (typeof INPUT_STRATEGIES)[number];
export type InputDeliveryMode = (typeof INPUT_DELIVERY_MODES)[number];
export type InputTiming = (typeof INPUT_TIMINGS)[number];
export type SessionDeliveryState = (typeof SESSION_DELIVERY_STATES)[number];
export type SessionDeliveryHeldReason = (typeof SESSION_DELIVERY_HELD_REASONS)[number];
export type SessionTurnKind = (typeof SESSION_TURN_KINDS)[number];
export type InputLeaseHolder = (typeof INPUT_LEASE_HOLDERS)[number];
export type InputLeaseReconcileState = (typeof INPUT_LEASE_RECONCILE_STATES)[number];

/** Reason union per state, for narrowing (`null`: the state carries no reason). */
export interface InputReasonByState {
  received: null;
  held: InputHeldReason;
  waiting: InputWaitingReason;
  sending: InputSendingReason;
  accepted: (typeof INPUT_CARRIED_REASONS)[number] | null;
  inContext: (typeof INPUT_CARRIED_REASONS)[number] | null;
  uncertain: InputUncertainReason;
  failed: InputFailedReason;
  rejected: InputRejectedReason;
  discarded: InputDiscardedReason;
  superseded: InputSupersededReason;
}

/** Per-state reason codes (input-states.json). A state absent here carries no reason. */
export const INPUT_REASONS_BY_STATE: { readonly [S in InputState]?: readonly InputReasonByState[S][] } = {
  accepted: INPUT_CARRIED_REASONS,
  inContext: INPUT_CARRIED_REASONS,
  sending: INPUT_SENDING_REASONS,
  held: INPUT_HELD_REASONS,
  waiting: INPUT_WAITING_REASONS,
  uncertain: INPUT_UNCERTAIN_REASONS,
  failed: INPUT_FAILED_REASONS,
  rejected: INPUT_REJECTED_REASONS,
  discarded: INPUT_DISCARDED_REASONS,
  superseded: INPUT_SUPERSEDED_REASONS,
};

/** Settled (了结): terminal or `uncertain`; cutex does nothing more on its own. */
export function isInputSettled(state: InputState): state is InputSettledState {
  return (INPUT_SETTLED_STATES as readonly string[]).includes(state);
}

export function isInputTerminal(state: InputState): state is InputTerminalState {
  return (INPUT_TERMINAL_STATES as readonly string[]).includes(state);
}

/** Whether `reason` is a code cutex documents for `state` (false: show the code and report it). */
export function isKnownInputReason(state: InputState, reason: string | null): boolean {
  const known = INPUT_REASONS_BY_STATE[state] as readonly string[] | undefined;
  if (!known) return reason === null;
  return reason === null || known.includes(reason);
}

/** Schema `inputSender`. */
export interface InputSender {
  kind: InputSenderKind;
  id: string;
  name: string;
  host: string | null;
  cutexSessionId: string | null;
}

/** Schema `inputIntent`. `strategy` only on owner messages; `timing` is required (never defaulted, #12). */
export interface InputIntent {
  strategy: InputStrategy | null;
  deliveryMode: InputDeliveryMode | null;
  timing: InputTiming;
}

/** nextUp order, taken from admission. */
export interface InputOrder {
  admissionKey: string;
  position: number;
}

export interface InputRemote {
  host: string;
  peerId: string;
  senderId: string;
}

/** cutex: the input is eligible but has not moved for `stallAfterSecs`. */
export interface InputStalled {
  reason: InputStalledReason | (string & {});
  since: string;
}

export interface InputError {
  code: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

/**
 * Schema `inputRecord` (054 §2.2). One record per input with a stable id (clientUserMessageId / messageId /
 * deliveryId / askId). `preview` and `actions` are absent on the host stream. `details` (not in the design
 * text): the per-reason details object (`nativeHeld` → `details.nativeReason`, …), `{}` when none.
 */
export interface InputRecord {
  inputId: string;
  cutexSessionId: string;
  kind: InputKind;
  sender: InputSender;
  intent: InputIntent;
  /** ≤ 80 chars. */
  preview?: string;
  createdAt: string;
  state: InputState;
  reason: InputReason | (string & {}) | null;
  since: string;
  deadline: string | null;
  /** accepted only (Claude insert stage). */
  stage: InputStage | null;
  surface: InputSurface;
  /** nextUp only. */
  order: InputOrder | null;
  turnId: string | null;
  timelineItemId: string | null;
  runtimeGeneration: number | null;
  attempt: number;
  supersededBy: string | null;
  batchId: string | null;
  /** 057: inputs bundled with this owner message; absent on older hosts. */
  carries?: string[];
  /** Unread wake agent / peer records to a busy recipient only (absent elsewhere and on older hosts). */
  wakeSchedule?: InputWakeSchedule;
  askId: string | null;
  remote: InputRemote | null;
  stalled: InputStalled | null;
  actions?: InputAction[];
  error: InputError | null;
  evidence: InputEvidence | null;
  details: Record<string, unknown>;
  /** The record's own monotonic version (1 on creation). */
  rev: number;
  /** The session `stateRevision` of this record's last change. */
  stateRevision: number;
  updatedAt: string;
}

/**
 * When a wake to a busy recipient may be read inside the running turn (cutex agentBus.wakeBusyWaitSecs).
 * `capability`: the recipient reads early (`soon`), only after the turn, or not at all. `timing`: `nextStep` =
 * past the wait, read at the next read point; `afterTurn` with `nextStepAt` = until then; `afterTurn` without
 * one = this note waits for the turn end. Says nothing about whether it was read.
 */
export interface InputWakeSchedule {
  nextStepAt: string | null;
  waitSecs: number | null;
  capability: "soon" | "afterTurn" | "none" | (string & {});
  timing: "afterTurn" | "nextStep" | (string & {});
  held?: string;
}

export interface InputHoldParams {
  inputId: string;
  expectedRev: number;
  held: boolean;
}

export interface InputHoldResult {
  ledgerEpoch: string;
  stateRevision: number;
  record: InputRecord;
}

export interface InputLeaseReconcile {
  state: InputLeaseReconcileState;
  lastCheckedAt?: string | null;
  nextCheckAt?: string | null;
  lastResult?: string | null;
}

/** Schema `inputLease` (054 §2.6). */
export interface InputLease {
  holder: InputLeaseHolder;
  turnId: string | null;
  since: string;
  runtimeGeneration: number | null;
  inputIds: string[];
  reconcile: InputLeaseReconcile;
}

export interface SessionDeliveryTurn {
  turnId: string;
  kind: SessionTurnKind;
  askId: string | null;
  startedAt: string | null;
  inputIds: string[];
}

/** Schema `sessionDelivery` (054 §2.6): replaces activeTurnId + ownerAdmission + currentTurn + turnState. */
export interface SessionDelivery {
  state: SessionDeliveryState;
  /** held only. */
  reason: SessionDeliveryHeldReason | null;
  turn: SessionDeliveryTurn | null;
  lease: InputLease | null;
  runtimeConnected: boolean;
  runtimeGeneration: number | null;
  heldCount: number;
  heldUntil: string | null;
  stateRevision: number;
  observedAt: string;
}

/** `cutex/input/get` params (the session travels in the request envelope). 1..100 ids. */
export interface InputGetParams {
  inputIds: string[];
}

/** `cutex/input/get` result: records in request order, unknown ids in `missing`. */
export interface InputGetResult {
  ledgerEpoch: string;
  stateRevision: number;
  records: InputRecord[];
  missing: string[];
}

/** `cutex/input/list` params. With `sinceRevision`: records changed after it; without: unsettled + settled within `includeSettledSecs`. */
export interface InputListParams {
  sinceRevision?: number;
  includeSettledSecs?: number;
}

export interface InputListResult {
  ledgerEpoch: string;
  stateRevision: number;
  records: InputRecord[];
  complete: boolean;
  /** `sinceRevision` was compacted away (or is ahead of the head): read the full list instead. */
  resyncRequired?: boolean;
  delivery?: SessionDelivery;
}

/** Owner action on an existing input: daemon owns interrupt, receipt check and same-id delivery. */
export interface InputInterruptSendParams {
  inputId: string;
  expectedRev: number;
  expectedTurnId: string;
  expectedRuntimeGeneration: number;
}
export interface InputInterruptSendResult {
  ledgerEpoch: string;
  stateRevision: number;
  outcome: "interrupted" | "alreadyInContext" | "held" | "agentOffline";
  interruptedTurnId: string | null;
  record: InputRecord;
}

/** `cutex/input/retry`: failed / uncertain → waiting{ownerRetry}. */
export interface InputRetryParams {
  inputId: string;
  expectedRev: number;
}

/** `cutex/input/dismiss`: single CAS or up to 100 CAS items; → discarded{ownerDiscarded}. */
export type InputDismissParams = { inputId: string; expectedRev: number } | { items: { inputId: string; expectedRev: number }[] };
export interface InputDismissResult {
  ledgerEpoch: string;
  stateRevision: number;
  records: InputRecord[];
  failed: { inputId: string; code: "input_not_found" | "revision_conflict" | "input_not_dismissible" | "dismiss_failed" | "event_persistence_unavailable"; message: string; currentRev: number | null }[];
}
/** Atomic queue CAS; revision is the queue revision, never the ledger head. */
export interface UserInputQueueMergeParams {
  items: { queueId: string; expectedRevision: number }[];
  input?: unknown[];
}
export interface UserInputQueueMergeResult {
  revision: number;
  affectedQueueIds: string[];
  item: QueueItem;
  inputs: InputRecord[];
}

/** `cutex/input/lease/release` params. Only while `reconcile.state` is stale. */
export interface InputLeaseReleaseParams {
  expectedLease: InputLease;
}

/** `cutex/input/stateChanged` params (session and host streams). */
export interface InputStateChangedEvent {
  cutexSessionId: string;
  ledgerEpoch: string;
  stateRevision: number;
  record: InputRecord;
}

/** `cutex/session/deliveryChanged` params. */
export interface SessionDeliveryChangedEvent {
  cutexSessionId: string;
  ledgerEpoch: string;
  stateRevision: number;
  delivery: SessionDelivery;
}

/** `cutex/userInput/queue/remove` / `queue/flush` result (schema `queueMutationResult`). */
export interface QueueMutationResult {
  revision: number;
  affectedQueueIds: string[];
  /** input-ledger-v1: the record of this request's input. */
  input?: InputRecord;
}
