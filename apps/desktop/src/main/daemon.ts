import { daemonFetch } from "./daemonFetch";
import { collectOwnerPages, ownerPageQuery } from "./ownerStorePages";
import { NOTIFICATION_PAGES_FEATURE, type ApprovalPage, type OwnerStorePageQuery } from "../shared/notificationPaging";
import { BACKGROUND_WORK_METHOD, BackgroundWorkProjection, backgroundWorkChange } from "../shared/backgroundWork";
import { readDelegationUpgrade, executeDelegationUpgrade, projectDelegationApproval } from "../shared/delegationUpgradeAdapter";
import { SidebarReadCache, SidebarRefresh } from "./sidebarReadCache";
import { SessionDeltaCatalog } from "./sessionDeltaCatalog";
import { retryableHostBusy, retryableSteerPreflight, withHostBusyRetry, withSteerPreflightRetry } from "../shared/queueSteerRetry";
import { hostBusyActionWire } from "../shared/hostBusyAction";
import { ownerJoinIntent } from "../shared/ownerJoin";
import { fullTextReference, needsFullTextRepair, hydrateFullText } from "./liveFullText";
import { OperatorRestartNotices, recordOperatorRuntimeNotice } from "./operatorRestart";
import { AGENT_PAUSE_METHOD, AGENT_RESUME_METHOD, type AgentPauseResult } from "../shared/agentPause";
import type { EventEnvelope, SessionResource } from "@cutex-desktop/protocol";
import { readProjectOperators } from "./projectOperators";
import { forkPreview, forkRequestParams, forkResult } from "./sessionFork";
import { localFileAction } from "./localFiles";
import { remoteCopyTransport } from "./remoteCopyTransport";
import type { CopySource } from "../shared/remoteCopies";
import type { SessionForkRequest, SessionForkResult, SessionForkPreviewRequest } from "../shared/sessionFork";
import { storageApi } from "./storage";
import { storageCleanupApi } from "./storageCleanup";
import type { StorageCleanupPreviewRequest, StorageCleanupExecuteRequest } from "../shared/storageCleanup";
import type { StorageItemQuery } from "../shared/storage";
import type { ApprovalRuleAuditPage, ApprovalRuleDraft, ApprovalRuleMutation, ApprovalRulesView } from "../shared/ipc";
import { directorScopeCandidates, directorReviewContent, projectDirector, directorHandovers, directorStartReviews, decideDirectorItem, approveDirectorScope, type DirectorFence, type DirectorScope } from "@cutex-desktop/cutex-client";
import { appWindows } from "./appWindows";
import { downloadFilename, downloadFilters } from "../shared/downloadFilename";
import { randomUUID } from "node:crypto";
import { FORMAL_RENAME_FEATURE, FORMAL_RENAME_FLAG, holderIds, restoreNameWire, nameHistoryPath, validRenameRequest, validRenameTarget, type FormalRenameRequest, type FormalRenameResult, type NameHistoryEvent, type NameHistoryPage } from "../shared/agentRename";
import type { HostProxyPatch } from "../shared/proxy";
import { traceSendStage } from "../shared/sendTrace";
import { fastTierOf } from "../shared/fastMode";
import { logError } from "./errorLog";
import { imageActionBytes, mediaReadRequest, withoutLiveImages } from "./eventMedia";
import { EVENT_MEDIA_BLOBS_FEATURE, MAX_EVENT_MEDIA_BYTES, mediaRecord, parseCutexBlobRef, parseCutexMediaRef } from "../shared/mediaBlobs";
import type { HistoryMediaExpected, HistoryMediaPayload, ImageActionInput, ImageActionResult } from "../shared/ipc";
import { RecentFeedTraffic, submitHttpTraceBuffer } from "./sendDiagnostics";
import { notesApi, sideApi } from "./notesSideApi";
import type { ExportReply, ImportReply } from "./profileTransfer";
import { remoteJobsApi } from "./remoteJobsApi";
import type { InboundMailInput, MarkExternalInput, NciVerificationInput } from "../shared/remoteJobs";
import type { NoteCreate, NotesQuery, NoteUpdate } from "../shared/notes";
import type { SideMessageInput, SideOpenInput, SideReply } from "../shared/sideChat";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { app, BrowserWindow, ClipboardItem, clipboard, dialog, nativeImage, shell } from "electron";
import { hostname } from "node:os";
import { approvalClientFacts } from "../shared/approvalOrigin";
import {
  CLIENT_INSTANCE_ID,
  messageSettlementCloseBody,
  messageSettlementEvidenceBody,
  CutexApiError,
  upgradeRefusalOf,
  CutexClient,
  CutexUnreachableError,
  EventFeed,
  LIVE_DELTAS_FEATURE,
  openStream,
  ProjectEventFollower,
  projectBackground,
  projectEventsPage,
  type StreamHandle,
  type DaemonEndpoint,
  PROFILE_IMAGE_KINDS,
  PROFILE_IMAGE_MAX_BYTES,
  type AvatarContentType,
  type ProfileImageKind,
} from "@cutex-desktop/cutex-client";
import type { IdleRuntimes, StopIdleRequest, StopIdleResult } from "../shared/stopIdle";
import type { ProjectBackground, ProjectEventPage, ProjectEventsQuery, ProjectEventsResult, ProjectEventsWatch } from "../shared/projectEvents";
/** cutex capability: history reads may return media as `cutex-media:` references (design 025). */
const HISTORY_MEDIA_REFS = "history-media-refs";
import type { AdmissionRef, GuidesPreferences, HostSessionRow, SessionList, OwnerNotification, OwnerNotificationList, OwnerNotifyFilter, OwnerNotifySettingsPatch, ProjectsResponse, QueueItem, QueueMoveResult, QueueYieldResult } from "@cutex-desktop/protocol";
import { SAFETY_CHECK_DISMISS, SAFETY_CHECK_GRANT } from "@cutex-desktop/protocol";
import { asRecord, isNotificationId, sanitizeOwnerNotifyPatch } from "../shared/ownerNotify";
import { asDecision, asLevelsView, sanitizeEvaluate, sanitizeLevelsPatch, type NotificationDecision, type NotificationEvaluateRequest, type NotificationLevelsPatch, type NotificationLevelsView } from "../shared/notificationLevels";
import { OWNER_REPLY_MAX, type OwnerNotifyAction, type OwnerNotifyResult, type SafetyCheckDecision, type SafetyCheckResult } from "../shared/ipc";
import type {
  CollaborationModeListResponse,
  CollaborationModeMask,
  ConfigReadResponse,
  ExperimentalFeatureListResponse,
  ModelListResponse,
  ReviewStartResponse,
  ReviewTarget,
  ThreadGoal,
  ThreadGoalClearResponse,
  ThreadGoalGetResponse,
  ThreadGoalSetResponse,
  ThreadGoalStatus,

} from "@cutex-desktop/protocol/codex/v2";
import type { ThreadMemoryMode } from "@cutex-desktop/protocol/codex";
import { checkDefaultsPatch } from "../shared/sessionDefaults";
import { MAX_IMAGE_BYTES, SESSION_ACTION_METHODS, type DaemonApi, type DirBrowse, type ExtraInput, type ExperimentalFeaturesView, type PickedImage, type QueuePromoteResult, type SessionActionMethod, type SubmitOptions, type ThreadSearchHit, type ThreadSearchPage } from "../shared/ipc";
import { ASK_COMMAND_METHODS, type ArtifactView, type AskAnswerPage, type AskCommandMethod, type AskDetail, type AskFilter, type AskSummary } from "../shared/ipc";
import type { JobListPage, JobOutputPage, JobResult, JobRow, JobServiceCapabilities, JobStream } from "../shared/ipc";
import { dataUrlImage, sanitizeExtraInput, uploadKind } from "../shared/input";
import { shownSessions } from "../shared/hiddenSessions";
import { queueMoveErrorKind, queueMoveErrorMessage } from "../shared/queueMove";
import { queueSteerErrorDetail, queueSteerErrorKind, queueSteerErrorMessage, queueSteerRawDetail, type QueueSteerErrorKind } from "../shared/queueSteer";
import { imageDeliveryOf } from "../shared/imageDelivery";
import { mergeableOwnerItem, mergeQueueInputs, planQueueMerge, queueMergeErrorMessage, type QueueMergeResult } from "../shared/queueMerge";
import type { RuntimesWire } from "../shared/runtimes";
import type { HostServiceInfo, UpgradeApplyRequest, UpgradeResult, UpgradeRollbackRequest, UpgradeRollbackResult, UpgradeRun, UpgradeSettings, UpgradeSettingsPatch, UpgradeStaging, UpgradeStatus } from "../shared/backendUpgrade";
import { COMPONENT_INDEX_CHECK_PATH, COMPONENT_NAME, componentConfigureBody, readComponentOperation, readComponentsList, sourceOnlyOffer, type ComponentAction, type ComponentRefusal, type ComponentConfigureRequest, type ComponentResult, type ComponentsList } from "../shared/components";
import { consumeResultOf, resetCreditsViewOf, validIdempotencyKey, type ResetConsumeResult, type ResetCreditsView } from "../shared/resetCredits";
import { effortFallbackOf, validActionId, type CreateAbandonResult } from "../shared/createAbandon";
import { autoPickPreviewOf, autoPickQuery, profilePickOf } from "../shared/profileAutoPick";
import { credentialSourceBody, profileApiKey, variantBaseUrl, variantAddBody, variantIdOf, variantPatchBody, type ProfileRuntimeVariant, type VariantResult } from "../shared/profileVariants";
import { kimiAccountCreateBody, kimiAccountId, kimiAccountRenameBody, kimiLoginId, type KimiAccount, type KimiAccountList, type KimiAccountRemoved, type KimiAccountRemoveResult, type KimiAccountResult, type KimiLogin, type KimiLoginResult } from "../shared/kimiAccounts";
import { claudeAccountCreateBody, claudeAccountId, claudeAccountKeyBody, claudeAccountRenameBody, DEFAULT_CLAUDE_ACCOUNT, writeOnlyApiKey, type ClaudeAccount, type ClaudeAccountCreate, type ClaudeAccountList, type ClaudeAccountRemoved, type ClaudeAccountRemoveResult, type ClaudeAccountResult, type ProfileQuotaDetail } from "../shared/claudeAccounts";
import { directorRotationBody, ROTATION_ID } from "../shared/directorRotation";
import { ccSwitchImportBody, type CcSwitchImportItem, type CcSwitchImportList, type CcSwitchImportResult } from "../shared/ccSwitchImport";
import { artifactContentQuery, artifactDiffQuery, artifactId, artifactListQuery, artifactPatchBody, artifactPublishBody, artifactResolveBody, artifactVersionSel, type ArtifactContent, type ArtifactDeleteResult, type ArtifactDetail, type ArtifactDiff, type ArtifactList, type ArtifactListQuery, type ArtifactPatch, type ArtifactPatchResult, type ArtifactPublished, type ArtifactPublishRequest, type ArtifactPublishResult, type ArtifactResolveItem, type ArtifactSummary, type ArtifactUsage } from "../shared/artifactStore";
import { ALARM_ID, type AlarmCancelResult, type AlarmList, type AlarmView } from "../shared/alarms";
import { USAGE_SOURCE_ID, USAGE_SOURCE_KINDS, type UsageSource, type UsageSourceCreate, type UsageSourceDeleteResult, type UsageSourcePatch, type UsageSourceResult, type UsageSourcesView } from "../shared/usageSources";
import { SKILL_ARCHIVE_ID, type SkillArchiveList, type SkillArchiveRecord, type SkillArchiveResult } from "../shared/skillsArchive";
import { WORKFLOW_RUN_ID, type WorkflowRunAction, type WorkflowRunList, type WorkflowRunView } from "../shared/workflows";
import type { RestoreCandidates } from "../shared/runtimeRestore";
import type { QuotaContinueResult, QuotaContinueView } from "../shared/quotaContinue";
import type { OwnDeviceRevoked, OwnDevices, PeerBindingResult, SelfProfile, SelfProfilePatch, TokenBindingResult, UserCreate, UserPatch, UsersList, UsersResult, UsersSettings, UserWriteResult } from "../shared/users";
import type { HomeCoverUpload, HomeDoc, HomeImage, HomeResult, HomeView, ServiceTileAnswer } from "../shared/home";
import type { IdentityChallenge, IdentityClaimResult, PersonKeyInput, PersonKeysResult } from "../shared/personIdentity";
import { accessRefusalDetailsOf, clientTokenUpdateBody, DEVICE_SCOPES, readDeviceScope, readIssuedVia, readOwnerNewDevices, userAccessOf, type ClientTokenUpdate, type ClientTokenUpdated, type DeviceScope, type OwnerDeviceAck, type OwnerNewDevice, type TokenPersonAckResult } from "../shared/users";
import { PEER_ID, peerAddBody, peerInviteBody, peerPatchBody, peersSettingsBody, type PeerAgents, type PeerAuditEntry, type PeerInvite, type PeerList, type PeerPatch, type PeerResult, type PeersSettingsPatch, type PeerView } from "../shared/peers";
import { asStuckDiscarded, asStuckView, cleanMinAge, stuckDiscardRequest } from "../shared/agentBusStuck";
import { sanitizeLaunch, type NewThreadDefaultsPatch } from "../shared/launch";
import type { ClientState, OnlineClientView, RemoteCloseResult } from "../shared/remoteClose";
import { CLIENT_INSTANCE } from "./clientPresence";
import type { ClientTokenView, PairingCodeView, WindowsSandboxReadiness } from "../shared/ipc";
import { windowsSandboxReadinessOf } from "../shared/windowsSandbox";
import { localDaemonSetup, readHostOwner, type HostOwner } from "../shared/hosts";
import { isValidTokenId } from "../shared/hosts";
import { servicesSettingsPatch } from "../shared/servicesSettings";
import type { ClaudeRepinDone, ClaudeRepinResult, ClaudeRuntimeView } from "../shared/claudeRepin";
import type { AgentSecurityPatch, ApprovalDecision, ApprovalDecisionOrigin, ApprovalDecisionResult, ApprovalRecord, CutexRefusal, RuntimePackageRun, RuntimePackageRunResult, RuntimePackagesView, MutationResult, ProfileCreateBody, ProfilePreset, NotificationLevel, ProfileAccountView, ServiceView, ServicesList, ServicesSettings, ServicesSettingsPatch, ProfileLogin, TerminalSummary, ProjectMemoryView, ProjectMutationOperation, BackgroundTerminal, CapabilitiesView, CatalogModelPatch, GlobalSettings, ProfileDetail, ProfileItem, ProfileModelsView, ProfilePatch, UserInstructions, AgentHarnessPreview, ClaudeCodeSources, ClaudePermissionRules, ClaudeSkillsImportList, ClaudeSkillsImportResult, SessionSandboxExtras, SessionSandboxExtrasPatch, FsDir, FsFile, GitStatus, UsageDimension, UsagePrices, UsageReport, UsageSourceFilter, WorkspaceScope, DaemonState, DesktopApi, DaemonEvents, ModelOption, QuotaConfigView, QuotaGauge, ServerRequestReply, SidebarSnapshot, DirectorRotation, DirectorRotationResult, DirectorRotationStart, StuckBusDiscardRequest, StuckBusDiscardResult, StuckBusView } from "../shared/ipc";

/** What a queue-steer refusal carries after its kind: the native refusal, or an unknown outcome's raw answer (详情). */
function steerErrorDetail(kind: QueueSteerErrorKind, error: CutexApiError): string {
  if (kind === "runtimeRefused") return queueSteerErrorDetail(error.details);
  return kind === "outcomeUnknown" || kind === "unrecognized" ? queueSteerRawDetail(error.message, error.details) : "";
}

/** Keep protocol reason codes in diagnostics; never log input or native error messages. */
function logSteerFailure(method: string, sessionId: string, error: unknown, attempt?: number): void {
  if (!(error instanceof CutexApiError)) return;
  const details = error.details as { reason?: unknown; nativeError?: { code?: unknown }; resyncRequired?: unknown } | null | undefined;
  const reason = typeof details?.reason === "string" ? details.reason : "none";
  logError({ source: "queue-steer-preflight", method, sessionId, message: `${attempt ? "retrying a definite pre-send refusal" : "queue operation refused"} (${error.code}/${reason})`,
    code: error.code, reason: details?.reason, nativeCode: details?.nativeError?.code, resyncRequired: details?.resyncRequired === true,
    status: error.status, retryable: error.retryable, attempt });
}

/**
 * A 4xx cutex error as a refusal the renderer can explain. Thrown errors lose their code and
 * details over IPC, so mutations whose refusals the UI shows return this instead.
 */
/** `cutex/access/changed` data → its `changedAt` (null when absent / malformed). */
function changedAtOf(detail: unknown): string | null {
  const at = (detail as { changedAt?: unknown } | null | undefined)?.changedAt;
  return typeof at === "string" && at.length <= 64 ? at : null;
}

function refusalOf(error: unknown): CutexRefusal | null {
  if (!(error instanceof CutexApiError) || error.status >= 500) return null;
  const details = error.details as { sessions?: unknown } | unknown[] | null | undefined;
  const raw = Array.isArray(details) ? details : Array.isArray(details?.sessions) ? (details.sessions as unknown[]) : null;
  const sessions = raw?.map((x): NonNullable<CutexRefusal["sessions"]>[number] => {
    // variant_in_use lists bare ids.
    if (typeof x === "string") return { cutexSessionId: x, displayName: x };
    const r = x as Record<string, unknown>;
    const id = String(r.cutexSessionId ?? r.cutex_session_id ?? r.id ?? "");
    const ref = { cutexSessionId: id, displayName: String(r.displayName ?? r.display_name ?? id) };
    // profile_in_use also counts archived agents (`lifecycle: "retired"`).
    return r.lifecycle === "active" || r.lifecycle === "retired" ? { ...ref, lifecycle: r.lifecycle } : ref;
  });
  const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
  const forkReferences = !Array.isArray(details) && (details as { nativeForkReferences?: unknown } | null | undefined)?.nativeForkReferences === true;
  // owner_local_only / device_scope_denied / …: the action / scope the UI explains.
  const access = accessRefusalDetailsOf(error.code, error.details);
  const count = !Array.isArray(details) && typeof (details as { count?: unknown } | null | undefined)?.count === "number" ? (details as { count: number }).count : undefined;
  return { code: error.code, message, ...(sessions ? { sessions } : {}), ...(forkReferences ? { forkReferences } : {}), ...(access ? { access } : {}), ...(count !== undefined ? { count } : {}) };
}

async function mutation(run: () => Promise<unknown>): Promise<MutationResult> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal) return { ok: false, error: refusal };
    throw error;
  }
}

const APPROVAL_RULE_KINDS = new Set(["managed_service", "service_lifetime", "static_root", "agent_profile", "ask_delivery", "browser_claim", "browser_open", "workflow_run"]);
function approvalRuleBody(input: ApprovalRuleDraft): ApprovalRuleDraft {
  if (!input || input.subject?.type !== "agent" || typeof input.subject.cutexSessionId !== "string" || !input.subject.cutexSessionId.startsWith("cutex.") || input.subject.cutexSessionId.length > 160) throw new Error("bad approval rule subject");
  const kinds = Array.isArray(input.kinds) ? [...new Set(input.kinds)] : [];
  const high = Array.isArray(input.highRiskKindsExplicit) ? [...new Set(input.highRiskKindsExplicit)] : [];
  if (!kinds.length || kinds.some((kind) => !APPROVAL_RULE_KINDS.has(kind)) || high.some((kind) => !kinds.includes(kind))) throw new Error("bad approval rule kinds");
  const mode = input.expiry?.mode;
  if (!(["turn", "hour", "today", "revoked"] as const).includes(mode)) throw new Error("bad approval rule expiry");
  const turn = input.expiry.turn;
  if (mode === "turn" && (!turn || !Number.isSafeInteger(turn.runtimeGeneration) || turn.runtimeGeneration < 1 || typeof turn.turnId !== "string" || !turn.turnId || turn.turnId.length > 200)) throw new Error("bad approval rule turn");
  const profiles = input.constraints?.profileIds ?? [];
  if (!Array.isArray(profiles) || profiles.length > 100 || profiles.some((id) => typeof id !== "string" || !id || id.length > 160)) throw new Error("bad approval rule profiles");
  const workflow = input.constraints?.workflow;
  for (const value of [workflow?.maxAgents, workflow?.maxTokens]) if (value !== undefined && (!Number.isSafeInteger(value) || value! < 1)) throw new Error("bad approval rule workflow limit");
  const projectId = input.projectId == null ? undefined : input.projectId;
  if (projectId !== undefined && (typeof projectId !== "string" || !projectId || projectId.length > 160)) throw new Error("bad approval rule project");
  return {
    enabled: input.enabled === true,
    subject: { type: "agent", cutexSessionId: input.subject.cutexSessionId, ...(typeof input.subject.displayName === "string" ? { displayName: input.subject.displayName.slice(0, 200) } : {}) },
    ...(projectId ? { projectId } : {}), kinds, constraints: { ...(profiles.length ? { profileIds: profiles } : {}), ...(workflow ? { workflow: { ...(workflow.maxAgents ? { maxAgents: workflow.maxAgents } : {}), ...(workflow.maxTokens ? { maxTokens: workflow.maxTokens } : {}) } } : {}) },
    expiry: { mode, ...(mode === "turn" ? { turn: { runtimeGeneration: turn!.runtimeGeneration, turnId: turn!.turnId } } : {}) },
    highRiskKindsExplicit: high,
  };
}

function approvalRuleId(id: string): string {
  if (!/^aar-[A-Za-z0-9-]{1,60}$/.test(id)) throw new Error("bad approval rule id");
  return id;
}

/** Profile routes answer `{ profile }`; tolerate a bare ProfileDetail too. */
function profileOf(r: { profile?: ProfileDetail } | ProfileDetail): ProfileDetail {
  const wrapped = (r as { profile?: ProfileDetail }).profile;
  return wrapped && typeof wrapped === "object" ? wrapped : (r as ProfileDetail);
}

export type DaemonEmit = <K extends keyof DaemonEvents>(event: K, payload: DaemonEvents[K]) => void;

/** Largest file uploaded as a session attachment (cutex `session-attachments` caps at 8 MiB). */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Read-only connection probes must not strand a host in `connecting` forever. */
const CONNECTION_READ_TIMEOUT_MS = 15_000;
/** Workspace watch: no message or keepalive (cutex: every 15 s) for this long = reconnect. */
const WATCH_IDLE_TIMEOUT_MS = 45_000;
/** Durable-change polling of a host not shown (DaemonService.setInView); shown hosts every 5 s. */
const OFF_VIEW_POLL_MS = 30_000;
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

/** Runtime-package runs for named agents (a retry of failed ones): a short list of session ids from the renderer, or none (= all). */
function checkAgentIds(agentIds: unknown): asserts agentIds is string[] | undefined {
  if (agentIds === undefined) return;
  if (!Array.isArray(agentIds) || agentIds.length === 0 || agentIds.length > 500 || !agentIds.every((id) => typeof id === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(id))) throw new Error("bad agent ids");
}

/**
 * Owns the connection to the active cutex daemon: the host-wide event feed (sidebar refresh) and
 * per-session feeds. Which daemon (local discovery or an SSH tunnel) is decided by `HostManager`,
 * which hands it an endpoint (`useEndpoint`). Implements the renderer-facing `DaemonApi`.
 */
export class DaemonService implements DaemonApi {
  private readonly operatorRestartNotices = new OperatorRestartNotices();
  storage() { return storageApi(this.requireClient()).storage(); }
  storageCleanupPreview(request: StorageCleanupPreviewRequest) { return storageCleanupApi(this.requireClient()).storageCleanupPreview(request); }
  storageCleanupExecute(request: StorageCleanupExecuteRequest) { return storageCleanupApi(this.requireClient()).storageCleanupExecute(request); }
  storageCleanupHistory() { return storageCleanupApi(this.requireClient()).storageCleanupHistory(); }
  storageCleanupRun(runId: string) { return storageCleanupApi(this.requireClient()).storageCleanupRun(runId); }
  storageRefresh(stores?: string[]) { return storageApi(this.requireClient()).storageRefresh(stores); }
  storageItems(storeId: string, query?: StorageItemQuery) { return storageApi(this.requireClient()).storageItems(storeId, query); }
  notesList(query?: NotesQuery) { return notesApi(this.requireClient()).notesList(query); }
  notesGet(id: string) { return notesApi(this.requireClient()).notesGet(id); }
  notesCreate(input: NoteCreate) { return notesApi(this.requireClient()).notesCreate(input); }
  notesUpdate(id: string, patch: NoteUpdate) { return notesApi(this.requireClient()).notesUpdate(id, patch); }
  notesDelete(id: string, expectedRevision: number) { return notesApi(this.requireClient()).notesDelete(id, expectedRevision); }
  sideOpen(sessionId: string, input?: SideOpenInput) { return sideApi(this.requireClient()).sideOpen(sessionId, input); }
  sideList(sessionId: string) { return sideApi(this.requireClient()).sideList(sessionId); }
  sideRead(sessionId: string, chatId: string, afterRevision?: number, waitMs?: number) { return sideApi(this.requireClient()).sideRead(sessionId, chatId, afterRevision, waitMs); }
  sideSend(sessionId: string, chatId: string, input: SideMessageInput) { return sideApi(this.requireClient()).sideSend(sessionId, chatId, input); }
  sideInterrupt(sessionId: string, chatId: string) { return sideApi(this.requireClient()).sideInterrupt(sessionId, chatId); }
  sideRespond(sessionId: string, chatId: string, requestId: string | number, reply: SideReply) { return sideApi(this.requireClient()).sideRespond(sessionId, chatId, requestId, reply); }
  sideClose(sessionId: string, chatId: string) { return sideApi(this.requireClient()).sideClose(sessionId, chatId); }
  private backgroundWork = new BackgroundWorkProjection();
  /** Authority events seen during a list read, released as soon as that read settles. */
  private approvalReads = new Set<{ client: CutexClient; changes: Map<string, ApprovalRecord> }>();
  private sidebarRefresh = new SidebarRefresh<SidebarSnapshot>(2000);
  private retiredCache = new SidebarReadCache<SessionList>();
  private sessionDeltas: SessionDeltaCatalog | undefined;
  private sessionDeltaPoll: ReturnType<typeof setInterval> | undefined;
  /** The host is shown (focus or in the view scope); off view its catalog is polled every 30 s, not 5 s. */
  private inView = true;
  private polledAt = 0;
  private pollNow: (() => void) | undefined;
  private sessionDeltaProjectsVersion = -1;
  private projectsCache = new SidebarReadCache<ProjectsResponse>();
  private operatorsCache = new SidebarReadCache<Awaited<ReturnType<typeof readProjectOperators>>>();
  private capabilitiesCache = new SidebarReadCache<CapabilitiesView | null>();
  private capabilitiesRevision = 0;
  private accessRevision = 0;
  private client: CutexClient | null = null;
  private endpoint: DaemonEndpoint | null = null;
  private state: DaemonState = { kind: "connecting", baseUrl: "" };
  private hostFeed: EventFeed | null = null;
  private connectAttempt = 0;
  private connectRead: AbortController | null = null;
  private hostFeedAttempt = 0;
  private hostFeedRead: AbortController | null = null;
  private hostTraffic = new RecentFeedTraffic();
  private sessionTraffic = new RecentFeedTraffic();
  private sessionFeeds = new Map<string, EventFeed>();
  private fullTextActive = 0;
  private fullTextQueue: { client: CutexClient; envelope: EventEnvelope; sessionId: string; feed: EventFeed; key: string }[] = [];
  private fullTextKeys = new Set<string>();
  private sessionFeedAttempt = 0;
  private sessionFeedAttempts = new Map<string, number>();
  private liveDeltasClient: CutexClient | null = null;
  private liveDeltasSupported = false;
  private mediaResyncSeen = new Set<string>();
  private mediaResyncPending = new Map<string, symbol>();
  private mediaResyncEmitted = new Set<string>();
  private mediaResyncAgain = new Set<string>();
  private retryTimer: NodeJS.Timeout | null = null;
  private watches = new Map<string, StreamHandle>();
  /** Project 「动态」 live watches (watchProjectEvents); closed with the connection. */
  private projectWatches = new Map<string, ProjectEventFollower>();
  /** Attached terminal output streams, by terminal id (the PTYs themselves live in cutex). */
  private terminals = new Map<string, StreamHandle>();
  /** Bumped whenever the app moves to another daemon; stale replies are dropped (main/index.ts). */
  private gen = 0;
  /** The active host is not this machine: no native file / folder dialogs, images are uploaded. */
  private remote = false;
  /**
   * The connection is not the host owner's (cutex `users`; read from each `/v2/capabilities` reply): a
   * non-owner's images go up as attachments (users-p2-access), never inline or as host paths.
   */
  private restricted = false;
  /** This connection refused `/v2/sessions?includeHidden=true` (older cutex or a non-root token). */
  private hiddenRefused = false;
  /** Archived agents are read only once something needs them (the archive list, search, an archived agent opened). */
  private archivedWanted = false;
  /** Local files the user picked in the image chooser (only these may be uploaded to a remote). */
  private pickedImages = new Set<string>();

  constructor(private readonly emit: DaemonEmit) {}

  get generation(): number {
    return this.gen;
  }

  get isRemote(): boolean {
    return this.remote;
  }

  get currentState(): DaemonState {
    return this.state;
  }

  /** Connect to a new daemon: everything tied to the previous one is torn down first. */
  useEndpoint(endpoint: DaemonEndpoint, options: { remote: boolean }): void {
    this.teardown();
    this.remote = options.remote;
    // A copy: `retarget` mutates it in place so feeds / handles follow a moved tunnel port.
    this.endpoint = { ...endpoint };
    this.client = new CutexClient(this.endpoint, { backgroundReads: true, fetch: daemonFetch });
    void this.connect();
  }

  /** No daemon for now (switching, SSH tunnel not up yet / failed): requests fail fast. */
  suspend(state: DaemonState, options: { remote: boolean }): void {
    this.teardown();
    this.remote = options.remote;
    this.endpoint = null;
    this.client = null;
    this.setState(state);
  }

  /**
   * Same daemon, new local URL (an SSH tunnel had to move to another local port). Feeds keep their
   * cursors and simply reconnect to the new port.
   */
  retarget(baseUrl: string): void {
    if (!this.endpoint || this.endpoint.baseUrl === baseUrl) return;
    this.endpoint.baseUrl = baseUrl;
    this.reconnectNow();
  }

  /** Skip the 5 s retry wait (the tunnel just came back). */
  reconnectNow(): void {
    if (!this.client) return;
    if (this.state.kind === "connected") {
      this.hostFeed?.reconnectNow();
      return this.kickSessionFeeds();
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.connect();
  }

  stop(): void {
    this.teardown();
  }

  /**
   * The app stopped showing this host but stays connected to it (multi-host: the focus moved): the
   * session feeds, workspace watches and terminals the views opened go, the host feed (counts,
   * notifications, big alerts) stays. Coming back opens them again, as after a switch.
   */
  detachViews(): void {
    for (const feed of this.sessionFeeds.values()) feed.stop();
    this.sessionFeeds.clear();
    this.sessionFeedAttempts.clear();
    this.fullTextQueue = [];
    this.fullTextKeys.clear();
    this.mediaResyncPending.clear();
    this.mediaResyncEmitted.clear();
    this.mediaResyncAgain.clear();
    for (const watch of this.watches.values()) watch.close();
    this.watches.clear();
    for (const t of this.terminals.values()) t.close();
    this.terminals.clear();
  }

  private teardown(): void {
    this.resetSessionDeltas();
    this.client?.dispose?.();
    this.mediaResyncSeen.clear();
    this.mediaResyncPending.clear();
    this.mediaResyncEmitted.clear();
    this.mediaResyncAgain.clear();
    this.gen++;
    this.accessRevision++;
    this.capabilitiesRevision++;
    this.backgroundWork = new BackgroundWorkProjection();
    this.sidebarRefresh = new SidebarRefresh<SidebarSnapshot>(2000);
    this.retiredCache = new SidebarReadCache<SessionList>();
    this.projectsCache = new SidebarReadCache<ProjectsResponse>();
    this.operatorsCache = new SidebarReadCache<Awaited<ReturnType<typeof readProjectOperators>>>();
    this.capabilitiesCache = new SidebarReadCache<CapabilitiesView | null>();
    this.restricted = false;
    this.hiddenRefused = false;
    this.hostTraffic = new RecentFeedTraffic();
    this.sessionTraffic = new RecentFeedTraffic();
    this.connectAttempt++;
    this.hostFeedAttempt++;
    this.connectRead?.abort();
    this.connectRead = null;
    this.hostFeedRead?.abort();
    this.hostFeedRead = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.hostFeed?.stop();
    this.hostFeed = null;
    for (const feed of this.sessionFeeds.values()) feed.stop();
    for (const watch of this.watches.values()) watch.close();
    this.watches.clear();
    for (const t of this.terminals.values()) t.close();
    this.terminals.clear();
    this.sessionFeeds.clear();
    this.sessionFeedAttempts.clear();
    this.fullTextQueue = [];
    this.fullTextKeys.clear();
    for (const w of this.projectWatches.values()) w.stop();
    this.projectWatches.clear();
  }

  private setState(state: DaemonState): void {
    if (state.kind !== "connected") {
      this.backgroundWork = new BackgroundWorkProjection();
      this.retiredCache = new SidebarReadCache<SessionList>();
      this.sidebarRefresh = new SidebarRefresh<SidebarSnapshot>(2000);
    }
    this.state = state;
    this.emit("daemonState", state);
  }

  /** Reuse canonical history reload once for an explicitly partial event; never replay-loop it. */
  private resyncPartialMedia(envelope: EventEnvelope, boundSessionId?: string, force = false): void {
    const message: unknown = envelope.native?.message;
    const marker = mediaRecord(message) ? message._cutexTruncated : undefined;
    if (!force && needsFullTextRepair(envelope) && mediaRecord(message) && message._cutexFullText !== undefined) return;
    if (!force && (!mediaRecord(marker) || marker.reason !== "event_size_limit" || marker.resyncRequired !== true)) return;
    const sessionId = boundSessionId ?? envelope.cutexSessionId;
    if (!sessionId || (boundSessionId && envelope.cutexSessionId && envelope.cutexSessionId !== boundSessionId) || !this.sessionFeeds.has(sessionId)) return;
    const key = JSON.stringify([sessionId, envelope.streamId, envelope.eventId, envelope.cursor]);
    if (this.mediaResyncSeen.has(key)) return;
    this.mediaResyncSeen.add(key);
    if (this.mediaResyncSeen.size > 512) this.mediaResyncSeen.delete(this.mediaResyncSeen.values().next().value!);
    if (this.mediaResyncPending.has(sessionId)) {
      // A new partial event after load() started might not be covered by that snapshot.
      if (this.mediaResyncEmitted.has(sessionId)) this.mediaResyncAgain.add(sessionId);
      return;
    }
    this.queuePartialMediaResync(sessionId);
  }

  private repairFullText(envelope: EventEnvelope, sessionId: string, feed: EventFeed): void {
    if (!Number.isSafeInteger(envelope.correlation?.runtimeGeneration) || !fullTextReference(envelope)) { this.resyncPartialMedia(envelope, sessionId, true); return; }
    const key = JSON.stringify([this.gen, this.sessionFeedAttempts.get(sessionId), sessionId, envelope.streamId, envelope.eventId, envelope.cursor]);
    if (this.fullTextKeys.has(key)) return;
    // Two bounded 32 MiB reads per host; queued entries retain descriptors/previews only.
    if (this.fullTextQueue.length >= 32) { this.resyncPartialMedia(envelope, sessionId, true); return; }
    this.fullTextKeys.add(key);
    this.fullTextQueue.push({ client: this.requireClient(), envelope, sessionId, feed, key });
    this.pumpFullText();
  }

  private pumpFullText(): void {
    while (this.fullTextActive < 2 && this.fullTextQueue.length) {
      const job = this.fullTextQueue.shift()!;
      const current = () => this.client === job.client && this.sessionFeeds.get(job.sessionId) === job.feed;
      if (!current()) { this.fullTextKeys.delete(job.key); continue; }
      this.fullTextActive++;
      void hydrateFullText(job.envelope, (sessionId, sha, expected) => job.client.eventBlob(sessionId, sha, expected)).then(full => {
        if (!current()) return;
        if (full) this.emit("sessionFullText", { sessionId: job.sessionId, envelope: full });
        else this.resyncPartialMedia(job.envelope, job.sessionId, true);
      }, () => { if (current()) this.resyncPartialMedia(job.envelope, job.sessionId, true); }).finally(() => {
        this.fullTextActive--;
        this.fullTextKeys.delete(job.key);
        this.pumpFullText();
      }).catch(() => {});
    }
  }

  private queuePartialMediaResync(sessionId: string): void {
    const token = Symbol(), generation = this.gen;
    this.mediaResyncPending.set(sessionId, token);
    queueMicrotask(() => {
      if (this.gen !== generation || this.mediaResyncPending.get(sessionId) !== token || !this.sessionFeeds.has(sessionId)) return;
      // Kept pending until subscribe resumes after the renderer's existing load() call.
      this.mediaResyncEmitted.add(sessionId);
      this.emit("sessionResync", { sessionId, reason: "event_size_limit" });
    });
  }

  private async connect(probe = false): Promise<void> {
    const client = this.requireClient();
    const gen = this.gen;
    const attempt = ++this.connectAttempt;
    this.connectRead?.abort();
    const controller = new AbortController();
    this.connectRead = controller;
    const timer = setTimeout(() => controller.abort(), CONNECTION_READ_TIMEOUT_MS);
    const current = () => gen === this.gen && attempt === this.connectAttempt;
    const baseUrl = client.endpoint.baseUrl;
    const wasConnected = probe && this.state.kind === "connected";
    if (!wasConnected) this.setState({ kind: "connecting", baseUrl });
    try {
      const host = await client.host({ signal: controller.signal });
      clearTimeout(timer);
      if (!current()) return;
      if (!wasConnected) this.setState({ kind: "connected", baseUrl, hostId: host.hostId, ...(host.instanceId ? { instanceId: host.instanceId } : {}), ...(typeof host.platform === "string" ? { platform: host.platform } : {}) });
      // The daemon answers again (e.g. the SSH tunnel came back): session feeds waiting out their
      // backoff (up to 15 s) reconnect now instead of leaving the open agent stale.
      if (!wasConnected) {
        this.hostFeed?.reconnectNow();
        this.kickSessionFeeds();
      }
      if (!this.hostFeed) await this.startHostFeed();
    } catch (error) {
      if (!current()) return;
      const message = error instanceof Error ? error.message : String(error);
      // A busy HTTP route proves the host still answers; a connected probe must not
      // turn a single overload refusal into a disconnected UI or kick every session feed.
      if (!(wasConnected && error instanceof CutexApiError && (error.status === 503 || error.status === 429))) this.setState(
        error instanceof CutexUnreachableError
          ? { kind: "unreachable", baseUrl, message, ...(this.remote ? {} : { setup: localDaemonSetup(client.endpoint) }) }
          : { kind: "error", baseUrl, message, ...(error instanceof CutexApiError ? { status: error.status } : {}) },
      );
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (current()) void this.connect(wasConnected);
      }, 5000);
    } finally {
      clearTimeout(timer);
      if (this.connectRead === controller) this.connectRead = null;
    }
  }

  /** Session feeds in a reconnect wait retry at once, with their backoff reset (live ones are left alone). */
  kickSessionFeeds(): void {
    for (const feed of this.sessionFeeds.values()) feed.reconnectNow();
    for (const w of this.projectWatches.values()) w.reconnectNow();
  }

  private async startHostFeed(): Promise<void> {
    const client = this.requireClient();
    const gen = this.gen;
    const attempt = ++this.hostFeedAttempt;
    const current = () => gen === this.gen && attempt === this.hostFeedAttempt;
    this.hostFeed?.stop();
    this.hostFeed = null;
    this.hostFeedRead?.abort();
    const controller = new AbortController();
    this.hostFeedRead = controller;
    const timer = setTimeout(() => controller.abort(), CONNECTION_READ_TIMEOUT_MS);
    // /v2/sessions reports the live tail (`management.eventStream.latest`); start there so the
    // sidebar feed does not replay the retained backlog. Falls back to fast-forward paging.
    let position: { streamId?: string; after?: string } = {};
    try {
      // Capable owner hosts recover their catalog through its own durable cursor.
      // Do not fetch a whole session list solely to discover the SSE tail.
      const caps = await this.readCapabilities(client, { signal: controller.signal }).catch(() => null);
      if (!this.supportsSessionDeltas(caps)) {
        const list = await client.sessions("active", { signal: controller.signal, background: true });
        const stream = (list.management as { eventStream?: { streamId?: string; latest?: { cursor?: string } | null } } | null)?.eventStream;
        if (stream?.streamId) position = { streamId: stream.streamId, after: stream.latest?.cursor ?? undefined };
      }
    } catch {
      // fall through to fromLatest paging
    } finally {
      clearTimeout(timer);
      if (this.hostFeedRead === controller) this.hostFeedRead = null;
    }
    // A slower tail read from a previous connection/reset must never start an orphan feed.
    if (!current()) return;
    let refused = false;
    // The initial sidebar read can precede the SSE subscription. A first live
    // handshake closes that gap just like a reconnect of non-replayable status.
    let statusGap = true;
    let statusWasLive = false;
    const feed = new EventFeed(
      client,
      {
        event: (envelope) => { if (current()) { this.invalidateSidebarEvent(envelope); this.emit("hostEvent", withoutLiveImages(envelope)); this.resyncPartialMedia(envelope); } },
        traffic: (sample) => { if (current()) this.hostTraffic.add(sample); },
        resync: (reason, detail) => {
          if (!current()) return;
          this.backgroundWork = new BackgroundWorkProjection();
          this.sidebarRefresh = new SidebarRefresh<SidebarSnapshot>(2000);
          // users: the token's user / grant changed — the renderer re-reads the capabilities and lists.
          this.invalidateSidebarParts(false);
          this.sessionDeltas?.invalidateActive();
          this.invalidateCapabilities();
          if (reason === "access_changed") {
            this.invalidateAccess();
            this.emit("accessChanged", { changedAt: changedAtOf(detail) });
          }
          this.emit("hostResync", { reason });
          // Restart from the live tail; renderer caches must re-read the state they follow.
          void this.startHostFeed();
        },
        status: (status, error) => {
          if (!current()) return;
          if (status === "retrying" || (status === "connecting" && statusWasLive)) statusGap = true;
          if (status === "live") statusWasLive = true;
          if (status === "live" && statusGap) {
            statusGap = false;
            // The process behind a surviving SSH endpoint may have been upgraded. The
            // renderer's resync must read its new capabilities rather than our old cache.
            this.invalidateCapabilities();
            // Ephemeral status cannot be replayed from the durable cursor. Recover once
            // per reconnect; events arriving during that snapshot still overlay its rows.
            this.backgroundWork = new BackgroundWorkProjection();
            this.sidebarRefresh = new SidebarRefresh<SidebarSnapshot>(2000);
            this.invalidateSidebarParts(false);
            // Status events before this moment were not streamed: only rows read before it are read again.
            this.sessionDeltas?.invalidateActive(Date.now());
            this.emit("hostResync", { reason: "session_status_reconnected" });
          }
          // A later HTTP answer/live stream cancels a not-yet-started transport probe.
          if ((status === "live" || error instanceof CutexApiError) && this.state.kind === "connected" && this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
          }
          // users: a refusal (403 access_pending / owner_required) is not a lost connection — the host
          // answers. Keep the feed's own backoff instead of reconnecting in a loop; once it streams
          // again (the owner assigned this device) the renderer re-reads what this device may see.
          if (status === "retrying" && error instanceof CutexApiError && error.status === 403) {
            if (!refused) this.invalidateAccess();
            refused = true;
            return;
          }
          if (status === "live" && refused) {
            refused = false;
            this.invalidateAccess();
            this.emit("accessChanged", { changedAt: null });
          }
          // HTTP errors (including route 503) prove the host is reachable. EventFeed owns
          // their backoff. Only transport loss starts a bounded host recovery probe.
          if (status === "retrying" && error instanceof CutexUnreachableError && !this.connectRead && !this.retryTimer) {
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              if (current()) void this.connect(true);
            }, 5000);
          }
        },
      },
      { ...position, fromLatest: position.streamId === undefined, background: true, sessionStatus: true },
    );
    this.hostFeed = feed;
    feed.start();
  }

  private requireClient(): CutexClient {
    if (!this.client) throw new Error("not connected to a cutex daemon");
    return this.client;
  }

  /** The active client and its generation (HostManager: revoke / test on the active host). */
  activeClient(): CutexClient | null {
    return this.client;
  }

  // ---------- DaemonApi ----------

  async daemonState(): Promise<DaemonState> {
    return this.state;
  }

  async browseDirs(path?: string): Promise<DirBrowse | null> {
    try {
      return await this.requireClient().request<DirBrowse>("GET", "/v2/fs/dirs", { query: { path: path?.trim() || undefined } });
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405) && error.code !== "path_not_found") return null;
      throw error;
    }
  }

  /**
   * Remote host: a local file the user picked becomes a host-side file (`session-attachments`), sent
   * as that path. Only paths returned by `pickImages` are read — the renderer cannot make main read
   * arbitrary files. Inline/ref images upload on local and remote hosts; existing host paths pass through.
   */
  private assertInputScope(client: CutexClient, generation: number): void {
    if (this.gen !== generation || this.client !== client) throw new Error("host switched");
  }

  private async remoteInput(sessionId: string, items: ExtraInput[], client: CutexClient, generation: number): Promise<ExtraInput[]> {
    this.assertInputScope(client, generation);
    if (!this.remote && !this.restricted && !items.some(item => item.type === "image")) return items;
    const ctx = { remote: this.remote, restricted: this.restricted, picked: (path: string) => this.pickedImages.has(path) };
    const out: ExtraInput[] = [];
    for (const item of items) {
      this.assertInputScope(client, generation);
      if (item.type === "image") {
        const blob = parseCutexBlobRef(item.url), ref = blob ?? parseCutexMediaRef(item.url);
        if (ref) {
          const image = blob ? await client.eventBlob(ref.sessionId, ref.sha256)
            : await client.historyMedia(ref.sessionId, ref.sha256, { transport: "bytes" });
          this.assertInputScope(client, generation);
          if (!image || !(image.bytes instanceof Uint8Array) || !image.bytes.length || !Object.values(IMAGE_MIME).includes(image.mime)) throw new Error("image_unavailable");
          if (image.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("image too large");
          const uploaded = await this.uploadImage(sessionId, new Uint8Array(image.bytes), image.mime, client, generation);
          out.push({ type: "localImage", path: uploaded.path });
          continue;
        }
      }
      const kind = uploadKind(item, ctx);
      if (!kind) {
        out.push(item);
        continue;
      }
      let bytes: Uint8Array<ArrayBuffer>;
      let mime: string;
      if (kind === "path" && item.type === "localImage") {
        const type = IMAGE_MIME[extname(item.path).slice(1).toLowerCase()];
        if (!type) throw new Error(`unsupported image type: ${basename(item.path)}`);
        mime = type;
        bytes = new Uint8Array(await readFile(item.path));
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`image too large: ${basename(item.path)}`);
      } else if (item.type === "image") {
        const data = dataUrlImage(item.url);
        if (!data) throw new Error("unsupported image type: only PNG, JPEG, GIF and WebP images can be sent to this host");
        mime = data.mime;
        bytes = new Uint8Array(Buffer.from(data.base64, "base64"));
      } else {
        out.push(item);
        continue;
      }
      this.assertInputScope(client, generation);
      if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("image too large");
      const uploaded = await this.uploadImage(sessionId, bytes, mime, client, generation);
      out.push({ type: "localImage", path: uploaded.path });
    }
    return out;
  }

  /** Keep inline binary data out of typed management receipts on every supported host. */
  private async uploadImage(sessionId: string, bytes: Uint8Array<ArrayBuffer>, mime: string, client: CutexClient, generation: number) {
    this.assertInputScope(client, generation);
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("image too large");
    if (mime === "image/bmp") {
      const decoded = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (decoded.isEmpty()) throw new Error("image_unavailable");
      bytes = new Uint8Array(decoded.toPNG());
      mime = "image/png";
      if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("image too large");
    }
    const uploaded = await client.uploadAttachment(sessionId, bytes, mime);
    this.assertInputScope(client, generation);
    return uploaded;
  }

  /**
   * The owner sees every persistent agent, also ones an agent created with `expose_to_im: false` (cutex
   * lists them only with `includeHidden=true`; hidden local-only sessions stay out: shared/hiddenSessions). Older cutex (400) and non-root tokens (403) refuse the switch: then
   * the plain listing, and not asked again on this connection.
   */
  private async activeSessions(client: CutexClient): Promise<SessionList> {
    const access = this.accessRevision;
    if (!this.hiddenRefused) {
      try {
        const list = await client.sessions("active", { includeHidden: true, background: true });
        return { ...list, sessions: shownSessions(list.sessions) };
      } catch (error) {
        if (!(error instanceof CutexApiError && (error.status === 400 || error.status === 403))) throw error;
        if (this.client === client && access === this.accessRevision) this.hiddenRefused = true;
      }
    }
    if (this.client !== client || access !== this.accessRevision) throw new Error("access changed");
    return client.sessions("active", { background: true });
  }

  sidebar(): Promise<SidebarSnapshot> {
    const client = this.requireClient(), generation = this.gen;
    const backgroundWork = this.backgroundWork;
    return this.sidebarRefresh.read(async () => {
      this.assertInputScope(client, generation);
      const access = this.accessRevision;
      const snapshot = await this.readSidebar(client);
      this.assertInputScope(client, generation);
      if (access !== this.accessRevision) throw new Error("access changed");
      // A feed (re)connect meanwhile: the renderer reads again, and that read joins the catalog read in
      // flight, which re-reads only the rows read before the gap (invalidateActive).
      if (backgroundWork !== this.backgroundWork) throw new Error("sidebar event scope changed");
      return backgroundWork.project(snapshot);
    }, () => setTimeout(() => { if (this.client === client) this.emit("sidebarChanged", { reason: "changed_during_read" }); }, 0));
  }

  /**
   * Whether this host is shown. Off view its catalog is polled every 30 s (its event feed still wakes it); shown
   * again, it is polled at once, so switching back finds it current.
   */
  setInView(inView: boolean): void {
    if (this.inView === inView) return;
    this.inView = inView;
    if (inView) this.pollNow?.(); else this.polledAt = Date.now();
  }

  /** At most every 400 ms (and the last one): the renderer peeks at the rows read so far. */
  private progressAt = 0;
  private progressTimer: ReturnType<typeof setTimeout> | undefined;
  private sidebarProgress(catalog: SessionDeltaCatalog, loaded: number, total: number): void {
    const send = () => {
      this.progressTimer = undefined;
      if (this.sessionDeltas !== catalog) return;
      this.progressAt = Date.now();
      this.emit("sidebarProgress", { loaded, total });
    };
    if (this.progressTimer) clearTimeout(this.progressTimer);
    const wait = this.progressAt + 400 - Date.now();
    if (wait <= 0 || loaded === total) send();
    else this.progressTimer = setTimeout(send, wait);
  }

  /**
   * While a host's first sidebar read runs: the active agents read so far (`loading`, `partial`), shown before
   * the rest arrives. null when no such read runs (the next `sidebar()` is the whole list).
   */
  async sidebarPeek(): Promise<SidebarSnapshot | null> {
    const peek = this.sessionDeltas?.peek();
    if (!peek) return null;
    // The projects to group the rows by come meanwhile (one read; the whole read reads them again after).
    const client = this.client;
    if (client && !this.projectsCache.peek()) void this.projectsCache.read(() => client.projects({ background: true })).catch(() => undefined);
    const snapshot: SidebarSnapshot = {
      active: peek.active, retired: peek.retired, hostRows: peek.hostRows, projects: this.projectsCache.peek() ?? null,
      ...(peek.claudeRuntime ? { claudeRuntime: peek.claudeRuntime } : {}),
      partial: true, archivedPending: { count: peek.archivedPending ?? 0 }, loading: peek.loading!,
    };
    return this.backgroundWork.project(snapshot);
  }

  /** Reads the archived agents from now on (one list read); the renderer is told to read the sidebar again. */
  async sidebarLoadArchived(): Promise<void> {
    const client = this.requireClient();
    const wanted = this.archivedWanted;
    this.archivedWanted = true;
    if (!(this.sessionDeltas?.wantArchived() ?? !wanted)) return;
    this.sidebarRefresh.invalidate();
    setTimeout(() => { if (this.client === client) this.emit("sidebarChanged", { reason: "archived_wanted" }); }, 0);
  }

  private invalidateSidebarParts(resources = true): void {
    if (resources) this.sessionDeltas?.invalidate();
    this.sidebarRefresh.invalidate();
    this.retiredCache = new SidebarReadCache<SessionList>();
    this.projectsCache = new SidebarReadCache<ProjectsResponse>();
    this.operatorsCache = new SidebarReadCache<Awaited<ReturnType<typeof readProjectOperators>>>();
  }

  private invalidateAccess(): void {
    this.resetSessionDeltas();
    this.accessRevision++;
    this.backgroundWork = new BackgroundWorkProjection();
    this.sidebarRefresh = new SidebarRefresh<SidebarSnapshot>(2000);
    this.invalidateSidebarParts();
    this.invalidateCapabilities();
    this.hiddenRefused = false;
    this.restricted = true;
  }

  private invalidateCapabilities(): void {
    this.capabilitiesRevision++;
    this.capabilitiesCache = new SidebarReadCache<CapabilitiesView | null>();
    this.liveDeltasClient = null;
    this.mediaRefsClient = null;
  }

  private invalidateSidebarEvent(envelope: EventEnvelope): void {
    const method = envelope.cutex?.method ?? "";
    if (method === "cutex/approvals/changed") {
      const record = (envelope.cutex?.params as { approval?: ApprovalRecord } | undefined)?.approval;
      if (record && typeof record.approvalId === "string" && typeof record.state === "string") this.noteApprovalDuringRead(record);
    }
    // Counts patch projections; they must not invalidate a whole-list read in flight.
    if (method === BACKGROUND_WORK_METHOD) {
      const change = backgroundWorkChange(envelope.cutex?.params);
      if (change) this.backgroundWork.record(change);
      return;
    }
    // Only what changes who this connection is or may see. Per-user preferences (cutex/users/me/…, e.g. the
    // layout pointer this desktop writes) and owner-device notices never restart the host's catalog.
    if (method === "cutex/users/changed" || method === "cutex/access/changed") this.invalidateAccess();
    else if (method.startsWith("cutex/components/") || method.startsWith("cutex/features/") ||
        method.startsWith("cutex/featureFlags/") || method.startsWith("cutex/settings/") || method.startsWith("cutex/capabilities/"))
      this.invalidateCapabilities();
    const native = envelope.native?.message.method ?? "";
    const params = envelope.cutex?.params as { cutexSessionId?: string } | undefined;
    const id = params?.cutexSessionId ?? envelope.cutexSessionId;
    if (method.startsWith("cutex/project/") || method.startsWith("cutex/projects/") || method.startsWith("cutex/agentManagement/"))
      this.sessionDeltas?.invalidate(); // Project membership/presentation is a separate authority.
    else if ((id && method && method !== "cutex/sessions/changed") || (method.startsWith("cutex/session/") && !method.includes("history/")) || method.startsWith("cutex/activity/") || method.startsWith("cutex/runtime/") ||
        native.startsWith("turn/") || native.startsWith("thread/status") || native === "thread/name/updated" || native === "thread/settings/updated")
      this.sessionDeltas?.invalidate(id);
    else if (method.startsWith("cutex/components/") || method.startsWith("cutex/settings/") || method.startsWith("cutex/profiles/"))
      this.sessionDeltas?.invalidateActive();
    if (method || native.startsWith("turn/") || native.startsWith("thread/status") || native === "thread/name/updated" || native === "thread/settings/updated")
      this.sidebarRefresh.invalidate();
    if (method.startsWith("cutex/project/") || method.startsWith("cutex/projects/") ||
        method.startsWith("cutex/agentManagement/") || (method === "cutex/sessions/changed" && !this.sessionDeltas)) {
      this.invalidateSidebarParts();
    } else if (method.startsWith("cutex/session/") && !method.includes("history/")) {
      if (/retire|restore|delete|created|fork/.test(method) && !this.sessionDeltas) this.invalidateSidebarParts();
      else {
        const params = envelope.cutex?.params as { cutexSessionId?: string } | undefined;
        const id = params?.cutexSessionId ?? envelope.cutexSessionId;
        const retired = this.retiredCache.peek();
        // Initial/unknown target reads remain conservative. Known active metadata never
        // invalidates the archive; retired names/defaults still update without a TTL.
        if (!retired || !id || retired.sessions.some(session => session.cutexSessionId === id))
          this.retiredCache = new SidebarReadCache<SessionList>();
      }
    }
  }

  private async readSidebar(client: CutexClient): Promise<SidebarSnapshot> {
    // Capture before awaiting: an old host must never fill a new host's caches.
    const retiredCache = this.retiredCache;
    const cachedCaps = this.capabilitiesCache.peek();
    const caps = cachedCaps === undefined ? await this.readCapabilities(client) : cachedCaps;
    const catalog = this.supportsSessionDeltas(caps) ? this.sessionDeltaCatalog(client) : undefined;
    if (!catalog && this.sessionDeltas) this.resetSessionDeltas();
    const catalogValue = catalog ? await catalog.read() : undefined;
    if (catalog) {
      if (this.sessionDeltas !== catalog) throw new Error("session catalog scope changed");
      if (catalog.membershipVersion !== this.sessionDeltaProjectsVersion) {
        this.projectsCache.invalidate(); this.operatorsCache.invalidate();
        this.sessionDeltaProjectsVersion = catalog.membershipVersion;
      }
    }
    const projectsCache = this.projectsCache, operatorsCache = this.operatorsCache;
    const [active, retired, projects, hostRows] = await Promise.all([
      catalogValue ? { sessions: catalogValue.active, claudeRuntime: catalogValue.claudeRuntime } : this.activeSessions(client),
      catalogValue ? { sessions: catalogValue.retired }
        : !this.archivedWanted ? { sessions: [], pending: true as const }
        : retiredCache.read(() => client.sessions("retired", { background: true })).catch(() => ({ sessions: [], failed: true as const })),
      projectsCache.read(() => client.projects({ background: true })).catch((error: unknown): ProjectsResponse | null => {
        if (error instanceof CutexApiError) return null;
        throw error;
      }),
      // users: `/v2/host/sessions` is owner-only; another user's rows (name, project) come from its
      // filtered summary instead, so the sidebar still groups its agents by project.
      catalogValue ? catalogValue.hostRows : this.allHostRows(client).catch((error: unknown) => (error instanceof CutexApiError && error.status === 403 ? this.summaryHostRows(client) : {})),
    ]);
    // session-claude-runtime: the release for new Claude sessions, read with the agents' pins.
    const projectOperators = projects ? await operatorsCache.read(async () => {
      const roster = await readProjectOperators(projects.projects, id => client.project(id, { background: true }));
      // Failed projections must be tried again, without retaining the old role.
      if (projects.projects.some(p => Number.isSafeInteger(p.operator_count) && p.operator_count! >= 0 && !Object.hasOwn(roster ?? {}, p.project_id)))
        operatorsCache.invalidate();
      return roster;
    }) : undefined;
    const claudeRuntime = active.claudeRuntime;
    const archivedPending = catalogValue ? catalogValue.archivedPending === undefined ? undefined : { count: catalogValue.archivedPending }
      : "pending" in retired ? { count: null } : undefined;
    const partial = ("failed" in retired && retired.failed) || !!archivedPending || (!catalog && this.hiddenRefused);
    return { active: active.sessions, retired: retired.sessions, projects, hostRows, operatorRestartRequired: this.operatorRestartNotices.current(active.sessions), ...(projectOperators ? { projectOperators } : {}), ...(claudeRuntime ? { claudeRuntime } : {}), ...(partial ? { partial: true as const } : {}), ...(archivedPending ? { archivedPending } : {}) };
  }

  private supportsSessionDeltas(caps: CapabilitiesView | null): boolean {
    return caps?.featureList?.includes("session-deltas-v1") === true && caps.featureList.includes("session-deltas-host-v1") && userAccessOf(caps).isOwner;
  }

  private resetSessionDeltas(): void {
    this.sessionDeltas?.dispose(); this.sessionDeltas = undefined;
    this.sessionDeltaProjectsVersion = -1;
    if (this.sessionDeltaPoll) clearInterval(this.sessionDeltaPoll);
    this.sessionDeltaPoll = undefined;
  }

  private sessionDeltaCatalog(client: CutexClient): SessionDeltaCatalog {
    if (client !== this.client) throw new Error("session catalog host changed");
    if (this.sessionDeltas) return this.sessionDeltas;
    const options = { background: true };
    const catalog = new SessionDeltaCatalog({
      page: (lifecycle, cursor) => client.sessionPage({ lifecycle, cursor, limit: 200, maxBytes: 262144 }, options),
      changes: cursor => client.sessionChanges(cursor, { limit: 1000, maxBytes: 65536 }, options),
      session: async (id, lifecycle) => {
        for (const kind of [lifecycle, lifecycle === "active" ? "retired" : "active"] as const) {
          try { return await client.session(id, kind, options); }
          catch (error) { if (!(error instanceof CutexApiError && error.status === 404)) throw error; }
        }
        return null;
      },
      hostRow: id => client.hostSession(id, options),
      retired: async () => (await client.sessions("retired", options)).sessions,
    }, (loaded, total) => this.sidebarProgress(catalog, loaded, total));
    if (this.archivedWanted) catalog.wantArchived();
    this.sessionDeltas = catalog;
    // Other-process and previous-build writes do not publish in-process wake hints.
    // Poll the bounded durable transport too, without forcing catalog snapshots on SSE gaps.
    let polling = false;
    const poll = (force = false) => {
      if (polling || this.sessionDeltas !== catalog || this.state.kind !== "connected" || !this.supportsSessionDeltas(this.capabilitiesCache.peek() ?? null)) return;
      if (!force && !this.inView && Date.now() - this.polledAt < OFF_VIEW_POLL_MS) return;
      polling = true; this.polledAt = Date.now();
      const revision = catalog.version;
      void catalog.read().then(() => {
        if (this.sessionDeltas === catalog && catalog.version !== revision)
          this.emit("hostResync", { reason: "session_catalog_changed" });
      }).catch(() => { /* Keep the cursor; a later hint/poll retries transient failures. */ }).finally(() => { polling = false; });
    };
    this.pollNow = () => poll(true);
    this.sessionDeltaPoll = setInterval(poll, 5000);
    this.sessionDeltaPoll.unref?.();
    return catalog;
  }

  /** Host rows of the agents a non-owner user sees (`GET /v2/summary`, filtered by cutex); {} on any error. */
  private async summaryHostRows(client = this.requireClient()): Promise<Record<string, HostSessionRow>> {
    try {
      const summary = await client.summary(undefined, { background: true });
      const projects = new Map(summary.projects.map((p) => [p.id, p.name]));
      return Object.fromEntries(summary.agents.map((a) => [a.id, {
        id: a.id, name: a.name, kind: a.kind ?? "agent", hostId: summary.hostId, profile: null, provider: a.provider,
        projectId: a.projectId, projectName: a.projectId ? projects.get(a.projectId) ?? null : null,
        cwd: null, state: a.status, generation: 0, nativeId: null,
      } satisfies HostSessionRow]));
    } catch {
      return {};
    }
  }

  private async allHostRows(client = this.requireClient()): Promise<Record<string, HostSessionRow>> {
    const rows: Record<string, HostSessionRow> = {};
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await client.hostSessions("", cursor, 200, { background: true });
      for (const row of result.data) rows[row.id] = row;
      if (!result.nextCursor) return rows;
      cursor = result.nextCursor;
    }
    logError({ source: "sidebar-pagination", message: "host session listing truncated at page limit", pages: 50, rows: Object.keys(rows).length });
    return rows;
  }

  /**
   * The client whose host offers history-media-refs (design 025): its history reads ask for media
   * as `cutex-media:` references, read back one by one with historyMedia. Older cutex refuses the
   * parameter, so it is only sent to the client the capability came from.
   */
  private mediaRefsClient: CutexClient | null = null;

  private mediaRefs(client: CutexClient): boolean {
    return this.mediaRefsClient === client;
  }

  bootstrap(sessionId: string, turnLimit?: number) {
    const client = this.requireClient();
    return client.bootstrap(sessionId, { turnLimit, mediaRefs: this.mediaRefs(client) });
  }

  /** An image of a `media=ref` history (`cutex-media:<session>/<sha256>`); null when the host no longer has it. */
  async historyMedia(sessionId: string, sha256: string, expected?: HistoryMediaExpected): Promise<HistoryMediaPayload | null> {
    const ref = mediaReadRequest(sessionId, sha256, expected), client = this.requireClient(), generation = this.gen;
    const media: unknown = await client.historyMedia(ref.sessionId, ref.sha256, { transport: "bytes", ...(ref.expected ? { expected: ref.expected } : {}) });
    this.assertInputScope(client, generation);
    return this.mediaPayload(media, ref.expected);
  }

  async eventBlob(sessionId: string, sha256: string, expected?: HistoryMediaExpected): Promise<HistoryMediaPayload | null> {
    const ref = mediaReadRequest(sessionId, sha256, expected), client = this.requireClient(), generation = this.gen;
    const media = await client.eventBlob(ref.sessionId, ref.sha256, ref.expected);
    this.assertInputScope(client, generation);
    const payload = this.mediaPayload(media, ref.expected);
    return payload && "bytes" in payload && payload.bytes.length <= MAX_EVENT_MEDIA_BYTES ? payload : null;
  }

  private mediaPayload(media: unknown, expected?: HistoryMediaExpected): HistoryMediaPayload | null {
    if (!mediaRecord(media)) return null;
    if (media.bytes instanceof Uint8Array && typeof media.mime === "string" && media.size === media.bytes.length
      && media.bytes.length > 0 && media.bytes.length <= (expected ? MAX_EVENT_MEDIA_BYTES : 64 * 1024 * 1024)
      && (!expected || (media.mime === expected.mime && media.size === expected.size))) {
      return { bytes: media.bytes, mime: media.mime, size: media.bytes.length };
    }
    // Additive compatibility with older image clients; real byte reads never encode to base64.
    return !expected && typeof media.contentType === "string" && /^image\/(?:png|jpeg|webp)$/.test(media.contentType)
      && typeof media.data === "string" && media.data.length <= 64 * 1024 * 1024 * 4 / 3
      ? { dataUrl: `data:${media.contentType};base64,${media.data}` } : null;
  }

  async imageAction(input: ImageActionInput, action: "copy" | "save"): Promise<ImageActionResult> {
    if (action !== "copy" && action !== "save") throw new Error("invalid_image_action");
    const client = this.client, generation = this.gen;
    const check = () => { if (this.client !== client || this.gen !== generation) throw new Error("host switched"); };
    const image = await imageActionBytes(input, (sessionId, sha, expected, blob) => blob ? this.eventBlob(sessionId, sha, expected) : this.historyMedia(sessionId, sha, expected));
    check();
    const decoded = nativeImage.createFromBuffer(Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength));
    if (decoded.isEmpty()) throw new Error("image_unavailable");
    if (action === "copy") {
      const png = new Uint8Array(decoded.toPNG());
      check();
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) })]);
      return { status: "copied" };
    }
    const win = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
    const defaultPath = downloadFilename("image", { extension: image.extension, mime: image.mime });
    const options = { defaultPath, filters: downloadFilters(defaultPath, image.mime) };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    check();
    if (result.canceled || !result.filePath) return { status: "cancelled" };
    await writeFile(result.filePath, image.bytes);
    return { status: "saved" };
  }

  async history(sessionId: string, cursor?: string | null, limit = 20) {
    try {
      const client = this.requireClient();
      return await client.history(sessionId, { limit, cursor, mediaRefs: this.mediaRefs(client) });
    } catch (e) {
      if (e instanceof CutexApiError && (e.status === 404 || e.status === 409)) return null;
      throw e;
    }
  }

  async subscribe(sessionId: string, from: Parameters<DesktopApi["subscribe"]>[1]): Promise<void> {
    const client = this.requireClient();
    const attempt = ++this.sessionFeedAttempt;
    this.sessionFeedAttempts.set(sessionId, attempt);
    if (this.liveDeltasClient !== client) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.readCapabilities(client, { signal: controller.signal }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("live capability probe timed out")); }, 1_500);
        })]);
      } catch { /* Capability negotiation cannot stall the existing durable feed. */ }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
    if (this.client !== client || this.sessionFeedAttempts.get(sessionId) !== attempt) return;
    // A new bootstrap advances the subscription checkpoint. Recover outcomes of
    // owner inputs that were held before it, without replaying native deltas into
    // the already rebuilt thread and without submitting any input again.
    if (from.ownerAdmissionReplay) {
      this.sessionFeeds.get(sessionId)?.stop();
      this.sessionFeeds.delete(sessionId);
      const replay = from.ownerAdmissionReplay;
      const ids = new Set(replay.ids);
      let after = replay.after;
      const signal = AbortSignal.timeout(10_000);
      for (let pageCount = 0; ; pageCount++) {
        if (pageCount >= 20) throw new Error("owner admission receipt recovery exceeded its read budget; reload to retry");
        const page = await client.events({ cutexSessionId: sessionId, streamId: from.streamId, ...(after ? { after } : {}), limit: 1000 }, { signal });
        if (this.client !== client || this.sessionFeedAttempts.get(sessionId) !== attempt) return;
        for (const envelope of page.events) {
          if (envelope.sequence > replay.throughSequence) break;
          const id = (envelope.cutex?.params as { clientUserMessageId?: string } | undefined)?.clientUserMessageId;
          if (id && ids.has(id) && /^cutex\/userInput\/(held|submitted|queued|failed)$/.test(envelope.cutex?.method ?? ""))
            this.emit("sessionEvent", { sessionId, envelope: withoutLiveImages(envelope) });
        }
        if (!page.hasMore || page.events.some(event => event.sequence >= replay.throughSequence)) break;
        if (!page.nextCursor || page.nextCursor === after) throw new Error("owner admission receipt recovery did not advance; reload to retry");
        after = page.nextCursor;
      }
    }
    const liveDeltas = this.liveDeltasClient === client && this.liveDeltasSupported;
    let latestGeneration = -1;
    let liveGeneration = -1;
    const again = this.mediaResyncAgain.delete(sessionId);
    this.mediaResyncPending.delete(sessionId);
    this.mediaResyncEmitted.delete(sessionId);
    this.sessionFeeds.get(sessionId)?.stop();
    const feed = new EventFeed(
      this.requireClient(),
      {
        event: (envelope) => {
          if (this.sessionFeeds.get(sessionId) !== feed) return;
          const generation = envelope.correlation?.runtimeGeneration;
          if (generation != null) latestGeneration = Math.max(latestGeneration, generation);
          this.emit("sessionEvent", { sessionId, envelope: withoutLiveImages(envelope) });
          if (needsFullTextRepair(envelope, liveDeltas && generation != null && generation === liveGeneration && generation === latestGeneration)) this.repairFullText(envelope, sessionId, feed);
          else this.resyncPartialMedia(envelope, sessionId);
        },
        liveDelta: (frame) => {
          if (this.sessionFeeds.get(sessionId) === feed) {
            if (frame.runtimeGeneration >= latestGeneration) liveGeneration = frame.runtimeGeneration;
            this.emit("sessionLiveDelta", { sessionId, frame });
          }
        },
        liveReset: () => {
          if (this.sessionFeeds.get(sessionId) === feed) this.emit("sessionLiveReset", { sessionId });
        },
        traffic: (sample) => { if (this.sessionFeeds.get(sessionId) === feed) this.sessionTraffic.add(sample); },
        resync: (reason) => {
          if (this.sessionFeeds.get(sessionId) !== feed) return;
          this.sessionFeedAttempts.delete(sessionId);
          this.sessionFeeds.delete(sessionId);
          this.emit("sessionResync", { sessionId, reason });
        },
        status: (status) => { if (this.sessionFeeds.get(sessionId) === feed) this.emit("sessionStatus", { sessionId, status }); },
      },
      { cutexSessionId: sessionId, streamId: from.streamId, after: from.after ?? undefined, liveDeltas },
    );
    this.sessionFeeds.set(sessionId, feed);
    feed.start();
    if (again) this.queuePartialMediaResync(sessionId);
  }

  async unsubscribe(sessionId: string): Promise<void> {
    this.sessionFeedAttempts.delete(sessionId);
    this.mediaResyncPending.delete(sessionId);
    this.mediaResyncEmitted.delete(sessionId);
    this.mediaResyncAgain.delete(sessionId);
    this.sessionFeeds.get(sessionId)?.stop();
    this.sessionFeeds.delete(sessionId);
  }

  async submit(sessionId: string, text: string, strategy: "auto" | "queue" | "interrupt", startIfOffline = false, options: SubmitOptions = {}) {
    const client = this.requireClient();
    const joinDelegation = ownerJoinIntent(options.joinDelegation);
    const generation = this.gen;
    const clientUserMessageId = typeof options.clientUserMessageId === "string" && options.clientUserMessageId.length <= 128 ? options.clientUserMessageId : undefined;
    const trace = { sessionId, clientUserMessageId, hostId: this.state.kind === "connected" ? this.state.hostId : undefined };
    const items = await traceSendStage({ ...trace, stage: "prepare-input" }, (record) => logError({ ...record }),
      () => this.remoteInput(sessionId, sanitizeExtraInput(options.extra ?? []), client, generation));
    this.assertInputScope(client, generation);
    // An image-only message has no text item (cute-codex accepts any non-empty input list).
    const input = text.trim() || items.length === 0 ? [{ type: "text", text, text_elements: [] }, ...items] : items;
    const httpTrace = submitHttpTraceBuffer();
    // Capabilities are populated by connection/bootstrap. Do not add a probe or
    // opt an older host into a response its client cannot reconcile.
    const caps = this.capabilitiesCache.peek();
    const allowHeld = caps?.featureList?.some(feature => feature === "owner-admission-held-v1" || feature === "ownerAdmissionHeldV1") === true
      || caps?.features?.ownerAdmissionHeldV1 === true;
    const hostTraffic = this.hostTraffic, sessionTraffic = this.sessionTraffic;
    const result = await traceSendStage({ ...trace, stage: "daemon-submit" }, (record) => logError({
      ...record, httpStages: httpTrace.snapshot(),
      hostSse: hostTraffic.snapshot(), sessionSse: sessionTraffic.snapshot(),
    }), async () => {
      try {
        return await client.submitInput(sessionId, input, strategy, { startIfOffline: joinDelegation ? false : startIfOffline, clientUserMessageId, joinDelegation, ...(allowHeld ? { allowHeld: true } : {}), onHttpTrace: httpTrace.observe });
      } catch (error) {
        // Only a definite pre-execution refusal authorizes repeating an offline send.
        const wire = startIfOffline && !joinDelegation ? hostBusyActionWire(error) : null;
        if (wire) {
          logSteerFailure("cutex/userInput/submit", sessionId, error);
          throw new Error(wire);
        }
        throw error;
      }
    });
    this.assertInputScope(client, generation);
    return result;
  }

  // Files are chosen on this machine. Local host: sent as localImage paths; remote host: uploaded
  // on send (remoteInput), so the chosen paths are remembered.
  async pickImages(maxBytes?: number): Promise<PickedImage[]> {
    const picked = await this.chooseImages(maxBytes);
    for (const p of picked) if (!p.error) this.pickedImages.add(p.path);
    return picked;
  }

  private async chooseImages(maxBytes?: number): Promise<PickedImage[]> {
    const limit = typeof maxBytes === "number" && maxBytes > 0 ? Math.min(maxBytes, MAX_IMAGE_BYTES) : MAX_IMAGE_BYTES;
    const win = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
    const options = { properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (r.canceled) return [];
    return Promise.all(
      r.filePaths.slice(0, 10).map(async (path): Promise<PickedImage> => {
        const name = basename(path);
        try {
          const size = (await stat(path)).size;
          if (size > limit) return { path, name, size, preview: null, error: "tooLarge" };
          const ext = extname(path).slice(1).toLowerCase();
          const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          // Thumbnail from the file itself (≤ 8 MB); the renderer downsizes it for display.
          const preview = `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
          return { path, name, size, preview };
        } catch {
          return { path, name, size: 0, preview: null, error: "unreadable" };
        }
      }),
    );
  }

  async interrupt(sessionId: string, threadId: string, turnId: string): Promise<void> {
    await this.requireClient().interrupt(sessionId, threadId, turnId);
  }

  async listModels(sessionId: string): Promise<ModelOption[]> {
    const result = await this.requireClient().native<ModelListResponse>(sessionId, "model/list", { limit: 100 });
    return result.data
      .filter((m) => !m.hidden)
      .map((m) => ({
        id: m.id,
        model: m.model,
        displayName: m.displayName,
        description: m.description,
        efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
        defaultEffort: m.defaultReasoningEffort,
        isDefault: m.isDefault,
        inputModalities: m.inputModalities ?? [],
        fastTier: fastTierOf(m),
      }));
  }

  async updateThreadSettings(sessionId: string, threadId: string, patch: Record<string, unknown>): Promise<void> {
    await this.requireClient().native(sessionId, "thread/settings/update", { ...patch, threadId });
  }

  async profileQuota(profile: string, refresh = false): Promise<QuotaGauge[]> {
    try {
      const result = await this.requireClient().request<{ gauges: QuotaGauge[] }>(
        "GET",
        `/v2/profiles/${encodeURIComponent(profile)}/quota`,
        { query: refresh ? { refresh: "true" } : undefined },
      );
      return result.gauges ?? [];
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return [];
      throw error;
    }
  }

  async profileQuotaDetail(profile: string): Promise<ProfileQuotaDetail | null> {
    if (typeof profile !== "string" || !profile || profile.length > 200) throw new Error("bad profile");
    try {
      const r = await this.requireClient().request<{ source?: string | null; gauges?: QuotaGauge[]; nativeQuota?: Record<string, unknown> | null }>("GET", `/v2/profiles/${encodeURIComponent(profile)}/quota`);
      return { source: r.source ?? null, gauges: r.gauges ?? [], nativeQuota: r.nativeQuota ?? null };
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  /** `GET /v2/profiles/{p}/reset-credits` (cutex `profile-reset-credits`); null when the route is missing. */
  async profileResetCredits(profile: string, refresh = false): Promise<ResetCreditsView | null> {
    if (typeof profile !== "string" || !profile || profile.length > 200) throw new Error("bad profile");
    try {
      const raw = await this.requireClient().request<unknown>("GET", `/v2/profiles/${encodeURIComponent(profile)}/reset-credits`, {
        query: refresh ? { refresh: "true" } : undefined,
      });
      return resetCreditsViewOf(raw);
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  /** `POST /v2/profiles/{p}/reset-credits/consume`: uses one reset credit. Only after the owner's confirm. */
  async consumeResetCredit(profile: string, body: { idempotencyKey: string; creditId?: string | null }): Promise<ResetConsumeResult> {
    if (typeof profile !== "string" || !profile || profile.length > 200) throw new Error("bad profile");
    if (!body || typeof body.idempotencyKey !== "string" || !validIdempotencyKey(body.idempotencyKey)) throw new Error("bad idempotency key");
    const creditId = typeof body.creditId === "string" && body.creditId.length > 0 && body.creditId.length <= 200 ? body.creditId : undefined;
    const raw = await this.requireClient().request<unknown>("POST", `/v2/profiles/${encodeURIComponent(profile)}/reset-credits/consume`, {
      body: { idempotencyKey: body.idempotencyKey, ...(creditId ? { creditId } : {}) },
    });
    return consumeResultOf(raw);
  }

  async readRateLimits(sessionId: string): Promise<Record<string, unknown> | null> {
    try {
      // No params: the app-server schema rejects `{}` for this method.
      const result = await this.requireClient().native<{ rateLimits?: Record<string, unknown> | null }>(sessionId, "account/rateLimits/read", undefined);
      return result?.rateLimits ?? null;
    } catch {
      return null;
    }
  }

  async windowsSandboxReadiness(sessionId: string): Promise<WindowsSandboxReadiness | null> {
    try {
      // No params: the app-server schema wants none for this method.
      const result = await this.requireClient().native<{ status?: unknown }>(sessionId, "windowsSandbox/readiness", undefined);
      return windowsSandboxReadinessOf(result?.status);
    } catch {
      return null;
    }
  }

  setupWindowsSandbox(sessionId: string): Promise<{ started: boolean }> {
    return this.requireClient().native<{ started: boolean }>(sessionId, "windowsSandbox/setupStart", { mode: "unelevated" });
  }

  quotaConfig(profile: string): Promise<QuotaConfigView> {
    return this.requireClient().request<QuotaConfigView>("GET", `/v2/profiles/${encodeURIComponent(profile)}/quota-config`);
  }

  putQuotaConfig(profile: string, patch: Parameters<DesktopApi["putQuotaConfig"]>[1]): Promise<QuotaConfigView> {
    return this.requireClient().request<QuotaConfigView>("PUT", `/v2/profiles/${encodeURIComponent(profile)}/quota-config`, { body: patch });
  }

  async capabilities(): Promise<CapabilitiesView | null> {
    return this.readCapabilities(this.requireClient());
  }

  private readCapabilities(client: CutexClient, options: { signal?: AbortSignal } = {}): Promise<CapabilitiesView | null> {
    const cache = this.capabilitiesCache;
    const load = async () => {
      const caps = await this.loadCapabilities(client, options);
      // A missing route can appear after an in-place daemon upgrade; don't memoize absence.
      if (caps === null) cache.invalidate();
      return caps;
    };
    return cache.read(() => {
      const signal = options.signal;
      if (!signal) return load();
      return new Promise<CapabilitiesView | null>((resolve, reject) => {
        const abort = () => reject(new Error("capability probe aborted"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        load().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    });
  }

  private async loadCapabilities(client: CutexClient, options: { signal?: AbortSignal }): Promise<CapabilitiesView | null> {
    const access = this.accessRevision, revision = this.capabilitiesRevision;
    const raw = await client.capabilities<CapabilitiesView>(options);
    if (options.signal?.aborted || this.client !== client || access !== this.accessRevision || revision !== this.capabilitiesRevision) throw new Error("capability scope changed");
    const blobs = raw?.eventMediaBlobs === true || raw?.featureList?.some(feature => feature === EVENT_MEDIA_BLOBS_FEATURE || feature === "eventMediaBlobs");
    let caps = blobs && !raw?.featureList?.includes(EVENT_MEDIA_BLOBS_FEATURE)
      ? { ...raw!, featureList: [...(raw?.featureList ?? []), EVENT_MEDIA_BLOBS_FEATURE] } : raw;
    if (caps?.features?.runtimePruneV1 === true && !caps.featureList?.includes("runtime-prune-v1"))
      caps = { ...caps, featureList: [...(caps.featureList ?? []), "runtime-prune-v1"] };
    if (caps?.features?.liveTextDeltas === true && !caps.featureList?.includes(LIVE_DELTAS_FEATURE))
      caps = { ...caps, featureList: [...(caps.featureList ?? []), LIVE_DELTAS_FEATURE] };
    if (caps?.features?.ownerAdmissionHeldV1 === true && !caps.featureList?.includes("owner-admission-held-v1"))
      caps = { ...caps, featureList: [...(caps.featureList ?? []), "owner-admission-held-v1"] };
    if (caps?.features?.[FORMAL_RENAME_FLAG] === true && !caps.featureList?.includes(FORMAL_RENAME_FEATURE))
      caps = { ...caps, featureList: [...(caps.featureList ?? []), FORMAL_RENAME_FEATURE] };
    if (this.client === client && access === this.accessRevision) {
      this.liveDeltasClient = caps === null ? null : client;
      this.liveDeltasSupported = caps?.featureList?.includes(LIVE_DELTAS_FEATURE) === true;
      this.restricted = !userAccessOf(caps).isOwner;
      if (this.sessionDeltas && !this.supportsSessionDeltas(caps)) this.resetSessionDeltas();
      this.mediaRefsClient = caps?.featureList?.some(feature => feature === HISTORY_MEDIA_REFS || feature === EVENT_MEDIA_BLOBS_FEATURE || feature === "eventMediaBlobs") || caps?.eventMediaBlobs === true ? client : null;
    }
    return caps;
  }

  /** Main-only: the fixed link-secret route is deliberately absent from DaemonApi/preload. */
  profileLinkRequest<T>(method: "GET" | "PUT", body?: unknown): Promise<T> {
    return this.requireClient().request<T>(method, "/v2/profile-link/secret", body === undefined ? {} : { body });
  }

  async usage(query: { from?: string; to?: string; groupBy: UsageDimension[]; source?: UsageSourceFilter }): Promise<UsageReport | null> {
    try {
      return await this.requireClient().request<UsageReport>("GET", "/v2/usage", {
        query: { from: query.from, to: query.to, groupBy: query.groupBy.join(","), source: query.source },
      });
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  usagePrices(): Promise<UsagePrices> {
    return this.requireClient().request<UsagePrices>("GET", "/v2/usage/prices");
  }

  putUsagePrices(prices: UsagePrices): Promise<UsagePrices> {
    return this.requireClient().request<UsagePrices>("PUT", "/v2/usage/prices", { body: prices });
  }

  // The owner's guide choice (cutex guides.preferences): 全部跳过 shared across the owner's devices.
  guidesPreferences(): Promise<GuidesPreferences> {
    return this.requireClient().request<GuidesPreferences>("GET", "/v2/human/preferences/guides");
  }

  putGuidesPreferences(skippedThrough: string | null): Promise<GuidesPreferences> {
    return this.requireClient().request<GuidesPreferences>("PUT", "/v2/human/preferences/guides", { body: { schema: 1, skippedThrough } });
  }

  // Extra usage sources (cutex usage-external-sources): Claude Code / Codex CLI / ZCode directories cutex imports.
  async usageSources(): Promise<UsageSourcesView | null> {
    try {
      return await this.requireClient().request<UsageSourcesView>("GET", "/v2/usage/sources");
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  private async usageSourceCall(method: "POST" | "PATCH", path: string, body?: Record<string, unknown>): Promise<UsageSourceResult> {
    try {
      return { ok: true, source: await this.requireClient().request<UsageSource>(method, path, body === undefined ? {} : { body }) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  addUsageSource(source: UsageSourceCreate): Promise<UsageSourceResult> {
    if (!(USAGE_SOURCE_KINDS as readonly string[]).includes(source.kind)) throw new Error("bad usage source kind");
    if (typeof source.path !== "string" || !source.path.trim() || source.path.length > 4096) throw new Error("bad usage source path");
    const body: Record<string, unknown> = { kind: source.kind, path: source.path.trim() };
    if (source.label?.trim()) body.label = source.label.trim();
    if (source.billing === "subscription" || source.billing === "api") body.billing = source.billing;
    if (typeof source.enabled === "boolean") body.enabled = source.enabled;
    return this.usageSourceCall("POST", "/v2/usage/sources", body);
  }

  private usageSourcePath(id: string, rest = ""): string {
    if (typeof id !== "string" || !USAGE_SOURCE_ID.test(id)) throw new Error("bad usage source id");
    return `/v2/usage/sources/${encodeURIComponent(id)}${rest}`;
  }

  patchUsageSource(id: string, patch: UsageSourcePatch): Promise<UsageSourceResult> {
    const body: Record<string, unknown> = {};
    if (typeof patch.path === "string") body.path = patch.path.trim();
    if (typeof patch.label === "string") body.label = patch.label.trim();
    if (patch.billing === "subscription" || patch.billing === "api") body.billing = patch.billing;
    if (typeof patch.enabled === "boolean") body.enabled = patch.enabled;
    return this.usageSourceCall("PATCH", this.usageSourcePath(id), body);
  }

  async deleteUsageSource(id: string, purge: boolean): Promise<UsageSourceDeleteResult> {
    const path = this.usageSourcePath(id);
    try {
      const r = await this.requireClient().request<{ purged?: boolean }>("DELETE", path, { query: { purge: purge ? "true" : undefined } });
      return { ok: true, purged: r.purged === true };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  rescanUsageSource(id: string): Promise<UsageSourceResult> {
    return this.usageSourceCall("POST", this.usageSourcePath(id, "/rescan"));
  }

  // ---------- workspace (cutex project / session file, git routes) ----------

  private scopePath(scope: WorkspaceScope): string {
    return `/v2/${scope.kind === "project" ? "projects" : "sessions"}/${encodeURIComponent(scope.id)}`;
  }

  fsDir(scope: WorkspaceScope, path: string): Promise<FsDir> {
    return this.requireClient().request<FsDir>("GET", `${this.scopePath(scope)}/fs/dir`, { query: { path } });
  }

  fsFile(scope: WorkspaceScope, path: string, maxBytes?: number): Promise<FsFile> {
    return this.requireClient().request<FsFile>("GET", `${this.scopePath(scope)}/fs/file`, { query: { path, maxBytes } });
  }

  /** Owner-only host file read (cutex fs-file-read): previews a file outside every workspace root. */
  hostFile(path: string, maxBytes?: number): Promise<FsFile> {
    return this.requireClient().request<FsFile>("GET", "/v2/fs/file", { query: { path, maxBytes } });
  }

  /** Main-only byte transport; never exposed through DaemonApi or the renderer. */
  async copyTransport(source: CopySource, check: () => void) {
    const client = this.requireClient(), generation = this.generation;
    const caps = await this.capabilities();
    check();
    if (!caps?.featureList?.includes("fs-file-transfer-v1")) throw new Error("file transfer is unavailable on this host");
    if (source.artifact && !caps.featureList.includes("artifacts")) throw new Error("artifact reads are unavailable on this host");
    return remoteCopyTransport(client, source, () => {
      check();
      if (this.client !== client || this.generation !== generation) throw new Error("source connection changed");
    });
  }

  fsSearch(scope: WorkspaceScope, q: string, limit?: number) {
    return this.requireClient().request<{ query: string; results: { path: string; score: number }[] }>("GET", `${this.scopePath(scope)}/fs/search`, { query: { q, limit } });
  }

  gitStatus(scope: WorkspaceScope): Promise<GitStatus> {
    return this.requireClient().request<GitStatus>("GET", `${this.scopePath(scope)}/git/status`);
  }

  gitDiff(scope: WorkspaceScope, path?: string, staged?: boolean) {
    return this.requireClient().request<{ path: string | null; staged: boolean; diff: string; truncated: boolean }>("GET", `${this.scopePath(scope)}/git/diff`, {
      query: { path, staged: staged === undefined ? undefined : String(staged) },
    });
  }

  async watchWorkspace(scope: WorkspaceScope): Promise<string> {
    const watchId = randomUUID();
    let readies = 0;
    const handle = openStream(
      this.requireClient(),
      `${this.scopePath(scope)}/fs/watch`,
      {
        onMessage: (message) => {
          // `ready` again = the stream reconnected (dropped, or idle past the keepalive): changes in
          // the gap were not reported, so the views reload everything they show once.
          if (message.event === "ready") {
            if (readies++ > 0) this.emit("workspaceChanged", { watchId, paths: [], gitChanged: true, overflow: true });
            return;
          }
          if (message.event !== "changed") return;
          const data = JSON.parse(message.data) as { paths: string[]; gitChanged: boolean; overflow: boolean };
          this.emit("workspaceChanged", { watchId, paths: data.paths, gitChanged: data.gitChanged, overflow: data.overflow });
        },
      },
      // cutex sends `: keepalive` every 15 s: three missed = a half-open connection, reconnect.
      { reconnect: true, idleTimeoutMs: WATCH_IDLE_TIMEOUT_MS },
    );
    this.watches.set(watchId, handle);
    return watchId;
  }

  async unwatchWorkspace(watchId: string): Promise<void> {
    this.watches.get(watchId)?.close();
    this.watches.delete(watchId);
  }

  async terminalList(scope: WorkspaceScope): Promise<TerminalSummary[]> {
    const r = await this.requireClient().request<{ terminals?: TerminalSummary[] }>("GET", `${this.scopePath(scope)}/terminals`);
    return r.terminals ?? [];
  }

  terminalCreate(scope: WorkspaceScope, cols: number, rows: number): Promise<TerminalSummary> {
    return this.requireClient().request<TerminalSummary>("POST", `${this.scopePath(scope)}/terminals`, { body: { cols, rows } });
  }

  async terminalAttach(terminalId: string): Promise<void> {
    if (this.terminals.has(terminalId)) return;
    const handle = openStream(
      this.requireClient(),
      `/v2/terminals/${encodeURIComponent(terminalId)}/stream`,
      {
        onMessage: (message) => {
          if (message.event === "output") {
            const d = JSON.parse(message.data) as { data: string; replay?: boolean; reset?: boolean };
            this.emit("terminalOutput", { terminalId, data: d.data, replay: !!d.replay, reset: !!d.reset });
          } else if (message.event === "exit") {
            const d = JSON.parse(message.data) as { exitCode: number | null };
            this.emit("terminalExit", { terminalId, exitCode: d.exitCode ?? null });
            this.terminals.get(terminalId)?.close();
            this.terminals.delete(terminalId);
          }
        },
      },
      { reconnect: true },
    );
    this.terminals.set(terminalId, handle);
  }

  async terminalDetach(terminalId: string): Promise<void> {
    this.terminals.get(terminalId)?.close();
    this.terminals.delete(terminalId);
  }

  async terminalInput(terminalId: string, data: string): Promise<void> {
    await this.requireClient().request("POST", `/v2/terminals/${encodeURIComponent(terminalId)}/input`, { body: { data } });
  }

  async terminalResize(terminalId: string, cols: number, rows: number): Promise<void> {
    await this.requireClient().request("POST", `/v2/terminals/${encodeURIComponent(terminalId)}/resize`, { body: { cols, rows } });
  }

  async terminalKill(terminalId: string): Promise<void> {
    await this.terminalDetach(terminalId);
    await this.requireClient().request("DELETE", `/v2/terminals/${encodeURIComponent(terminalId)}`);
  }

  async codexRequest(method: string, params?: unknown): Promise<unknown> {
    const response = await this.requireClient().request<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }>("POST", "/v2/codex/requests", {
      body: { requestId: randomUUID(), method, params: params ?? null },
    });
    if (response.error) throw new Error(response.error.message || `codex error ${response.error.code}`);
    return response.result;
  }

  // Skills archive (cutex skills-archive): user skills moved out of the shared CODEX_HOME and back.
  async skillArchives(): Promise<SkillArchiveList | null> {
    try {
      return await this.requireClient().request<SkillArchiveList>("GET", "/v2/codex/skills/archive");
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  private async skillArchiveCall(path: string, body: Record<string, unknown>): Promise<SkillArchiveResult> {
    try {
      const r = await this.requireClient().request<{ archive: SkillArchiveRecord }>("POST", path, { body: { requestId: randomUUID(), ...body } });
      return { ok: true, archive: r.archive };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  archiveSkill(path: string): Promise<SkillArchiveResult> {
    if (typeof path !== "string" || !path || path.length > 4096) throw new Error("bad skill path");
    return this.skillArchiveCall("/v2/codex/skills/archive", { path });
  }

  restoreSkill(archiveId: string): Promise<SkillArchiveResult> {
    if (typeof archiveId !== "string" || !SKILL_ARCHIVE_ID.test(archiveId)) throw new Error("bad archive id");
    return this.skillArchiveCall(`/v2/codex/skills/archive/${encodeURIComponent(archiveId)}/restore`, {});
  }

  // ---------- 自己的名字 (formal-agent-name-rename-v1) ----------

  async renameFormalAgent(id: string, request: FormalRenameRequest): Promise<FormalRenameResult> {
    if (!validRenameTarget(id) || !validRenameRequest(request)) throw new Error("bad rename request");
    const body = { requestId: request.requestId, expectedRevision: request.expectedRevision, name: request.name };
    try {
      const r = await this.requireClient().request<{ event: NameHistoryEvent; replayed?: boolean; session?: SessionResource | null }>("POST", `/v2/human/agents/${encodeURIComponent(id)}/rename`, { body });
      return { ok: true, event: r.event, replayed: r.replayed === true, session: r.session ?? null };
    } catch (error) {
      if (error instanceof CutexApiError) {
        const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
        const holders = holderIds(error.details);
        // 503 persistence_unavailable / admission_busy made no rename: the same request may go again.
        return { ok: false, error: { code: error.code, message, retrySame: error.status >= 500, ...(holders ? { holderSessionIds: holders } : {}) } };
      }
      // No answer: it may have been renamed. Only the exact same request may be replayed.
      return { ok: false, error: { code: "transport", message: error instanceof Error ? error.message : String(error), retrySame: true } };
    }
  }

  async formalNameHistory(id: string, before: number | null): Promise<NameHistoryPage> {
    if (!validRenameTarget(id) || (before !== null && !(Number.isSafeInteger(before) && before > 0))) throw new Error("bad name history request");
    const r = await this.requireClient().request<{ events?: NameHistoryEvent[]; next?: number | null }>("GET", nameHistoryPath(id, before));
    return { events: Array.isArray(r.events) ? r.events : [], next: typeof r.next === "number" ? r.next : null };
  }

  // ---------- profiles / settings (cutex settings routes) ----------

  private profilePath(profile: string, rest = ""): string {
    return `/v2/profiles/${encodeURIComponent(profile)}${rest}`;
  }

  async listProfiles(): Promise<{ defaultProfile: string | null; profiles: ProfileItem[] } | null> {
    try {
      return await this.requireClient().request<{ defaultProfile: string | null; profiles: ProfileItem[] }>("GET", "/v2/profiles");
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  async getProfile(profile: string): Promise<ProfileDetail> {
    return (await this.requireClient().request<{ profile: ProfileDetail }>("GET", this.profilePath(profile))).profile;
  }

  async patchProfile(profile: string, patch: ProfilePatch): Promise<ProfileDetail> {
    const body: ProfilePatch = { ...patch };
    // Write-only fields are rebuilt here (shared/profileVariants.ts); errors never repeat a key.
    if (body.apiKey !== undefined && body.apiKey !== null) body.apiKey = profileApiKey(body.apiKey);
    if (body.credential !== undefined) body.credential = credentialSourceBody(body.credential);
    if (body.defaultVariant !== undefined && body.defaultVariant !== null) body.defaultVariant = variantIdOf(body.defaultVariant);
    if (body.kimiAccount !== undefined && body.kimiAccount !== null) body.kimiAccount = kimiAccountId(body.kimiAccount);
    return (await this.requireClient().request<{ profile: ProfileDetail }>("PATCH", this.profilePath(profile), { body })).profile;
  }

  // profile-runtime-variants (r265): add / edit / remove a Profile's runtime variants; refusals come back as data.
  async addProfileVariant(profile: string, request: Parameters<DesktopApi["addProfileVariant"]>[1]): Promise<VariantResult> {
    const body = variantAddBody(request);
    return this.variantCall(() => this.requireClient().request<{ variant?: ProfileRuntimeVariant; profile: ProfileDetail }>("POST", `${this.profilePath(profile)}/variants`, { body }));
  }

  async patchProfileVariant(profile: string, variantId: string, defaults: Parameters<DesktopApi["patchProfileVariant"]>[2]): Promise<VariantResult> {
    const body = variantPatchBody(defaults);
    return this.variantCall(() => this.requireClient().request<{ variant?: ProfileRuntimeVariant; profile: ProfileDetail }>("PATCH", `${this.profilePath(profile)}/variants/${encodeURIComponent(variantIdOf(variantId))}`, { body }));
  }

  async deleteProfileVariant(profile: string, variantId: string): Promise<{ ok: true; defaultVariant: string | null; profile?: ProfileDetail } | { ok: false; error: CutexRefusal }> {
    const path = `${this.profilePath(profile)}/variants/${encodeURIComponent(variantIdOf(variantId))}`;
    try {
      const r = await this.requireClient().request<{ defaultVariant?: string | null; profile?: ProfileDetail }>("DELETE", path);
      return { ok: true, defaultVariant: r?.defaultVariant ?? null, ...(r?.profile ? { profile: r.profile } : {}) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  private async variantCall(run: () => Promise<{ variant?: ProfileRuntimeVariant; profile: ProfileDetail }>): Promise<VariantResult> {
    try {
      const r = await run();
      return { ok: true, profile: r.profile, variant: r.variant ?? null };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  // cutex `profile-avatar`: the picture / intro portrait of a profile (owner only, like every profile route).
  async profileImage(profileId: string, kind: ProfileImageKind): Promise<{ dataUrl: string; etag: string | null } | null> {
    const image = await this.requireClient().profileImage(profileId, kind);
    return image ? { dataUrl: `data:${image.contentType};base64,${image.data}`, etag: image.etag } : null;
  }

  async putProfileImage(profileId: string, kind: ProfileImageKind, dataUrl: string | null): Promise<{ etag: string | null }> {
    if (!PROFILE_IMAGE_KINDS.includes(kind)) throw new Error("bad profile image kind");
    if (dataUrl === null) return this.requireClient().putProfileImage(profileId, kind, null);
    const match = typeof dataUrl === "string" ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl) : null;
    // base64 grows 4/3; cutex checks the decoded size and the image itself.
    if (!match || match[2]!.length > Math.ceil(PROFILE_IMAGE_MAX_BYTES[kind] / 3) * 4) throw new Error("bad profile image");
    return this.requireClient().putProfileImage(profileId, kind, { contentType: match[1] as AvatarContentType, data: match[2]! });
  }

  async createProfile(request: ProfileCreateBody): Promise<ProfileDetail> {
    // Forward only the known fields (cutex validates kind / preset / URL).
    const body: Record<string, unknown> = { name: request.name.trim(), kind: request.kind };
    for (const k of ["preset", "baseUrl", "model"] as const) {
      const v = request[k]?.trim();
      if (v) body[k] = v;
    }
    if (request.interfaceBaseUrls !== undefined) {
      if (request.kind !== "apiKey" && request.kind !== "dsh") throw new Error("interface base URLs are only valid for API-key or DSH profiles");
      const urls = request.interfaceBaseUrls;
      if (!urls || typeof urls !== "object" || Array.isArray(urls)) throw new Error("bad interface base URLs");
      // Rebuild the allow-listed interface map; never forward arbitrary renderer fields.
      body.interfaceBaseUrls = urls.deepseekNative === undefined ? {} : { deepseekNative: variantBaseUrl(urls.deepseekNative) };
    }
    if (request.kind === "dsh") {
      const dsh = request.options?.dsh;
      // profile-runtime-variants: a stored key or a named variable replaces the legacy env default (no fallback).
      const ownCredential = request.apiKey !== undefined || request.credential !== undefined;
      // No (valid) model: leave it out and cutex picks its default — main writes no model name of its own.
      const model = typeof dsh?.model === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(dsh.model.trim()) ? dsh.model.trim() : null;
      body.options = { dsh: { ...(model ? { model } : {}), ...(ownCredential ? {} : { apiKeyEnv: "DEEPSEEK_API_KEY" }), ...(dsh?.reasoningEffort && ["off", "low", "high", "max"].includes(dsh.reasoningEffort) ? { reasoningEffort: dsh.reasoningEffort } : {}) } };
      if (request.credential !== undefined) body.credential = credentialSourceBody(request.credential);
    }
    // Write-only: an API-key or DSH profile's key, in this one request (never logged or returned).
    if (request.apiKey !== undefined) {
      if (request.kind !== "apiKey" && request.kind !== "dsh") throw new Error("apiKey is only valid for API-key or DSH profiles");
      const key = writeOnlyApiKey(request.apiKey);
      if (request.credential?.source !== "env") body.apiKey = key;
    }
    // claude-accounts: a Claude profile's account (a well-formed id; `default` = leave it out).
    if (request.kind === "claude" && request.claudeAccount !== undefined && request.claudeAccount !== DEFAULT_CLAUDE_ACCOUNT) body.claudeAccount = claudeAccountId(request.claudeAccount);
    // kimi-runtime-profiles: the account is the credential; Kimi relay addresses use the primary baseUrl.
    if (request.kind === "kimi") {
      for (const k of ["preset", "model"] as const) delete body[k];
      if (request.baseUrl !== undefined) body.baseUrl = variantBaseUrl(request.baseUrl);
      if (request.kimiAccount !== undefined) body.kimiAccount = kimiAccountId(request.kimiAccount);
    }
    return profileOf(await this.requireClient().request<{ profile: ProfileDetail }>("POST", "/v2/profiles", { body }));
  }

  /** cutex's API-key presets (the renderer's lib/profilePresets.ts checks each item); null = no such route (older cutex). */
  async profilePresets(): Promise<ProfilePreset[] | null> {
    try {
      const reply = await this.requireClient().request<{ presets?: unknown }>("GET", "/v2/profile-presets");
      return Array.isArray(reply.presets) ? (reply.presets as ProfilePreset[]) : null;
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  async duplicateProfile(profile: string, name: string): Promise<ProfileDetail> {
    return profileOf(await this.requireClient().request<{ profile: ProfileDetail }>("POST", this.profilePath(profile, "/duplicate"), { body: { name: name.trim() } }));
  }

  /** cutex `profile-import-cc-switch`: CC Switch's providers on the host (never with keys); null = no such route (older cutex). */
  async ccSwitchImportList(): Promise<CcSwitchImportList | null> {
    try {
      return await this.requireClient().request<CcSwitchImportList>("GET", "/v2/profile-imports/cc-switch");
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  /** cutex `profile-import-cc-switch`: the body is rebuilt from known fields (shared/ccSwitchImport.ts). */
  ccSwitchImport(items: CcSwitchImportItem[]): Promise<CcSwitchImportResult> {
    return this.requireClient().request<CcSwitchImportResult>("POST", "/v2/profile-imports/cc-switch", { body: ccSwitchImportBody(items) });
  }

  /**
   * profile-transfer, MAIN ONLY (never an IPC method: not in DaemonApi / ALLOWED): the reply's bundle
   * may hold an API key. Used by main/profileTransfer.ts through HostManager.copyProfileToHost.
   */
  exportProfileBundle(profile: string, includeCredentials: boolean): Promise<ExportReply> {
    return this.requireClient().request<ExportReply>("POST", this.profilePath(profile, "/export"), { body: { includeCredentials } });
  }

  /** profile-transfer, MAIN ONLY: create a new profile from a bundle (cutex refuses a name clash). */
  importProfileBundle(bundle: unknown, name: string): Promise<ImportReply> {
    return this.requireClient().request<ImportReply>("POST", "/v2/profiles/import", { body: { bundle, name: name.trim(), onConflict: "fail" } });
  }

  deleteProfile(profile: string, options?: { archived?: "detach" }): Promise<MutationResult> {
    const query = options?.archived === "detach" ? "?archived=detach" : "";
    return mutation(() => this.requireClient().request("DELETE", this.profilePath(profile, query)));
  }

  profileModels(profile: string): Promise<ProfileModelsView> {
    return this.requireClient().request<ProfileModelsView>("GET", this.profilePath(profile, "/models"));
  }

  discoverModels(profile: string): Promise<ProfileModelsView> {
    return this.requireClient().request<ProfileModelsView>("POST", this.profilePath(profile, "/models/discover"), { body: { apply: true } });
  }

  patchModel(profile: string, modelId: string, patch: CatalogModelPatch): Promise<ProfileModelsView> {
    return this.requireClient().request<ProfileModelsView>("PATCH", this.profilePath(profile, `/models/${encodeURIComponent(modelId)}`), { body: patch });
  }

  deleteModel(profile: string, modelId: string): Promise<ProfileModelsView> {
    return this.requireClient().request<ProfileModelsView>("DELETE", this.profilePath(profile, `/models/${encodeURIComponent(modelId)}`));
  }

  resetModel(profile: string, modelId: string): Promise<ProfileModelsView> {
    return this.requireClient().request<ProfileModelsView>("POST", this.profilePath(profile, `/models/${encodeURIComponent(modelId)}/reset`), { body: {} });
  }

  getSettings(): Promise<GlobalSettings> {
    return this.requireClient().request<GlobalSettings>("GET", "/v2/settings");
  }

  patchAgentSecurity(patch: AgentSecurityPatch): Promise<GlobalSettings> {
    // Only the writable fields: cutex rejects unknown ones (the view's options / limits).
    const body: Record<string, unknown> = {};
    if (patch.crossProjectAccess === "isolated" || patch.crossProjectAccess === "host") body.crossProjectAccess = patch.crossProjectAccess;
    if (Array.isArray(patch.links)) body.links = patch.links.filter((l) => Array.isArray(l) && l.length === 2 && l.every((k) => typeof k === "string")).map(([a, b]) => [a, b]);
    if (Array.isArray(patch.externalAgents)) {
      body.externalAgents = patch.externalAgents
        .filter((g) => g && typeof g.project === "string" && typeof g.agent === "string")
        .map((g) => ({ project: g.project, agent: g.agent }));
    }
    return this.requireClient().request<GlobalSettings>("PATCH", "/v2/settings", { body: { agentSecurity: body } });
  }

  private async ownerPagesContext() {
    const client = this.requireClient(), generation = this.gen, access = this.accessRevision;
    const caps = await this.readCapabilities(client);
    const verify = () => {
      this.assertInputScope(client, generation);
      if (access !== this.accessRevision) throw new Error("access changed");
    };
    verify();
    return { client, verify, paged: caps?.featureList?.includes(NOTIFICATION_PAGES_FEATURE) === true };
  }

  private noteApprovalDuringRead(record: ApprovalRecord, client = this.client): void {
    for (const read of this.approvalReads) if (read.client === client) read.changes.set(record.approvalId, record);
  }

  async approvals(state: "pending" | "all"): Promise<ApprovalRecord[] | null> {
    const { client, verify, paged } = await this.ownerPagesContext();
    const read = { client, changes: new Map<string, ApprovalRecord>() };
    this.approvalReads.add(read);
    try {
      const records = paged ? await collectOwnerPages(async (cursor, limit) => {
        const page = await client.approvalsPage<ApprovalRecord>(state, { limit, cursor });
        verify();
        return page ? { items: page.approvals, nextCursor: page.nextCursor } : null;
      }) : await client.approvals<ApprovalRecord>(state);
      verify();
      if (records === null || read.changes.size === 0) return records;
      const rows = new Map(records.map(record => [record.approvalId, record]));
      for (const record of read.changes.values()) {
        if (state === "pending" && record.state !== "pending") rows.delete(record.approvalId);
        else rows.set(record.approvalId, record);
      }
      return [...rows.values()].sort((a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) || 0);
    } finally {
      this.approvalReads.delete(read);
    }
  }

  async approvalsPage(state: "pending" | "all", query: OwnerStorePageQuery = {}): Promise<ApprovalPage<ApprovalRecord> | null> {
    const { client, verify, paged } = await this.ownerPagesContext();
    const request = ownerPageQuery(query);
    if (!paged) {
      if (request.cursor) throw new Error("owner-store pages unavailable");
      const records = await client.approvals<ApprovalRecord>(state);
      verify();
      return records === null ? null : { approvals: records };
    }
    const page = await client.approvalsPage<ApprovalRecord>(state, request);
    verify();
    return page;
  }

  async decideApproval(approvalId: string, decision: ApprovalDecision, note?: string, origin?: ApprovalDecisionOrigin): Promise<ApprovalDecisionResult> {
    const client = this.requireClient();
    // approval-decided-by: the renderer passes an origin only to a cutex that has it (older ones refuse `client`).
    const facts = approvalClientFacts(origin, app.getVersion(), hostname());
    try {
      const approval = await client.decideApproval<ApprovalRecord>(approvalId, decision, note, facts);
      this.noteApprovalDuringRead(approval, client);
      return { ok: true, approval };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  async approvalRules(): Promise<ApprovalRulesView | null> {
    try {
      return await this.requireClient().request<ApprovalRulesView>("GET", "/v2/approval-rules");
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  confirmApprovalRule(rule: ApprovalRuleDraft, typedPhrase: string): Promise<{ confirmationToken: string; requiredPhrase: string; expiresInSeconds: number }> {
    if (typeof typedPhrase !== "string" || typedPhrase.length > 500) throw new Error("bad approval rule confirmation");
    return this.requireClient().request("POST", "/v2/approval-rules/confirm", { body: { rule: approvalRuleBody(rule), typedPhrase } });
  }

  createApprovalRule(expectedRevision: number, rule: ApprovalRuleDraft, confirmationToken?: string): Promise<ApprovalRuleMutation> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("bad approval rule revision");
    return this.requireClient().request("POST", "/v2/approval-rules", { body: { expectedRevision, rule: approvalRuleBody(rule), ...(confirmationToken ? { confirmationToken } : {}) } });
  }

  patchApprovalRule(ruleId: string, expectedRevision: number, rule: ApprovalRuleDraft, confirmationToken?: string): Promise<ApprovalRuleMutation> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("bad approval rule revision");
    return this.requireClient().request("PATCH", `/v2/approval-rules/${encodeURIComponent(approvalRuleId(ruleId))}`, { body: { expectedRevision, rule: approvalRuleBody(rule), ...(confirmationToken ? { confirmationToken } : {}) } });
  }

  deleteApprovalRule(ruleId: string, expectedRevision: number): Promise<ApprovalRuleMutation> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("bad approval rule revision");
    return this.requireClient().request("DELETE", `/v2/approval-rules/${encodeURIComponent(approvalRuleId(ruleId))}`, { body: { expectedRevision } });
  }

  approvalRuleAudit(cursor = 0, limit = 100): Promise<ApprovalRuleAuditPage> {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("bad approval rule audit query");
    return this.requireClient().request("GET", "/v2/approval-rules/audit", { query: { cursor, limit } });
  }

  runtimePackages(): Promise<RuntimePackagesView | null> {
    return this.requireClient().runtimePackages<RuntimePackagesView>();
  }

  runtimePackageRun(runId: string): Promise<RuntimePackageRun | null> {
    if (typeof runId !== "string" || !/^rpu-[A-Za-z0-9-]{1,80}$/.test(runId)) throw new Error("bad run id");
    return this.requireClient().runtimePackageRun<RuntimePackageRun>(runId);
  }

  async startRuntimePackageRun(agentIds?: string[]): Promise<RuntimePackageRunResult> {
    checkAgentIds(agentIds);
    return this.runtimePackageRunCall(() => this.requireClient().startRuntimePackageRun<RuntimePackageRun>(agentIds === undefined ? { all: true } : { agentIds: [...agentIds] }));
  }

  async revertRuntimePackageRun(runId: string, agentIds?: string[]): Promise<RuntimePackageRunResult> {
    if (typeof runId !== "string" || !/^rpu-[A-Za-z0-9-]{1,80}$/.test(runId)) throw new Error("bad run id");
    checkAgentIds(agentIds);
    return this.runtimePackageRunCall(() => this.requireClient().revertRuntimePackageRun<RuntimePackageRun>(runId, agentIds));
  }

  directorRotations(projectId: string): Promise<DirectorRotation[] | null> {
    if (typeof projectId !== "string" || !projectId || projectId.length > 200) throw new Error("bad project id");
    return this.requireClient().directorRotations<DirectorRotation>(projectId, 20);
  }

  directorRotation(rotationId: string): Promise<DirectorRotation | null> {
    if (typeof rotationId !== "string" || !ROTATION_ID.test(rotationId)) throw new Error("bad rotation id");
    return this.requireClient().directorRotation<DirectorRotation>(rotationId);
  }

  startDirectorRotation(request: DirectorRotationStart): Promise<DirectorRotationResult> {
    const body = directorRotationBody(request);
    return this.directorRotationCall(() => this.requireClient().startDirectorRotation<DirectorRotation>(body));
  }

  cancelDirectorRotation(rotationId: string): Promise<DirectorRotationResult> {
    if (typeof rotationId !== "string" || !ROTATION_ID.test(rotationId)) throw new Error("bad rotation id");
    return this.directorRotationCall(() => this.requireClient().directorRotationAction<DirectorRotation>(rotationId, "cancel"));
  }

  continueDirectorRotation(rotationId: string): Promise<DirectorRotationResult> {
    if (typeof rotationId !== "string" || !ROTATION_ID.test(rotationId)) throw new Error("bad rotation id");
    return this.directorRotationCall(() => this.requireClient().directorRotationAction<DirectorRotation>(rotationId, "continue"));
  }

  delegationUpgradeSnapshot(projectId: string, cursor?: string) {
    return readDelegationUpgrade(this.requireClient(),projectId,cursor);
  }
  delegationUpgradeAction(projectId: string, action: import("../shared/delegationUpgradePreview").UpgradeAction) {
    return executeDelegationUpgrade(this.requireClient(),projectId,action);
  }
  async delegationUpgradeApproval(approvalId: string) {
    return projectDelegationApproval(await this.requireClient().delegationApproval(approvalId));
  }
  async delegationRoutingApprovals(projectId: string) {
    if (!/^(?!\.+$)[A-Za-z0-9_.:-]{1,256}$/.test(projectId)) throw new Error("bad project identifier");
    const result = await this.requireClient().request<{ routingApprovals: import("@cutex-desktop/protocol").DelegationApproval[] }>("GET", `/v2/projects/${projectId}/delegation-approvals`, { query: { state: "pending" } });
    return result.routingApprovals.map(projectDelegationApproval);
  }
  delegationUpgradeOperation(actionId: string) {
    return this.requireClient().delegationOperation(actionId);
  }
  async delegationRetirementReview(projectId: string, request: import("@cutex-desktop/protocol").PermanentRetirementReviewRequest) {
    const client=this.requireClient();
    const caps=await client.capabilities<{featureList:string[];user?:unknown}>();
    if (!caps?.featureList.includes("agent-archive-kind-v1") || !userAccessOf(caps).isOwner) throw new Error("retirement_review_unavailable");
    const workspace=await client.project(projectId);
    if (![...workspace.active_agents,...workspace.retired_agents,...(workspace.archived_agents??[])].some(row=>row.agent.cutex_session_id===request.cutex_session_id)&&workspace.director?.cutex_session_id!==request.cutex_session_id) throw new Error("member_scope_changed");
    return client.permanentRetirementReview(request);
  }

  async busMessageEvidence(request: { messageId: string }): Promise<import("../shared/ipc").MessageSettlementEvidenceResult> {
    const body = messageSettlementEvidenceBody(request);
    try {
      return { ok: true, result: await this.requireClient().busMessageEvidence(body) };
    } catch (error) {
      if (error instanceof CutexApiError) return { ok: false, error: { code: error.code, message: error.message, status: error.status } };
      throw error;
    }
  }

  async closeBusMessage(request: import("@cutex-desktop/protocol").MessageSettlementCloseRequest): Promise<import("../shared/ipc").MessageSettlementCloseResult> {
    const body = messageSettlementCloseBody(request);
    try {
      return { ok: true, result: await this.requireClient().closeBusMessage(body) };
    } catch (error) {
      if (error instanceof CutexApiError) return { ok: false, error: { code: error.code, message: error.message, status: error.status } };
      throw error;
    }
  }

  async stuckBusMessages(minAgeSecs: number): Promise<StuckBusView | null> {
    const wanted = cleanMinAge(minAgeSecs);
    const raw = await this.requireClient().stuckBusMessages(wanted);
    return raw === null ? null : asStuckView(raw, wanted);
  }

  async discardStuckBusMessage(request: StuckBusDiscardRequest): Promise<StuckBusDiscardResult> {
    const body = stuckDiscardRequest(request);
    try {
      return { ok: true, discarded: asStuckDiscarded(await this.requireClient().discardStuckBusMessage(body), body.messageId) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  private async directorRotationCall(call: () => Promise<DirectorRotation>): Promise<DirectorRotationResult> {
    try {
      return { ok: true, rotation: await call() };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  runtimePrunePlan() { return this.requireClient().runtimePrunePlan(); }

  pruneRuntimes(ids: string[]) { return this.requireClient().pruneRuntimes(ids); }

  runtimes(): Promise<RuntimesWire | null> {
    return this.requireClient().runtimes<RuntimesWire>();
  }

  // Claude accounts: bodies are rebuilt from known fields here (shared/claudeAccounts.ts); an API key
  // passes only as the write-only `apiKey` of create / setClaudeAccountKey; logins run in the owner's terminal.
  claudeAccounts(): Promise<ClaudeAccountList | null> {
    return this.requireClient().claudeAccounts<ClaudeAccountList>();
  }

  createClaudeAccount(request: ClaudeAccountCreate): Promise<ClaudeAccountResult> {
    const body = claudeAccountCreateBody(request);
    // cutex-client's createClaudeAccount refuses `apiKey` (its keyless contract); the inline key goes
    // through the plain request with the same route and refusal handling.
    if (body.apiKey !== undefined) return this.claudeAccountCall(() => this.requireClient().request<ClaudeAccount>("POST", "/v2/claude/accounts", { body: { ...body } }));
    return this.claudeAccountCall(() => this.requireClient().createClaudeAccount<ClaudeAccount>(body));
  }

  renameClaudeAccount(id: string, label: string): Promise<ClaudeAccountResult> {
    const accountId = claudeAccountId(id);
    const patch = claudeAccountRenameBody(label);
    return this.claudeAccountCall(() => this.requireClient().updateClaudeAccount<ClaudeAccount>(accountId, patch));
  }

  /** Write-only: the key goes to cutex in this one request and is not kept, logged or returned. */
  setClaudeAccountKey(id: string, apiKey: string): Promise<ClaudeAccountResult> {
    const accountId = claudeAccountId(id);
    const patch = claudeAccountKeyBody(apiKey);
    return this.claudeAccountCall(() => this.requireClient().updateClaudeAccount<ClaudeAccount>(accountId, patch));
  }

  async deleteClaudeAccount(id: string): Promise<ClaudeAccountRemoveResult> {
    const accountId = claudeAccountId(id);
    try {
      return { ok: true, removed: await this.requireClient().deleteClaudeAccount<ClaudeAccountRemoved>(accountId) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  checkClaudeAccount(id: string): Promise<ClaudeAccountResult> {
    const accountId = claudeAccountId(id);
    return this.claudeAccountCall(() => this.requireClient().checkClaudeAccount<ClaudeAccount>(accountId));
  }

  // Kimi accounts (r266): ids / labels checked here; the login runs on the host (cutex drives `kimi login`), the
  // desktop only shows its URL / code and polls. No token ever passes through the desktop.
  async kimiAccounts(): Promise<KimiAccountList | null> {
    try {
      return await this.requireClient().request<KimiAccountList>("GET", "/v2/kimi/accounts");
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  createKimiAccount(request: { label: string; region?: string }): Promise<KimiAccountResult> {
    const body = kimiAccountCreateBody(request);
    return this.kimiCall((account) => ({ ok: true, account }), () => this.requireClient().request<KimiAccount>("POST", "/v2/kimi/accounts", { body }));
  }

  renameKimiAccount(id: string, label: string): Promise<KimiAccountResult> {
    const path = this.kimiAccountPath(id);
    const body = kimiAccountRenameBody(label);
    return this.kimiCall((account) => ({ ok: true, account }), () => this.requireClient().request<KimiAccount>("PATCH", path, { body }));
  }

  deleteKimiAccount(id: string): Promise<KimiAccountRemoveResult> {
    const path = this.kimiAccountPath(id);
    return this.kimiCall((removed) => ({ ok: true, removed }), () => this.requireClient().request<KimiAccountRemoved>("DELETE", path));
  }

  checkKimiAccount(id: string): Promise<KimiAccountResult> {
    const path = `${this.kimiAccountPath(id)}/status`;
    return this.kimiCall((account) => ({ ok: true, account }), () => this.requireClient().request<KimiAccount>("POST", path, { body: {} }));
  }

  logoutKimiAccount(id: string): Promise<KimiAccountResult> {
    const path = `${this.kimiAccountPath(id)}/logout`;
    return this.kimiCall((account) => ({ ok: true, account }), () => this.requireClient().request<KimiAccount>("POST", path, { body: {} }));
  }

  startKimiLogin(id: string): Promise<KimiLoginResult> {
    const path = `${this.kimiAccountPath(id)}/login`;
    return this.kimiCall((login) => ({ ok: true, login }), () => this.requireClient().request<KimiLogin>("POST", path, { body: {} }));
  }

  kimiLogin(id: string, loginId: string): Promise<KimiLoginResult> {
    const path = `${this.kimiAccountPath(id)}/login/${encodeURIComponent(kimiLoginId(loginId))}`;
    return this.kimiCall((login) => ({ ok: true, login }), () => this.requireClient().request<KimiLogin>("GET", path));
  }

  cancelKimiLogin(id: string, loginId: string): Promise<KimiLoginResult> {
    const path = `${this.kimiAccountPath(id)}/login/${encodeURIComponent(kimiLoginId(loginId))}`;
    return this.kimiCall((login) => ({ ok: true, login }), () => this.requireClient().request<KimiLogin>("DELETE", path));
  }

  private kimiAccountPath(id: string): string {
    return `/v2/kimi/accounts/${encodeURIComponent(kimiAccountId(id))}`;
  }

  private async kimiCall<T, R>(ok: (value: T) => R, call: () => Promise<T>): Promise<R | { ok: false; error: CutexRefusal }> {
    try {
      return ok(await call());
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  private async claudeAccountCall(call: () => Promise<ClaudeAccount>): Promise<ClaudeAccountResult> {
    try {
      return { ok: true, account: await call() };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  private async runtimePackageRunCall(start: () => Promise<RuntimePackageRun>): Promise<RuntimePackageRunResult> {
    try {
      return { ok: true, run: await start() };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  async createPairingCode(label?: string, userId?: string, scope?: DeviceScope): Promise<PairingCodeView> {
    if (scope !== undefined && scope !== null && !DEVICE_SCOPES.includes(scope)) throw new Error("bad scope");
    // The reply carries a one-time code: returned to the renderer only, never logged here.
    const r = await this.requireClient().createPairingCode(typeof label === "string" ? label : undefined, { ...(typeof userId === "string" ? { userId } : {}), ...(scope ? { scope } : {}) });
    const bound = (r as { userId?: unknown }).userId;
    const ttl = r.ttlSeconds;
    const granted = readDeviceScope(r.scope);
    return {
      code: r.code, expiresAt: r.expiresAt, label: r.label ?? null, hostId: r.hostId, ...(r.instanceId ? { instanceId: r.instanceId } : {}), urls: Array.isArray(r.urls) ? r.urls : [], qr: r.qr,
      ...(typeof bound === "string" ? { userId: bound } : {}),
      // owner-device-notice / device-scope (absent on older hosts).
      ...(typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? { ttlSeconds: ttl } : {}),
      ...(granted ? { scope: granted } : {}),
      ...(typeof r.ownerDevice === "boolean" ? { ownerDevice: r.ownerDevice } : {}),
    };
  }

  async clientTokens(): Promise<ClientTokenView[]> {
    const r = await this.requireClient().clientTokens();
    return (r.tokens ?? []).map((t) => ({
      tokenId: t.tokenId,
      label: t.label,
      kind: t.kind,
      deviceName: t.deviceName ?? null,
      platform: t.platform ?? null,
      ownerName: t.ownerName ?? null,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt ?? null,
      lastAddress: t.lastAddress ?? null,
      // device-scope / owner-local-only (absent on older hosts).
      ...((s) => (s ? { scope: s } : {}))(readDeviceScope(t.scope)),
      ...((v) => (v ? { issuedVia: v } : {}))(readIssuedVia(t.issuedVia)),
    }));
  }

  async revokeClientToken(tokenId: string): Promise<void> {
    if (!isValidTokenId(tokenId)) throw new Error("bad token id");
    await this.requireClient().revokeClientToken(tokenId);
  }

  async renameClientToken(tokenId: string, name: string | null): Promise<{ tokenId: string; ownerName: string | null }> {
    if (!isValidTokenId(tokenId)) throw new Error("bad token id");
    if (name !== null && typeof name !== "string") throw new Error("bad name");
    const r = await this.requireClient().renameClientToken(tokenId, name === null ? null : name.slice(0, 200));
    return { tokenId: r.tokenId, ownerName: r.ownerName ?? null };
  }

  /** `PATCH /v2/client-tokens/{id}` `{name?, scope?}` (client-token-rename / device-scope); refusals as values. */
  updateClientToken(tokenId: string, patch: ClientTokenUpdate): Promise<UsersResult<ClientTokenUpdated>> {
    if (!isValidTokenId(tokenId)) throw new Error("bad token id");
    const body = clientTokenUpdateBody(patch);
    return this.usersCall(async () => {
      const r = await this.requireClient().request<{ tokenId?: unknown; ownerName?: unknown; scope?: unknown }>("PATCH", `/v2/client-tokens/${encodeURIComponent(tokenId)}`, { body });
      return { tokenId: typeof r?.tokenId === "string" ? r.tokenId : tokenId, ownerName: typeof r?.ownerName === "string" ? r.ownerName : null, scope: readDeviceScope(r?.scope) ?? null };
    });
  }

  // ---------- new owner devices (cutex `owner-device-notice`, shared/users.ts) ----------

  /** `GET /v2/users/owner/new-devices`: unacknowledged owner devices; null on a cutex without the route. */
  ownerNewDevices(): Promise<UsersResult<OwnerNewDevice[] | null>> {
    return this.usersCall(async () => {
      try {
        return readOwnerNewDevices(await this.requireClient().request<unknown>("GET", "/v2/users/owner/new-devices"));
      } catch (error) {
        if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
        throw error;
      }
    });
  }

  /** `POST /v2/users/owner/new-devices/{tokenId}/ack` (full owner principals; idempotent). */
  ackOwnerNewDevice(tokenId: string): Promise<UsersResult<OwnerDeviceAck>> {
    if (!isValidTokenId(tokenId)) throw new Error("bad token id");
    return this.usersCall(async () => {
      const r = await this.requireClient().request<{ tokenId?: unknown; acknowledged?: unknown }>("POST", `/v2/users/owner/new-devices/${encodeURIComponent(tokenId)}/ack`);
      return { tokenId: typeof r?.tokenId === "string" ? r.tokenId : tokenId, acknowledged: r?.acknowledged === true };
    });
  }

  // ---------- online desktops (cutex `client-remote-close`, shared/remoteClose.ts) ----------

  /** `GET /v2/clients`; `self` = this launch's instance (main/clientPresence.ts CLIENT_INSTANCE). */
  onlineClients(): Promise<RemoteCloseResult<OnlineClientView[]>> {
    return this.remoteCloseCall(async () => (await this.requireClient().onlineClients()).map((c) => ({ ...c, self: c.instanceId === CLIENT_INSTANCE })));
  }

  /** `POST /v2/clients/{instanceId}/close` (the contract's 15 s countdown); refusals as values. */
  closeOnlineClient(instanceId: string): Promise<RemoteCloseResult<{ instanceId: string; state: ClientState }>> {
    if (typeof instanceId !== "string" || !CLIENT_INSTANCE_ID.test(instanceId)) throw new Error("bad instance id");
    if (instanceId === CLIENT_INSTANCE) throw new Error("this desktop is closed from its own window");
    return this.remoteCloseCall(() => this.requireClient().closeClient(instanceId));
  }

  private async remoteCloseCall<T>(run: () => Promise<T>): Promise<RemoteCloseResult<T>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      if (error instanceof CutexApiError) {
        const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
        return { ok: false, error: { code: error.code, message } };
      }
      throw error;
    }
  }

  patchSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings & { restartRequired: string[] }> {
    // newThreadDefaults has its own patch shape (null = reset); it goes through patchNewThreadDefaults.
    // agentSecurity too (patchAgentSecurity): the view carries read-only fields cutex would reject.
    // listen-settings: only managementListen / managementCorsOrigins are writable.
    const {
      newThreadDefaults: _current,
      newThreadDefaultsBuiltin: _builtin,
      agentSecurity: _security,
      managementListenDefault: _listenDefault,
      managementListenEntries: _listenEntries,
      managementListenActiveRemote: _listenActive,
      managementCorsOriginsDefault: _corsDefault,
      remoteAccess: _remoteAccess,
      // owner-notify: through patchOwnerNotify (the view carries read-only deliveryDefault / phonePaired).
      ownerNotify: _ownerNotify,
      agentHarnessDefault: _harnessDefault,
      promptCacheKeyDefault: _promptCacheKeyDefault,
      agentBusDefault: _agentBusDefault,
      agentBusRange: _agentBusRange,
      // peers-v2: through patchPeersSettings (loopback-only; a stray copy must not make every save fail remotely).
      peers: _peers,
      // proxy-modes: through patchProxySettings (the view carries read-only fields; owner credential only).
      proxy: _proxy,
      ...rest
    } = patch;
    return this.requireClient().request<GlobalSettings & { restartRequired: string[] }>("PATCH", "/v2/settings", { body: rest });
  }

  patchProxySettings(patch: HostProxyPatch): Promise<GlobalSettings> {
    // Forward only the known fields; cutex validates the URL and keeps an omitted url / noProxy.
    const proxy: Record<string, unknown> = { mode: patch.mode };
    if (patch.url !== undefined) proxy.url = patch.url;
    if (patch.noProxy !== undefined) proxy.noProxy = patch.noProxy;
    return this.requireClient().request<GlobalSettings>("PATCH", "/v2/settings", { body: { proxy } });
  }

  patchNewThreadDefaults(patch: NewThreadDefaultsPatch): Promise<GlobalSettings & { restartRequired: string[] }> {
    // Forward only the known kinds; cutex validates the field values (enums, absolute roots).
    const body: Record<string, unknown> = {};
    for (const kind of ["agent", "quickChat"] as const) if (kind in patch) body[kind] = patch[kind];
    return this.requireClient().request<GlobalSettings & { restartRequired: string[] }>("PATCH", "/v2/settings", { body: { newThreadDefaults: body } });
  }

  userInstructions(): Promise<UserInstructions> {
    return this.requireClient().request<UserInstructions>("GET", "/v2/user-instructions");
  }

  agentHarness(sessionId: string): Promise<AgentHarnessPreview> {
    return this.requireClient().request<AgentHarnessPreview>("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/harness`);
  }

  claudeCodeSources(sessionId: string): Promise<ClaudeCodeSources> {
    return this.requireClient().request<ClaudeCodeSources>("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/claude-code`);
  }

  claudeRuntime(sessionId: string): Promise<ClaudeRuntimeView> {
    return this.requireClient().request<ClaudeRuntimeView>("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/claude-runtime`);
  }

  async repinClaudeRuntime(sessionId: string, target: string): Promise<ClaudeRepinResult> {
    if (typeof target !== "string" || !target || target.length > 200) throw new Error("bad runtime target");
    try {
      const done = await this.requireClient().request<ClaudeRepinDone>("POST", `/v2/sessions/${encodeURIComponent(sessionId)}/claude-runtime/repin`, { body: { target } });
      return { ok: true, done };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  async claudeModelStatus(sessionId: string, threadId: string): Promise<unknown> {
    return this.requireClient()
      .native<unknown>(sessionId, "claude/model/status", { threadId })
      .catch((e: unknown) => {
        if (e instanceof CutexApiError && e.code === "session_offline") return null;
        throw e;
      });
  }

  sessionSkills(sessionId: string): Promise<unknown> {
    return this.requireClient().request<unknown>("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/skills`);
  }

  sessionSandboxExtras(sessionId: string): Promise<SessionSandboxExtras> {
    return this.requireClient().request<SessionSandboxExtras>("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/sandbox-extras`);
  }

  setSessionSandboxExtras(sessionId: string, patch: SessionSandboxExtrasPatch): Promise<SessionSandboxExtras> {
    return this.requireClient().request<SessionSandboxExtras>("PATCH", `/v2/sessions/${encodeURIComponent(sessionId)}/sandbox-extras`, { body: { ...patch } });
  }

  claudePermissionRules(sessionId: string): Promise<ClaudePermissionRules> {
    return this.requireClient().request<ClaudePermissionRules>("GET", `/v2/sessions/${encodeURIComponent(sessionId)}/claude-permission-rules`);
  }

  setClaudePermissionRules(sessionId: string, allow: string[], expectedRevision?: number): Promise<ClaudePermissionRules> {
    return this.requireClient().request<ClaudePermissionRules>("PUT", `/v2/sessions/${encodeURIComponent(sessionId)}/claude-permission-rules`, {
      body: expectedRevision === undefined ? { allow } : { allow, expectedRevision },
    });
  }

  claudeSkillsImportList(source?: string): Promise<ClaudeSkillsImportList> {
    const query = source ? `?source=${encodeURIComponent(source)}` : "";
    return this.requireClient().request<ClaudeSkillsImportList>("GET", `/v2/claude/skills/import${query}`);
  }

  importClaudeSkills(names: string[], options?: { source?: string; overwrite?: boolean }): Promise<ClaudeSkillsImportResult> {
    const body: Record<string, unknown> = { names };
    if (options?.source) body.source = options.source;
    if (options?.overwrite) body.overwrite = true;
    return this.requireClient().request<ClaudeSkillsImportResult>("POST", "/v2/claude/skills/import", { body });
  }

  putUserInstructions(content: string, expectedRevision: string): Promise<UserInstructions> {
    return this.requireClient().request<UserInstructions>("PUT", "/v2/user-instructions", { body: { content, expectedRevision } });
  }

  services(): Promise<ServicesList> {
    return this.requireClient().request<ServicesList>("GET", "/v2/services", { query: { visibility: "all" } });
  }

  serviceEligibleOwners(slug: string): Promise<import("../shared/serviceOwners").EligibleServiceOwners> {
    return this.requireClient().request("GET", `/v2/services/${encodeURIComponent(slug)}/eligible-owners`);
  }

  async registerService(request: Record<string, unknown>): Promise<ServiceView> {
    return (await this.requireClient().request<{ service: ServiceView }>("POST", "/v2/services", { body: request })).service;
  }

  async patchService(slug: string, patch: Record<string, unknown>): Promise<ServiceView> {
    return (await this.requireClient().request<{ service: ServiceView }>("PATCH", `/v2/services/${encodeURIComponent(slug)}`, { body: patch })).service;
  }

  async deleteService(slug: string): Promise<void> {
    await this.requireClient().request("DELETE", `/v2/services/${encodeURIComponent(slug)}`);
  }

  async serviceAction(slug: string, action: "start" | "stop" | "restart" | "archive" | "restore"): Promise<ServiceView> {
    if (!["start", "stop", "restart", "archive", "restore"].includes(action)) throw new Error("bad service action");
    return (await this.requireClient().request<{ service: ServiceView }>("POST", `/v2/services/${encodeURIComponent(slug)}/${action}`)).service;
  }

  async openService(slug: string): Promise<{ url: string; localUrl: string }> {
    const r = await this.requireClient().request<{ url: string; localUrl: string }>("POST", `/v2/services/${encodeURIComponent(slug)}/open`);
    return { url: r.url, localUrl: r.localUrl };
  }

  async serviceLogs(slug: string, tail = 300): Promise<{ text: string }> {
    const r = await this.requireClient().request<{ text: string }>("GET", `/v2/services/${encodeURIComponent(slug)}/logs`, { query: { tail: String(tail) } });
    return { text: r.text };
  }

  async patchServicesSettings(patch: ServicesSettingsPatch): Promise<ServicesSettings> {
    const body = servicesSettingsPatch(patch);
    if (body.ephemeralIdleMinutes !== undefined) {
      if (body.agentPersistentApproval !== undefined) throw new Error("service TTL and approval settings must be changed separately");
      const answer = await this.requireClient().request<{ services: ServicesSettings }>("PATCH", "/v2/settings", { body: { services: body } });
      return answer.services;
    }
    return (await this.requireClient().request<{ settings: ServicesSettings }>("PATCH", "/v2/services", { body })).settings;
  }

  async profileAccount(profile: string): Promise<ProfileAccountView | null> {
    try {
      return await this.requireClient().request<ProfileAccountView>("GET", `${this.profilePath(profile)}/account`);
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.code === "unsupported")) return null;
      throw error;
    }
  }

  async profileLogin(profile: string, request: { type: "chatgpt" } | { type: "apiKey"; apiKey: string }): Promise<ProfileLogin> {
    const r = await this.requireClient().request<{ login: ProfileLogin }>("POST", `${this.profilePath(profile)}/login`, { body: request });
    return r.login;
  }

  async profileLoginStatus(profile: string, loginId: string): Promise<ProfileLogin> {
    const r = await this.requireClient().request<{ login: ProfileLogin }>("GET", `${this.profilePath(profile)}/login/${encodeURIComponent(loginId)}`);
    return r.login;
  }

  async profileLoginCancel(profile: string, loginId: string): Promise<ProfileLogin> {
    const r = await this.requireClient().request<{ login: ProfileLogin }>("POST", `${this.profilePath(profile)}/login/${encodeURIComponent(loginId)}/cancel`);
    return r.login;
  }

  profileLogout(profile: string): Promise<ProfileAccountView> {
    return this.requireClient().request<ProfileAccountView>("POST", `${this.profilePath(profile)}/logout`);
  }

  notificationLevel(threadId: string): Promise<NotificationLevel> {
    return this.requireClient().notificationLevel(threadId);
  }

  setNotificationLevel(threadId: string, level: NotificationLevel): Promise<NotificationLevel> {
    return this.requireClient().setNotificationLevel(threadId, level);
  }

  async createAgent(request: Parameters<DesktopApi["createAgent"]>[0]) {
    const body: Record<string, unknown> = { requestId: randomUUID(), name: request.name, start: request.start };
    if (request.projectId) body.projectId = request.projectId;
    if (request.cwd) body.cwd = request.cwd;
    if (request.profile) body.profile = request.profile;
    // profile-runtime-variants: the renderer sends it only to hosts that report the capability.
    if (request.variantId !== undefined) body.variantId = variantIdOf(request.variantId);
    const launch = sanitizeLaunch(request.launch);
    if (launch) body.launch = launch;
    const r = await this.requireClient().request<{ cutexSessionId: string; effortFallback?: unknown; profilePick?: unknown }>("POST", "/v2/human/agents", { body });
    return { cutexSessionId: r.cutexSessionId, effortFallback: effortFallbackOf(r.effortFallback), profilePick: profilePickOf(r.profilePick) };
  }

  async profileAutoPick(query: Parameters<DesktopApi["profileAutoPick"]>[0]) {
    const raw = await this.requireClient().request<unknown>("GET", `/v2/profile-auto-pick${autoPickQuery(query ?? {})}`);
    const preview = autoPickPreviewOf(raw);
    if (!preview) throw new Error("unexpected profile-auto-pick answer");
    return preview;
  }

  async abandonAgentCreate(actionId: string, dryRun: boolean): Promise<CreateAbandonResult> {
    if (typeof actionId !== "string" || !validActionId(actionId)) throw new Error("bad action id");
    return this.requireClient().request<CreateAbandonResult>("POST", "/v2/agent-management/create-abandon", { body: { action_id: actionId, dry_run: !!dryRun } });
  }

  async createHumanSession(request: Parameters<DesktopApi["createHumanSession"]>[0]) {
    const body: Record<string, unknown> = { requestId: randomUUID(), start: !!request.start };
    if (request.cwd) body.cwd = request.cwd;
    if (request.profile) body.profile = request.profile;
    if (request.displayName?.trim()) body.displayName = request.displayName.trim().slice(0, 64).trim();
    if (request.variantId !== undefined) body.variantId = variantIdOf(request.variantId);
    const launch = sanitizeLaunch(request.launch);
    if (launch) body.launch = launch;
    const r = await this.requireClient().request<{ cutexSessionId: string }>("POST", "/v2/human/sessions", { body });
    return { cutexSessionId: r.cutexSessionId };
  }

  async sessionAction(sessionId: string, method: SessionActionMethod, params: Record<string, unknown>) {
    if (!(SESSION_ACTION_METHODS as readonly string[]).includes(method)) throw new Error(`method not allowed: ${method}`);
    if (method === "cutex/session/defaults/update") checkDefaultsPatch(params);
    const client = this.requireClient();
    try { return await client.cutex<unknown>(sessionId, method, params); }
    catch (error) {
      // Restore refused because its own name is someone else's now: the renderer offers 改名 (shared/agentRename).
      const nameBlocked = method === "cutex/session/restore" ? restoreNameWire(error) : null;
      if (nameBlocked) throw new Error(nameBlocked);
      if (["cutex/session/delete", "cutex/runtime/online", "cutex/session/retire"].includes(method)) {
        const wire = hostBusyActionWire(error);
        if (wire) {
          logSteerFailure(method, sessionId, error);
          throw new Error(wire);
        }
      }
      throw error;
    }
    finally {
      if (this.client === client) this.invalidateSidebarEvent({ cutexSessionId: sessionId, cutex: { method, params } } as EventEnvelope);
    }
  }

  forkPreview(sessionId: string, request?: SessionForkPreviewRequest) { return forkPreview(this.requireClient(), sessionId, request); }

  async forkSession(sessionId: string, request: SessionForkRequest): Promise<SessionForkResult> {
    return forkResult(await this.sessionAction(sessionId, "cutex/session/fork", forkRequestParams(request)));
  }

  deleteSession(sessionId: string, expectedRevision?: number): Promise<MutationResult> {
    return mutation(() => this.sessionAction(sessionId, "cutex/session/delete", expectedRevision === undefined ? {} : { expectedRevision }));
  }

  async revertHistory(sessionId: string, beforeTurnId: string, expectedRevision: number, options?: { rewindFiles?: boolean }) {
    // Only sent when requested: older cutex rejects the unknown parameter.
    const params = options?.rewindFiles === true ? { beforeTurnId, expectedRevision, rewindFiles: true } : { beforeTurnId, expectedRevision };
    return this.requireClient().cutex<unknown>(sessionId, "cutex/session/history/revert", params);
  }

  async backgroundTerminals(sessionId: string, threadId: string): Promise<BackgroundTerminal[]> {
    // An offline agent has no app-server, hence no background terminals: not an error.
    const r = await this.requireClient()
      .native<{ data: (Omit<BackgroundTerminal, "rssKb"> & { rssKb: number | string | null })[] }>(sessionId, "thread/backgroundTerminals/list", { threadId, limit: 50 })
      .catch((e: unknown) => {
        if (e instanceof CutexApiError && e.code === "session_offline") return { data: [] };
        throw e;
      });
    return r.data.map((t) => ({ ...t, rssKb: t.rssKb === null ? null : Number(t.rssKb) }));
  }

  async terminateBackgroundTerminal(sessionId: string, threadId: string, processId: string): Promise<void> {
    await this.requireClient().native(sessionId, "thread/backgroundTerminals/terminate", { threadId, processId });
  }

  async stopClaudeTask(sessionId: string, threadId: string, taskId: string): Promise<void> {
    await this.requireClient().native(sessionId, "claude/tasks/stop", { threadId, taskId });
  }

  // ---------- project log (project-events, design 022) ----------

  private async projectEventRead<T>(read: (client: CutexClient) => Promise<T>): Promise<ProjectEventsResult<T>> {
    try {
      return { ok: true, value: await read(this.requireClient()) };
    } catch (error) {
      if (error instanceof CutexApiError) {
        // A cutex without the route: router 404 / 405 with no project-events code.
        const missing = (error.status === 404 || error.status === 405) && error.code !== "project_not_found";
        return { ok: false, code: missing ? "unsupported" : error.code, message: error.message };
      }
      if (error instanceof CutexUnreachableError) return { ok: false, code: "unreachable", message: error.message };
      throw error;
    }
  }

  directorScopeCandidates(projectId: string) { return this.projectEventRead((c) => directorScopeCandidates(c, projectId)); }
  directorReviewContent(projectId: string, id: string) { return this.projectEventRead((c) => directorReviewContent(c, projectId, id)); }
  projectDirector(projectId: string) { return this.projectEventRead((c) => projectDirector(c, projectId)); }
  directorHandovers(projectId: string) { return this.projectEventRead((c) => directorHandovers(c, projectId)); }
  directorStartReviews(projectId: string) { return this.projectEventRead((c) => directorStartReviews(c, projectId)); }
  decideDirectorItem(projectId: string, kind: "handover" | "start-reviews", id: string, decision: "accept" | "discard", fence: DirectorFence) {
    if (!["handover", "start-reviews"].includes(kind) || !["accept", "discard"].includes(decision)) throw new Error("Invalid Director decision");
    return this.projectEventRead((c) => decideDirectorItem(c, projectId, kind, id, decision, fence));
  }
  approveDirectorScope(projectId: string, scope: DirectorScope) { return this.projectEventRead((c) => approveDirectorScope(c, projectId, scope)); }

  projectEvents(projectId: string, query: ProjectEventsQuery): Promise<ProjectEventsResult<ProjectEventPage>> {
    const limit = typeof query.limit === "number" ? Math.min(500, Math.max(1, Math.floor(query.limit))) : undefined;
    return this.projectEventRead((client) => projectEventsPage(client, projectId, { ...query, limit }));
  }

  projectBackground(projectId: string): Promise<ProjectEventsResult<ProjectBackground>> {
    return this.projectEventRead((client) => projectBackground(client, projectId));
  }

  async watchProjectEvents(projectId: string, watch: ProjectEventsWatch): Promise<string> {
    const watchId = randomUUID();
    const follower = new ProjectEventFollower(
      this.requireClient(),
      projectId,
      {
        event: (event) => this.emit("projectEvents", { watchId, kind: "event", event }),
        status: (status) => this.emit("projectEvents", { watchId, kind: "status", status }),
        reset: () => {
          this.projectWatches.delete(watchId);
          this.emit("projectEvents", { watchId, kind: "reset" });
        },
        failed: (error) => {
          this.projectWatches.delete(watchId);
          this.emit("projectEvents", { watchId, kind: "failed", code: error.code, message: error.message });
        },
      },
      // cutex keeps alive every 25 s: three missed = a half-open connection.
      { after: watch.after, streamId: watch.streamId ?? null, kinds: watch.kinds, sessionId: watch.sessionId ?? null, idleTimeoutMs: 80_000 },
    );
    this.projectWatches.set(watchId, follower);
    follower.start();
    return watchId;
  }

  async unwatchProjectEvents(watchId: string): Promise<void> {
    this.projectWatches.get(watchId)?.stop();
    this.projectWatches.delete(watchId);
  }

  async subAgentThread(sessionId: string, threadId: string, opts?: { includeTurns?: boolean }): Promise<unknown> {
    return this.requireClient().native<unknown>(sessionId, "thread/read", { threadId, includeTurns: opts?.includeTurns !== false });
  }

  async searchThread(sessionId: string, threadId: string, term: string, cursor?: string | null): Promise<ThreadSearchPage> {
    const page = await this.requireClient().native<{ data?: ThreadSearchHit[]; nextCursor?: string | null }>(sessionId, "thread/searchOccurrences", { threadId, searchTerm: term, cursor: cursor ?? null, limit: 50 });
    return { data: Array.isArray(page?.data) ? page.data : [], nextCursor: typeof page?.nextCursor === "string" ? page.nextCursor : null };
  }

  async operatorRuntimeNotice(projectId: string, sessionId: string) {
    const client = this.requireClient(), generation = this.gen;
    const current = () => this.gen === generation;
    const workspace = await client.project(projectId);
    if (!current() || workspace.access_role !== "human_management" || !workspace.active_agents.some(member => member.agent.cutex_session_id === sessionId) || workspace.director?.cutex_session_id === sessionId) throw Error("operator_unavailable");
    return recordOperatorRuntimeNotice({ read: () => client.session(sessionId), notices: this.operatorRestartNotices, current });
  }
  projectRead(projectId: string) { return this.requireClient().project(projectId); }
  async operatorAction(request: import("@cutex-desktop/cutex-client").OperatorActionRequest) {
    const client = this.requireClient();
    try { return await client.operatorAction(request); }
    finally { if (this.client === client) this.invalidateSidebarParts(); }
  }

  async projectMutation(projectId: string, expected: { authorityEpoch: number; projectRevision: number }, operation: ProjectMutationOperation) {
    const client = this.requireClient();
    try { return await client.request<unknown>("POST", "/v2/agent-management/project-mutations", {
      body: {
        schema: "cutex/human-management-project-mutation/v1",
        action_id: `desktop-${randomUUID()}`,
        project_id: projectId,
        expected_authority_epoch: expected.authorityEpoch,
        expected_project_revision: expected.projectRevision,
        operation,
      },
    }); }
    finally { if (this.client === client) this.invalidateSidebarParts(); }
  }

  async projectPresentation(projectId: string, expected: { authorityEpoch: number; presentationRevision: number }, presentation: { display_name: string; badge_label: string; color: string }) {
    const client = this.requireClient();
    try { return await client.request<unknown>("POST", "/v2/agent-management/project-presentation", {
      body: {
        schema: "cutex/human-management-project-presentation/v1",
        project_id: projectId,
        expected_authority_epoch: expected.authorityEpoch,
        expected_presentation_revision: expected.presentationRevision,
        presentation,
      },
    }); }
    finally { if (this.client === client) this.invalidateSidebarParts(); }
  }

  async projectMemory(projectId: string): Promise<ProjectMemoryView | null> {
    try {
      return await this.requireClient().request<ProjectMemoryView>("GET", `/v2/projects/${encodeURIComponent(projectId)}/memory`);
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  async projectMemoryFile(projectId: string, file: string) {
    return this.requireClient().request<{ file: string; content: string; bytes: number; updatedAt: string | null }>("GET", `/v2/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(file)}`);
  }

  async projectMcp(projectId: string) {
    try {
      return await this.requireClient().request<{ servers: Record<string, unknown>; revision: number; updatedAt: string | null }>("GET", `/v2/projects/${encodeURIComponent(projectId)}/mcp`);
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  // ---------- delegations (cutex asks, root credential) ----------

  asks(filter: AskFilter): Promise<AskSummary[] | null> {
    const { background, ...query } = filter;
    return this.requireClient().asks<AskSummary>(query, { background });
  }

  ask(askId: string): Promise<AskDetail | null> {
    return this.requireClient().ask<AskDetail>(askId);
  }

  askAnswer(askId: string, cursor?: number): Promise<AskAnswerPage | null> {
    return this.requireClient().askAnswer<AskAnswerPage>(askId, cursor);
  }

  // ---------- jobs (cutex Job Service bridge, root credential) ----------

  private async jobCall<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<JobResult<T>> {
    try {
      const value = await this.requireClient().request<T>(method, path, body ? { body } : {});
      return { ok: true, value };
    } catch (error) {
      if (error instanceof CutexApiError) {
        // A cutex without the route (router 404 / 405 with no job error code).
        const missing = (error.status === 404 || error.status === 405) && !error.code.startsWith("job");
        const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
        return { ok: false, code: missing ? "unsupported" : error.code, message };
      }
      return { ok: false, code: "unreachable", message: String((error as Error)?.message ?? error) };
    }
  }

  jobs(params: { query?: string; cursor?: string | null; limit?: number }): Promise<JobResult<JobListPage>> {
    const body: Record<string, unknown> = { query: typeof params?.query === "string" ? params.query.slice(0, 256) : "" };
    if (typeof params?.cursor === "string" && params.cursor.length <= 160) body.cursor = params.cursor;
    if (typeof params?.limit === "number" && Number.isFinite(params.limit)) body.limit = Math.max(1, Math.min(50, Math.floor(params.limit)));
    return this.jobCall<{ data?: JobRow[]; nextCursor?: string | null }>("POST", "/v2/job-service/management-query", body).then((r) =>
      r.ok ? { ok: true, value: { data: Array.isArray(r.value?.data) ? r.value.data : [], nextCursor: r.value?.nextCursor ?? null } } : r,
    );
  }

  jobServiceCapabilities(): Promise<JobResult<JobServiceCapabilities>> {
    return this.jobCall<JobServiceCapabilities>("GET", "/v2/job-service/capabilities");
  }

  cancelJob(jobId: string, expectedRevision: number): Promise<JobResult<unknown>> {
    if (typeof jobId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(jobId)) throw new Error("bad job id");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("bad revision");
    return this.jobCall("POST", "/v2/job-service/cancel", { jobId, expectedRevision });
  }

  jobOutput(jobId: string, stream: JobStream, offset: number): Promise<JobResult<JobOutputPage>> {
    if (typeof jobId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(jobId)) throw new Error("bad job id");
    if (stream !== "stdout" && stream !== "stderr") throw new Error("bad stream");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("bad offset");
    return this.jobCall<JobOutputPage>("POST", "/v2/job-service/output", { jobId, stream, offset, maxBytes: 8192 });
  }

  // Remote (NCI) jobs: owner marking, PBS mailbox, Gadi scheduler check (main/remoteJobsApi.ts).
  markExternalJob(input: MarkExternalInput) { return remoteJobsApi(this.requireClient()).markExternalJob(input); }
  inboundMail() { return remoteJobsApi(this.requireClient()).inboundMail(); }
  putInboundMail(input: InboundMailInput) { return remoteJobsApi(this.requireClient()).putInboundMail(input); }
  testInboundMail(input: InboundMailInput | null) { return remoteJobsApi(this.requireClient()).testInboundMail(input); }
  deleteInboundMail() { return remoteJobsApi(this.requireClient()).deleteInboundMail(); }
  nciVerification() { return remoteJobsApi(this.requireClient()).nciVerification(); }
  putNciVerification(input: NciVerificationInput) { return remoteJobsApi(this.requireClient()).putNciVerification(input); }
  deleteNciVerification() { return remoteJobsApi(this.requireClient()).deleteNciVerification(); }
  generateNciKey(replace: boolean) { return remoteJobsApi(this.requireClient()).generateNciKey(replace); }
  nciHelper() { return remoteJobsApi(this.requireClient()).nciHelper(); }
  saveNciHelper() { return remoteJobsApi(this.requireClient()).saveNciHelper(); }

  async artifact(artifactId: string): Promise<ArtifactView | null> {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(artifactId)) throw new Error("bad artifact id");
    try {
      return await this.requireClient().request<ArtifactView>("GET", `/v2/artifacts/${encodeURIComponent(artifactId)}`);
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  // Artifact store (docs/research/artifacts-api-v1.md): ids, queries and bodies rebuilt from known
  // fields (shared/artifactStore.ts). Reads answer null on a 404; mutations return 4xx refusals.

  private async artifactRead<T>(path: string, options: { query?: Record<string, string | number>; body?: unknown; method?: "GET" | "POST" } = {}): Promise<T | null> {
    try {
      return await this.requireClient().request<T>(options.method ?? "GET", path, { ...(options.query ? { query: options.query } : {}), ...(options.body !== undefined ? { body: options.body } : {}) });
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  artifactStoreList(query: ArtifactListQuery): Promise<ArtifactList | null> {
    return this.artifactRead<ArtifactList>("/v2/artifact-store", { query: artifactListQuery(query) });
  }

  artifactStoreGet(id: string): Promise<ArtifactDetail | null> {
    return this.artifactRead<ArtifactDetail>(`/v2/artifact-store/${artifactId(id)}`);
  }

  artifactStoreContent(id: string, version: number | "latest", opts?: { offset?: number; maxBytes?: number }): Promise<ArtifactContent | null> {
    return this.artifactRead<ArtifactContent>(`/v2/artifact-store/${artifactId(id)}/versions/${artifactVersionSel(version)}/content`, { query: artifactContentQuery(opts) });
  }

  artifactStoreDiff(id: string, from: number, to: number): Promise<ArtifactDiff | null> {
    return this.artifactRead<ArtifactDiff>(`/v2/artifact-store/${artifactId(id)}/diff`, { query: artifactDiffQuery(from, to) });
  }

  async artifactStoreResolve(refs: string[]): Promise<ArtifactResolveItem[] | null> {
    const r = await this.artifactRead<{ items?: ArtifactResolveItem[] }>("/v2/artifact-store/resolve", { method: "POST", body: artifactResolveBody(refs) });
    return r ? (r.items ?? []) : null;
  }

  artifactStoreUsage(): Promise<ArtifactUsage | null> {
    return this.artifactRead<ArtifactUsage>("/v2/artifact-store/usage");
  }

  async artifactStorePublish(request: ArtifactPublishRequest): Promise<ArtifactPublishResult> {
    const body = artifactPublishBody(request);
    try {
      return { ok: true, published: await this.requireClient().request<ArtifactPublished>("POST", "/v2/artifact-store", { body }) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  async artifactStorePatch(id: string, patch: ArtifactPatch): Promise<ArtifactPatchResult> {
    const path = `/v2/artifact-store/${artifactId(id)}`;
    const body = artifactPatchBody(patch);
    try {
      const r = await this.requireClient().request<{ artifact: ArtifactSummary }>("PATCH", path, { body });
      return { ok: true, artifact: r.artifact };
    } catch (error) {
      const refusal = refusalOf(error);
      if (!refusal) throw error;
      const revision = (error as CutexApiError).details as { revision?: unknown } | null | undefined;
      return typeof revision?.revision === "number" ? { ok: false, error: refusal, revision: revision.revision } : { ok: false, error: refusal };
    }
  }

  async artifactStoreDelete(id: string): Promise<ArtifactDeleteResult> {
    const path = `/v2/artifact-store/${artifactId(id)}`;
    try {
      const r = await this.requireClient().request<{ artifactId?: string }>("DELETE", path);
      return { ok: true, artifactId: r?.artifactId ?? id };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  // Agent alarms (cutex alarms-api): the owner's view of alarm_set reminders and their cancel.
  alarms(query: { sessionId?: string; state?: "pending" | "all"; limit?: number }): Promise<AlarmList | null> {
    const sessionId = query?.sessionId;
    if (sessionId !== undefined && (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId))) throw new Error("bad session id");
    const limit = typeof query?.limit === "number" ? query.limit : undefined;
    return this.requireClient().alarms<AlarmList>({ ...(sessionId ? { sessionId } : {}), state: query?.state === "all" ? "all" : "pending", ...(limit !== undefined ? { limit } : {}) });
  }

  async cancelAlarm(alarmId: string): Promise<AlarmCancelResult> {
    if (typeof alarmId !== "string" || !ALARM_ID.test(alarmId)) throw new Error("bad alarm id");
    try {
      return { ok: true, alarm: await this.requireClient().cancelAlarm<AlarmView>(alarmId) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  // Workflow runs (cutex workflows): the owner's list / detail and stop / resume / delete.
  workflowRuns(query: { state?: "open" | "closed" | "all"; sessionId?: string; projectId?: string; limit?: number }): Promise<WorkflowRunList | null> {
    const state = query?.state === "open" || query?.state === "closed" ? query.state : "all";
    const sessionId = typeof query?.sessionId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(query.sessionId) ? query.sessionId : undefined;
    const projectId = typeof query?.projectId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(query.projectId) ? query.projectId : undefined;
    const limit = typeof query?.limit === "number" ? query.limit : undefined;
    return this.requireClient().workflowRuns<WorkflowRunList>({ state, ...(sessionId ? { sessionId } : {}), ...(projectId ? { projectId } : {}), ...(limit !== undefined ? { limit } : {}) });
  }

  workflowRun(runId: string, include: ("steps" | "log" | "result" | "script")[]): Promise<WorkflowRunView> {
    if (typeof runId !== "string" || !WORKFLOW_RUN_ID.test(runId)) throw new Error("bad run id");
    const allowed = Array.isArray(include) ? include.filter((i) => ["steps", "log", "result", "script"].includes(i)) : [];
    return this.requireClient().workflowRun<WorkflowRunView>(runId, allowed);
  }

  async workflowRunAction(runId: string, action: WorkflowRunAction): Promise<{ ok: true } | { ok: false; error: CutexRefusal }> {
    if (typeof runId !== "string" || !WORKFLOW_RUN_ID.test(runId)) throw new Error("bad run id");
    if (action !== "stop" && action !== "resume" && action !== "delete") throw new Error("bad workflow action");
    try {
      await this.requireClient().workflowRunAction(runId, action);
      return { ok: true };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  // Restore after an unclean stop (cutex runtime-restore-candidates).
  restoreCandidates(): Promise<RestoreCandidates | null> {
    return this.requireClient().restoreCandidates<RestoreCandidates>();
  }

  // Stop idle agents (cutex stop-idle-agents, design 031): cutex classifies and stops.
  async idleRuntimes(query: { minIdleSecs: number; projectId?: string }): Promise<IdleRuntimes | null> {
    try {
      return await this.requireClient().request<IdleRuntimes>("GET", "/v2/runtimes/idle", {
        query: { minIdleSecs: String(Math.max(0, Math.round(query.minIdleSecs))), ...(query.projectId ? { projectId: query.projectId } : {}) },
      });
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  stopIdle(body: StopIdleRequest): Promise<StopIdleResult> {
    return this.requireClient().request<StopIdleResult>("POST", "/v2/runtimes/stop-idle", { body });
  }

  dismissRestoreCandidates(): Promise<MutationResult> {
    return mutation(() => this.requireClient().dismissRestoreCandidates());
  }

  // Claude quota auto-continue (cutex claude-quota-auto-continue, shared/quotaContinue.ts).
  quotaAutoContinue(sessionId: string): Promise<QuotaContinueView | null> {
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId)) throw new Error("bad session id");
    return this.requireClient().quotaAutoContinue<QuotaContinueView>(sessionId);
  }

  async setQuotaAutoContinue(sessionId: string, enabled: boolean): Promise<QuotaContinueResult> {
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId)) throw new Error("bad session id");
    try {
      return { ok: true, view: await this.requireClient().setQuotaAutoContinue<QuotaContinueView>(sessionId, enabled === true) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  async cancelQuotaAutoContinue(sessionId: string): Promise<QuotaContinueResult> {
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId)) throw new Error("bad session id");
    try {
      return { ok: true, view: await this.requireClient().cancelQuotaAutoContinue<QuotaContinueView>(sessionId) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  // ---------- cross-host peers (cutex peers-v2, shared/peers.ts) ----------
  // Bodies are rebuilt from known fields; refusals (loopback_only, invalid_pairing_code, …) come back
  // as values so the renderer can explain them. No peer credential ever passes this bridge.

  async peers(): Promise<PeerList | null> {
    try {
      return await this.requireClient().request<PeerList>("GET", "/v2/peers");
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  private async peerCall<T>(run: () => Promise<T>): Promise<PeerResult<T>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      // Peer routes also answer coded 5xx (`peer_unreachable` 503, `persistence_unavailable`): keep
      // the code so the page can explain it instead of a bare "http_503".
      if (error instanceof CutexApiError && !error.code.startsWith("http_")) {
        const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
        return { ok: false, error: { code: error.code, message } };
      }
      throw error;
    }
  }

  private peerPath(peerId: string, tail = ""): string {
    if (typeof peerId !== "string" || !PEER_ID.test(peerId)) throw new Error("bad peer id");
    return `/v2/peers/${peerId}${tail}`;
  }

  createPeerInvite(request: { label?: string }): Promise<PeerResult<PeerInvite>> {
    const body = peerInviteBody(request);
    return this.peerCall(() => this.requireClient().request<PeerInvite>("POST", "/v2/peers/invites", { body }));
  }

  addPeer(request: { url: string; code: string; label?: string }): Promise<PeerResult<PeerView>> {
    const body = peerAddBody(request);
    return this.peerCall(async () => (await this.requireClient().request<{ peer: PeerView }>("POST", "/v2/peers", { body })).peer);
  }

  patchPeer(peerId: string, patch: PeerPatch): Promise<PeerResult<PeerView>> {
    const path = this.peerPath(peerId);
    const body = peerPatchBody(patch);
    return this.peerCall(async () => (await this.requireClient().request<{ peer: PeerView }>("PATCH", path, { body })).peer);
  }

  deletePeer(peerId: string): Promise<PeerResult<{ removed: boolean }>> {
    const path = this.peerPath(peerId);
    return this.peerCall(() => this.requireClient().request<{ removed: boolean }>("DELETE", path));
  }

  async peerInflight(peerId: string): Promise<AskDetail[]> {
    const r = await this.requireClient().request<{ asks?: AskDetail[] }>("GET", this.peerPath(peerId, "/inflight"));
    return Array.isArray(r?.asks) ? r.asks : [];
  }

  peerAgents(peerId: string): Promise<PeerAgents> {
    return this.requireClient().request<PeerAgents>("GET", this.peerPath(peerId, "/agents"));
  }

  async peerAudit(peerId: string, limit?: number): Promise<PeerAuditEntry[]> {
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 100;
    const r = await this.requireClient().request<{ entries?: PeerAuditEntry[] }>("GET", this.peerPath(peerId, "/audit"), { query: { limit: n } });
    return Array.isArray(r?.entries) ? r.entries : [];
  }

  patchPeersSettings(patch: PeersSettingsPatch): Promise<PeerResult<GlobalSettings>> {
    const peers = peersSettingsBody(patch);
    return this.peerCall(() => this.requireClient().request<GlobalSettings>("PATCH", "/v2/settings", { body: { peers } }));
  }

  // ---------- users and grants (cutex users, shared/users.ts) ----------
  // Owner only; refusals (owner_required, user_in_use, owner_immutable, …) come back as values.

  async users(): Promise<UsersList | null> {
    return this.requireClient().users();
  }

  private async usersCall<T>(run: () => Promise<T>): Promise<UsersResult<T>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      if (!(error instanceof CutexApiError) || error.code.startsWith("http_")) throw error;
      const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
      const details = error.details as { tokens?: unknown; peers?: unknown; userId?: unknown; publicKey?: unknown } | null | undefined;
      const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
      const tokens = ids(details?.tokens);
      const peers = ids(details?.peers);
      // person_key_in_use: who holds the key.
      const userId = typeof details?.userId === "string" ? details.userId : undefined;
      const publicKey = typeof details?.publicKey === "string" ? details.publicKey : undefined;
      // owner_local_only (disableOwnerApproval) / owner_person_local_only / device_scope_denied: their details.
      const access = accessRefusalDetailsOf(error.code, error.details);
      return { ok: false, error: { code: error.code, message, ...(tokens ? { tokens } : {}), ...(peers ? { peers } : {}), ...(userId ? { userId } : {}), ...(publicKey ? { publicKey } : {}), ...(access ? { access } : {}) } };
    }
  }

  createUser(request: UserCreate): Promise<UsersResult<UserWriteResult>> {
    return this.usersCall(() => this.requireClient().createUser(request));
  }

  patchUser(userId: string, patch: UserPatch): Promise<UsersResult<UserWriteResult>> {
    return this.usersCall(() => this.requireClient().patchUser(userId, patch));
  }

  deleteUser(userId: string): Promise<UsersResult<{ userId: string; deleted: boolean }>> {
    return this.usersCall(() => this.requireClient().deleteUser(userId));
  }

  bindUserToken(tokenId: string, userId: string | null): Promise<UsersResult<TokenBindingResult>> {
    return this.usersCall(() => this.requireClient().bindTokenUser(tokenId, userId));
  }

  bindUserPeer(peerId: string, userId: string): Promise<UsersResult<PeerBindingResult>> {
    return this.usersCall(() => this.requireClient().bindPeerUser(peerId, userId));
  }

  patchUsersSettings(patch: UsersSettings): Promise<UsersResult<{ settings: UsersSettings }>> {
    return this.usersCall(() => this.requireClient().patchUsersSettings(patch));
  }

  usersMe(): Promise<SelfProfile | null> {
    return this.requireClient().usersMe();
  }

  patchUsersMe(patch: SelfProfilePatch): Promise<UsersResult<SelfProfile>> {
    return this.usersCall(() => this.requireClient().patchUsersMe(patch));
  }

  /** cutex `user-own-devices`: the caller's own devices (refusals such as user_pending as values). */
  usersMeDevices(): Promise<UsersResult<OwnDevices | null>> {
    return this.usersCall(() => this.requireClient().usersMeDevices());
  }

  /** cutex `user-own-devices`: remove one of the caller's own devices (refusals as values). */
  usersMeRemoveDevice(tokenId: string): Promise<UsersResult<OwnDeviceRevoked>> {
    return this.usersCall(() => this.requireClient().usersMeRemoveDevice(tokenId));
  }

  /** person-identity, owner only: replace a user's person keys (refusals as values). */
  putUserPersonKeys(userId: string, personKeys: PersonKeyInput[]): Promise<UsersResult<PersonKeysResult>> {
    return this.usersCall(() => this.requireClient().putUserPersonKeys(userId, personKeys));
  }

  /** person-identity-ack, owner only: acknowledge a device's key change (refusals as values). */
  ackTokenPersonChange(tokenId: string): Promise<UsersResult<TokenPersonAckResult>> {
    return this.usersCall(() => this.requireClient().ackTokenPersonChange(tokenId));
  }

  // ---------- backend upgrade (cutex backend-upgrade, shared/backendUpgrade.ts) ----------
  // Owner only. The client rebuilds every body from known fields and returns refusals as values
  // (upgrade_blocked {reason}, one_way_unconfirmed {migrations}, no_trusted_keys, …).

  upgradeStatus(): Promise<UpgradeStatus | null> {
    return this.requireClient().upgradeStatus();
  }

  upgradeCheck(): Promise<UpgradeResult<UpgradeStatus>> {
    return this.requireClient().upgradeCheck();
  }

  upgradeStage(release?: string | null): Promise<UpgradeResult<UpgradeStaging>> {
    return this.requireClient().upgradeStage(release);
  }

  upgradeApply(request: UpgradeApplyRequest): Promise<UpgradeResult<UpgradeRun>> {
    return this.requireClient().upgradeApply(request);
  }

  upgradeCancel(): Promise<UpgradeResult<UpgradeRun>> {
    return this.requireClient().upgradeCancel();
  }

  upgradeRollback(request: UpgradeRollbackRequest): Promise<UpgradeResult<UpgradeRollbackResult>> {
    return this.requireClient().upgradeRollback(request);
  }

  upgradeRuns(limit?: number): Promise<UpgradeResult<UpgradeRun[]>> {
    return this.requireClient().upgradeRuns(limit);
  }

  async upgradeRun(runId: string): Promise<UpgradeResult<UpgradeRun>> {
    return this.requireClient().upgradeRun(runId);
  }

  patchUpgradeSettings(patch: UpgradeSettingsPatch): Promise<UpgradeResult<UpgradeSettings>> {
    return this.requireClient().patchUpgradeSettings(patch);
  }

  hostServiceInfo(): Promise<HostServiceInfo> {
    return this.requireClient().hostServiceInfo();
  }

  // ---------- host owner person (cutex `host-owner-person`, docs/research/host-ownership-20261019.md §1.2) ----------

  /** `GET /v2/host` `owner`; null when absent (older cutex). */
  async hostOwner(): Promise<HostOwner | null> {
    return readHostOwner(await this.requireClient().request<unknown>("GET", "/v2/host"));
  }

  /** `PUT /v2/users/owner-person`: root credential on loopback only (403 `owner_person_local_only` as a value). */
  setOwnerPerson(publicKey: string): Promise<UsersResult<HostOwner | null>> {
    if (typeof publicKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(publicKey)) return Promise.resolve({ ok: false, error: { code: "invalid_public_key", message: "publicKey" } });
    return this.usersCall(async () => readHostOwner(await this.requireClient().request<unknown>("PUT", "/v2/users/owner-person", { body: { publicKey } })));
  }

  /** `DELETE /v2/users/owner-person` (unconfirmed again); same rule as setOwnerPerson. */
  clearOwnerPerson(): Promise<UsersResult<HostOwner | null>> {
    return this.usersCall(async () => readHostOwner(await this.requireClient().request<unknown>("DELETE", "/v2/users/owner-person")));
  }

  // ---------- optional components (cutex `components`, shared/components.ts) ----------
  // Owner only. The desktop only asks cutex to install / remove; cutex downloads, verifies, starts.

  /** `GET /v2/components` (null on a cutex without the route), read raw so the r269 `external` / `index` / `indexOperation` / `result` fields survive (shared/componentIndex.ts). */
  async components(): Promise<ComponentsList | null> {
    try {
      return readComponentsList(await this.requireClient().request<unknown>("GET", "/v2/components"));
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  componentAction(name: string, action: ComponentAction, opts?: { version?: string }): Promise<ComponentResult> {
    if (action === "remove" && !opts?.version) return this.requireClient().componentAction(name, action);
    // An empty install (legacy manifest semantics) goes through componentCall too: the same POST {} as the client's, but the
    // refusal keeps r270 `component_source_only` details (the explicit version cutex suggests; sourceOnlyOffer).
    if (action === "install" && !opts?.version) return this.componentCall(`/v2/components/${this.componentName(name)}/install`, {});
    if (action !== "install" && action !== "check") throw new Error("bad component action");
    // r269 (shared/componentIndex.ts): install `{version}` from the effective verified offers; `check` re-runs the external-install probe.
    return this.componentCall(`/v2/components/${this.componentName(name)}/${action}`, action === "install" && typeof opts?.version === "string" ? { version: opts.version } : {});
  }

  /** r269 owner action `POST /v2/components/{name}/configure` (Moth's route; shared/componentIndex.ts). */
  componentConfigure(name: string, req: ComponentConfigureRequest): Promise<ComponentResult> {
    return this.componentCall(`/v2/components/${this.componentName(name)}/configure`, componentConfigureBody(req));
  }

  /** r269 `POST /v2/components/index/check`: refresh the configured signed index (own operation slot; no selection change). */
  componentIndexCheck(): Promise<ComponentResult> {
    return this.componentCall(COMPONENT_INDEX_CHECK_PATH, {});
  }

  private componentName(name: string): string {
    if (typeof name !== "string" || !COMPONENT_NAME.test(name)) throw new Error("bad component name");
    return encodeURIComponent(name);
  }

  /** `POST` a component route → `{operation}` (with its r269 `result`); coded refusals as values (like the client's componentAction). */
  private async componentCall(path: string, body: Record<string, unknown>): Promise<ComponentResult> {
    try {
      const r = await this.requireClient().request<{ operation?: unknown } | null>("POST", path, { body });
      return { ok: true, value: readComponentOperation(r?.operation) };
    } catch (error) {
      if (!(error instanceof CutexApiError) || error.code.startsWith("http_")) throw error;
      const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
      const refusal: ComponentRefusal = upgradeRefusalOf(error.status, error.code, message, error.details);
      const offered = sourceOnlyOffer(error.code, error.details);
      if (offered) refusal.offeredVersion = offered;
      return { ok: false, error: refusal };
    }
  }

  // person-identity claim (main/personIdentity.ts only; not renderer IPC: signing stays in main).
  identityChallenge(): Promise<IdentityChallenge> {
    return this.requireClient().identityChallenge();
  }

  identityClaim(claim: { publicKey: string; signature: string; nonce: string; displayName?: string | null }): Promise<IdentityClaimResult> {
    return this.requireClient().identityClaim(claim);
  }

  async userAvatar(userId: string): Promise<{ dataUrl: string; etag: string | null } | null> {
    const avatar = await this.requireClient().userAvatar(userId);
    return avatar ? { dataUrl: `data:${avatar.contentType};base64,${avatar.data}`, etag: avatar.etag } : null;
  }

  // ---------- home page (cutex `user-home`) and service tiles (`service-tiles`), shared/home.ts ----------

  /** Refusals as values; `home_revision_conflict` carries the host's current revision (`details.revision`). */
  private async homeCall<T>(run: () => Promise<T>): Promise<HomeResult<T>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      if (!(error instanceof CutexApiError) || error.code.startsWith("http_")) throw error;
      const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
      const revision = (error.details as { revision?: unknown } | null | undefined)?.revision;
      return { ok: false, error: { code: error.code, message, ...(typeof revision === "number" && Number.isInteger(revision) && revision >= 0 ? { revision } : {}) } };
    }
  }

  userLayout() { return this.homeCall(() => this.requireClient().userLayout()); }
  putUserLayout(section: string, revision: number, data: Record<string, unknown> | null) { return this.homeCall(() => this.requireClient().putUserLayout(section, revision, data)); }
  putLayoutPointer(pointer: import("@cutex-desktop/cutex-client").MemoryHost) { return this.homeCall(() => this.requireClient().putLayoutPointer(pointer)); }

  userHome(): Promise<HomeResult<HomeView | null>> {
    return this.homeCall(() => this.requireClient().userHome());
  }

  putUserHome(revision: number, home: HomeDoc | null): Promise<HomeResult<HomeView>> {
    return this.homeCall(() => this.requireClient().putUserHome(revision, home));
  }

  async homeCover(): Promise<HomeImage | null> {
    const image = await this.requireClient().homeCover();
    return image ? { dataUrl: `data:${image.contentType};base64,${image.data}`, etag: image.etag } : null;
  }

  putHomeCover(upload: HomeCoverUpload): Promise<HomeResult<HomeView>> {
    return this.homeCall(() => this.requireClient().putHomeCover(upload));
  }

  deleteHomeCover(): Promise<HomeResult<HomeView>> {
    return this.homeCall(() => this.requireClient().deleteHomeCover());
  }

  serviceTile(slug: string): Promise<ServiceTileAnswer | null> {
    return this.requireClient().serviceTile(slug);
  }

  async serviceTileImage(slug: string): Promise<HomeImage | null> {
    const image = await this.requireClient().serviceTileImage(slug);
    return image ? { dataUrl: `data:${image.contentType};base64,${image.data}`, etag: image.etag } : null;
  }

  askCommand(sessionId: string, method: AskCommandMethod, params: { askId: string; outcome?: "accepted" | "abandoned" }): Promise<MutationResult> {
    if (!ASK_COMMAND_METHODS.includes(method)) throw new Error(`method not allowed: ${String(method)}`);
    if (typeof params?.askId !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(params.askId)) throw new Error("bad ask id");
    // Exactly the fields cutex accepts: its schema refuses anything else.
    const body: Record<string, unknown> = { askId: params.askId };
    if (method === "cutex/ask/close") {
      if (params.outcome !== "accepted" && params.outcome !== "abandoned") throw new Error("bad outcome");
      body.outcome = params.outcome;
    }
    return mutation(() => this.requireClient().cutex<unknown>(sessionId, method, body));
  }

  // Local host only: on a remote host the renderer browses the host's folders (browseDirs).
  async pickFolder(defaultPath?: string): Promise<string | null> {
    if (this.remote) throw new Error("the active host is remote: use the in-app folder browser");
    const win = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
    const options = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[], defaultPath: defaultPath || undefined };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  }

  // Local host only (a remote path means nothing here). Reveal, never open: opening could run it.
  async revealPath(path: string) {
    if (this.remote) throw new Error("the active host is remote: its files are not on this machine");
    await localFileAction("local", path, "reveal", shell);
  }

  async openExternal(url: string) {
    if (!/^https?:\/\//.test(url)) throw new Error("only http(s) URLs can be opened externally");
    await shell.openExternal(url);
  }

  async switchProfile(sessionId: string, profile: string, when: "now" | "afterTurn", expectedRevision: number) {
    return this.requireClient().cutex<{ status: "switched" | "scheduled"; from: string; to: string }>(sessionId, "cutex/session/profile/switch", { profile, when, expectedRevision });
  }

  async managedMcp() {
    try {
      return await this.requireClient().request<Awaited<ReturnType<DesktopApi["managedMcp"]>>>("GET", "/v2/codex/managed-mcp");
    } catch (error) {
      if (error instanceof CutexApiError && error.status === 404) return null;
      throw error;
    }
  }

  async compactThread(sessionId: string, threadId: string): Promise<void> {
    await this.requireClient().native(sessionId, "thread/compact/start", { threadId });
  }

  inputGet(sessionId: string, inputIds: readonly string[]) { return this.requireClient().inputGet(sessionId, inputIds); }
  inputList(sessionId: string, query: import("@cutex-desktop/protocol").InputListParams = {}) { return this.requireClient().inputList(sessionId, query); }
  inputInterruptSend(sessionId: string, params: import("@cutex-desktop/protocol").InputInterruptSendParams) { return this.requireClient().inputInterruptSend(sessionId, params); }
  inputHold(sessionId: string, params: import("@cutex-desktop/protocol").InputHoldParams) { return this.requireClient().inputHold(sessionId, params); }
  inputRetry(sessionId: string, inputId: string, expectedRev: number) { return this.requireClient().inputRetry(sessionId, inputId, expectedRev); }
  queueMerge(sessionId: string, params: import("@cutex-desktop/protocol").UserInputQueueMergeParams) { return this.requireClient().queueMerge(sessionId, params); }
  inputDismiss(sessionId: string, inputId: string, expectedRev: number) { return this.requireClient().inputDismiss(sessionId, inputId, expectedRev); }
  inputLeaseRelease(sessionId: string, expectedLease: import("@cutex-desktop/protocol").InputLease) { return this.requireClient().inputLeaseRelease(sessionId, expectedLease); }

  queueList(sessionId: string) {
    const client = this.requireClient(), generation = this.gen;
    return withHostBusyRetry(() => client.queueList(sessionId), () => this.assertInputScope(client, generation),
      (error, attempt) => logSteerFailure("queueList", sessionId, error, attempt));
  }

  async queueUpdate(sessionId: string, queueId: string, expectedRevision: number, text: string): Promise<void> {
    await this.requireClient().queueUpdate(sessionId, queueId, expectedRevision, [{ type: "text", text, text_elements: [] }]);
  }

  async queueRemove(sessionId: string, queueId: string, expectedRevision: number): Promise<void> {
    await this.requireClient().queueRemove(sessionId, queueId, expectedRevision);
  }

  /**
   * admission-order: move an owner queued item before `before` (null = to the end). A refusal cutex
   * names (revision conflict, passing_not_allowed, item gone) becomes a `queue_move_refused:` message.
   */
  async queueMove(sessionId: string, queueId: string, expectedRevision: number, before: AdmissionRef | null): Promise<QueueMoveResult> {
    try {
      return await this.requireClient().queueMove(sessionId, queueId, expectedRevision, before);
    } catch (error) {
      const kind = error instanceof CutexApiError ? queueMoveErrorKind(error.code) : null;
      if (kind === null) throw error;
      throw new Error(queueMoveErrorMessage(kind));
    }
  }

  /** admission-owner-yield: waiting ride-alongs go before the owner's queued input once. */
  queueYield(sessionId: string): Promise<QueueYieldResult> {
    return this.requireClient().queueYield(sessionId);
  }

  /** queue-pause: clear a stopped queue's pause; cutex sends the next item once the thread is idle. */
  queueResume(sessionId: string) {
    return this.requireClient().queueResume(sessionId);
  }

  /** asks-pause-v2: the owner pauses / resumes delegation (委托) for this session. */
  asksPause(sessionId: string) {
    return this.requireClient().asksPause(sessionId);
  }

  asksResume(sessionId: string) {
    return this.requireClient().asksResume(sessionId);
  }

  /** agent-pause: the owner pauses / resumes the whole agent (session requests, Management root credential). */
  agentPause(sessionId: string) {
    return this.requireClient().cutex<AgentPauseResult>(sessionId, AGENT_PAUSE_METHOD);
  }

  agentResume(sessionId: string) {
    return this.requireClient().cutex<AgentPauseResult>(sessionId, AGENT_RESUME_METHOD);
  }

  /** queue-pause "停止": cutex pauses the queue first, then interrupts the active turn (no auto-send). */
  stopTurn(sessionId: string) {
    return this.requireClient().turnStop(sessionId);
  }

  /**
   * Queue item → steer. `steer` (the host has queue-steer): cutex's atomic `queue/steer` sends it into
   * the running turn (idle: starts it) and only then removes it; a refusal (delegation turn, runtime
   * without steering, turn changed, ...) leaves it queued and throws a `queue_steer_refused:` message.
   * Older cutex: CAS-remove it (fails if it changed, was flushed or removed meanwhile, so it is never
   * sent twice), then submit the stored input with `auto` under its own clientUserMessageId + origin
   * (cutex dedupes that id against the thread) — which cutex may queue again (an ask holds the
   * session, a Claude turn runs). `options.ifIdle` "fail": a steer that never starts a turn (a draft
   * with images queued first, then steered: r264 image-input-steering).
   */
  async queuePromote(sessionId: string, queueId: string, expectedRevision: number, steer = false, join?: import("@cutex-desktop/protocol").OwnerJoinDelegation, options: { ifIdle?: "fail" } = {}): Promise<QueuePromoteResult> {
    const joinDelegation = ownerJoinIntent(join);
    if (joinDelegation && !steer) throw new Error("queue_steer_refused:joinChanged");
    const client = this.requireClient();
    const generation = this.gen;
    if (steer) {
      try {
        const send = () => client.queueSteer(sessionId, queueId, expectedRevision, { ifIdle: joinDelegation || options.ifIdle === "fail" ? "fail" as const : "start" as const, ...(joinDelegation ? { joinDelegation } : {}) });
        const r = this.capabilitiesCache.peek()?.featureList?.some(feature => feature === "input-ledger-v1" || feature === "inputLedgerV1") ? await send() : await withSteerPreflightRetry(send, () => {
          this.assertInputScope(client, generation);
        }, (error, attempt) => logSteerFailure("queuePromote", sessionId, error, attempt));
        const imageDelivery = imageDeliveryOf(r);
        return { result: { ...(r.input ? { input: r.input } : {}), disposition: r.disposition, turnId: r.turnId, ...(imageDelivery ? { imageDelivery } : {}) }, clientUserMessageId: r.clientUserMessageId };
      } catch (error) {
        logSteerFailure("queuePromote", sessionId, error);
        const kind = error instanceof CutexApiError ? retryableHostBusy(error) ? "hostBusy" : retryableSteerPreflight(error) ? "runtimeNotReady" : queueSteerErrorKind(error.code, error.details) : null;
        if (kind === null) throw error;
        throw new Error(queueSteerErrorMessage(kind, steerErrorDetail(kind, error as CutexApiError)));
      }
    }
    const { items } = await withHostBusyRetry(() => client.queueList(sessionId), () => this.assertInputScope(client, generation), (error, attempt) => logSteerFailure("queuePromote", sessionId, error, attempt));
    const item = items.find((x) => x.queueId === queueId && x.revision === expectedRevision);
    if (!item) throw new Error("queue item changed or already sent");
    await client.queueRemove(sessionId, queueId, expectedRevision);
    const result = await client.submitInput(sessionId, item.input, "auto", { clientUserMessageId: item.clientUserMessageId, origin: item.origin });
    return { result, clientUserMessageId: item.clientUserMessageId, input: item.input };
  }

  /**
   * 「全部合并插入」 (shared/queueMerge): merge the queued owner messages `requested` (queue order, at
   * the revisions the owner saw) into ONE input and steer it into the running turn. cutex has no
   * atomic merge, so the merged text always lives in a cutex queue item (never only here):
   *   1. queue/list: every requested item still at its revision (else nothing is touched: `changed`).
   *   2. queue/remove the 2nd..Nth merged items with their expected revisions (in order; a conflict
   *      stops there — the rest stay queued as they are).
   *   3. queue/update the 1st (the carrier) with the merged input of itself + the removed ones.
   *      Refused (sent / edited meanwhile): the removed ones go back as ONE queued item at the front.
   *   4. queue/steer the carrier (one clientUserMessageId: the carrier's); cutex removes it only once
   *      the native accepted it. Refused: it stays queued as one item, moved to the front (`kept`).
   *      Older cutex (no queue-steer): CAS-remove + submit `auto`; a failed submit is queued again.
   */
  async queueMergeInsert(sessionId: string, requested: { queueId: string; revision: number }[], steer = false, join?: import("@cutex-desktop/protocol").OwnerJoinDelegation): Promise<QueueMergeResult> {
    const joinDelegation = ownerJoinIntent(join);
    if (joinDelegation && !steer) throw new Error("queue_steer_refused:joinChanged");
    const client = this.requireClient();
    const generation = this.gen;
    const { items } = await withHostBusyRetry(() => client.queueList(sessionId), () => this.assertInputScope(client, generation), (error, attempt) => logSteerFailure("queueMergeInsert", sessionId, error, attempt)).catch(error => {
      logSteerFailure("queueMergeInsert", sessionId, error);
      if (retryableHostBusy(error)) throw new Error(queueSteerErrorMessage("hostBusy"));
      throw error;
    });
    const wanted = requested.map((r) => items.find((x) => x.queueId === r.queueId && x.revision === r.revision));
    if (wanted.some((x) => !x)) throw new Error(queueMergeErrorMessage("changed"));
    const plan = planQueueMerge(wanted as QueueItem[]);
    if (!plan) throw new Error(queueMergeErrorMessage(wanted.filter((x) => mergeableOwnerItem(x!)).length >= 2 ? "tooLarge" : "changed"));
    const [carrier, ...others] = plan.items as [QueueItem, ...QueueItem[]];
    const removed: QueueItem[] = [];
    for (const other of others) {
      if (await this.removeForMerge(sessionId, other)) removed.push(other);
      else break;
    }
    if (!removed.length) throw new Error(queueMergeErrorMessage("changed"));
    const merged = [carrier, ...removed];
    const input = mergeQueueInputs(merged.map((x) => x.input));
    const skipped = requested.map((r) => r.queueId).filter((id) => !merged.some((x) => x.queueId === id));
    let revision: number;
    try {
      const updated = (await client.queueUpdate(sessionId, carrier.queueId, carrier.revision, input)) as { revision?: unknown } | null;
      if (typeof updated?.revision !== "number") throw new Error("queue/update returned no revision");
      revision = updated.revision;
    } catch (error) {
      // Not in the carrier: the removed messages' text must not vanish — one item at the front.
      await this.requeueMergedFront(sessionId, mergeQueueInputs(removed.map((x) => x.input)), carrier.origin);
      throw new Error(queueMergeErrorMessage("kept", error instanceof Error ? error.message : String(error)));
    }
    const done = (result: QueueMergeResult["result"]): QueueMergeResult => ({ result, clientUserMessageId: carrier.clientUserMessageId, input, merged: merged.map((x) => x.queueId), skipped });
    if (steer) {
      try {
        const r = await withSteerPreflightRetry(() => client.queueSteer(sessionId, carrier.queueId, revision, { ifIdle: joinDelegation ? "fail" : "start", ...(joinDelegation ? { joinDelegation } : {}) }), () => {
          this.assertInputScope(client, generation);
        }, (error, attempt) => logSteerFailure("queueMergeInsert", sessionId, error, attempt));
        const imageDelivery = imageDeliveryOf(r);
        return done({ disposition: r.disposition, turnId: r.turnId, ...(imageDelivery ? { imageDelivery } : {}) });
      } catch (error) {
        this.assertInputScope(client, generation);
        logSteerFailure("queueMergeInsert", sessionId, error);
        const kind = error instanceof CutexApiError ? retryableHostBusy(error) ? "hostBusy" : retryableSteerPreflight(error) ? "runtimeNotReady" : queueSteerErrorKind(error.code, error.details) : null;
        // May have reached the native: never moved or re-sent from here.
        if (kind === "outcomeUnknown" || kind === "unrecognized" || kind === null) throw new Error(queueSteerErrorMessage("outcomeUnknown", kind ? steerErrorDetail(kind, error as CutexApiError) : error instanceof Error ? error.message : String(error)));
        await this.moveToFront(sessionId, carrier.queueId, () => this.assertInputScope(client, generation));
        const detail = kind ? queueSteerErrorMessage(kind, steerErrorDetail(kind, error as CutexApiError)) : error instanceof Error ? error.message : String(error);
        throw new Error(queueMergeErrorMessage("kept", detail));
      }
    }
    try {
      await client.queueRemove(sessionId, carrier.queueId, revision);
    } catch (error) {
      await this.moveToFront(sessionId, carrier.queueId);
      throw new Error(queueMergeErrorMessage("kept", error instanceof Error ? error.message : String(error)));
    }
    try {
      const result = await client.submitInput(sessionId, input, "auto", { clientUserMessageId: carrier.clientUserMessageId, origin: carrier.origin });
      return done(result);
    } catch (error) {
      await this.requeueMergedFront(sessionId, input, carrier.origin);
      throw new Error(queueMergeErrorMessage("kept", error instanceof Error ? error.message : String(error)));
    }
  }

  /** queue/remove at the expected revision for a merge; true = removed (an unknown outcome counts if it is gone). */
  private async removeForMerge(sessionId: string, item: QueueItem): Promise<boolean> {
    const client = this.requireClient();
    try {
      await client.queueRemove(sessionId, item.queueId, item.revision);
      return true;
    } catch (error) {
      // Changed / sent / removed by someone else: not ours to merge.
      if (error instanceof CutexApiError && ["revision_conflict", "queue_item_not_found", "queue_input_already_submitted"].includes(error.code)) return false;
      // Unknown outcome (transport): if it is gone now, this remove took it — merge its text.
      try {
        const { items } = await client.queueList(sessionId);
        return !items.some((x) => x.queueId === item.queueId);
      } catch {
        // Unreadable: count it as removed (a duplicate is better than a lost message).
        return true;
      }
    }
  }

  /** Queue `input` again as ONE item (new id) and put it at the front; best effort beyond the submit. */
  private async requeueMergedFront(sessionId: string, input: unknown[], origin: QueueItem["origin"]): Promise<void> {
    if (!input.length) return;
    const result = await this.requireClient().submitInput(sessionId, input, "queue", { clientUserMessageId: randomUUID(), origin });
    const queueId = (result as { queue?: { queueId?: string } | null }).queue?.queueId;
    if (queueId) await this.moveToFront(sessionId, queueId);
  }

  /** Best effort: move an owner queue item before the first admission item (cutex may refuse passing a delegation). */
  private async moveToFront(sessionId: string, queueId: string, checkCurrent: () => void = () => {}): Promise<void> {
    checkCurrent();
    try {
      const client = this.requireClient();
      const { admission } = await client.queueList(sessionId);
      checkCurrent();
      const first = admission?.items[0];
      if (!admission || !first || (first.kind === "owner" && first.id === queueId)) return;
      await client.queueMove(sessionId, queueId, admission.orderRevision ?? admission.revision, { kind: first.kind, id: first.id });
    } catch {
      checkCurrent();
      // stays where it is (still queued)
    }
  }

  async respond(sessionId: string, runtimeGeneration: number, requestId: string | number, reply: ServerRequestReply): Promise<void> {
    await this.requireClient().respondServerRequest(sessionId, runtimeGeneration, requestId, reply);
  }

  // ---------- composer slash commands ----------

  /** Native request that cutex may not forward yet: turn its 403 into a readable gap error. */
  private async nativeOrGap<R>(sessionId: string, method: string, params: unknown): Promise<R> {
    try {
      return await this.requireClient().native<R>(sessionId, method, params);
    } catch (e) {
      if (e instanceof CutexApiError && e.code === "native_method_denied") throw new Error(`cutex does not forward \`${method}\` yet (native request allowlist)`);
      throw e;
    }
  }

  async threadGoal(sessionId: string, threadId: string): Promise<ThreadGoal | null> {
    const r = await this.requireClient().native<ThreadGoalGetResponse>(sessionId, "thread/goal/get", { threadId });
    return r.goal ?? null;
  }

  async setThreadGoal(sessionId: string, threadId: string, patch: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }): Promise<ThreadGoal> {
    const params: Record<string, unknown> = { threadId };
    if (patch.objective !== undefined) params.objective = patch.objective;
    if (patch.status !== undefined) params.status = patch.status;
    if (patch.tokenBudget !== undefined) params.tokenBudget = patch.tokenBudget;
    return (await this.requireClient().native<ThreadGoalSetResponse>(sessionId, "thread/goal/set", params)).goal;
  }

  async clearThreadGoal(sessionId: string, threadId: string): Promise<boolean> {
    return (await this.requireClient().native<ThreadGoalClearResponse>(sessionId, "thread/goal/clear", { threadId })).cleared;
  }

  async startReview(sessionId: string, threadId: string, target: ReviewTarget): Promise<{ turnId: string }> {
    const r = await this.requireClient().native<ReviewStartResponse>(sessionId, "review/start", { threadId, target, delivery: "inline" });
    return { turnId: r.turn.id };
  }

  async collaborationModes(sessionId: string): Promise<CollaborationModeMask[]> {
    return (await this.requireClient().native<CollaborationModeListResponse>(sessionId, "collaborationMode/list", {})).data;
  }

  async setMemoryMode(sessionId: string, threadId: string, mode: ThreadMemoryMode): Promise<void> {
    await this.requireClient().native(sessionId, "thread/memoryMode/set", { threadId, mode });
  }

  async resetMemory(sessionId: string): Promise<void> {
    await this.nativeOrGap(sessionId, "memory/reset", undefined);
  }

  async experimentalFeatures(sessionId: string, threadId: string | null): Promise<ExperimentalFeaturesView> {
    try {
      const r = await this.requireClient().native<ExperimentalFeatureListResponse>(sessionId, "experimentalFeature/list", { limit: 200, ...(threadId ? { threadId } : {}) });
      return {
        source: "native",
        features: r.data.map((f) => ({ name: f.name, displayName: f.displayName, description: f.description, stage: f.stage, enabled: f.enabled, defaultEnabled: f.defaultEnabled })),
      };
    } catch (e) {
      // cutex forwards neither experimentalFeature/* method yet: show what config.toml sets.
      if (!(e instanceof CutexApiError && (e.code === "native_method_denied" || e.code === "session_offline"))) throw e;
      const read = (await this.codexRequest("config/read", { includeLayers: false })) as ConfigReadResponse;
      const table = (read.config as Record<string, unknown>).features;
      const flags = table && typeof table === "object" ? Object.entries(table as Record<string, unknown>).filter(([, v]) => typeof v === "boolean") : [];
      return { source: "config", features: flags.map(([name, v]) => ({ name, displayName: null, description: null, stage: null, enabled: v as boolean, defaultEnabled: null })) };
    }
  }

  async setExperimentalFeature(name: string, enabled: boolean): Promise<void> {
    if (!/^[a-z0-9_]+$/i.test(name)) throw new Error("bad feature name");
    await this.codexRequest("config/value/write", { keyPath: `features.${name}`, value: enabled, mergeStrategy: "replace" });
  }

  // ---------- owner notify (capability owner-messages) ----------

  async ownerNotifications(query: { filter?: OwnerNotifyFilter; agentId?: string; limit?: number }): Promise<OwnerNotification[]> {
    const filter = query?.filter === "pending" || query?.filter === "alerting" || query?.filter === "all" ? query.filter : undefined;
    const agentId = typeof query?.agentId === "string" && query.agentId.length <= 200 ? query.agentId : undefined;
    const limit = typeof query?.limit === "number" && Number.isFinite(query.limit) ? Math.max(1, Math.min(500, Math.floor(query.limit))) : undefined;
    const { client, verify, paged } = await this.ownerPagesContext();
    if (paged) {
      return await collectOwnerPages(async (cursor, pageLimit) => {
        const page = await client.ownerNotificationsPage({ filter, agentId, limit: pageLimit, cursor });
        verify();
        return page ? { items: page.notifications.map(asRecord).filter((n): n is OwnerNotification => n !== null), nextCursor: page.nextCursor } : null;
      }, limit ?? 100) ?? [];
    }
    try {
      const r = await client.request<OwnerNotificationList>("GET", "/v2/owner-notifications", { query: { filter, agentId, limit } });
      verify();
      return (Array.isArray(r?.notifications) ? r.notifications : []).map(asRecord).filter((n): n is OwnerNotification => n !== null);
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405) && !error.code.startsWith("notification")) return [];
      throw error;
    }
  }

  async ownerNotificationsPage(query: { filter?: OwnerNotifyFilter; agentId?: string; limit?: number; cursor?: string }): Promise<OwnerNotificationList> {
    const { client, verify, paged } = await this.ownerPagesContext();
    const request = ownerPageQuery(query);
    if (!paged) {
      if (request.cursor) throw new Error("owner-store pages unavailable");
      return { notifications: await this.ownerNotifications(query) };
    }
    const filter = query?.filter === "pending" || query?.filter === "alerting" || query?.filter === "all" ? query.filter : undefined;
    const agentId = typeof query?.agentId === "string" && query.agentId.length <= 200 ? query.agentId : undefined;
    const page = await client.ownerNotificationsPage({ ...request, filter, agentId });
    verify();
    return { notifications: (page?.notifications ?? []).map(asRecord).filter((n): n is OwnerNotification => n !== null), ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  async ownerNotifyAction(agentId: string, action: OwnerNotifyAction, notificationId: string, text?: string): Promise<OwnerNotifyResult> {
    if (typeof agentId !== "string" || !agentId || agentId.length > 200) throw new Error("bad agent id");
    if (!isNotificationId(notificationId)) throw new Error("bad notification id");
    const method = action === "ack" ? "cutex/ownerNotify/ack" : action === "reply" ? "cutex/ownerNotify/reply" : action === "dismiss" ? "cutex/ownerNotify/dismiss" : action === "delete" ? "cutex/ownerNotify/delete" : null;
    if (!method) throw new Error("bad owner notify action");
    const params: Record<string, unknown> = { notificationId };
    if (action === "reply") {
      if (typeof text !== "string" || !text.trim() || text.length > OWNER_REPLY_MAX) throw new Error("bad reply text");
      params.text = text;
    }
    try {
      const r = await this.requireClient().cutex<{ notification?: unknown }>(agentId, method, params);
      const notification = asRecord(r?.notification);
      if (!notification) throw new Error(`${method} returned no notification`);
      return { ok: true, notification };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  async safetyCheckDecide(agentId: string, blockId: string, decision: SafetyCheckDecision): Promise<SafetyCheckResult> {
    if (typeof agentId !== "string" || !agentId || agentId.length > 200) throw new Error("bad agent id");
    if (!isNotificationId(blockId)) throw new Error("bad block id");
    const method = decision === "grant" ? SAFETY_CHECK_GRANT : decision === "dismiss" ? SAFETY_CHECK_DISMISS : null;
    if (!method) throw new Error("bad safety check decision");
    try {
      const r = await this.requireClient().cutex<{ notification?: unknown; submitError?: { code?: unknown; message?: unknown } }>(agentId, method, { blockId });
      const notification = asRecord(r?.notification);
      if (!notification) throw new Error(`${method} returned no notification`);
      const failed = r?.submitError;
      const submitError = failed && typeof failed.code === "string" ? { code: failed.code, message: typeof failed.message === "string" ? failed.message : "" } : null;
      return { ok: true, notification, submitError };
    } catch (error) {
      const refusal = refusalOf(error);
      if (!refusal) throw error;
      // safety_block_closed carries the notice as the runtime has it (decided elsewhere meanwhile).
      const notification = error instanceof CutexApiError ? asRecord((error.details as { notification?: unknown } | null | undefined)?.notification) : null;
      return { ok: false, error: refusal, ...(notification ? { notification } : {}) };
    }
  }

  patchOwnerNotify(patch: OwnerNotifySettingsPatch): Promise<GlobalSettings> {
    return this.requireClient().request<GlobalSettings>("PATCH", "/v2/settings", { body: { ownerNotify: sanitizeOwnerNotifyPatch(patch) } });
  }

  // ---------- notification levels (capability notification-levels) ----------

  async notificationLevels(): Promise<NotificationLevelsView | null> {
    try {
      return asLevelsView(await this.requireClient().request<unknown>("GET", "/v2/notification-levels"));
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  async patchNotificationLevels(patch: NotificationLevelsPatch): Promise<NotificationLevelsView> {
    const view = asLevelsView(await this.requireClient().request<unknown>("PATCH", "/v2/notification-levels", { body: sanitizeLevelsPatch(patch) }));
    if (!view) throw new Error("PATCH /v2/notification-levels returned no view");
    return view;
  }

  async evaluateNotification(request: NotificationEvaluateRequest): Promise<NotificationDecision> {
    const decision = asDecision(await this.requireClient().request<unknown>("POST", "/v2/notification-levels/evaluate", { body: sanitizeEvaluate(request) }));
    if (!decision) throw new Error("POST /v2/notification-levels/evaluate returned no decision");
    return decision;
  }

  // Export always goes to this machine's disk (also when the active host is remote).
  async saveMarkdown(defaultName: string, content: string): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
    const defaultPath = downloadFilename(defaultName || "conversation", { extension: "md", maxLength: 120 });
    const options = { defaultPath, filters: downloadFilters(defaultPath, "Markdown") };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, content, "utf8");
    return r.filePath;
  }
}
