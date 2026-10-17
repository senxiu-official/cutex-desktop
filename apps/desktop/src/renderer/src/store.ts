import { composerDrafts, insertComposerDraft } from "./lib/composerDrafts";
import { traceSendStage, type SendTraceRecord } from "../../shared/sendTrace";
import { create } from "zustand";
import type { AdmissionRef, AsksPause, EventEnvelope, QueueAdmission, QueueItem, QueuePause, SubmitStrategy, UserInputSubmitResult } from "@cutex-desktop/protocol";
import type { ApprovalsReviewer, CollaborationModeMask, ThreadGoalStatus } from "@cutex-desktop/protocol/codex/v2";
import { LAUNCH_REVIEWER_FEATURE, reviewerForCreate, type PermissionMode } from "./lib/permissionModes";
import type { ApprovalDecision, ApprovalDecisionResult, ApprovalRecord, DaemonApi, DaemonState, ExtraInput, HostsState, ModelOption, MutationResult, QuotaGauge, ServerRequestReply, SessionActionMethod, SidebarSnapshot, ServiceView } from "../../shared/ipc";
import type { LaunchOverrides } from "../../shared/launch";
import { api, apiFor, bridge } from "./bridge";
import { hostEpoch as connEpochOf, scopeHosts } from "../../shared/hosts";
import { routeAgentHost } from "./lib/agentHostRoute";
import { nextPreview, previewFromResource, type ActivityPreview } from "./lib/activity";
import { emitNotify, retractNotify } from "./lib/notifyEvents";
import { retractionOfApproval, retractionOfHostEvent, startLookRetract } from "./lib/notifyRetract";
import { applyTurnEvent, endTurn, serverRequestEventOf, turnEventOf, turnOwnerOf, type TurnTriggerState } from "./lib/turnTriggers";
import { markSeenOn, recordTurnEndOn, turnEndOf } from "./lib/turnUnread";
import { agentFeaturesOf, lacks } from "./lib/agentFeatures";
import { applyApprovalChange, approvalChangeOf, APPROVALS_FEATURE, sortApprovals, withoutApproval } from "./lib/approvals";
import { parseUnsupported } from "../../shared/unsupported";
import { QUEUE_STEER_FEATURE, queueSteerNotice } from "./lib/queueSteer";
import { QUOTA_NATIVE_FEATURE, QUOTA_UPDATED_EVENT, quotaEventProfiles } from "./lib/quota";
import { newPendingSteer, recordedSteers, resolveChecked, settlePendingSteers, type PendingSteer, type SteerSettlement } from "./lib/pendingSteers";
import { confirmOutbox, failOutbox, flushedOutboxEntry, flushOutbox, hasUnlandedTurn, markOutboxDispatched, markOutboxWaiting, newOutboxEntry, setOutboxStage, predictPlacement, pruneHidden, reconcileOutbox, removeOutbox, retryOutbox, sendErrorText, submitLandedPaused, updateOutbox, type OutboxEntry } from "./lib/outbox";
import { collaborationModeOf, seedThreadSettings } from "./lib/threadSettings";
import { applyEvent, contextUsageFromLatest, contextUsageOf, emptyTimeline, insertInteraction, isChildThreadEvent, isDockEvent, planFromLatest, planSnapshotOf, seedContextUsage, seedInteractions, seedPlan, timelineFromThreadRead, type ThreadSettingsView, type TimelineState } from "./lib/timeline";
import { answeredRecord, elsewhereRecord, putRecord, recordsOf, requestTurnId, retainSessions, type InteractionRecord } from "./lib/interactionLog";
import { bootPlan, dismissPlan as dismissedPlan, nextPlan, planTurnGone, revertDropsPlan } from "./lib/planState";
import { forgetFreshPlans, getCachedPlan, isPlanFresh, setCachedPlan } from "./lib/planCache";
import type { LatestPlan, SessionHistory } from "@cutex-desktop/protocol";
import { answerFailureOf } from "./lib/interactions";
import { childStatusFromEvent } from "./lib/subagents";
import { interruptSendText, pausedSection, restorePlan } from "./lib/queuePause";
import { OUTBOX_STUCK_MS, outboxLingerRecord } from "./lib/outboxDiagnostics";
import { ADMISSION_ORDER_FEATURE, applyMove } from "./lib/admissionOrder";
import { stopHeld } from "./lib/stopHold";
import { parseQueueMoveError, type QueueMoveErrorKind } from "../../shared/queueMove";
import { SIDEBAR_GROUP_IDS, untitledChatName } from "./lib/sidebar";
import { withRetiredDefaults } from "./lib/retiredSession";
import { isArchived, lifecycleFlip } from "./lib/archivedAgent";
import { emptyPendingChat, hasDraftContent, pendingChatSteps, type PendingChatState, type PendingDraft } from "./lib/pendingChat";
import { translate, type MessageKey } from "./i18n";
import { fireHostReset, fireHostSwitch } from "./lib/hostSwitch";
import { noteHostAccess } from "./lib/hostAccess";
import { hostFeatureSet, isOwnerFeatures, userAccessOf } from "../../shared/users";
import { claimHostIds, claimList, dropLegacy, hostKey, keyFocus, projectList, registerHostKeyed, setKeyFocus, writeList } from "./lib/hostKeys";
import { startDelegationSync, useDelegations } from "./lib/delegationStore";
import { startJobSync, useJobs } from "./lib/jobStore";
import { startRuntimePackageSync } from "./lib/runtimePackageStore";
import { useAgentMessages } from "./lib/agentMessageStore";
import { refreshPendingOwnerNotes, seedOwnerNotes, startOwnerNotifySync } from "./lib/ownerNotifyStore";
import { noteCatalogNames } from "./lib/modelDisplay";
import { MESSAGES_WAKE_METHOD } from "../../shared/ipc";
import { cloneTimeline, historyPageSize, MAX_PAGE_TURNS, olderAfterPage, olderFromPage, prependHistory, INTERRUPT_STEER_CHECK_TURNS, STEER_CHECK_TURNS, type OlderHistory } from "./lib/historyPages";
import { getUiPrefs } from "./lib/prefs";
import { agentManagementToolCompleted, coalescedRefresh, sidebarRefreshesForMethod, type CoalescedRefresh } from "./lib/coalescedRefresh";
import type { ItemId, PageParams } from "./modules/types";

/** Notices of the move refusals cutex names (shared/queueMove). */
const QUEUE_MOVE_NOTICES: Record<QueueMoveErrorKind, MessageKey> = {
  conflict: "queue.move.conflict",
  passingNotAllowed: "queue.move.passingNotAllowed",
  gone: "queue.move.gone",
};

export interface SessionView {
  loading: boolean;
  error: string | null;
  resyncing: boolean;
  connection: "connecting" | "live" | "retrying";
  runtimeGeneration: number;
  timeline: TimelineState;
  /** cutex-held user input queue (survives window close, shared with the TUI). */
  queue: QueueItem[];
  /** cutex queue pause after a plain stop (queue-pause): nothing is auto-sent while set. */
  queuePause: QueuePause | null;
  /** cutex asks pause (asks-pause-v2): only an explicit owner 暂停委托 sets it; resume or the owner's next message clears it. */
  asksPaused: AsksPause | null;
  /** admission-order: owner items, asks and deliveries in admission order (null: older cutex / not listed yet). */
  admission?: QueueAdmission | null;
  /** Bumped on every mutation so React re-renders (timeline is mutated in place). */
  version: number;
  /** "offline": timeline came from stored history (runtime not running); re-bootstrapped on online. */
  /** "archived": a retired agent, read-only from GET /history (no bootstrap, no feed; lib/archivedAgent). */
  historySource: "live" | "offline" | "archived";
  /** Last failed offline start, valid only while its inputs still wait for a runtime. */
  startError: string | null;
  startErrorQueueIds?: string[];
  /** History pages: older turns still on the host (lib/historyPages); null = all loaded. */
  older: OlderHistory | null;
}

/** Plain text of a queued input (cute-codex UserInput[]). */
export function queueItemText(item: QueueItem): string {
  return (item.input as { type: string; text?: string }[])
    .map((part) => (part.type === "text" ? part.text ?? "" : `[${part.type}]`))
    .join("\n");
}

export type ProjectTab = "overview" | "agents" | "tasks" | "memory" | "settings";

export type ProfilePage = { kind: "profile"; name: string } | { kind: "new" };
/**
 * What the main area shows (docs/desktop-modules.md §3.2): the selected agent's conversation, or a
 * `main.page` item (modules/<id>/) with its in-memory params. Settings is the shell's page
 * `shell.settings` (params: tab, profile, create).
 */
export type MainView = { kind: "conversation" } | { kind: "page"; page: ItemId; params: PageParams };
export const SETTINGS_PAGE: ItemId = "shell.settings";
/** The draft page of 新工作 (quick-chats module); newQuickChat opens it. */
export const DRAFT_CHAT_PAGE: ItemId = "quick-chats.draft";
/** The open page's id, or null in the conversation. */
export const pageOf = (view: MainView): ItemId | null => (view.kind === "page" ? view.page : null);
/** Settings → Profiles sub-page from the settings page params. */
export function profilePageOf(params: PageParams): ProfilePage | undefined {
  if (params.tab !== "profiles") return undefined;
  return params.create ? { kind: "new" } : params.profile ? { kind: "profile", name: params.profile } : undefined;
}
export type SettingsTab =
  // 应用
  | "general"
  | "appearance"
  | "conversation"
  | "sidebar"
  | "sides"
  | "status"
  | "notifications"
  // 连接
  | "me"
  | "hosts"
  | "remote"
  | "peers"
  | "users"
  // Agent
  | "profiles"
  | "defaults"
  | "instructions"
  | "collab"
  | "runtime"
  // 工具
  | "browser"
  | "plugins"
  | "mcp"
  | "skills"
  | "hooks"
  | "nci"
  // 数据
  | "usage"
  | "archive"
  // 系统
  | "modules"
  | "shortcuts"
  | "backend"
  | "updates"
  | "about";

/**
 * What the app keeps of a connected host it does not show (multi-host RFC §6.2 / §10, P0: every
 * connected host but the focus): enough for the attention count, notifications and approvals of hosts
 * outside the scope. The focus host's own state is the top-level fields (daemon, sidebar, features, …).
 */
export interface HostSlice {
  /** The connection (routing epoch) this slice belongs to. */
  epoch: string;
  daemon: DaemonState;
  features: ReadonlySet<string>;
  featuresKnown: boolean;
  sidebar: SidebarSnapshot | null;
  approvals: ApprovalRecord[] | null;
  services: ServiceView[] | null;
  /** Agents waiting for the owner (native requests seen on the host feed, not resolved yet) → request ids. */
  waiting: Record<string, string[]>;
}

interface AppState {
  /** The focus host's connection state (the host the app shows). */
  daemon: DaemonState;
  /** Host list + scope + focus host (`active`) + its SSH tunnel (main HostManager); null until loaded. */
  hosts: HostsState | null;
  /** Show another host (local or SSH; P0: the scope = that one host); the shown host's state is reset. */
  switchHost(hostId: string): Promise<void>;
  /** Connected hosts other than the focus, by host id (their counts / notifications keep working). */
  byHost: Record<string, HostSlice>;
  sidebar: SidebarSnapshot | null;
  selectedId: string | null;
  /**
   * The host of the selected agent (multi-host P1: an agent of any host in the scope can be open; its
   * calls go to that host, see `sessionApi`); null when none is selected.
   */
  selectedHost: string | null;
  sessions: Record<string, SessionView>;
  pinned: Set<string>;
  /** Sidebar "latest activity" line per agent. */
  activity: Record<string, ActivityPreview>;
  view: MainView;

  init(): void;
  refreshSidebar(): Promise<void>;
  /** Reload a host's sidebar snapshot: the focus host's (`refreshSidebar`) or another followed host's slice. */
  refreshHostSidebar(hostId: string): Promise<void>;
  /** Open an agent; `hostId`: its host (default: the selected agent's when it is the same id, else the focus host). */
  select(sessionId: string, hostId?: string): Promise<void>;
  /**
   * Open an agent of any host (lists, notifications): in the scope → at once (`select` with its host);
   * outside it → 所有设备 first (RFC §10, ★ Q14), then the agent.
   */
  openAgent(sessionId: string, hostId: string): Promise<void>;
  /**
   * Read the open agent again (its view's 重新加载 after a failed load): from the host that lists it now
   * (lib/agentHostRoute; a view opened on the wrong host moves to its own), else from the same host.
   */
  reloadSession(sessionId: string): Promise<void>;
  /**
   * `extra`: image / skill input items. Optimistic (lib/outbox): the message shows up at once where
   * it will land, marked as sending, and is replaced by cutex's item; sends of one agent go out in
   * order. Rejects on failure (the entry stays, failed). `keepFailed: false` drops it instead (the
   * new-chat draft keeps its own copy).
   */
  submit(text: string, strategy: SubmitStrategy, extra?: ExtraInput[], opts?: { keepFailed?: boolean }): Promise<UserInputSubmitResult | null>;
  /** Optimistic sends per agent not yet visible as cutex items (lib/outbox). */
  outbox: Record<string, OutboxEntry[]>;
  /** Queue rows hidden while their removal / edit / "立即" is in flight (queue ids per agent). */
  queueHidden: Record<string, string[]>;
  /** Failed send: again under the same clientUserMessageId (cutex dedupes it). */
  retrySend(sessionId: string, id: string): void;
  /** Failed send: back into the composer (appended), removed from the outbox. */
  editSend(sessionId: string, id: string): void;
  discardSend(sessionId: string, id: string): void;
  interrupt(): Promise<void>;
  /** Steered messages not yet recorded by the native, per agent (lib/pendingSteers; queue area). */
  pendingSteers: Record<string, PendingSteer[]>;
  /** Native item ids of this agent's live background terminals (lib/background; tool rows). */
  backgroundItems: Record<string, string[]>;
  setBackgroundItems(sessionId: string, itemIds: string[]): void;
  /** Re-send an undelivered steer of the selected agent (same clientUserMessageId: no duplicates). */
  resendSteer(id: string): Promise<void>;
  /** Remove an undelivered steer from the queue panel. */
  dismissSteer(id: string): void;
  /** collaborationMode/list presets per agent (`/plan`, composer mode chip). */
  collabModes: Record<string, CollaborationModeMask[]>;
  loadCollabModes(): Promise<void>;
  /**
   * Switch the selected agent's collaboration mode (`thread/settings/update`); false if the mode is
   * unknown or the native did not take it; null (stale, nothing applied, say nothing) when the host
   * or the selection changed while the mode list loaded.
   */
  setCollabMode(mode: string): Promise<boolean | null>;
  /** `/goal`: set objective / status of the selected agent's thread goal. */
  setGoal(patch: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }): Promise<void>;
  /** A fresh goal in place of the current one (clear + set, so usage counters restart) — TUI `/goal <new>`. */
  replaceGoal(objective: string): Promise<void>;
  clearGoal(): Promise<void>;
  /** `/review`: inline review of uncommitted changes (or custom instructions). */
  startReview(instructions: string | null): Promise<void>;
  /** `/stop`: terminate every background terminal of the selected agent; returns how many. */
  stopBackgroundTerminals(): Promise<number>;
  /** One-shot UI requests across components ("open the model picker", "open /ps"). */
  /** One-shot "open this UI" request; `arg` carries a mode/payload (e.g. the goal card's edit / replace). */
  uiSignal: { target: string; nonce: number; arg?: string } | null;
  signal(target: string, arg?: string): void;
  /** Short line above the composer (command feedback, errors). */
  notice: { text: string; tone: "info" | "error"; nonce: number } | null;
  notify(text: string, tone?: "info" | "error"): void;
  /** Where Settings should land (e.g. `/logout` → this profile's account section). */
  settingsFocus: { profile?: string; anchor?: string } | null;
  /** Answer a pending server request (approval / question / elicitation) of the selected agent. */
  respond(requestId: string | number, reply: ServerRequestReply): Promise<void>;
  /** Models available to the selected agent (cached per agent and runtime generation). */
  models: Record<string, ModelOption[]>;
  /** Load the selected agent's models; `refresh` refetches even when cached (the list stays shown). */
  loadModels(refresh?: boolean): Promise<void>;
  /** Optimistically apply + send a `thread/settings/update` patch for the selected agent. */
  updateSettings(patch: Record<string, unknown>): Promise<boolean>;
  /** Start a native context compaction for the selected agent. */
  compact(): Promise<void>;
  /** cutex quota gauges per profile name (refreshed on select + every minute while shown). */
  quotas: Record<string, QuotaGauge[]>;
  loadQuota(profile: string, refresh?: boolean): Promise<void>;
  /** `sessionId`: the agent whose queue row was clicked (default: the selected one, read at call time). */
  queueRemove(item: QueueItem, sessionId?: string): Promise<void>;
  /** Remove from the queue and return its text so the composer can edit it. */
  queueTakeForEdit(item: QueueItem, sessionId?: string): Promise<string>;
  /**
   * "Steer" a queued item into the running turn (main: queuePromote): with queue-steer cutex's
   * atomic `queue/steer` (a refusal keeps it queued and throws a readable notice); older cutex:
   * CAS-remove + submit `auto` under the item's own clientUserMessageId/origin, so it can't be sent twice.
   */
  queueSendNow(item: QueueItem, sessionId?: string): Promise<void>;
  /**
   * admission-order: move an owner queued item in front of `before` (null = to the end). Optimistic:
   * the panel shows the new order at once and goes back if cutex refuses; the error is a readable
   * notice with `moveRefusal` (shared/queueMove) when cutex named the reason.
   */
  queueMove(item: QueueItem, before: AdmissionRef | null): Promise<void>;
  /** admission-owner-yield: the selected agent's waiting ride-alongs go before the owner's queued turns once. */
  queueYield(): Promise<void>;
  /**
   * "Interrupt & send" for the steers still waiting in the queue area: stop the turn; cute-codex
   * discards unread steer input on interrupt, so exactly those it dropped are re-sent as one new
   * message (those it recorded first are not).
   */
  interruptAndSendSteers(): Promise<void>;
  /**
   * Ctrl+Shift+Enter with steers waiting (queue-pause): stop the turn, merge the steers it dropped
   * and `text` into one message as the new turn; the queue keeps going after it (not paused).
   * Without waiting steers or the capability: a plain submit with strategy `interrupt`.
   */
  interruptAndSend(text: string, extra: ExtraInput[]): Promise<boolean>;
  /** 暂停委托 (asks-pause-v2): hold new delegations to this agent until resumed. */
  pauseAsks(sessionId: string): Promise<void>;
  /** 继续委托 (asks-pause-v2): release the asks pause. */
  resumeAsks(sessionId: string): Promise<void>;
  /**
   * 继续发送: undelivered steers as one new message, then resume the cutex queue (also when only an
   * owner stop hold is on: queue resume releases it, stop-holds-ridealongs). Default: the selected agent.
   */
  resumePaused(sessionId?: string): Promise<void>;
  /** 放回输入框: paused texts (steers, then queued items) into the composer; removed from the queue. */
  restorePaused(): Promise<void>;
  /** 清空: discard undelivered steers and the paused queue items (the UI confirms first). */
  discardPaused(): Promise<void>;
  /** Sessions whose queue is transiently stopped by interrupt-and-send (not shown as paused). */
  queueHandoff: Record<string, boolean>;
  /** `focus.profile` (tab "profiles") opens that profile's detail page; `focus.create` the 添加 form. */
  openSettings(tab?: SettingsTab, focus?: { profile?: string; anchor?: string; create?: boolean }): void;
  /** Shows a `main.page` item (= services.ui.openPage, modules/app.ts). */
  openPage(page: ItemId, params?: PageParams): void;
  /** Back to the conversation. */
  closePage(): void;
  /** Sidebar "New chat": scratch quick chat on the default profile, started and selected (human-create-session). */
  /** `profile`: a profile id, or the default profile when omitted. */
  newQuickChat(profile?: string): Promise<void>;
  creatingChat: boolean;
  /** New chat draft: nothing exists in cutex until the first message, so profile / model / effort /
   *  permissions / plan mode / goal can be picked first. The first send creates the session (~1 s),
   *  applies plan mode and the goal, then the messages typed meanwhile go out (lib/pendingChat). */
  pendingChat: PendingChatState | null;
  queuePendingChat(draft: PendingDraft): void;
  setPendingChat(patch: { hostId?: string | null; profile?: string | null; launch?: LaunchOverrides; permissionMode?: PermissionMode | null; plan?: boolean; goal?: string | null }): void;
  /**
   * Fallback for hosts without launch-approvals-reviewer: set this reviewer on the new agent's
   * thread once it is live (applied when its view loads with a running native; lib/permissionModes).
   */
  expectApprovalsReviewer(sessionId: string, hostId: string, reviewer: ApprovalsReviewer): void;
  retryPendingChat(): void;
  /** Pin / unpin an agent of `hostId` (default: the focus host). */
  togglePin(sessionId: string, hostId?: string): void;
  /**
   * cutex session mutation from menus; fills `expectedRevision` (+ `expectedRuntimeGeneration` for
   * retire / runtime methods) from the sidebar snapshot, then refreshes the sidebar. `hostId`: the agent's
   * host (default: the host of its open view, else the focus host; menus of another host's rows pass it).
   */
  sessionAction(sessionId: string, method: SessionActionMethod, params?: Record<string, unknown>, hostId?: string): Promise<unknown>;
  /**
   * Fork (session-fork): a new agent from this one's thread up to `afterTurnId` (null = latest),
   * selected afterwards with a short notice. Non-destructive: no confirmation.
   */
  forkSession(sessionId: string, afterTurnId: string | null): Promise<void>;
  /** Roll the thread back so the turn before `beforeTurnId` is the last (history only, live). */
  revertTo(sessionId: string, beforeTurnId: string): Promise<void>;
  /** The owner's × on 进程: hidden until a different non-empty plan arrives (lib/planState). */
  dismissPlan(sessionId: string): void;
  /** Permanent delete (session-delete); a refusal comes back for the caller to explain. */
  deleteSession(sessionId: string, expectedRevision?: number, hostId?: string): Promise<MutationResult>;
  /** Put text into the current host/session's window-local draft ("edit & resend", "quote"). */
  /** `extra`: image / skill input items to attach to the draft (放回输入框). */
  insertIntoComposer(sessionId: string, text: string, mode?: "replace" | "append", extra?: unknown[]): void;
  /** Live timelines of subagent threads opened in the side pane, keyed by thread id (§4.16). */
  subTimelines: Record<string, { timeline: TimelineState; version: number }>;
  setSubTimeline(threadId: string, timeline: TimelineState): void;
  /** Sub-agent status from the child thread itself (its events on the parent stream, or
   *  `thread/read`), keyed by child thread id; overrides the parent's call-time snapshots. */
  subAgentLive: Record<string, string>;
  /** Parent `runtimeGeneration` each `subAgentLive` status was seen under (lib/subagents `liveAtGeneration`). */
  subAgentLiveGen: Record<string, number>;
  /** `generation`: the parent's runtime generation the status was seen under (omitted / 0 = unknown). */
  setSubAgentStatus(threadId: string, status: string, generation?: number): void;
  /** cutex `/v2/capabilities` featureList (empty until loaded / on older cutex). */
  features: ReadonlySet<string>;
  /** `features` reflects the connected host (false until its capabilities load; reset on host switch). */
  featuresKnown: boolean;
  /** cutex services registry (null until loaded / unsupported); patched live from host events. */
  services: ServiceView[] | null;
  refreshServices(): Promise<void>;
  /** Revert the thread to before `turnId` (live, no restart) and put its text back in the composer. */
  editAndResend(sessionId: string, turnId: string, text: string): Promise<void>;
  /** Pending owner approvals (cutex owner-approvals), newest first; null until loaded / unsupported. */
  approvals: ApprovalRecord[] | null;
  refreshApprovals(): Promise<void>;
  /** Approve / deny; the record leaves the pending list at once (the host event confirms it). */
  decideApproval(approvalId: string, decision: ApprovalDecision, note?: string): Promise<ApprovalDecisionResult>;
  /**
   * History pages: prepend the next older page of turns to the agent's timeline (scrolled to the top).
   * `opts` (jumps, lib/jump.ts): another page size, a reader that may answer from the reference cache.
   */
  loadOlder(sessionId: string, opts?: { limit?: number; read?(cursor: string): Promise<SessionHistory | null> }): Promise<void>;
  /** The agent's whole thread (older pages fetched into a copy; the view is untouched), e.g. for export. */
  completeTimeline(sessionId: string): Promise<TimelineState | null>;
}

/** Timelines kept in memory for agents viewed recently (most recent first). */
const CACHED_SESSIONS = 12;
let recentSessions: string[] = [];
/** Runtime generation each cached model list was fetched for. */
const modelsGeneration = new Map<string, number>();

function newView(): SessionView {
  return {
    loading: true,
    error: null,
    resyncing: false,
    connection: "connecting",
    runtimeGeneration: 0,
    timeline: emptyTimeline(),
    queue: [],
    queuePause: null,
    asksPaused: null,
    admission: null,
    version: 0,
    historySource: "live",
    startError: null,
    older: null,
  };
}

const queueTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Last collaboration mode seen per agent (AgentKey; lib/threadSettings: fills cutex's resume snapshot gap). */
const lastCollabMode = new Map<string, NonNullable<ThreadSettingsView["collaborationMode"]>>();
/** expectApprovalsReviewer: reviewer still to set on a new thread (hostKey → reviewer). */
const pendingReviewers = new Map<string, ApprovalsReviewer>();
/**
 * Last context usage (`thread/tokenUsage/updated`) per agent (AgentKey) seen on its host's feed, so a
 * re-bootstrap keeps the composer's context ring: thread/read has none and runtimes only report it
 * after a model request. In memory only (the kept 进程 snapshot is lib/planCache).
 */
const lastContext = new Map<string, NonNullable<ReturnType<typeof contextUsageOf>>>();
/** Entries of one host in a map keyed by AgentKey (lib/hostKeys hostKey). */
function dropHostEntries(map: Map<string, unknown>, hostId: string): void {
  const prefix = JSON.stringify([hostId]).slice(0, -1) + ",";
  for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
}
/** Turns interrupted by "interrupt & send": their unread steers are re-sent, not restored. */
const resendTurns = new Set<string>();
/** Order stamps for outbox confirmations vs. queue lists (lib/outbox). */
let outboxTick = 0;
/** Per-agent chain of submits, so optimistic sends reach cutex in the order they were made. */
const sendChains = new Map<string, Promise<unknown>>();
/** Sends already reported by the outbox-linger diagnostic (bounded). */
const lingerReported = new Set<string>();
const logSendTrace = (record: SendTraceRecord) => bridge.shell?.logError({ kind: "reported", message: JSON.stringify(record) });
/**
 * Sends whose request had left when their host was switched away and that then failed: host →
 * agent → failed entries. Shown again on that host (failed, same clientUserMessageId: retry is
 * deduped by cutex, and reconcileOutbox drops the row if the message did land). Never re-sent or
 * turned into a new-id draft automatically. Small and bounded; removed hosts are forgotten.
 */
const orphanedSends = new Map<string, Map<string, OutboxEntry[]>>();
const ORPHANED_SENDS_PER_HOST = 20;
function stashOrphanedSend(host: string, sessionId: string, entry: OutboxEntry): void {
  const byAgent = orphanedSends.get(host) ?? new Map<string, OutboxEntry[]>();
  orphanedSends.set(host, byAgent);
  byAgent.set(sessionId, [...(byAgent.get(sessionId) ?? []).filter((e) => e.id !== entry.id), entry]);
  let count = [...byAgent.values()].reduce((n, list) => n + list.length, 0);
  for (const [agent, list] of byAgent) {
    if (count <= ORPHANED_SENDS_PER_HOST) break;
    const keep = list.slice(Math.min(list.length, count - ORPHANED_SENDS_PER_HOST));
    count -= list.length - keep.length;
    if (keep.length) byAgent.set(agent, keep);
    else byAgent.delete(agent);
  }
}
function mergeOrphans(outbox: Record<string, OutboxEntry[]>, restored: Record<string, OutboxEntry[]>): Record<string, OutboxEntry[]> {
  const next = { ...outbox };
  for (const [agent, list] of Object.entries(restored)) next[agent] = [...(next[agent] ?? []).filter((e) => !list.some((r) => r.id === e.id)), ...list];
  return next;
}
function takeOrphanedSends(host: string): Record<string, OutboxEntry[]> {
  const byAgent = orphanedSends.get(host);
  orphanedSends.delete(host);
  return byAgent ? Object.fromEntries(byAgent) : {};
}

// Host-event driven sidebar reloads: first 400 ms after an event, then at most every 2 s.
let sidebarRefresh: CoalescedRefresh | null = null;
/** The same for the connected hosts outside the scope (their slices). */
const backgroundRefresh = new Map<string, CoalescedRefresh>();
/** Per host: running turns and whether the owner wrote into them (notification events turn.owner.* / turn.other.*). */
const turnTriggers = new Map<string, TurnTriggerState>();
/** Agent and project ids of a sidebar snapshot (lib/hostKeys claims), plus the sidebar's own group ids. */
function snapshotIds(snapshot: SidebarSnapshot): Set<string> {
  // 独立智能体 / 快速会话 / 其他项目 folds etc. stored before host keys: the first host that loads
  // claims them (otherwise never claimed, they would be dropped with the legacy entries).
  const ids = new Set<string>(SIDEBAR_GROUP_IDS);
  for (const s of [...snapshot.active, ...snapshot.retired]) ids.add(s.cutexSessionId);
  for (const p of snapshot.projects?.projects ?? []) ids.add(p.project_id);
  return ids;
}
/** A sidebar snapshot as the app keeps it (archived defaults, untitled quick chats named). */
function preparedSidebar(snapshot: SidebarSnapshot): SidebarSnapshot {
  const sidebar = { ...snapshot, retired: snapshot.retired.map(withRetiredDefaults) };
  for (const s of [...sidebar.active, ...sidebar.retired]) {
    const untitled = untitledChatName(s, translate("chat.untitled"));
    if (untitled) s.displayName = untitled;
  }
  return sidebar;
}
/**
 * Host of each agent view the store holds (`sessions`; multi-host P1: an agent of any host in the scope
 * can be open). Views are keyed by session id: an agent of another host with the same id replaces the
 * view (select). Missing = the focus host.
 */
const sessionHosts = new Map<string, string>();
function sessionHostOf(sessionId: string, focus: string): string {
  return sessionHosts.get(sessionId) ?? focus;
}
let lastProjectKey: string | null = null;
let initialized = false;
// Activity updates arrive per streamed delta across all agents; batch them per animation frame.
let pendingActivity: Record<string, ActivityPreview> | null = null;

export const useApp = create<AppState>((set, get) => {
  // A → B → A is still a different operation lifetime. Host IDs alone cannot fence it.
  let hostEpoch = 0;
  let pendingChatRun: object | null = null;
  // Operations on the focus host's state (select / send / steer / queue / revert …): they end with the
  // focus (another host shown, or its connection replaced). Hosts outside the scope reconnecting do not
  // matter (multi-host RFC §6.2; their slices have their own epoch).
  // An agent of another host in the scope (multi-host P1) is that host's: its operations also end
  // when that host's connection is replaced or closed.
  const captureHost = (hostId?: string) => {
    const focus = focusHost();
    const host = hostId ?? focus;
    const epoch = hostEpoch;
    const conn = host === focus ? null : connEpochOf(get().hosts, host);
    return { host, current: () => epoch === hostEpoch && focus === focusHost() && (host === focus || (conn !== null && connEpochOf(get().hosts, host) === conn)) };
  };
  const focusHost = () => get().hosts?.active ?? "local";
  /** The host of an agent's view (the focus host unless it was opened from another host). */
  const hostOf = (sessionId: string) => sessionHostOf(sessionId, focusHost());
  /** Calls about an agent go to its host (the focus api for the focus host: focus-fenced as before). */
  const apiOf = (sessionId: string): DaemonApi => apiOn(hostOf(sessionId));
  const apiOn = (hostId: string): DaemonApi => (hostId === focusHost() ? api : apiFor(hostId));
  /** The agent's own operation fence (its host's connection). */
  const captureSession = (sessionId: string) => captureHost(hostOf(sessionId));
  const sidebarOn = (hostId: string) => sidebarOf(get(), hostId);
  const featuresOn = (hostId: string) => featuresOf(get(), hostId);
  const resourceOf = (sessionId: string, host = hostOf(sessionId)) => {
    const sidebar = sidebarOn(host);
    return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === sessionId);
  };
  /** Whether a host's sidebar snapshot lists an agent (active or archived); null = no snapshot of it. */
  const listsAgent = (hostId: string, sessionId: string): boolean | null => {
    const sidebar = sidebarOn(hostId);
    return sidebar ? [...sidebar.active, ...sidebar.retired].some((r) => r.cutexSessionId === sessionId) : null;
  };
  /** The host to open an agent on (lib/agentHostRoute): `preferred` unless only another host of the scope lists it. */
  const agentHostFor = (sessionId: string, preferred: string, tieBreak?: string): string => {
    const hosts = get().hosts;
    return routeAgentHost(preferred, [focusHost(), ...(hosts?.scope ? scopeHosts(hosts) : [])], (h) => listsAgent(h, sessionId), tieBreak);
  };
  /** Re-read the sidebar of a host (the focus host's, or a followed host's slice). */
  const refreshHostSidebar = (hostId: string) => (hostId === focusHost() ? get().refreshSidebar() : refreshSliceSidebar(hostId));
  // Sidebar requests can overlap during reconnect and runtime events. A late, older reply must
  // not put an already-online agent back into the offline group.
  const sidebarReads = new Map<string, { issued: number; applied: number }>();
  const beginSidebarRead = (host: string) => {
    let reads = sidebarReads.get(host);
    if (!reads) sidebarReads.set(host, (reads = { issued: 0, applied: 0 }));
    const state = reads;
    const read = ++state.issued;
    return () => {
      if (read < state.applied) return false;
      // Accept progress while a newer read is pending (or fails), even on a slow host.
      state.applied = read;
      return true;
    };
  };
  const reconcileStartErrors = (host: string, sidebar: SidebarSnapshot) => {
    for (const resource of sidebar.active) {
      const id = resource.cutexSessionId;
      const view = get().sessions[id];
      if (hostOf(id) !== host || !view?.startError) continue;
      const runtime = resource.runtime;
      if (runtime.status === "online" && runtime.appServerConnected !== false && runtime.runtimeGeneration >= view.runtimeGeneration)
        patchSession(id, { startError: null, startErrorQueueIds: undefined });
    }
  };
  const startPendingChat = () => {
    const scope = captureHost();
    const run = {};
    pendingChatRun = run;
    void createPendingChat(
      () => scope.current() && pendingChatRun === run,
      () => { if (pendingChatRun === run) pendingChatRun = null; },
    );
  };
  type HostOperation = ReturnType<typeof captureHost>;
  const staleHost = () => new DOMException("Host changed before this operation completed", "AbortError");
  const restoreUnsent = (scope: HostOperation, sessionId: string, text: string, extra: unknown[]) => {
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      if (text.trim() || extra.length) insertComposerDraft(scope.host, sessionId, text, "append", extra);
    };
  };
  const patchSession = (id: string, patch: Partial<SessionView> | ((v: SessionView) => Partial<SessionView>)) =>
    set((state) => {
      const current = state.sessions[id];
      if (!current) return state;
      const next = typeof patch === "function" ? patch(current) : patch;
      return { sessions: { ...state.sessions, [id]: { ...current, ...next } } };
    });

  /**
   * Keep one handled-interaction row in the timeline (lib/interactionLog): the record store first
   * (upsert rules there), then the row into the live view's timeline. No view (agent not open):
   * the record alone; load() seeds it when the agent is opened again this run.
   */
  const putInteraction = (sessionId: string, record: InteractionRecord) => {
    if (!putRecord(sessionId, record)) return;
    const view = get().sessions[sessionId];
    if (view && insertInteraction(view.timeline, record)) patchSession(sessionId, (v) => ({ version: v.version + 1 }));
  };

  const refreshQueue = (sessionId: string) => {
    const scope = captureSession(sessionId);
    clearTimeout(queueTimers.get(sessionId));
    queueTimers.set(
      sessionId,
      setTimeout(async () => {
        if (!scope.current()) return;
        try {
          const tick = ++outboxTick;
          const startError = get().sessions[sessionId]?.startError;
          const failedIds = get().sessions[sessionId]?.startErrorQueueIds;
          const { items, pause, asksPaused, admission } = await apiOn(scope.host).queueList(sessionId);
          if (!scope.current()) return;
          patchSession(sessionId, (v) => ({
            queue: [...items].sort((a, b) => a.position - b.position), queuePause: pause ?? null, asksPaused: asksPaused ?? null, admission: admission ?? null,
            // Removed, sent, or replaced: never claim these inputs are still queued.
            ...(v.startError === startError && v.startErrorQueueIds === failedIds
              && (!items.length || (failedIds && !items.some((item) => failedIds.includes(item.queueId))))
              ? { startError: null, startErrorQueueIds: undefined } : {}),
          }));
          settleOutbox(sessionId, tick);
        } catch {
          // transient; next event retries
        }
      }, 100),
    );
  };

  const setSteers = (sessionId: string, update: (list: PendingSteer[]) => PendingSteer[]) =>
    set((state) => ({ pendingSteers: { ...state.pendingSteers, [sessionId]: update(state.pendingSteers[sessionId] ?? []) } }));

  // ---------- optimistic sends (lib/outbox) ----------
  const setOutbox = (sessionId: string, update: (list: OutboxEntry[]) => OutboxEntry[]) => {
    const before = get().outbox[sessionId] ?? [];
    set((state) => {
      const list = state.outbox[sessionId] ?? [];
      const next = update(list);
      return next === list ? state : { outbox: { ...state.outbox, [sessionId]: next } };
    });
    const after = get().outbox[sessionId] ?? [];
    if (after !== before) watchOutbox(sessionId, before, after);
  };

  /** One outbox-linger record per send visible > 3 s (lib/outboxDiagnostics): when it leaves, or at 30 s. */
  const reportLinger = (sessionId: string, entry: OutboxEntry, outcome: "left" | "visible") => {
    if (lingerReported.has(entry.id)) return;
    const record = outboxLingerRecord(sessionId, entry, get().sessions[sessionId]?.timeline ?? null, Date.now(), outcome);
    if (!record) return;
    lingerReported.add(entry.id);
    if (lingerReported.size > 500) lingerReported.delete(lingerReported.values().next().value!);
    try { void Promise.resolve(bridge.shell?.logError({ kind: "reported", message: JSON.stringify(record) })).catch(() => {}); } catch { /* best effort */ }
  };
  const watchOutbox = (sessionId: string, before: readonly OutboxEntry[], after: readonly OutboxEntry[]) => {
    const now = new Set(after.map((e) => e.id));
    const was = new Set(before.map((e) => e.id));
    for (const e of before) if (!now.has(e.id)) reportLinger(sessionId, e, "left");
    for (const e of after) {
      if (was.has(e.id)) continue;
      setTimeout(() => {
        const current = get().outbox[sessionId]?.find((x) => x.id === e.id);
        if (current) reportLinger(sessionId, current, "visible");
      }, OUTBOX_STUCK_MS);
    }
  };

  /** Drop sends whose cutex item is visible now; `queueTick`: the queue list just applied (+ unhide rows it no longer has). */
  const settleOutbox = (sessionId: string, queueTick: number | null = null) => {
    const view = get().sessions[sessionId];
    if (!view) return;
    setOutbox(sessionId, (list) => reconcileOutbox(list, view.timeline, view.queue, queueTick));
    const hidden = get().queueHidden[sessionId];
    if (queueTick !== null && hidden?.length) {
      const kept = pruneHidden(hidden, view.queue);
      if (kept !== hidden) set((state) => ({ queueHidden: { ...state.queueHidden, [sessionId]: kept } }));
    }
  };

  const hideQueued = (sessionId: string, queueIds: string[], show = false) =>
    set((state) => {
      const current = state.queueHidden[sessionId] ?? [];
      const next = show ? current.filter((id) => !queueIds.includes(id)) : [...current, ...queueIds.filter((id) => !current.includes(id))];
      // A confirmed send shown from the submit response is hidden with its outbox entry gone.
      const outbox = show ? state.outbox : { ...state.outbox, [sessionId]: (state.outbox[sessionId] ?? []).filter((e) => !e.queueItem || !queueIds.includes(e.queueItem.queueId)) };
      return { queueHidden: { ...state.queueHidden, [sessionId]: next }, outbox };
    });

  /** Where a send will land on this agent now (an unlanded new-turn send counts as busy). */
  const placementFor = (sessionId: string, strategy: SubmitStrategy, offlineQueued: boolean) => {
    const view = get().sessions[sessionId];
    const resource = sidebarOn(hostOf(sessionId))?.active.find((s) => s.cutexSessionId === sessionId);
    const busy = !!view?.timeline.activeTurnId || hasUnlandedTurn(get().outbox[sessionId]);
    return predictPlacement(strategy, busy, { offlineQueued, noSteer: lacks(agentFeaturesOf(resource), "turnSteer") });
  };

  /**
   * Submit an outbox entry (already shown) after the agent's earlier sends; on the response it is
   * confirmed / handed over to the pending-steer row, on failure marked failed (or dropped).
   */
  const dispatchSend = (sessionId: string, entry: OutboxEntry, keepFailed = true, scope = captureSession(sessionId), cancelled = restoreUnsent(scope, sessionId, entry.text, entry.extra)): Promise<UserInputSubmitResult | null> => {
    const trace = { hostId: scope.host, sessionId, clientUserMessageId: entry.id };
    const previous = sendChains.get(sessionId);
    if (previous) setOutbox(sessionId, (list) => markOutboxWaiting(list, entry.id, true));
    const run = async () => {
      // Earlier submits may keep this callback queued past a host switch.
      if (!scope.current()) { cancelled(); throw staleHost(); }
      setOutbox(sessionId, (list) => markOutboxDispatched(list, entry.id));
      let answered = false;
      try {
        const result = await traceSendStage({ ...trace, stage: "ipc-submit" }, logSendTrace,
          () => apiOn(scope.host).submit(sessionId, entry.text, entry.strategy, entry.startIfOffline, { extra: entry.extra as ExtraInput[], clientUserMessageId: entry.id }));
        answered = true;
        // The request already left: acceptance may be unknown. Never make a new draft copy.
        if (!scope.current()) throw staleHost();
        setOutbox(sessionId, (list) => confirmOutbox(list, entry.id, result, ++outboxTick));
        trackSteer(sessionId, result, entry.id, entry.text, entry.extra);
        settleOutbox(sessionId);
        if (result?.disposition === "queued") refreshQueue(sessionId);
        // queue-idle-start: the item waits behind a stop's pause (older cutex: no `paused` field).
        if (submitLandedPaused(result)) get().notify(translate("queue.addedToPaused"));
        return result;
      } catch (e) {
        const message = sendErrorText(e, () => translate("outbox.capacityExceeded"), (code) => translate(`users.access.${code}`));
        if (!scope.current()) {
          // The text must not vanish: keep it as a failed row of its own host (same id, see
          // orphanedSends); already back on that host (A → B → A) → show it now.
          if (keepFailed && !answered) {
            stashOrphanedSend(scope.host, sessionId, { ...entry, state: "failed", error: message, queueItem: undefined, confirmedTick: undefined });
            if ((get().hosts?.active ?? "local") === scope.host) {
              const restored = takeOrphanedSends(scope.host);
              set((state) => ({ outbox: mergeOrphans(state.outbox, restored) }));
            }
          }
          throw staleHost();
        }
        setOutbox(sessionId, (list) => (keepFailed ? failOutbox(list, entry.id, message) : removeOutbox(list, entry.id)));
        throw e;
      }
    };
    const next = traceSendStage({ ...trace, stage: "chain-wait" }, logSendTrace, () => previous ?? Promise.resolve()).then(run);
    const tail = next.then(() => {}, () => {});
    sendChains.set(sessionId, tail);
    void tail.then(() => { if (sendChains.get(sessionId) === tail) sendChains.delete(sessionId); });
    return next;
  };

  /** A "steered" submit waits in the queue panel until the native records it (lib/pendingSteers). */
  const trackSteer = (sessionId: string, result: UserInputSubmitResult | null, clientUserMessageId: string, text: string, extra: unknown[]) => {
    const view = get().sessions[sessionId];
    if (result?.disposition !== "steered" || !view) return;
    const images = (extra as { type?: string }[]).filter((x) => x.type === "image" || x.type === "localImage").length;
    const pending = { ...newPendingSteer(view.timeline, clientUserMessageId, text, images, result.turnId ?? null), extra };
    // The item may already have arrived while the request was in flight.
    const before = (get().pendingSteers[sessionId] ?? []).filter((p) => p.id !== clientUserMessageId);
    settleSteers(sessionId, settlePendingSteers([...before, pending], view.timeline), null);
  };

  /** Apply a settlement; steers whose turn ended unrecorded are re-checked against the history. */
  const settleSteers = (sessionId: string, settled: SteerSettlement, previous: PendingSteer[] | null) => {
    if (settled.pending !== previous) set((state) => ({ pendingSteers: { ...state.pendingSteers, [sessionId]: settled.pending } }));
    if (settled.lost.length) void verifyLostSteers(sessionId, settled.lost);
  };

  /**
   * Safeguard for steers whose turn ended without their userMessage in the live timeline: re-read
   * the recorded history (thread/read via bootstrap; a missed event is not a lost steer). Recorded →
   * gone from the panel. Not recorded → the native dropped it: re-sent when "interrupt & send" asked
   * for that turn, else shown as undelivered with resend / dismiss. Never dropped silently.
   */
  const verifyLostSteers = async (sessionId: string, lost: PendingSteer[]) => {
    const scope = captureSession(sessionId);
    const ids = new Set(lost.map((p) => p.id));
    let recorded = new Set<string>();
    try {
      const boot = await apiOn(scope.host).bootstrap(sessionId, STEER_CHECK_TURNS);
      if (!scope.current()) return;
      if (boot.native) recorded = recordedSteers(lost, timelineFromThreadRead(boot.native.result));
    } catch {
      // unreadable: treat as not recorded (the user can resend; cutex dedupes the same id)
    }
    if (!scope.current()) return;
    const missing = lost.filter((p) => !recorded.has(p.id));
    const resend = missing.filter((p) => !!p.turnId && resendTurns.has(p.turnId));
    for (const p of resend) resendTurns.delete(p.turnId!);
    const resendIds = new Set(resend.map((p) => p.id));
    setSteers(sessionId, (list) => resolveChecked(list, ids, new Set([...recorded, ...resendIds]), "undelivered"));
    const undelivered = missing.length - resend.length;
    if (undelivered > 0) get().notify(translate("steer.undeliveredNotice", { n: undelivered }), "error");
    if (resend.length) await sendMergedSteers(sessionId, resend);
  };

  /**
   * "Interrupt & send" (like the TUI's Esc with pending steers): the dropped steers, merged in send
   * order into one message, start the next turn. Sent once: the turn's resend mark is consumed
   * above, and only steers the history re-check did not find are included.
   */
  const sendMergedSteers = async (sessionId: string, steers: PendingSteer[], tail: { text: string; extra: unknown[] } | null = null, outboxId?: string, scope = captureSession(sessionId), cancelled: () => void = () => {}): Promise<boolean> => {
    if (!scope.current()) { cancelled?.(); return false; }
    const text = interruptSendText(steers, tail?.text ?? "");
    const extra = [...steers.flatMap((p) => p.extra ?? []), ...(tail?.extra ?? [])];
    if (!text && extra.length === 0) {
      if (outboxId) setOutbox(sessionId, (list) => removeOutbox(list, outboxId));
      return true;
    }
    // Optimistic: one pending message (lib/outbox); a failure keeps it there with retry / edit / discard.
    const shown = outboxId ? get().outbox[sessionId]?.find((e) => e.id === outboxId) : undefined;
    let entry: OutboxEntry;
    if (shown) {
      setOutbox(sessionId, (list) => updateOutbox(list, shown.id, { text, extra }));
      entry = { ...shown, text, extra };
    } else {
      entry = newOutboxEntry(get().sessions[sessionId]?.timeline ?? null, { id: crypto.randomUUID(), text, extra, strategy: "auto", placement: placementFor(sessionId, "auto", false) });
      setOutbox(sessionId, (list) => [...list, entry]);
    }
    try {
      await dispatchSend(sessionId, entry, true, scope, cancelled);
      return true;
    } catch {
      return false;
    }
  };

  /** The selected agent's paused section (lib/queuePause). */
  const pausedOf = (sessionId: string) => {
    const view = get().sessions[sessionId];
    return pausedSection(get().pendingSteers[sessionId] ?? [], view?.queue ?? [], view?.queuePause ?? null, !!get().queueHandoff[sessionId]);
  };

  /** Remove queued items at their revision; returns the ones actually removed. */
  const removeQueued = async (sessionId: string, items: QueueItem[]) => {
    // Rows leave the panel at once; the removals go out together (one round trip, not one each).
    hideQueued(sessionId, items.map((i) => i.queueId));
    const results = await Promise.allSettled(items.map((item) => apiOf(sessionId).queueRemove(sessionId, item.queueId, item.revision)));
    const removed = items.filter((_, i) => results[i]!.status === "fulfilled");
    // Changed, flushed or already removed meanwhile: shown again until cutex's list says otherwise.
    const failed = items.filter((_, i) => results[i]!.status === "rejected");
    if (failed.length) hideQueued(sessionId, failed.map((i) => i.queueId), true);
    refreshQueue(sessionId);
    return removed;
  };

  /**
   * (Re)send a steer under its own clientUserMessageId: cutex answers "deduplicated" if the thread
   * already has it, so a text is never recorded twice. Failure → back to undelivered.
   */
  const sendSteerAgain = async (sessionId: string, p: PendingSteer) => {
    const scope = captureSession(sessionId);
    try {
      const result = await apiOn(scope.host).submit(sessionId, p.text, "auto", false, { extra: (p.extra ?? []) as ExtraInput[], clientUserMessageId: p.id });
      if (!scope.current()) return;
      trackSteer(sessionId, result, p.id, p.text, p.extra ?? []);
    } catch (e) {
      if (!scope.current()) return;
      setSteers(sessionId, (list) => [...list.filter((x) => x.id !== p.id), { ...p, state: "undelivered" }]);
      get().notify(sendErrorText(e, () => translate("outbox.capacityExceeded"), (code) => translate(`users.access.${code}`)), "error");
    }
  };

  /**
   * `cutex/session/history/revert` from `beforeTurnId` on (live runtime, no restart), then re-read
   * the thread so the timeline drops the reverted turns. `after` runs once cutex accepted it.
   */
  const revertAndReload = async (sessionId: string, beforeTurnId: string, after?: () => void) => {
    const host = hostOf(sessionId);
    const resource = sidebarOn(host)?.active.find((r) => r.cutexSessionId === sessionId);
    if (!resource) throw new Error(`unknown session ${sessionId}`);
    const shown = get().sessions[sessionId]?.timeline;
    await apiOn(host).revertHistory(sessionId, beforeTurnId, resource.revision);
    // A kept 进程 of a reverted turn goes with it (cutex's latestPlan is trimmed the same way).
    const kept = getCachedPlan(host, sessionId);
    if (kept && shown && kept.threadId === shown.threadId && revertDropsPlan(kept.turnId, shown.turns.map((t) => t.id), beforeTurnId)) setCachedPlan(host, sessionId, null);
    after?.();
    await refreshHostSidebar(host);
    if (get().selectedId === sessionId && hostOf(sessionId) === host) {
      await apiOn(host).unsubscribe(sessionId);
      set((state) => ({ sessions: { ...state.sessions, [sessionId]: newView() } }));
      await load(sessionId);
    }
  };

  /**
   * A rebuilt timeline's 进程: the kept snapshot (lib/planCache) or cutex `latestPlan`, whichever is
   * newer (lib/planState.bootPlan); a kept one whose turn is known reverted is dropped. The result is
   * kept again (it survives restarts).
   */
  const seedKeptPlan = (host: string, sessionId: string, timeline: TimelineState, previous: TimelineState | undefined, latest: LatestPlan | null | undefined, olderUnloaded: boolean) => {
    if (!timeline.threadId) return;
    const turns = timeline.turns.map((t) => t.id);
    let cached = getCachedPlan(host, sessionId);
    if (cached && previous?.threadId === timeline.threadId && planTurnGone(cached.turnId, previous.turns.map((t) => t.id), turns, olderUnloaded)) cached = null;
    const plan = bootPlan({ threadId: timeline.threadId, turns, olderUnloaded, cached, cachedFresh: isPlanFresh(host, sessionId), latest: planFromLatest(latest) });
    seedPlan(timeline, plan);
    setCachedPlan(host, sessionId, plan);
  };

  /**
   * An archived agent: cutex has no bootstrap or feed for it, only the stored thread
   * (`GET /v2/sessions/{id}/history`, offline-history). Read-only; nothing is subscribed.
   */
  const loadArchived = async (sessionId: string, pageSize: number | undefined, scope: HostOperation) => {
    const history = featuresOn(scope.host).has("offline-history") ? await apiOn(scope.host).history(sessionId, null, pageSize ?? MAX_PAGE_TURNS) : null;
    if (!scope.current()) return;
    const timeline = history ? timelineFromThreadRead(history.native.result, []) : emptyTimeline();
    seedContextUsage(timeline, contextUsageFromLatest(history?.cutexState?.latestTokenUsage));
    const older = olderFromPage(history?.page);
    seedKeptPlan(scope.host, sessionId, timeline, undefined, history?.cutexState?.latestPlan, !!older?.cursor);
    patchSession(sessionId, (v) => ({
      loading: false,
      error: null,
      resyncing: false,
      timeline,
      queue: [],
      queuePause: null,
      asksPaused: null,
      admission: null,
      version: v.version + 1,
      historySource: "archived",
      startError: null,
      startErrorQueueIds: undefined,
      older,
    }));
  };

  /**
   * A reviewer expected for this new thread (older cutex: not in the create `launch`): set once the
   * view loaded with a live native. Failure keeps it for the next load; the native's
   * thread/settings/updated refreshes the shown mode.
   */
  const applyPendingReviewer = (sessionId: string, agent: string, timeline: TimelineState | null, daemon: { updateThreadSettings(sessionId: string, threadId: string, patch: Record<string, unknown>): Promise<unknown> }) => {
    const wanted = pendingReviewers.get(agent);
    if (!wanted || !timeline?.threadId) return;
    if (timeline.settings?.approvalsReviewer === wanted) {
      pendingReviewers.delete(agent);
      return;
    }
    daemon.updateThreadSettings(sessionId, timeline.threadId, { approvalsReviewer: wanted }).then(
      () => { if (pendingReviewers.get(agent) === wanted) pendingReviewers.delete(agent); },
      () => {},
    );
  };

  const load = async (sessionId: string) => {
    const scope = captureSession(sessionId);
    const daemon = apiOn(scope.host);
    // What was shown before (resync / re-open): tells a reverted plan turn from one not loaded yet.
    const previous = get().sessions[sessionId]?.timeline;
    const bootTick = ++outboxTick;
    try {
      // History pages: only the newest turns (a cutex without history-pages ignores turnLimit and
      // sends every turn, without historyPage); older ones as the user scrolls up (loadOlder).
      const pageSize = historyPageSize(getUiPrefs().timelineTurns);
      if (isArchived(sidebarOn(scope.host)?.retired.find((s) => s.cutexSessionId === sessionId))) return await loadArchived(sessionId, pageSize, scope);
      const boot = await daemon.bootstrap(sessionId, pageSize);
      if (!scope.current()) return;
      // Offline runtime: fall back to stored history (read-only reader on the daemon side).
      const history = !boot.native && featuresOn(scope.host).has("offline-history") ? await daemon.history(sessionId, null, pageSize ?? MAX_PAGE_TURNS).catch(() => null) : null;
      if (!scope.current()) return;
      const older = olderFromPage(boot.native ? boot.historyPage : history?.page);
      const timeline = boot.native
        ? timelineFromThreadRead(boot.native.result, boot.cutexState.pendingServerRequests)
        : history
          ? timelineFromThreadRead(history.native.result, [])
          : emptyTimeline();
      // Seed live settings from the session resource; thread/settings/updated keeps them fresh.
      const sidebar = sidebarOn(scope.host);
      const resource = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === sessionId);
      const agent = hostKey(scope.host, sessionId);
      timeline.settings = seedThreadSettings(resource?.runtime.threadSettings as ThreadSettingsView | null | undefined, lastCollabMode.get(agent));
      const seededMode = collaborationModeOf(timeline.settings);
      if (seededMode) lastCollabMode.set(agent, seededMode);
      // What this desktop saw live is at least as new; cutex recovers the rest from the rollout.
      if (!seedContextUsage(timeline, lastContext.get(agent)))
        seedContextUsage(timeline, contextUsageFromLatest(boot.cutexState.latestTokenUsage ?? history?.cutexState?.latestTokenUsage));
      seedKeptPlan(scope.host, sessionId, timeline, previous, boot.cutexState.latestPlan ?? history?.cutexState?.latestPlan, !!older?.cursor);
      // This run's handled-interaction rows go back into the rebuilt timeline (in-memory only:
      // cutex keeps no handled server requests — lib/interactionLog).
      seedInteractions(timeline, recordsOf(sessionId));
      patchSession(sessionId, (v) => ({
        loading: false,
        error: null,
        resyncing: false,
        runtimeGeneration: boot.cutexState.runtime.runtimeGeneration,
        timeline,
        queue: [...boot.cutexState.userInputQueue].sort((a, b) => a.position - b.position),
        queuePause: boot.cutexState.userInputQueuePause ?? null,
        asksPaused: boot.cutexState.asksPaused ?? null,
        version: v.version + 1,
        historySource: boot.native ? "live" : history ? "offline" : "live",
        startError: null,
        startErrorQueueIds: undefined,
        older,
      }));
      if (!scope.current()) return;
      applyPendingReviewer(sessionId, agent, boot.native ? timeline : null, daemon);
      settleOutbox(sessionId, bootTick);
      // admission-order: the bootstrap has the owner queue only; the merged order comes from queue/list.
      if (featuresOn(scope.host).has(ADMISSION_ORDER_FEATURE)) refreshQueue(sessionId);
      // Agent messages v2: pending incoming messages (待读留言) + the status of its sent ones (the
      // agent-messages store follows the focus host and the open agent's host).
      useAgentMessages.getState().seed(sessionId, boot.cutexState.agentBusMessages, boot.cutexState.agentBusSentMessages);
      // owner-notify: the agent's recent agent → owner messages (timeline cards).
      seedOwnerNotes(boot.cutexState.ownerNotifications, scope.host);
      if (!scope.current()) return;
      await daemon.subscribe(sessionId, { streamId: boot.checkpoint.streamId, after: boot.checkpoint.cursor });
      if (!scope.current()) return;
      // Goal is not part of thread/read; seed it once, then thread/goal/* events keep it fresh.
      if (boot.native && timeline.threadId && !lacks(agentFeaturesOf(resource), "goals")) {
        const threadId = timeline.threadId;
        daemon.threadGoal(sessionId, threadId).then(
          (goal) => {
            if (!scope.current()) return;
            const view = get().sessions[sessionId];
            if (!view || view.timeline.threadId !== threadId) return;
            view.timeline.goal = goal;
            patchSession(sessionId, (v) => ({ version: v.version + 1 }));
          },
          () => {}, // goals feature off / older runtime: no goal chip
        );
      }
    } catch (error) {
      if (!scope.current()) return;
      patchSession(sessionId, { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  /**
   * The app now shows another host, or the shown host's connection was replaced (main dropped that
   * connection's session feeds / watches / terminals): forget everything the shown host's views held.
   * Desktop-local prefs (pins, theme, UI prefs) stay; Settings stays open so the user sees the new
   * host's connection page. What the app follows of every connected host — host feed caches, turn
   * triggers, owner notes, the slices of hosts outside the scope — is per host (resetHost).
   */
  const resetForHostSwitch = () => {
    hostEpoch++;
    pendingChatRun = null;
    for (const timer of queueTimers.values()) clearTimeout(timer);
    queueTimers.clear();
    lastCollabMode.clear(); // seen on the shown host's session streams only
    resendTurns.clear();
    sendChains.clear();
    sidebarRefresh?.cancel();
    lastProjectKey = null;
    pendingActivity = null;
    fireHostSwitch();
    useDelegations.getState().reset();
    useJobs.getState().reset();
    useAgentMessages.getState().reset();
    sessionHosts.clear();
    const view = get().view;
    set(() => ({
      pinned: loadPinned(),
      sidebar: null,
      selectedId: null,
      selectedHost: null,
      sessions: {},
      activity: {},
      // Settings stays open (on the same tab) across a host switch; any other page closes.
      view: view.kind === "page" && view.page === SETTINGS_PAGE ? { kind: "page", page: SETTINGS_PAGE, params: { tab: view.params.tab } } : { kind: "conversation" },
      pendingSteers: {},
      outbox: takeOrphanedSends(get().hosts?.active ?? "local"),
      queueHidden: {},
      backgroundItems: {},
      collabModes: {},
      uiSignal: null,
      notice: null,
      settingsFocus: null,
      models: {},
      quotas: {},
      queueHandoff: {},
      creatingChat: false,
      pendingChat: null,
      subTimelines: {},
      subAgentLive: {},
      subAgentLiveGen: {},
      features: new Set(),
      featuresKnown: false,
      services: null,
      approvals: null,
    }));
    retainSessions([]);
  };

  /** A host's connection was replaced or closed, or the host removed: what the app followed of it goes. */
  const resetHost = (hostId: string) => {
    turnTriggers.delete(hostId);
    waitingByHost.delete(hostId);
    dropHostEntries(lastContext, hostId);
    dropHostEntries(lastCollabMode, hostId);
    forgetFreshPlans(hostId);
    backgroundRefresh.get(hostId)?.cancel();
    backgroundRefresh.delete(hostId);
    if (get().byHost[hostId]) set((state) => ({ byHost: withoutKey(state.byHost, hostId) }));
    forgetHostViews(hostId);
    fireHostReset(hostId);
  };

  /**
   * Views of agents of a host that is not the focus (multi-host P1) end with that host's connection or
   * when it leaves the scope: the selection is cleared (like a host switch) and its cached timelines go.
   * `unsubscribe`: the host stays connected, so its session feed is closed (after the host notification).
   */
  const forgetHostViews = (hostId: string, unsubscribe = false) => {
    if (hostId === focusHost()) return;
    const ids = [...sessionHosts].filter(([, h]) => h === hostId).map(([id]) => id);
    if (!ids.length) return;
    const selected = get().selectedHost === hostId ? get().selectedId : null;
    for (const id of ids) sessionHosts.delete(id);
    recentSessions = recentSessions.filter((id) => !ids.includes(id));
    if (selected && unsubscribe) afterHostsDelivered(() => void apiFor(hostId).unsubscribe(selected).catch(() => {}));
    set((state) => ({
      sessions: withoutKeys(state.sessions, ids),
      ...(selected ? { selectedId: null, selectedHost: null } : {}),
    }));
    retainSessions(Object.keys(get().sessions));
  };

  /** The shown host leaves the scope but stays connected: its summary becomes a slice (counts, notifications). */
  const stashFocus = (hostId: string, epoch: string) => {
    const s = get();
    const waiting = waitingRecord(hostId);
    for (const [id, view] of Object.entries(s.sessions)) if (view.timeline.pending.size) waiting[id] = [...new Set([...(waiting[id] ?? []), ...view.timeline.pending.keys()])];
    set({ byHost: { ...s.byHost, [hostId]: { epoch, daemon: s.daemon, features: s.features, featuresKnown: s.featuresKnown, sidebar: s.sidebar, approvals: s.approvals, services: s.services, waiting } } });
    // Left before its capabilities arrived: load the slice (a later connect event also does).
    if (s.daemon.kind === "connected" && !s.featuresKnown) void loadSlice(hostId, epoch);
  };

  /** The shown host is now `hosts.active`: take over its slice (if it was connected outside the scope) and load it. */
  const adoptFocus = (hosts: HostsState) => {
    const id = hosts.active;
    const epoch = connEpochOf(hosts, id);
    const slice = get().byHost[id];
    if (slice) set((state) => ({ byHost: withoutKey(state.byHost, id) }));
    const kept = slice && slice.epoch === epoch ? slice : null;
    if (kept) set({ sidebar: kept.sidebar, approvals: kept.approvals, services: kept.services, activity: activityOf(kept.sidebar, {}) });
    const daemon = kept?.daemon ?? hosts.hosts.find((h) => h.id === id)?.conn?.daemon;
    if (!daemon) return;
    set({ daemon });
    if (!kept && !(epoch && daemon.kind === "connected")) return;
    // Taken over while connected (it was followed outside the scope): no connect event will come.
    // Its features (they start the sub-stores' loads) and the refresh wait until this host
    // notification is delivered: calls made during the delivery are refused (preload, C-011).
    afterHostsDelivered(() => {
      const now = get().hosts;
      if (now?.active !== id || connEpochOf(now, id) !== epoch) return;
      if (kept) set({ features: kept.features, featuresKnown: kept.featuresKnown });
      if (epoch && get().daemon.kind === "connected") onFocusConnected();
    });
  };

  /** The shown host is connected (again): its sidebar, capabilities, services and approvals. */
  const onFocusConnected = () => {
    void get().refreshSidebar();
    const scope = captureHost();
    api.capabilities().then((c) => {
      if (!scope.current()) return;
      noteHostAccess(focusHost(), c);
      set({ features: hostFeatureSet(c), featuresKnown: true });
      // users: services and host approvals are owner-only (a non-owner connection gets 403).
      if (!userAccessOf(c).isOwner) return;
      void get().refreshServices();
      void get().refreshApprovals();
    }, () => {});
  };

  // ---------- connected hosts outside the scope (HostSlice) ----------

  /**
   * After the hostsState notification being handled: preload refuses daemon calls made while it
   * delivers one (bindings are set once every listener ran), so a listener's calls go out after it.
   */
  const afterHostsDelivered = (fn: () => void) => queueMicrotask(fn);

  const sliceCurrent = (hostId: string, epoch: string) => get().byHost[hostId]?.epoch === epoch;
  const patchSlice = (hostId: string, epoch: string, patch: Partial<HostSlice> | ((slice: HostSlice) => Partial<HostSlice>)) =>
    set((state) => {
      const slice = state.byHost[hostId];
      if (!slice || slice.epoch !== epoch) return state;
      return { byHost: { ...state.byHost, [hostId]: { ...slice, ...(typeof patch === "function" ? patch(slice) : patch) } } };
    });

  /** Follow every connected host the app does not show (new connections get a slice; gone ones lose it). */
  const syncSlices = (hosts: HostsState) => {
    const wanted = new Map(hosts.hosts.filter((h) => h.id !== hosts.active && h.conn?.epoch).map((h) => [h.id, h] as const));
    for (const id of Object.keys(get().byHost)) if (!wanted.has(id) || wanted.get(id)!.conn!.epoch !== get().byHost[id]!.epoch) set((state) => ({ byHost: withoutKey(state.byHost, id) }));
    for (const [id, host] of wanted) {
      if (get().byHost[id]) continue;
      const epoch = host.conn!.epoch!;
      set((state) => ({ byHost: { ...state.byHost, [id]: { epoch, daemon: host.conn!.daemon, features: new Set(), featuresKnown: false, sidebar: null, approvals: null, services: null, waiting: waitingRecord(id) } } }));
      // The snapshot's state may be older than the connection: ask (once the notification is delivered).
      afterHostsDelivered(() => {
        if (!sliceCurrent(id, epoch)) return;
        apiFor(id).daemonState().then((daemon) => {
          if (!sliceCurrent(id, epoch)) return;
          patchSlice(id, epoch, { daemon });
          if (daemon.kind === "connected") void loadSlice(id, epoch);
        }, () => {});
      });
    }
  };

  const loadSlice = async (hostId: string, epoch: string) => {
    // Never from inside a host notification's delivery (stashFocus): those calls are refused.
    await new Promise<void>((resolve) => afterHostsDelivered(resolve));
    if (!sliceCurrent(hostId, epoch)) return;
    const daemon = apiFor(hostId);
    const currentRead = beginSidebarRead(hostId);
    try {
      const [caps, snapshot] = await Promise.all([daemon.capabilities(), daemon.sidebar()]);
      if (!sliceCurrent(hostId, epoch)) return;
      noteHostAccess(hostId, caps);
      const features = hostFeatureSet(caps);
      patchSlice(hostId, epoch, { features, featuresKnown: true });
      if (currentRead()) {
        patchSlice(hostId, epoch, { sidebar: preparedSidebar(snapshot) });
        reconcileStartErrors(hostId, snapshot);
        claimHostIds(hostId, snapshotIds(snapshot));
      }
      // users: owner notes, host approvals and services are owner-only.
      if (!isOwnerFeatures(features)) return;
      void refreshPendingOwnerNotes(hostId);
      if (features.has(APPROVALS_FEATURE)) {
        const list = await daemon.approvals("pending");
        if (sliceCurrent(hostId, epoch)) patchSlice(hostId, epoch, { approvals: list ? sortApprovals(list.filter((a) => a.state === "pending")) : null });
      }
      if (features.has("services")) {
        const services = (await daemon.services()).services;
        if (sliceCurrent(hostId, epoch)) patchSlice(hostId, epoch, { services });
      }
    } catch {
      // unreachable meanwhile: its next connect retries
    }
  };

  const refreshSliceSidebar = async (hostId: string) => {
    const epoch = get().byHost[hostId]?.epoch;
    if (!epoch) return;
    const currentRead = beginSidebarRead(hostId);
    try {
      const snapshot = await apiFor(hostId).sidebar();
      if (!sliceCurrent(hostId, epoch) || !currentRead()) return;
      patchSlice(hostId, epoch, { sidebar: preparedSidebar(snapshot) });
      reconcileStartErrors(hostId, snapshot);
      claimHostIds(hostId, snapshotIds(snapshot));
    } catch {
      // its daemon state reports connectivity problems
    }
  };

  const onSliceDaemon = (hostId: string, epoch: string, daemon: DaemonState) => {
    if (!sliceCurrent(hostId, epoch)) return;
    patchSlice(hostId, epoch, { daemon });
    // Its host feed restarts from the live tail on reconnect: updates in the gap are unknown.
    if (daemon.kind !== "connected") forgetFreshPlans(hostId);
    else void loadSlice(hostId, epoch);
  };

  /** Agents of `hostId` waiting for the owner, from its host feed (serverRequest → resolved / turn end). */
  const trackWaiting = (hostId: string, envelope: EventEnvelope, turnEnded: boolean): boolean => {
    const native = envelope.native;
    const agent = envelope.cutexSessionId;
    const byAgent = waitingByHost.get(hostId) ?? new Map<string, Set<string>>();
    waitingByHost.set(hostId, byAgent);
    const before = byAgent.get(agent)?.size ?? 0;
    if (native?.kind === "serverRequest") {
      const id = (native.message as { id?: unknown }).id;
      if (typeof id === "string" || typeof id === "number") byAgent.set(agent, new Set([...(byAgent.get(agent) ?? []), String(id)]));
    } else if (native?.message.method === "serverRequest/resolved") {
      const requestId = (native.message.params as { requestId?: unknown } | undefined)?.requestId;
      byAgent.get(agent)?.delete(String(requestId));
    } else if (turnEnded) byAgent.delete(agent);
    if (byAgent.get(agent)?.size === 0) byAgent.delete(agent);
    return (byAgent.get(agent)?.size ?? 0) !== before;
  };

  /** Run `then` once the scope is 所有设备 (set here; main's host notification for it resets the view first). */
  const inAllDevices = (then: () => void) => {
    const isAll = () => get().hosts?.scope.kind === "all";
    if (isAll()) return then();
    void api.setScope({ kind: "all" }).then(() => {
      if (isAll()) return then();
      const off = useApp.subscribe(() => {
        if (!isAll()) return;
        off();
        clearTimeout(timer);
        // After that notification's delivery (and its re-selection, onHosts).
        afterHostsDelivered(then);
      });
      const timer = setTimeout(off, 5000);
    }, () => {});
  };

  /**
   * An approval of `hostId` (notification click): the 审批 page merges the scope's hosts, so a host in
   * the scope opens it at once; one outside it shows 所有设备 first (multi-host RFC §10, ★ Q14), then
   * the page (once main's host notification for the new scope arrived: it resets the view).
   */
  const openApprovalsOn = (hostId: string) => {
    const open = () => get().openPage("approvals.page");
    const hosts = get().hosts;
    if (!hosts || scopeHosts(hosts).includes(hostId)) return open();
    inAllDevices(open);
  };

  /** Host notification (main HostManager): scope / focus / connections changed, or only metadata. */
  const onHosts = (hosts: HostsState) => {
    const previous = get().hosts;
    const before = previous?.active ?? "local";
    setKeyFocus(hosts.active);
    set({ hosts });
    // Unsent drafts of a removed host go with it (lib/composerDrafts).
    const configured = [...hosts.hosts.map((h) => h.id), hosts.active];
    composerDrafts.retainHosts(configured);
    for (const host of orphanedSends.keys()) if (host !== "local" && !configured.includes(host)) orphanedSends.delete(host);
    // A host whose connection was replaced or closed (or the host removed) starts over: a fresh route for
    // the same ID (or a missed ABA observed by handshake) is a new operation lifetime. Mere metadata
    // updates with the same connection keep state intact.
    const changed = new Set<string>();
    if (previous) for (const id of new Set([...previous.hosts.map((h) => h.id), ...hosts.hosts.map((h) => h.id)])) if (connEpochOf(previous, id) !== connEpochOf(hosts, id)) changed.add(id);
    const focusMoved = before !== hosts.active || changed.has(hosts.active);
    // The open agent (multi-host P1: of any host in the scope). A scope change keeps it open while its
    // host stays connected and in the scope (Q13: a scope change only filters); one that left the scope
    // is closed (its feed too: main closes only the old focus host's views).
    const selected = get().selectedId;
    const selectedHost = get().selectedHost;
    const selectionLives = !!selected && !!selectedHost && !changed.has(selectedHost) && !!connEpochOf(hosts, selectedHost);
    const selectionShown = selectionLives && scopeHosts(hosts).includes(selectedHost!);
    if (selectionLives && !selectionShown) {
      if (!focusMoved) forgetHostViews(selectedHost!, true);
      else if (selectedHost !== before) afterHostsDelivered(() => void apiFor(selectedHost!).unsubscribe(selected!).catch(() => {}));
    }
    // Leaving a host that stays connected: keep following it outside the scope.
    const beforeEpoch = connEpochOf(hosts, before);
    if (previous && focusMoved && before !== hosts.active && beforeEpoch && !changed.has(before)) stashFocus(before, beforeEpoch);
    for (const id of changed) resetHost(id);
    if (focusMoved) {
      resetForHostSwitch();
      adoptFocus(hosts);
      // The focus moved (P0 rule) but the open agent is still in the scope: open it again, now from
      // its own host (focus api or apiFor), once the host notification is delivered.
      if (selectionShown)
        afterHostsDelivered(() => {
          const s = get();
          if (s.selectedId || s.view.kind !== "conversation" || connEpochOf(s.hosts, selectedHost!) !== connEpochOf(hosts, selectedHost!)) return;
          void s.select(selected!, selectedHost!);
        });
    }
    syncSlices(hosts);
  };

  return {
    daemon: { kind: "connecting", baseUrl: "" },
    hosts: null,
    byHost: {},
    async switchHost(hostId) {
      await api.switchHost(hostId);
    },
    sidebar: null,
    selectedId: null,
    selectedHost: null,
    sessions: {},
    pinned: loadPinned(),
    activity: {},
    view: { kind: "conversation" },

    togglePin(sessionId, hostId) {
      if (hostId && hostId !== focusHost()) {
        const pins = pinnedOn(hostId);
        if (!pins.delete(sessionId)) pins.add(sessionId);
        storePins(writeList(storedPins(), [...pins], hostId));
        // Other hosts' pins are read from storage (pinnedOn): a new set re-renders their rows.
        set((state) => ({ pinned: new Set(state.pinned) }));
        return;
      }
      set((state) => {
        const pinned = new Set(state.pinned);
        if (!pinned.delete(sessionId)) pinned.add(sessionId);
        savePinned(pinned);
        return { pinned };
      });
    },

    async sessionAction(sessionId, method, params = {}, hostId) {
      const scope = hostId ? captureHost(hostId) : captureSession(sessionId);
      const resource = resourceOf(sessionId, scope.host);
      if (!resource) throw new Error(`unknown session ${sessionId}`);
      // Runtime methods are fenced by generation only (cutex rejects expectedRevision there);
      // retire takes both, the rest take the session revision.
      // Fork takes neither (it only reads the source session).
      const runtime = method.startsWith("cutex/runtime/");
      const fenced = runtime || method === "cutex/session/retire";
      const unfenced = runtime || method === "cutex/session/fork" || method === MESSAGES_WAKE_METHOD;
      try {
        return await apiOn(scope.host).sessionAction(sessionId, method, {
          ...(unfenced ? {} : { expectedRevision: resource.revision }),
          ...(fenced ? { expectedRuntimeGeneration: resource.runtime.runtimeGeneration } : {}),
          ...params,
        });
      } finally {
        // A generation/revision conflict also means the cached resource needs refreshing. Do not
        // retry the mutation automatically: the owner may have stopped it on another device.
        if (scope.current()) await refreshHostSidebar(scope.host);
      }
    },

    async forkSession(sessionId, afterTurnId) {
      const host = hostOf(sessionId);
      const { cutexSessionId } = await apiOn(host).forkSession(sessionId, { afterTurnId });
      await refreshHostSidebar(host);
      await get().select(cutexSessionId, host);
      const s = sidebarOn(host)?.active.find((r) => r.cutexSessionId === cutexSessionId);
      get().notify(translate("fork.done", { name: s?.displayName ?? cutexSessionId }));
    },

    async revertTo(sessionId, beforeTurnId) {
      await revertAndReload(sessionId, beforeTurnId);
    },
    dismissPlan(sessionId) {
      const view = get().sessions[sessionId];
      const plan = dismissedPlan(view?.timeline.plan);
      if (!view || !plan || plan === view.timeline.plan) return;
      view.timeline.plan = plan;
      setCachedPlan(hostOf(sessionId), sessionId, plan);
      patchSession(sessionId, (v) => ({ version: v.version + 1 }));
    },

    async loadOlder(sessionId, opts) {
      const view = get().sessions[sessionId];
      const cursor = view?.older?.cursor;
      if (!view || !cursor || view.older?.loading) return;
      const timeline = view.timeline;
      // A reload (resync, revert, runtime online) replaces the timeline: drop a page that arrives late.
      const current = () => get().sessions[sessionId]?.timeline === timeline;
      patchSession(sessionId, (v) => ({ older: v.older && { ...v.older, loading: true, error: null } }));
      try {
        const page = opts?.read ? await opts.read(cursor) : await apiOf(sessionId).history(sessionId, cursor, opts?.limit ?? historyPageSize(getUiPrefs().timelineTurns) ?? MAX_PAGE_TURNS);
        if (!current()) return;
        if (!page) return patchSession(sessionId, (v) => ({ older: v.older && { ...v.older, loading: false, cursor: null } }));
        const added = prependHistory(timeline, page.native.result);
        patchSession(sessionId, (v) => ({ version: v.version + 1, older: olderAfterPage(v.older, page.page, added, cursor) }));
      } catch (e) {
        if (current()) patchSession(sessionId, (v) => ({ older: v.older && { ...v.older, loading: false, error: e instanceof Error ? e.message : String(e) } }));
      }
    },

    async completeTimeline(sessionId) {
      const view = get().sessions[sessionId];
      if (!view) return null;
      const full = cloneTimeline(view.timeline);
      let cursor = view.older?.cursor ?? null;
      for (let pages = 0; cursor && pages < 1000; pages++) {
        const page = await apiOf(sessionId).history(sessionId, cursor, MAX_PAGE_TURNS);
        if (!page) break;
        prependHistory(full, page.native.result);
        cursor = olderAfterPage(null, page.page, 0, cursor).cursor;
      }
      return full;
    },

    async deleteSession(sessionId, expectedRevision, hostId) {
      const scope = hostId ? captureHost(hostId) : captureSession(sessionId);
      const resource = resourceOf(sessionId, scope.host);
      // An agent the desktop doesn't list (hidden / temporary, e.g. one blocking a profile delete):
      // cutex resolves it by id and applies the delete to its current revision.
      const result = await apiOn(scope.host).deleteSession(sessionId, expectedRevision ?? resource?.revision);
      if (!result.ok || !scope.current()) return result;
      if (get().selectedId === sessionId && hostOf(sessionId) === scope.host) {
        void apiOn(scope.host).unsubscribe(sessionId);
        set({ selectedId: null, selectedHost: null });
      }
      await refreshHostSidebar(scope.host);
      return result;
    },

    features: new Set(),
    featuresKnown: false,
    approvals: null,
    async refreshApprovals() {
      if (!get().features.has(APPROVALS_FEATURE)) return set({ approvals: null });
      try {
        const list = await api.approvals("pending");
        set({ approvals: list ? sortApprovals(list.filter((a) => a.state === "pending")) : null });
      } catch {
        // keep the last list
      }
    },
    async decideApproval(approvalId, decision, note) {
      const result = await api.decideApproval(approvalId, decision, note);
      // Decided here, or already decided / gone elsewhere: either way not pending any more.
      if (result.ok || result.error.code === "approval_not_pending" || result.error.code === "approval_not_found") set({ approvals: withoutApproval(get().approvals, approvalId) });
      return result;
    },
    services: null,
    async refreshServices() {
      if (!get().features.has("services")) return;
      try {
        set({ services: (await api.services()).services });
      } catch {
        // keep the last list
      }
    },
    async editAndResend(sessionId, turnId, text) {
      const host = hostOf(sessionId);
      await revertAndReload(sessionId, turnId, () => insertComposerDraft(host, sessionId, text, "replace"));
    },

    subTimelines: {},
    setSubTimeline(threadId, timeline) {
      set((state) => ({ subTimelines: { ...state.subTimelines, [threadId]: { timeline, version: (state.subTimelines[threadId]?.version ?? 0) + 1 } } }));
    },
    subAgentLive: {},
    subAgentLiveGen: {},
    setSubAgentStatus(threadId, status, generation = 0) {
      const { subAgentLive, subAgentLiveGen } = get();
      const seen = subAgentLiveGen[threadId] ?? 0;
      // A read answered for an older runtime than the status we already have says nothing new.
      if (generation > 0 && generation < seen) return;
      const genChanged = generation > 0 && generation !== seen;
      if (subAgentLive[threadId] === status && !genChanged) return;
      set((state) => ({
        subAgentLive: state.subAgentLive[threadId] === status ? state.subAgentLive : { ...state.subAgentLive, [threadId]: status },
        ...(genChanged ? { subAgentLiveGen: { ...state.subAgentLiveGen, [threadId]: generation } } : {}),
      }));
    },
    insertIntoComposer(sessionId, text, mode = "replace", extra) {
      insertComposerDraft(hostOf(sessionId), sessionId, text, mode, extra);
    },

    openSettings(tab = "general", focus) {
      const sub = tab !== "profiles" ? {} : focus?.create ? { create: "1" } : focus?.profile ? { profile: focus.profile } : {};
      set({ view: { kind: "page", page: SETTINGS_PAGE, params: { tab, ...sub } }, settingsFocus: focus ?? null });
    },

    settingsFocus: null,
    uiSignal: null,
    signal(target, arg) {
      set({ uiSignal: { target, nonce: Date.now() + Math.random(), arg } });
    },
    notice: null,
    notify(text, tone = "info") {
      // "Not available for this agent" (a Claude agent without that Codex feature) is information.
      const feature = parseUnsupported(text);
      if (feature !== null) return set({ notice: { text: unsupportedNotice(feature), tone: "info", nonce: Date.now() + Math.random() } });
      set({ notice: { text, tone, nonce: Date.now() + Math.random() } });
    },

    pendingSteers: {},
    outbox: {},
    queueHidden: {},
    retrySend(sessionId, id) {
      const entry = get().outbox[sessionId]?.find((e) => e.id === id && e.state === "failed");
      if (!entry) return;
      // cutex "queue" never starts a turn on an idle agent: an idle agent gets it as a new turn.
      const busy = !!get().sessions[sessionId]?.timeline.activeTurnId;
      const strategy = entry.strategy === "queue" && !busy && !entry.startIfOffline ? "auto" : entry.strategy;
      const placement = placementFor(sessionId, strategy, entry.startIfOffline);
      setOutbox(sessionId, (list) => retryOutbox(list, id, strategy, placement));
      // A retry may already have been accepted under this ID; never clone it into a new draft.
      void dispatchSend(sessionId, { ...entry, strategy, placement }, true, captureSession(sessionId), () => {}).catch(() => {});
    },
    editSend(sessionId, id) {
      const entry = get().outbox[sessionId]?.find((e) => e.id === id && e.state === "failed");
      if (!entry) return;
      setOutbox(sessionId, (list) => removeOutbox(list, id));
      get().insertIntoComposer(sessionId, entry.text, "append", entry.extra.length ? entry.extra : undefined);
    },
    discardSend(sessionId, id) {
      setOutbox(sessionId, (list) => removeOutbox(list, id));
    },
    backgroundItems: {},
    setBackgroundItems(sessionId, itemIds) {
      const prev = get().backgroundItems[sessionId] ?? [];
      if (prev.length === itemIds.length && prev.every((x, i) => x === itemIds[i])) return;
      set((state) => ({ backgroundItems: { ...state.backgroundItems, [sessionId]: itemIds } }));
    },
    async resendSteer(id) {
      const sessionId = get().selectedId;
      const p = sessionId ? (get().pendingSteers[sessionId] ?? []).find((x) => x.id === id && x.state === "undelivered") : undefined;
      if (!sessionId || !p) return;
      setSteers(sessionId, (list) => list.filter((x) => x.id !== id));
      await sendSteerAgain(sessionId, p);
    },
    dismissSteer(id) {
      const sessionId = get().selectedId;
      if (sessionId) setSteers(sessionId, (list) => list.filter((x) => x.id !== id));
    },
    collabModes: {},
    async loadCollabModes() {
      const id = get().selectedId;
      if (!id || get().collabModes[id]) return;
      const scope = captureSession(id);
      try {
        const modes = await apiOn(scope.host).collaborationModes(id);
        if (!scope.current()) return;
        set((state) => ({ collabModes: { ...state.collabModes, [id]: modes } }));
      } catch {
        // offline / older runtime: no mode chip
      }
    },
    async setCollabMode(mode) {
      const id = get().selectedId;
      const scope = captureHost(id ? hostOf(id) : undefined);
      const settings = id ? get().sessions[id]?.timeline.settings : null;
      if (!id) return false;
      await get().loadCollabModes();
      if (!scope.current() || get().selectedId !== id) return null;
      const mask = (get().collabModes[id] ?? []).find((m) => m.mode === mode);
      if (!mask) return false;
      // Mask fields left null keep the thread's current model / effort (like the TUI). False when the
      // native did not take it (e.g. runtime offline): "执行计划" must not then submit, or the
      // resumed native — which restores the persisted Plan mode — would just plan again.
      return get().updateSettings({
        collaborationMode: {
          mode,
          settings: { model: mask.model ?? settings?.model ?? "", reasoning_effort: mask.reasoning_effort ?? settings?.effort ?? null, developer_instructions: null },
        },
      });
    },

    async setGoal(patch) {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      const threadId = view?.timeline.threadId;
      if (!id || !view || !threadId) return;
      const scope = captureSession(id);
      const goal = await apiOn(scope.host).setThreadGoal(id, threadId, patch);
      if (!scope.current() || get().sessions[id]?.timeline !== view.timeline) return;
      view.timeline.goal = goal;
      patchSession(id, (v) => ({ version: v.version + 1 }));
    },
    async replaceGoal(objective) {
      if (get().selectedId && get().sessions[get().selectedId!]?.timeline.goal) await get().clearGoal();
      await get().setGoal({ objective, status: "active" });
    },
    async clearGoal() {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      const threadId = view?.timeline.threadId;
      if (!id || !view || !threadId) return;
      await apiOf(id).clearThreadGoal(id, threadId);
      view.timeline.goal = null;
      patchSession(id, (v) => ({ version: v.version + 1 }));
    },
    async startReview(instructions) {
      const id = get().selectedId;
      const threadId = id ? get().sessions[id]?.timeline.threadId : null;
      if (!id || !threadId) return;
      await apiOf(id).startReview(id, threadId, instructions ? { type: "custom", instructions } : { type: "uncommittedChanges" });
    },
    async stopBackgroundTerminals() {
      const id = get().selectedId;
      const threadId = id ? get().sessions[id]?.timeline.threadId : null;
      if (!id || !threadId) return 0;
      // cutex forwards list + terminate (not `clean`), so terminate each.
      const daemon = apiOf(id);
      const terminals = await daemon.backgroundTerminals(id, threadId);
      const results = await Promise.allSettled(terminals.map((t) => daemon.terminateBackgroundTerminal(id, threadId, t.processId)));
      return results.filter((r) => r.status === "fulfilled").length;
    },

    openPage(page, params = {}) {
      set({ view: { kind: "page", page, params } });
    },

    creatingChat: false,
    pendingChat: null,
    setPendingChat(patch) {
      const pending = get().pendingChat;
      if (!pending || get().creatingChat) return;
      // Plan / goal can still change after a failed setup, as long as they were not applied yet.
      const next = { ...pending, ...patch };
      // The host is fixed once the session exists (retries reuse it).
      if (pending.sessionId) next.hostId = pending.hostId;
      if (pending.applied.plan) next.plan = pending.plan;
      if (pending.applied.goal) next.goal = pending.goal;
      set({ pendingChat: next });
    },
    expectApprovalsReviewer(sessionId, hostId, reviewer) {
      pendingReviewers.set(hostKey(hostId, sessionId), reviewer);
    },
    retryPendingChat() {
      if (get().pendingChat && !get().creatingChat) startPendingChat();
    },
    queuePendingChat(draft) {
      const pending = get().pendingChat;
      if (!pending || !hasDraftContent(draft)) return;
      set({ pendingChat: { ...pending, drafts: [...pending.drafts, draft], error: null } });
      if (!get().creatingChat) startPendingChat();
    },
    async newQuickChat(profile) {
      set({ view: { kind: "page", page: DRAFT_CHAT_PAGE, params: {} } });
      const pending = get().pendingChat;
      // Keep a draft that already has messages (being created, or failed); otherwise start fresh.
      if (pending && (get().creatingChat || pending.drafts.length || pending.sessionId)) return;
      // A profile picked from a menu is the focus host's; otherwise the draft page's host picker decides.
      set({ pendingChat: emptyPendingChat(profile ?? null, profile ? focusHost() : null) });
    },
    closePage() {
      set({ view: { kind: "conversation" } });
    },

    init() {
      // Idempotent: StrictMode runs effects twice and duplicate listeners would double-apply deltas.
      if (initialized) return;
      initialized = true;
      startDelegationSync(useApp);
      startOwnerNotifySync(useApp);
      startJobSync(useApp);
      startRuntimePackageSync(useApp);
      // Opening an agent / the approvals page takes back their alerts (lib/notifyRetract).
      startLookRetract(useApp);
      // Main sends hostsState before a new connection starts, so the reset lands first.
      bridge.on("hostsState", onHosts);
      const hostReady = api.hosts().then((hosts) => {
        if (!get().hosts) onHosts(hosts);
      }, () => {});
      bridge.on("daemonState", ({ hostId, epoch, state: daemon }) => {
        const hosts = get().hosts;
        if (hostId !== (hosts?.active ?? "local")) return onSliceDaemon(hostId, epoch, daemon);
        const current = connEpochOf(hosts, hostId);
        if (current && current !== epoch) return;
        set({ daemon });
        // The host feed restarts from the live tail on reconnect: updates in the gap are unknown.
        if (daemon.kind !== "connected") forgetFreshPlans(hostId);
        if (daemon.kind === "connected") onFocusConnected();
      });
      bridge.on("hostEvent", ({ hostId, envelope }) => {
        const state = get();
        const focus = hostId === (state.hosts?.active ?? "local");
        const slice = focus ? null : state.byHost[hostId];
        // A connection not followed (yet): its slice loads everything once it is.
        if (!focus && !slice) return;
        const sidebar = focus ? state.sidebar : slice!.sidebar;
        const id = envelope.cutexSessionId;
        const bound = [...(sidebar?.active ?? [])].find((s) => s.cutexSessionId === id)?.native.threadId ?? null;
        // A native request answered (here or elsewhere; subagents' too): its alert goes.
        if (envelope.native?.message.method === "serverRequest/resolved") {
          const resolved = retractionOfHostEvent(envelope, false);
          if (resolved) retractNotify(resolved);
        }
        // Subagent events: only their approvals surface here (needs-input notification).
        if (isChildThreadEvent(envelope, bound) && envelope.native?.kind !== "serverRequest") return;
        const plan = planSnapshotOf(envelope);
        if (plan) setCachedPlan(hostId, id, nextPlan(getCachedPlan(hostId, id), { ...plan, threadId: plan.threadId ?? bound }), true);
        // Agent-bus events of every agent of the shown host and of the open agent's host (both parties'
        // streams; merged idempotently; message ids are unique across hosts).
        if (focus || hostId === state.selectedHost) useAgentMessages.getState().apply(envelope);
        const context = contextUsageOf(envelope);
        if (context) lastContext.set(hostKey(hostId, id), { ...context, threadId: context.threadId ?? bound });
        const native = envelope.native;
        // Owner's turn or not (desktop approximation until cutex turn-triggers; lib/turnTriggers).
        let triggers = turnTriggers.get(hostId) ?? new Map();
        if (native && native.kind !== "serverRequest") triggers = applyTurnEvent(triggers, id, native.message);
        // Done / failed turns not seen yet (sidebar 完成 / 出错, 需要你 strip; lib/turnUnread).
        const turnEnd = native && native.kind !== "serverRequest" ? turnEndOf(native.message.method, native.message.params) : null;
        const looking = hostId === (state.selectedHost ?? state.hosts?.active ?? "local") && document.hasFocus() && state.selectedId === id && state.view.kind === "conversation";
        // Seen while it ended: the mark goes now. Otherwise the host's tables decide (`mark` method of
        // the turn event's level, below; a host without notification levels marks every turn end).
        if (turnEnd && looking) recordTurnEndOn(hostId, id, turnEnd, true);
        // Waiting agents of every host (the shown host counts its open timelines; the slices these).
        if (trackWaiting(hostId, envelope, !!turnEnd) && !focus) patchSlice(hostId, slice!.epoch, { waiting: waitingRecord(hostId) });
        // Hosts outside the scope (P0: the hosts not shown) say which host it is.
        const label = focus ? null : (state.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId);
        const titled = (title: string) => (label ? `${label} · ${title}` : title);
        // Notifications: the notifications module asks the host's tables (cutex notification levels;
        // project / agent mutes are cutex overrides) and runs this device's methods.
        if (native && (native.kind === "serverRequest" || turnEnd)) {
          const name = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === id)?.displayName ?? id;
          const row = sidebar?.hostRows[id];
          const base = { ...(focus ? {} : { hostId }), agentId: id, agentName: name, projectId: row ? (row.projectId ?? null) : undefined, title: titled(name), looking, onClick: () => void get().openAgent(id, hostId) };
          if (native.kind === "serverRequest") {
            const event = serverRequestEventOf(native.message.method);
            const requestId = String((native.message as { id?: unknown }).id ?? Date.now());
            emitNotify({ ...base, key: `req:${id}:${requestId}`, events: [event], fallback: ["desktop"], body: translate(event === "native.question" ? "notify.question" : "notify.needsInput") });
          } else if (turnEnd) {
            // Its requests die with the turn: their alerts go.
            const ended = retractionOfHostEvent(envelope, true);
            if (ended) retractNotify(ended);
            const owner = turnOwnerOf(triggers, id, turnEnd.turnId);
            triggers = endTurn(triggers, id);
            const body = translate(turnEnd.status === "failed" ? "notify.turnFailed" : turnEnd.status === "interrupted" ? "notify.turnInterrupted" : "notify.turnCompleted");
            const endedAt = Date.now();
            // Decided asynchronously: an agent opened meanwhile was seen (no mark).
            const mark = looking || turnEnd.status === "interrupted" ? undefined : () => {
              const now = get();
              const seen = hostId === (now.selectedHost ?? now.hosts?.active ?? "local") && document.hasFocus() && now.selectedId === id && now.view.kind === "conversation";
              if (!seen) recordTurnEndOn(hostId, id, turnEnd, false, endedAt);
            };
            emitNotify({ ...base, key: `turn:${id}:${turnEnd.turnId ?? endedAt}`, events: [turnEventOf(owner, turnEnd.status)], fallback: [], body, mark });
          }
        }
        turnTriggers.set(hostId, triggers);
        if (focus) {
          const current = pendingActivity?.[id] ?? get().activity[id];
          const next = nextPreview(current, envelope);
          if (next) {
            if (!pendingActivity) {
              pendingActivity = {};
              requestAnimationFrame(() => {
                const batch = pendingActivity;
                pendingActivity = null;
                if (batch) set((state) => ({ activity: { ...state.activity, ...batch } }));
              });
            }
            pendingActivity[id] = next;
          }
        }
        // Coalesce sidebar refreshes; any session/runtime/turn change may move rows.
        const m = envelope.cutex?.method ?? envelope.native?.message.method ?? "";
        // thread/name/updated: quick chats are named after the native thread title.
        // thread/settings/updated: load() seeds a re-selected agent's settings from the sidebar resource.
        // Plan/diff updates and delegation, runtime-package, service and owner-note events don't
        // move rows; their own views/stores handle them.
        // An Agent Management tool call (agent_create …) of an agent on this host: its new / moved
        // agents' own events may not reach this feed live (lib/coalescedRefresh).
        if (sidebarRefreshesForMethod(m) || agentManagementToolCompleted(envelope)) {
          if (focus) {
            sidebarRefresh ??= coalescedRefresh(() => void get().refreshSidebar(), { delayMs: 400, minIntervalMs: 2000 });
            sidebarRefresh.request();
          } else {
            let refresh = backgroundRefresh.get(hostId);
            if (!refresh) backgroundRefresh.set(hostId, (refresh = coalescedRefresh(() => void refreshSliceSidebar(hostId), { delayMs: 400, minIntervalMs: 2000 })));
            refresh.request();
          }
        }
        // Services registry: patch the row from the event (host-level, session id "cutex.host").
        if (m === "cutex/services/changed") {
          const p = envelope.cutex?.params as { reason?: string; slug?: string; service?: ServiceView } | undefined;
          const list = focus ? get().services : slice!.services;
          if (list && p?.slug) {
            const rest = list.filter((x) => x.slug !== p.slug);
            const services = p.reason === "removed" || !p.service ? rest : list.some((x) => x.slug === p.slug) ? list.map((x) => (x.slug === p.slug ? p.service! : x)) : [...list, p.service];
            if (focus) set({ services });
            else patchSlice(hostId, slice!.epoch, { services });
          }
        }
        // Quota pushed by cutex (profile-quota-native): re-read the named profile(s) — or all loaded ones.
        // `quotas` are the open agent's host's (any host); other hosts' gauges: lib/targetHost.
        if (hostId === agentHost(get()) && m === QUOTA_UPDATED_EVENT && featuresOn(hostId).has(QUOTA_NATIVE_FEATURE)) {
          const named = quotaEventProfiles(envelope.cutex?.params);
          const loaded = Object.keys(get().quotas);
          for (const p of named.length ? loaded.filter((k) => named.includes(k)) : loaded) void get().loadQuota(p);
        }
        // Owner approvals (host session "cutex.host"): patch the pending list; notify on new requests.
        const change = approvalChangeOf(envelope);
        if (change) {
          if (focus) set({ approvals: applyApprovalChange(get().approvals, change) });
          else patchSlice(hostId, slice!.epoch, (s) => ({ approvals: applyApprovalChange(s.approvals, change) }));
          // Approved / denied (here or elsewhere): its alert goes.
          const settled = retractionOfApproval(change);
          if (settled) retractNotify(settled);
          if (change.reason === "requested" && change.approval.state === "pending") {
            const a = change.approval;
            const requester = a.requesterName ?? [...(sidebar?.active ?? [])].find((s) => s.cutexSessionId === a.requesterCutexSessionId)?.displayName ?? a.requesterCutexSessionId;
            const row = sidebar?.hostRows[a.requesterCutexSessionId];
            emitNotify({
              key: `approval:${a.approvalId}`,
              ...(focus ? {} : { hostId }),
              events: ["ownerApproval.pending"],
              fallback: ["desktop"],
              agentId: a.requesterCutexSessionId,
              agentName: requester,
              projectId: a.projectId !== undefined ? a.projectId : row ? (row.projectId ?? null) : undefined,
              title: titled(`${requester} · ${translate("notify.approval")}`),
              body: a.summary,
              looking: focus && document.hasFocus() && pageOf(get().view) === "approvals.page",
              onClick: () => openApprovalsOn(hostId),
            });
          }
        }
      });
      // Session streams, statuses and resyncs: of the agent views' own hosts (the focus host's, and an
      // open agent of another host in the scope; main closes a host's views when the focus leaves it).
      const shown = (hostId: string) => hostId === focusHost();
      const ownView = (hostId: string, sessionId: string) => hostOf(sessionId) === hostId;
      bridge.on("sessionEvent", ({ hostId, sessionId, envelope }) => {
        if (shown(hostId) || hostId === get().selectedHost) useAgentMessages.getState().apply(envelope);
        if (!ownView(hostId, sessionId)) return;
        const view = get().sessions[sessionId];
        if (!view) return;
        const generation = envelope.correlation.runtimeGeneration;
        const currentRuntime = generation != null && generation >= view.runtimeGeneration;
        // Older generations may still carry history; they must not lower action fences or clear
        // a current startup failure when replayed through this subscription.
        if (currentRuntime) view.runtimeGeneration = generation;
        // Subagent threads share the parent's stream. Their approvals (and serverRequest/resolved) still
        // go to the parent's dock (the user must answer them); everything else updates that subagent's
        // own timeline.
        if (isChildThreadEvent(envelope, view.timeline.threadId) && !isDockEvent(envelope)) {
          const tid = (envelope.native?.message.params as { threadId?: string } | undefined)?.threadId ?? "";
          const child = childStatusFromEvent(envelope);
          if (child) get().setSubAgentStatus(child.threadId, child.status, envelope.correlation.runtimeGeneration ?? view.runtimeGeneration);
          const sub = get().subTimelines[tid];
          if (sub && applyEvent(sub.timeline, envelope)) set((state) => ({ subTimelines: { ...state.subTimelines, [tid]: { ...sub, version: sub.version + 1 } } }));
          return;
        }
        // A request this desktop saw pending, resolved without our reply in flight (respond removes
        // it from pending optimistically): answered on another device, or cancelled / timed out
        // server-side — the resolved event carries no reason. Keep a row saying what it was.
        if (envelope.native?.message.method === "serverRequest/resolved") {
          const requestId = (envelope.native.message.params as { requestId?: unknown } | undefined)?.requestId;
          const seen = requestId === undefined ? undefined : view.timeline.pending.get(String(requestId));
          if (seen) putInteraction(sessionId, elsewhereRecord(seen, requestTurnId(view.timeline, seen), Date.now() / 1000));
        }
        if (applyEvent(view.timeline, envelope)) {
          patchSession(sessionId, (v) => ({ version: v.version + 1 }));
          const pending = get().pendingSteers[sessionId];
          if (pending?.length) settleSteers(sessionId, settlePendingSteers(pending, view.timeline), pending);
          if (get().outbox[sessionId]?.length) settleOutbox(sessionId);
          const mode = envelope.native?.message.method === "thread/settings/updated" ? collaborationModeOf(view.timeline.settings) : null;
          if (mode) lastCollabMode.set(hostKey(hostId, sessionId), mode);
        }
        const cm = envelope.cutex?.method;
        // A queued message of this agent went to the native (the queue flush): it moves from its queue
        // row to a pending bubble at the timeline tail at once, until its userMessage lands (lib/outbox).
        if (cm === "cutex/userInput/submitted") {
          const params = envelope.cutex?.params as { clientUserMessageId?: string } | undefined;
          const id = params?.clientUserMessageId;
          if (id && get().outbox[sessionId]?.some((e) => e.id === id)) {
            // Still our optimistic queued send (cutex flushed it before its queue row was ever listed):
            // it becomes the pending new-turn bubble in place, never shown nowhere.
            setOutbox(sessionId, (list) => flushOutbox(list, get().sessions[sessionId]?.timeline ?? null, params, ++outboxTick));
          } else if (id && get().sessions[sessionId]?.queue.some((q) => q.clientUserMessageId === id)) {
            const entry = flushedOutboxEntry(get().sessions[sessionId]?.timeline ?? null, params, ++outboxTick);
            if (entry) setOutbox(sessionId, (list) => [...list, entry]);
          }
        }
        if (cm?.startsWith("cutex/userInput/")) refreshQueue(sessionId);
        // admission-order: delegations to this agent (and their pauses) are in the same list.
        // admission-order: delegations to this agent and its unread bus messages are in the same list.
        else if (cm && (cm.startsWith("cutex/ask/") || cm.startsWith("cutex/asks/") || cm.startsWith("cutex/agentBus/")) && featuresOn(hostId).has(ADMISSION_ORDER_FEATURE)) refreshQueue(sessionId);
        // …and say whose turn runs, and what rides along with it (turn groups).
        const nm = envelope.native?.message.method;
        if ((nm === "turn/started" || nm === "turn/completed") && featuresOn(hostId).has(ADMISSION_ORDER_FEATURE)) refreshQueue(sessionId);
        if (cm === "cutex/userInput/startFailed") {
          const failed = envelope.cutex?.params as { error?: { message?: string }; queueIds?: string[] } | undefined;
          if (generation == null || currentRuntime)
            patchSession(sessionId, { startError: failed?.error?.message ?? "start failed", startErrorQueueIds: failed?.queueIds });
          // The offline-start worker can lose a race to another successful launch. Its failure
          // event has no generation: ask the daemon whether the runtime and queue recovered.
          void refreshHostSidebar(hostId);
        }
        if (cm === "cutex/asks/pauseChanged") {
          const p = envelope.cutex?.params as { asksPaused?: AsksPause | null } | undefined;
          patchSession(sessionId, { asksPaused: p?.asksPaused ?? null });
        }
        if (((cm === "cutex/runtime/onlineRequested" || cm === "cutex/runtime/online") && (generation == null || currentRuntime))
          || (nm === "turn/started" && currentRuntime)) {
          patchSession(sessionId, { startError: null, startErrorQueueIds: undefined });
        }
        // History came from the offline reader: rebuild from the live runtime once it is up.
        if (cm === "cutex/runtime/online" && get().sessions[sessionId]?.historySource === "offline") void load(sessionId);
      });
      // users: this connection's user or grant changed (the host feed ended with cutex/access/changed):
      // read its capabilities and lists again (the session feeds re-bootstrap on their own resync).
      bridge.on("accessChanged", ({ hostId, epoch }) => {
        const hosts = get().hosts;
        if (hostId === (hosts?.active ?? "local")) {
          const current = connEpochOf(hosts, hostId);
          if (!current || current === epoch) onFocusConnected();
        } else if (sliceCurrent(hostId, epoch)) void loadSlice(hostId, epoch);
      });
      bridge.on("sessionStatus", ({ hostId, sessionId, status }) => {
        if (ownView(hostId, sessionId)) patchSession(sessionId, { connection: status });
      });
      bridge.on("sessionResync", ({ hostId, sessionId }) => {
        if (!ownView(hostId, sessionId)) return;
        patchSession(sessionId, { resyncing: true });
        void load(sessionId);
      });
      // No host at all (macOS without a local cutex, lib/hosts hasNoHost): there is no connection to ask.
      void hostReady.then(() => (get().hosts?.hosts.length === 0 ? null : api.daemonState())).then((daemon) => {
        if (!daemon) return;
        set({ daemon });
        if (daemon.kind === "connected") onFocusConnected();
      }, () => {});
    },

    refreshHostSidebar(hostId) {
      return refreshHostSidebar(hostId);
    },

    async refreshSidebar() {
      const scope = captureHost();
      const currentRead = beginSidebarRead(scope.host);
      try {
        const snapshot = await api.sidebar();
        if (!scope.current() || !currentRead()) return;
        const before = get().sidebar;
        // Archived agents come as cutex's reduced projection (see retiredSession.ts).
        const sidebar = preparedSidebar(snapshot);
        set((state) => ({ sidebar, activity: activityOf(sidebar, state.activity) }));
        reconcileStartErrors(scope.host, sidebar);
        // Legacy prefs naming these agents / projects are this host's (lib/hostKeys).
        claimHostIds(scope.host, snapshotIds(snapshot));
        if (!scope.current()) return;
        // The selected agent was archived or restored: it now reads from another source (history only
        // vs bootstrap + feed), so reload it.
        const focusSelected = (get().selectedHost ?? scope.host) === scope.host ? get().selectedId : null;
        const flip = lifecycleFlip(before, sidebar, focusSelected);
        if (flip) {
          const id = focusSelected!;
          if (flip === "archived") void api.unsubscribe(id);
          void load(id);
        }
        const projectKey = (sidebar.projects?.projects ?? []).map((p) => p.project_id).join(",");
        if (projectKey !== lastProjectKey) {
          lastProjectKey = projectKey;
          void get().refreshServices();
        }
      } catch {
        // daemon state listener reports connectivity problems
      }
    },

    async openAgent(sessionId, hostId) {
      const hosts = get().hosts;
      if (!hosts || hostId === focusHost() || scopeHosts(hosts).includes(hostId)) return get().select(sessionId, hostId);
      await new Promise<void>((resolve) => {
        inAllDevices(() => void get().select(sessionId, hostId).then(resolve, resolve));
        setTimeout(resolve, 5000);
      });
    },

    async reloadSession(sessionId) {
      if (get().selectedId !== sessionId) return;
      const current = hostOf(sessionId);
      const host = agentHostFor(sessionId, current);
      if (host !== current) return get().select(sessionId, host);
      void apiOn(current).unsubscribe(sessionId).catch(() => {});
      patchSession(sessionId, { loading: true, error: null });
      await load(sessionId);
    },

    async select(sessionId, hostId) {
      const previous = get().selectedId;
      const previousHost = get().selectedHost ?? focusHost();
      // The agent's own host: the given one (or, without one, the open agent's for the same id, else the
      // focus host) unless only another host of the scope lists this id (lib/agentHostRoute).
      const host = agentHostFor(sessionId, hostId ?? (previous === sessionId ? previousHost : focusHost()), previousHost);
      set({ view: { kind: "conversation" } });
      markSeenOn(host, sessionId);
      if (previous === sessionId && previousHost === host) return;
      // Another host's agent with the same id held this view: its per-agent state goes (views are keyed by id).
      const other = sessionHosts.has(sessionId) && sessionHosts.get(sessionId) !== host;
      if (other) {
        set((state) => ({
          sessions: withoutKey(state.sessions, sessionId),
          models: withoutKey(state.models, sessionId),
          collabModes: withoutKey(state.collabModes, sessionId),
          outbox: withoutKey(state.outbox, sessionId),
          pendingSteers: withoutKey(state.pendingSteers, sessionId),
          queueHidden: withoutKey(state.queueHidden, sessionId),
          backgroundItems: withoutKey(state.backgroundItems, sessionId),
        }));
        clearTimeout(queueTimers.get(sessionId));
        sendChains.delete(sessionId);
      }
      // Coming back to a recently viewed agent: show its cached timeline at once and refresh it in
      // the background (load replaces it from a fresh bootstrap) instead of "loading history".
      const cached = get().sessions[sessionId];
      const reusable = !!cached && !cached.loading && !cached.error && !!cached.timeline.threadId;
      recentSessions = [sessionId, ...recentSessions.filter((id) => id !== sessionId)].slice(0, CACHED_SESSIONS);
      for (const id of [...sessionHosts.keys()]) if (!recentSessions.includes(id)) sessionHosts.delete(id);
      sessionHosts.set(sessionId, host);
      // Sends of this host that failed while it was not shown (orphanedSends) are shown again.
      const restored = host !== focusHost() ? takeOrphanedSends(host) : {};
      set((state) => {
        const sessions: Record<string, SessionView> = {};
        for (const id of recentSessions) {
          const view = id === sessionId ? (reusable ? cached : newView()) : state.sessions[id];
          if (view) sessions[id] = view;
        }
        // Quota gauges are per profile name of one host.
        return { selectedId: sessionId, selectedHost: host, sessions, ...(host !== previousHost ? { quotas: {} } : {}), ...(Object.keys(restored).length ? { outbox: mergeOrphans(state.outbox, restored) } : {}) };
      });
      // Interaction rows live exactly as long as the cached timeline views (lib/interactionLog).
      retainSessions(recentSessions);
      if (previous && (previous !== sessionId || previousHost !== host)) void apiOn(previousHost).unsubscribe(previous).catch(() => {});
      await load(sessionId);
    },

    async submit(text, strategy, extra = [], opts = {}) {
      const id = get().selectedId;
      if (!id || (!text.trim() && extra.length === 0)) return null;
      const sidebar = sidebarOn(hostOf(id));
      // Archived: read-only until restored (the composer is replaced by the archived banner).
      if (isArchived(sidebar?.retired.find((s) => s.cutexSessionId === id))) return null;
      // Offline agent: cutex queues the message and starts the runtime (offline-submit).
      const resource = sidebar?.active.find((s) => s.cutexSessionId === id);
      const offline = resource ? resource.runtime.status !== "online" : false;
      const startIfOffline = offline && featuresOn(hostOf(id)).has("offline-submit");
      const entry = newOutboxEntry(get().sessions[id]?.timeline ?? null, { id: crypto.randomUUID(), text, extra, strategy, startIfOffline, placement: placementFor(id, strategy, startIfOffline) });
      setOutbox(id, (list) => [...list, entry]);
      return dispatchSend(id, entry, opts.keepFailed ?? true);
    },

    async respond(requestId, reply) {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      if (!id || !view) return;
      // Optimistic: the dock advances at once (serverRequest/resolved confirms it); the request waits
      // in `answering` and comes back only if the reply fails for a reason a retry can fix.
      const { timeline } = view;
      const key = String(requestId);
      const request = timeline.pending.get(key);
      if (request) {
        timeline.pending.delete(key);
        timeline.answering.add(key);
        patchSession(id, (v) => ({ version: v.version + 1 }));
      }
      try {
        await apiOf(id).respond(id, view.runtimeGeneration, requestId, reply);
        // Timeline row: answered here. Upgrades an 已在别处处理 row that a resolved event wrote
        // while the reply was in flight but the reply landed anyway (event order is not guaranteed).
        if (request) putInteraction(id, answeredRecord(request, reply, requestTurnId(timeline, request), Date.now() / 1000));
      } catch (e) {
        // Settled elsewhere — another client (phone, second desktop) answered first, it is gone, or
        // serverRequest/resolved arrived while the reply was in flight: never put it back.
        const failure = answerFailureOf(e);
        const resolvedMeanwhile = !!request && !timeline.answering.has(key);
        const current = get().sessions[id]?.timeline === timeline;
        if (failure === "retry" && !resolvedMeanwhile && request && current && !timeline.pending.has(key)) {
          timeline.pending.set(key, request);
          patchSession(id, (v) => ({ version: v.version + 1 }));
        }
        if (failure === "stale" && current) {
          // The runtime restarted: re-read the agent (the request returns if it is still pending).
          patchSession(id, { resyncing: true });
          void load(id);
        }
        // Another client answered first, or the request left without our reply: keep a row saying so.
        if ((failure === "resolved" || failure === "gone") && request) putInteraction(id, elsewhereRecord(request, requestTurnId(timeline, request), Date.now() / 1000));
        if (failure !== "retry") get().notify(translate(`interaction.err.${failure}`));
        else if (!resolvedMeanwhile) get().notify(e instanceof Error ? e.message : String(e), "error");
      } finally {
        timeline.answering.delete(key);
      }
    },

    models: {},

    async loadModels(refresh = false) {
      const id = get().selectedId;
      if (!id) return;
      // A relaunch (profile switch, native update) can change the list: key the cache by generation.
      const generation = get().sessions[id]?.runtimeGeneration ?? 0;
      if (!refresh && get().models[id] && modelsGeneration.get(id) === generation) return;
      try {
        const models = await apiOf(id).listModels(id);
        modelsGeneration.set(id, generation);
        noteCatalogNames(models.map((m) => ({ id: m.model, displayName: m.displayName })));
        set((state) => ({ models: { ...state.models, [id]: models } }));
      } catch {
        // offline agent: menu shows only the current model
      }
    },

    async updateSettings(patch) {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      const threadId = view?.timeline.threadId;
      if (!id || !view || !threadId) return false;
      const scope = captureSession(id);
      const previous = view.timeline.settings;
      view.timeline.settings = { ...(previous ?? {}), ...patch };
      patchSession(id, (v) => ({ version: v.version + 1 }));
      try {
        if (!scope.current()) return false;
        await apiOn(scope.host).updateThreadSettings(id, threadId, patch);
        return scope.current();
      } catch (error) {
        if (!scope.current() || get().sessions[id]?.timeline !== view.timeline) return false;
        view.timeline.settings = previous;
        const message = error instanceof Error ? error.message : String(error);
        // Not available for this agent: a notice above the composer, not a broken conversation.
        if (parseUnsupported(message) !== null) {
          get().notify(message);
          patchSession(id, (v) => ({ version: v.version + 1 }));
        } else patchSession(id, (v) => ({ version: v.version + 1, error: message }));
        return false;
      }
    },

    quotas: {},

    async loadQuota(profile, refresh = false) {
      try {
        const gauges = await apiOn(get().selectedHost ?? focusHost()).profileQuota(profile, refresh);
        set((state) => ({ quotas: { ...state.quotas, [profile]: gauges } }));
      } catch {
        // keep last known gauges
      }
    },

    async compact() {
      const id = get().selectedId;
      const threadId = id ? get().sessions[id]?.timeline.threadId : null;
      if (!id || !threadId) return;
      await apiOf(id).compactThread(id, threadId);
    },

    async queueRemove(item, sessionId) {
      // Agent and host as of the click (a confirm dialog or a slow round trip may outlive the selection).
      const id = sessionId ?? get().selectedId;
      if (!id) return;
      const host = hostOf(id);
      // Optimistic: the row leaves at once; back (with the error) if cutex refuses.
      hideQueued(id, [item.queueId]);
      try {
        await apiOn(host).queueRemove(id, item.queueId, item.revision);
      } catch (e) {
        hideQueued(id, [item.queueId], true);
        throw e;
      } finally {
        refreshQueue(id);
      }
    },

    async queueTakeForEdit(item, sessionId) {
      const id = sessionId ?? get().selectedId;
      // The text goes to the composer at once; the removal follows. If it fails (sent or changed
      // meanwhile) the row comes back and a notice says the draft is a copy.
      if (id)
        void get()
          .queueRemove(item, id)
          .catch(() => get().notify(translate("queue.editFailed"), "error"));
      return queueItemText(item);
    },

    async queueSendNow(item, sessionId) {
      const id = sessionId ?? get().selectedId;
      if (!id) return;
      const host = hostOf(id);
      // Optimistic: the row moves to the steers section at once — or, idle, to the timeline as a new
      // turn (立即发送) — (same clientUserMessageId), while main does list + CAS remove + submit.
      const input = item.input as { type: string }[];
      const entry = newOutboxEntry(get().sessions[id]?.timeline ?? null, { id: item.clientUserMessageId, text: queueItemText({ ...item, input: input.filter((x) => x.type === "text") }), extra: input.filter((x) => x.type !== "text"), strategy: "auto", placement: placementFor(id, "auto", false), promoted: true });
      hideQueued(id, [item.queueId]);
      setOutbox(id, (list) => [...list.filter((e) => e.id !== entry.id), entry]);
      try {
        const promoted = await apiOn(host).queuePromote(id, item.queueId, item.revision, featuresOn(host).has(QUEUE_STEER_FEATURE));
        const text = queueItemText({ ...item, input: (promoted.input as { type: string }[]).filter((x) => x.type === "text") });
        const extra = (promoted.input as { type: string }[]).filter((x) => x.type !== "text");
        setOutbox(id, (list) => confirmOutbox(list, entry.id, promoted.result, ++outboxTick));
        trackSteer(id, promoted.result, promoted.clientUserMessageId, text, extra);
        settleOutbox(id);
      } catch (e) {
        // Not promoted (changed / already sent / steer refused): the queue row is shown again as
        // cutex lists it.
        setOutbox(id, (list) => removeOutbox(list, entry.id));
        hideQueued(id, [item.queueId], true);
        const notice = queueSteerNotice(e instanceof Error ? e.message : String(e), translate);
        throw notice === null ? e : new Error(notice);
      } finally {
        refreshQueue(id);
      }
    },

    async queueMove(item, before) {
      const id = get().selectedId;
      const admission = id ? get().sessions[id]?.admission : null;
      if (!id || !admission) return;
      const next = applyMove(admission, item.queueId, before);
      if (next === admission) return;
      // Optimistic: the row takes its new place at once; back to the old order if cutex refuses.
      patchSession(id, { admission: next });
      try {
        const result = await apiOf(id).queueMove(id, item.queueId, admission.orderRevision ?? admission.revision, before);
        if (result?.admission && get().sessions[id]?.admission === next) patchSession(id, { admission: result.admission });
      } catch (e) {
        if (get().sessions[id]?.admission === next) patchSession(id, { admission });
        const kind = parseQueueMoveError(e instanceof Error ? e.message : String(e));
        if (kind === null) throw e;
        throw Object.assign(new Error(translate(QUEUE_MOVE_NOTICES[kind])), { moveRefusal: kind });
      } finally {
        refreshQueue(id);
      }
    },

    async queueYield() {
      const id = get().selectedId;
      if (!id) return;
      try {
        const result = await apiOf(id).queueYield(id);
        if (result?.admission) patchSession(id, { admission: result.admission });
      } finally {
        refreshQueue(id);
      }
    },

    async interruptAndSendSteers() {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      const turnId = view?.timeline.activeTurnId;
      if (!id || !view?.timeline.threadId || !turnId) return;
      if (!(get().pendingSteers[id] ?? []).some((p) => p.turnId === turnId && p.state === "waiting")) return;
      if (featuresOn(hostOf(id)).has("queue-pause")) return void (await get().interruptAndSend("", []));
      resendTurns.add(turnId);
      try {
        await apiOf(id).interrupt(id, view.timeline.threadId, turnId);
      } catch (e) {
        resendTurns.delete(turnId);
        throw e;
      }
    },

    queueHandoff: {},

    async interruptAndSend(text, extra) {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      const turnId = view?.timeline.activeTurnId ?? null;
      if (!id || !view) return false;
      const scope = captureSession(id);
      const daemon = apiOn(scope.host);
      const restoreTail = restoreUnsent(scope, id, text, extra);
      const waiting = (get().pendingSteers[id] ?? []).filter((p) => p.turnId === turnId && (p.state ?? "waiting") === "waiting");
      if (!turnId || waiting.length === 0 || !featuresOn(scope.host).has("queue-pause")) {
        // Optimistic send: a failure stays visible on the message itself (retry / edit / discard).
        if (text.trim() || extra.length) void get().submit(text, turnId ? "interrupt" : "auto", extra).catch(() => {});
        return true;
      }
      // Take the steers out of the panel first so the turn's end does not report them undelivered.
      // They show up at once as one pending message (merged with `text`) at the end of the timeline;
      // its text is corrected below if the native recorded some of them before the stop.
      const ids = new Set(waiting.map((p) => p.id));
      setSteers(id, (list) => list.filter((p) => !ids.has(p.id)));
      const outboxId = crypto.randomUUID();
      // Not sent yet: 正在停止当前回合… until the stop returns, then 正在核对… (lib/outbox stage).
      const merged = newOutboxEntry(view.timeline, { id: outboxId, text: interruptSendText(waiting, text), extra: [...waiting.flatMap((p) => p.extra ?? []), ...extra], strategy: "auto", placement: "turn", stage: "stopping" });
      setOutbox(id, (list) => [...list, merged]);
      const wasPaused = !!view.queuePause;
      set((state) => ({ queueHandoff: { ...state.queueHandoff, [id]: true } }));
      // A non-focus host's connection replaced meanwhile (the focus did not change, so nothing reset
      // this agent's send state): take back what this operation put there instead of leaving the merged
      // message at 正在停止… forever (hasUnlandedTurn would read the agent as busy) and its steers gone.
      // Never dispatched: the message leaves; its steers go back to their section while the view is
      // still this host's agent (they settle against the new connection), else their text goes back
      // into the composer draft of that host's agent. Dispatched with unknown acceptance: a failed row
      // (retry is deduped by its id) — or, the view gone, dispatchSend's stashed copy alone.
      // A focus change resets that state itself (left untouched, as before).
      const focusAtStart = focusHost();
      /** `restore`: puts the unsent tail back into the composer (after the steers, in their order). */
      const stale = (restore: () => void = () => {}) => {
        if (scope.host === focusAtStart || focusHost() !== focusAtStart) { restore(); return false; }
        const ours = sessionHosts.get(id) === scope.host;
        const entry = get().outbox[id]?.find((e) => e.id === outboxId);
        const unsent = !!entry && entry.dispatchedAt === undefined;
        if (unsent) {
          setOutbox(id, (list) => removeOutbox(list, outboxId));
          if (ours) setSteers(id, (list) => [...waiting.filter((p) => !list.some((q) => q.id === p.id)), ...list]);
          else {
            const steerText = interruptSendText(waiting, "");
            const steerExtra = waiting.flatMap((p) => p.extra ?? []);
            if (steerText || steerExtra.length) insertComposerDraft(scope.host, id, steerText, "append", steerExtra);
          }
        }
        restore();
        if (!unsent && entry?.state === "sending") setOutbox(id, (list) => (ours ? failOutbox(list, outboxId, staleHost().message) : removeOutbox(list, outboxId)));
        if (ours || !get().sessions[id]) set((state) => ({ queueHandoff: { ...state.queueHandoff, [id]: false } }));
        return false;
      };
      try {
        // cutex pauses the queue before interrupting, so nothing queued can start in between.
        let stop;
        try {
          stop = await daemon.stopTurn(id);
          if (!scope.current()) return stale(restoreTail);
        } catch (e) {
          if (!scope.current()) return stale(restoreTail);
          setSteers(id, (list) => [...waiting, ...list]);
          // Not stopped: the steers are back in their section, the new text back in the composer.
          setOutbox(id, (list) => removeOutbox(list, outboxId));
          restoreTail();
          throw e;
        }
        setOutbox(id, (list) => setOutboxStage(list, outboxId, "checking"));
        // Exactly the steers the native dropped (those it recorded first are not re-sent). They all
        // belong to the stopped turn, the newest one: a short page is enough (a 10-turn read took
        // seconds right after an abort, docs/research/send-latency-r233-20261014.md).
        let recorded = new Set<string>();
        try {
          const boot = await daemon.bootstrap(id, INTERRUPT_STEER_CHECK_TURNS);
          if (!scope.current()) return stale(restoreTail);
          if (boot.native) recorded = recordedSteers(waiting, timelineFromThreadRead(boot.native.result));
        } catch {
          // unreadable: send them all (a duplicate beats a lost message)
        }
        if (!scope.current()) return stale(restoreTail);
        const dropped = waiting.filter((p) => !recorded.has(p.id));
        const sent = await sendMergedSteers(id, dropped, { text, extra }, outboxId, scope, restoreTail);
        if (!scope.current()) return stale();
        // Interrupt-and-send does not pause: continue the queue after the new turn.
        // Only the owner queue: with asks-pause-v2 a stop never pauses delegations (and the new message
        // would clear an owner asks pause anyway); older daemons resume both here, as before.
        if (sent && stop.paused && !stop.alreadyPaused && !wasPaused) await daemon.queueResume(id);
        return sent;
      } finally {
        if (scope.current()) {
          set((state) => ({ queueHandoff: { ...state.queueHandoff, [id]: false } }));
          refreshQueue(id);
        }
      }
    },

    async resumePaused(sessionId) {
      const id = sessionId ?? get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      if (!id || !view) return;
      const scope = captureSession(id);
      const { steers } = pausedOf(id);
      if (steers.length) {
        const ids = new Set(steers.map((p) => p.id));
        setSteers(id, (list) => list.filter((p) => !ids.has(p.id)));
        if (!(await sendMergedSteers(id, steers))) return;
      }
      // Owner queue only on asks-pause-v2 (delegations have their own 继续委托); older daemons
      // resume the asks together with it, as before.
      if (!scope.current()) return;
      // A stop hold (stop-holds-ridealongs) is released by a queue resume too, even with nothing queued.
      if (view.queuePause || stopHeld(view.asksPaused)) await apiOn(scope.host).queueResume(id);
      if (scope.current()) refreshQueue(id);
    },

    async pauseAsks(id) {
      if (!featuresOn(hostOf(id)).has("asks-pause-v2")) return;
      const { asksPaused } = await apiOf(id).asksPause(id);
      patchSession(id, { asksPaused });
    },

    async resumeAsks(id) {
      if (!featuresOn(hostOf(id)).has("asks-pause-v2")) return;
      const { asksPaused } = await apiOf(id).asksResume(id);
      patchSession(id, { asksPaused });
    },

    async restorePaused() {
      const id = get().selectedId;
      if (!id) return;
      const host = hostOf(id);
      const paused = pausedOf(id);
      const planned = restorePlan(paused.steers, paused.items);
      const removed = await removeQueued(id, planned.take);
      const plan = restorePlan(paused.steers, removed);
      const ids = new Set(plan.steerIds);
      setSteers(id, (list) => list.filter((p) => !ids.has(p.id)));
      if (plan.text || plan.extra.length) insertComposerDraft(host, id, plan.text, "append", plan.extra);
      const failed = planned.take.length - removed.length;
      if (planned.keep.length) get().notify(translate("paused.restoreKept", { n: planned.keep.length }), "error");
      else if (failed > 0) get().notify(translate("paused.restoreFailed", { n: failed }), "error");
    },

    async discardPaused() {
      const id = get().selectedId;
      if (!id) return;
      const paused = pausedOf(id);
      const ids = new Set(paused.steers.map((p) => p.id));
      setSteers(id, (list) => list.filter((p) => !ids.has(p.id)));
      await removeQueued(id, paused.items);
    },

    async interrupt() {
      const id = get().selectedId;
      const view = id ? get().sessions[id] : undefined;
      const turnId = view?.timeline.activeTurnId;
      if (!id || !view?.timeline.threadId || !turnId) return;
      // 停止 = 全部暂停: cutex pauses the queue, then interrupts (no auto-send afterwards).
      if (featuresOn(hostOf(id)).has("queue-pause")) {
        await apiOf(id).stopTurn(id);
        refreshQueue(id);
        return;
      }
      await apiOf(id).interrupt(id, view.timeline.threadId, turnId);
    },
  };
});

/** Interrupt + brief "interrupted" feedback (stop button, Esc in the composer). */
export async function interruptWithFeedback(t: (key: "composer.interrupted" | "composer.interrupting") => string): Promise<void> {
  const app = useApp.getState();
  // Feedback at once; the stop takes a round trip (slow over SSH).
  app.notify(t("composer.interrupting"));
  try {
    await app.interrupt();
    app.notify(t("composer.interrupted"));
  } catch (e) {
    app.notify(e instanceof Error ? e.message : String(e), "error");
  }
}

// Pins are a per-device view preference (DESIGN §4.12), not cutex state. Stored per host (host keys,
// lib/hostKeys; legacy bare ids until a host claims them); `pinned` is the shown host's.
const PIN_KEY = "cutex-desktop.pinned";
function storedPins(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function storePins(list: readonly string[]): void {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: pins last for this window only
  }
}
function loadPinned(): Set<string> {
  return new Set(projectList(storedPins(), keyFocus()));
}
/** Pinned agents of any host (the store's `pinned` is the focus host's; re-read when it changes). */
export function pinnedOn(hostId: string): Set<string> {
  return new Set(projectList(storedPins(), hostId));
}

// ---------- per-host reads (multi-host P1) ----------

type HostReadSource = Pick<AppState, "hosts" | "sidebar" | "features" | "byHost">;
const focusOf = (s: Pick<AppState, "hosts">) => s.hosts?.active ?? "local";

/** The sidebar snapshot of a host: the focus host's top-level one, else its slice's (null: not followed). */
export function sidebarOf(s: HostReadSource, hostId: string | null | undefined): SidebarSnapshot | null {
  if (!hostId || hostId === focusOf(s)) return s.sidebar;
  return s.byHost[hostId]?.sidebar ?? null;
}

/** The cutex capabilities of a host (empty when not followed / not loaded). */
export function featuresOf(s: HostReadSource, hostId: string | null | undefined): ReadonlySet<string> {
  if (!hostId || hostId === focusOf(s)) return s.features;
  return s.byHost[hostId]?.features ?? EMPTY_FEATURES;
}
const EMPTY_FEATURES: ReadonlySet<string> = new Set();

/** The host of the selected agent (the focus host when none is selected). */
export function agentHost(s: Pick<AppState, "hosts" | "selectedHost">): string {
  return s.selectedHost ?? focusOf(s);
}

/** The selected agent's host's sidebar snapshot (its resource, project, host row). */
export function selectedSidebar(s: HostReadSource & Pick<AppState, "selectedHost">): SidebarSnapshot | null {
  return sidebarOf(s, agentHost(s));
}

/** The selected agent's host's capabilities. */
export function selectedFeatures(s: HostReadSource & Pick<AppState, "selectedHost">): ReadonlySet<string> {
  return featuresOf(s, agentHost(s));
}

/** The host of an agent view the store holds (the focus host when none). */
export function viewHostOf(sessionId: string): string {
  return sessionHostOf(sessionId, focusOf(useApp.getState()));
}

/** The store's agent views of the focus host only (`sessions` may also hold an open agent of another host). */
export function focusSessionViews(s: Pick<AppState, "hosts" | "sessions">): Record<string, SessionView> {
  const focus = focusOf(s);
  const out: Record<string, SessionView> = {};
  for (const [id, view] of Object.entries(s.sessions)) if (sessionHostOf(id, focus) === focus) out[id] = view;
  return out;
}

/**
 * Daemon calls about an agent the store holds a view of: its own host (the focus host's `api`, or
 * `apiFor` for an agent opened from another host in the scope). Components calling cutex for the open
 * agent use this instead of `api`.
 */
export function sessionApi(sessionId: string): DaemonApi {
  const focus = focusOf(useApp.getState());
  const host = sessionHostOf(sessionId, focus);
  return host === focus ? api : apiFor(host);
}

/** Daemon calls of a host: the focus host's `api` (focus-fenced), another host's `apiFor`. */
export function hostApi(hostId: string): DaemonApi {
  return hostId === focusOf(useApp.getState()) ? api : apiFor(hostId);
}
function savePinned(pinned: Set<string>): void {
  storePins(writeList(storedPins(), [...pinned], keyFocus()));
}
/** Stored pins changed by a claim / expiry: the shown ones follow (a legacy pin another host claimed leaves). */
function storeClaimedPins(list: readonly string[]): void {
  storePins(list);
  useApp.setState({ pinned: loadPinned() });
}
registerHostKeyed({
  claim(hostId, ids) {
    const list = storedPins();
    const next = claimList(list, hostId, (id) => ids.has(id));
    if (next !== list) storeClaimedPins(next);
  },
  dropLegacy() {
    const list = storedPins();
    const next = dropLegacy(list);
    if (next !== list) storeClaimedPins(next);
  },
});
/** Hosts outside the scope: agents waiting for the owner, from their host feeds (store.ts trackWaiting). */
const waitingByHost = new Map<string, Map<string, Set<string>>>();
function waitingRecord(hostId: string): Record<string, string[]> {
  return Object.fromEntries([...(waitingByHost.get(hostId) ?? [])].map(([agent, ids]) => [agent, [...ids]]));
}
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}
function withoutKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (!keys.some((key) => key in record)) return record;
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}
/** Seed / refresh previews from the server-side projection unless something newer was seen live. */
function activityOf(sidebar: SidebarSnapshot | null, current: Record<string, ActivityPreview>): Record<string, ActivityPreview> {
  const activity = { ...current };
  for (const s of [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])]) {
    const seeded = previewFromResource(s);
    const live = activity[s.cutexSessionId];
    if (seeded && (!live || seeded.at > live.at)) activity[s.cutexSessionId] = seeded;
  }
  return activity;
}

/** Resolves with the session's native thread id once known (plan mode / goal need it), or null after `ms`. */
function waitForThread(sessionId: string, ms = 15_000): Promise<string | null> {
  const current = () => useApp.getState().sessions[sessionId]?.timeline.threadId ?? null;
  if (current()) return Promise.resolve(current());
  return new Promise((resolve) => {
    let finished = false;
    const done = (value: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => done(current()), ms);
    const unsubscribe = useApp.subscribe(() => {
      const id = current();
      if (id) done(id);
    });
  });
}

/**
 * First message of a draft chat: create the session with the draft's choices, set plan mode and the
 * goal, then send the drafts in order (lib/pendingChat). Messages typed meanwhile are picked up by
 * the loop. A failure keeps what is left (a created session is reused by the retry) and brings the
 * draft page back so the error and retry are visible.
 */
async function createPendingChat(current: () => boolean, finish: () => void): Promise<void> {
  if (!current() || !useApp.getState().pendingChat) return;
  useApp.setState({ creatingChat: true });
  const patch = (fn: (p: PendingChatState) => Partial<PendingChatState>) =>
    useApp.setState((state) => ({ pendingChat: state.pendingChat && { ...state.pendingChat, ...fn(state.pendingChat) } }));
  let selected = false;
  try {
    for (;;) {
      if (!current()) return;
      const pending = useApp.getState().pendingChat;
      if (!pending) return;
      const step = pendingChatSteps(pending)[0];
      if (!step) {
        useApp.setState({ pendingChat: null });
        return;
      }
      const app = useApp.getState();
      // The draft's host (null: the focus host); everything below acts on that host's daemon.
      const host = pending.hostId ?? focusOf(app);
      if (step.kind === "create") {
        const { profile } = pending;
        // 自动 = auto reviewer: in `launch` where cutex takes it, else set once the thread runs.
        const reviewer = reviewerForCreate(pending.launch, pending.permissionMode ?? "custom", featuresOf(app, host).has(LAUNCH_REVIEWER_FEATURE));
        const launch = reviewer.launch ?? {};
        const { cutexSessionId } = await hostApi(host).createHumanSession({ start: true, ...(profile ? { profile } : {}), ...(Object.keys(launch).length ? { launch } : {}) });
        if (reviewer.fallback) app.expectApprovalsReviewer(cutexSessionId, host, reviewer.fallback);
        if (!current()) return;
        patch(() => ({ sessionId: cutexSessionId, hostId: host }));
        if (!current()) return;
        await app.refreshHostSidebar(host);
        continue;
      }
      const sessionId = pending.sessionId!;
      // Go there once per run: plan mode / goal act on the selected session, and the drafts then
      // appear in the conversation as they are sent.
      if (!selected) {
        selected = true;
        await app.select(sessionId, host);
        if (!current()) return;
      }
      if ((step.kind === "plan" || step.kind === "goal") && !(await waitForThread(sessionId))) throw new Error(translate("chat.draft.noThread"));
      if (!current()) return;
      if (step.kind === "plan") {
        const applied = await app.setCollabMode("plan");
        // Stale (the owner moved to another agent / host meanwhile): stop quietly; the draft keeps
        // its remaining steps and the next send resumes (no misleading "plan unavailable").
        if (!current() || applied === null) return;
        if (!applied) throw new Error(translate("slash.notice.planUnavailable"));
        patch((p) => ({ applied: { ...p.applied, plan: true } }));
      } else if (step.kind === "goal") {
        await app.setGoal({ objective: step.objective, status: "active" });
        if (!current()) return;
        patch((p) => ({ applied: { ...p.applied, goal: true } }));
      } else {
        await app.submit(step.text, "auto", step.extra, { keepFailed: false });
        if (!current()) return;
        patch((p) => ({ drafts: p.drafts.slice(1) }));
      }
    }
  } catch (error) {
    if (!current()) return;
    patch(() => ({ error: error instanceof Error ? error.message : String(error) }));
    if (useApp.getState().pendingChat?.sessionId) useApp.setState({ view: { kind: "page", page: DRAFT_CHAT_PAGE, params: {} } });
  } finally {
    if (current()) useApp.setState({ creatingChat: false });
    finish();
  }
}

/** Friendly text for a "not available for this agent" error (lib/agentFeatures). */
export function unsupportedNotice(feature: string): string {
  const key = `agentFeature.${feature}` as Parameters<typeof translate>[0];
  const label = translate(key);
  return translate("unsupported.notice", { feature: label === key ? feature || translate("unsupported.thisFeature") : label });
}
