import { randomUUID } from "node:crypto";
import { traceSendStage } from "../shared/sendTrace";
import { fastTierOf } from "../shared/fastMode";
import { logError } from "./errorLog";
import { RecentFeedTraffic, submitHttpTraceBuffer } from "./sendDiagnostics";
import { notesApi, sideApi } from "./notesSideApi";
import type { ExportReply, ImportReply } from "./profileTransfer";
import { remoteJobsApi } from "./remoteJobsApi";
import type { InboundMailInput, MarkExternalInput, NciVerificationInput } from "../shared/remoteJobs";
import type { NoteCreate, NotesQuery, NoteUpdate } from "../shared/notes";
import type { SideMessageInput, SideOpenInput, SideReply } from "../shared/sideChat";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { BrowserWindow, dialog, shell } from "electron";
import {
  CutexApiError,
  CutexClient,
  CutexUnreachableError,
  EventFeed,
  openStream,
  type StreamHandle,
  type DaemonEndpoint,
} from "@cutex-desktop/cutex-client";
import type { AdmissionRef, HostSessionRow, SessionList, OwnerNotification, OwnerNotificationList, OwnerNotifyFilter, OwnerNotifySettingsPatch, ProjectsResponse, QueueMoveResult, QueueYieldResult } from "@cutex-desktop/protocol";
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
import { MAX_IMAGE_BYTES, SESSION_ACTION_METHODS, type DaemonApi, type DirBrowse, type ExtraInput, type ExperimentalFeaturesView, type PickedImage, type QueuePromoteResult, type SessionActionMethod, type SubmitOptions } from "../shared/ipc";
import { ASK_COMMAND_METHODS, type ArtifactView, type AskAnswerPage, type AskCommandMethod, type AskDetail, type AskFilter, type AskSummary } from "../shared/ipc";
import type { JobListPage, JobOutputPage, JobResult, JobRow, JobServiceCapabilities, JobStream } from "../shared/ipc";
import { dataUrlImage, sanitizeExtraInput, uploadKind } from "../shared/input";
import { shownSessions } from "../shared/hiddenSessions";
import { queueMoveErrorKind, queueMoveErrorMessage } from "../shared/queueMove";
import { queueSteerErrorDetail, queueSteerErrorKind, queueSteerErrorMessage } from "../shared/queueSteer";
import type { RuntimesWire } from "../shared/runtimes";
import type { HostServiceInfo, UpgradeApplyRequest, UpgradeResult, UpgradeRollbackRequest, UpgradeRollbackResult, UpgradeRun, UpgradeSettings, UpgradeSettingsPatch, UpgradeStaging, UpgradeStatus } from "../shared/backendUpgrade";
import type { ComponentAction, ComponentResult, ComponentsList } from "../shared/components";
import { claudeAccountCreateBody, claudeAccountId, claudeAccountRenameBody, DEFAULT_CLAUDE_ACCOUNT, type ClaudeAccount, type ClaudeAccountCreate, type ClaudeAccountList, type ClaudeAccountRemoved, type ClaudeAccountRemoveResult, type ClaudeAccountResult, type ProfileQuotaDetail } from "../shared/claudeAccounts";
import { directorRotationBody, ROTATION_ID } from "../shared/directorRotation";
import { artifactContentQuery, artifactDiffQuery, artifactId, artifactListQuery, artifactPatchBody, artifactPublishBody, artifactResolveBody, artifactVersionSel, type ArtifactContent, type ArtifactDeleteResult, type ArtifactDetail, type ArtifactDiff, type ArtifactList, type ArtifactListQuery, type ArtifactPatch, type ArtifactPatchResult, type ArtifactPublished, type ArtifactPublishRequest, type ArtifactPublishResult, type ArtifactResolveItem, type ArtifactSummary, type ArtifactUsage } from "../shared/artifactStore";
import { ALARM_ID, type AlarmCancelResult, type AlarmList, type AlarmView } from "../shared/alarms";
import { USAGE_SOURCE_ID, USAGE_SOURCE_KINDS, type UsageSource, type UsageSourceCreate, type UsageSourceDeleteResult, type UsageSourcePatch, type UsageSourceResult, type UsageSourcesView } from "../shared/usageSources";
import { SKILL_ARCHIVE_ID, type SkillArchiveList, type SkillArchiveRecord, type SkillArchiveResult } from "../shared/skillsArchive";
import { WORKFLOW_RUN_ID, type WorkflowRunAction, type WorkflowRunList, type WorkflowRunView } from "../shared/workflows";
import type { RestoreCandidates } from "../shared/runtimeRestore";
import type { QuotaContinueResult, QuotaContinueView } from "../shared/quotaContinue";
import type { OwnDeviceRevoked, OwnDevices, PeerBindingResult, SelfProfile, SelfProfilePatch, TokenBindingResult, UserCreate, UserPatch, UsersList, UsersResult, UsersSettings, UserWriteResult } from "../shared/users";
import type { IdentityChallenge, IdentityClaimResult, PersonKeyInput, PersonKeysResult } from "../shared/personIdentity";
import { userAccessOf, type TokenPersonAckResult } from "../shared/users";
import { PEER_ID, peerAddBody, peerInviteBody, peerPatchBody, peersSettingsBody, type PeerAgents, type PeerAuditEntry, type PeerInvite, type PeerList, type PeerPatch, type PeerResult, type PeersSettingsPatch, type PeerView } from "../shared/peers";
import { asStuckDiscarded, asStuckView, cleanMinAge, stuckDiscardRequest } from "../shared/agentBusStuck";
import { sanitizeLaunch, type NewThreadDefaultsPatch } from "../shared/launch";
import type { ClientTokenView, PairingCodeView, WindowsSandboxReadiness } from "../shared/ipc";
import { windowsSandboxReadinessOf } from "../shared/windowsSandbox";
import { localDaemonSetup } from "../shared/hosts";
import { isValidTokenId } from "../shared/hosts";
import { servicesSettingsPatch } from "../shared/servicesSettings";
import type { AgentSecurityPatch, ApprovalDecision, ApprovalDecisionResult, ApprovalRecord, CutexRefusal, RuntimePackageRun, RuntimePackageRunResult, RuntimePackagesView, MutationResult, ProfileCreateRequest, ProfilePreset, NotificationLevel, ProfileAccountView, ServiceView, ServicesList, ServicesSettings, ServicesSettingsPatch, ProfileLogin, TerminalSummary, ProjectMemoryView, ProjectMutationOperation, BackgroundTerminal, CapabilitiesView, CatalogModelPatch, GlobalSettings, ProfileDetail, ProfileItem, ProfileModelsView, ProfilePatch, UserInstructions, AgentHarnessPreview, FsDir, FsFile, GitStatus, UsageDimension, UsagePrices, UsageReport, UsageSourceFilter, WorkspaceScope, DaemonState, DesktopApi, DaemonEvents, ModelOption, QuotaConfigView, QuotaGauge, ServerRequestReply, SidebarSnapshot, DirectorRotation, DirectorRotationResult, DirectorRotationStart, StuckBusDiscardRequest, StuckBusDiscardResult, StuckBusView } from "../shared/ipc";

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
    const r = x as Record<string, unknown>;
    const id = String(r.cutexSessionId ?? r.cutex_session_id ?? r.id ?? "");
    const ref = { cutexSessionId: id, displayName: String(r.displayName ?? r.display_name ?? id) };
    // profile_in_use also counts archived agents (`lifecycle: "retired"`).
    return r.lifecycle === "active" || r.lifecycle === "retired" ? { ...ref, lifecycle: r.lifecycle } : ref;
  });
  const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
  const forkReferences = !Array.isArray(details) && (details as { nativeForkReferences?: unknown } | null | undefined)?.nativeForkReferences === true;
  return { code: error.code, message, ...(sessions ? { sessions } : {}), ...(forkReferences ? { forkReferences } : {}) };
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
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

/**
 * Owns the connection to the active cutex daemon: the host-wide event feed (sidebar refresh) and
 * per-session feeds. Which daemon (local discovery or an SSH tunnel) is decided by `HostManager`,
 * which hands it an endpoint (`useEndpoint`). Implements the renderer-facing `DaemonApi`.
 */
export class DaemonService implements DaemonApi {
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
  private retryTimer: NodeJS.Timeout | null = null;
  private watches = new Map<string, StreamHandle>();
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
    this.client = new CutexClient(this.endpoint);
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
    for (const watch of this.watches.values()) watch.close();
    this.watches.clear();
    for (const t of this.terminals.values()) t.close();
    this.terminals.clear();
  }

  private teardown(): void {
    this.gen++;
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
  }

  private setState(state: DaemonState): void {
    this.state = state;
    this.emit("daemonState", state);
  }

  private async connect(): Promise<void> {
    const client = this.requireClient();
    const gen = this.gen;
    const attempt = ++this.connectAttempt;
    this.connectRead?.abort();
    const controller = new AbortController();
    this.connectRead = controller;
    const timer = setTimeout(() => controller.abort(), CONNECTION_READ_TIMEOUT_MS);
    const current = () => gen === this.gen && attempt === this.connectAttempt;
    const baseUrl = client.endpoint.baseUrl;
    this.setState({ kind: "connecting", baseUrl });
    try {
      const host = await client.host({ signal: controller.signal });
      clearTimeout(timer);
      if (!current()) return;
      this.setState({ kind: "connected", baseUrl, hostId: host.hostId, ...(typeof host.platform === "string" ? { platform: host.platform } : {}) });
      // The daemon answers again (e.g. the SSH tunnel came back): session feeds waiting out their
      // backoff (up to 15 s) reconnect now instead of leaving the open agent stale.
      this.kickSessionFeeds();
      await this.startHostFeed();
    } catch (error) {
      if (!current()) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setState(
        error instanceof CutexUnreachableError
          ? { kind: "unreachable", baseUrl, message, ...(this.remote ? {} : { setup: localDaemonSetup(client.endpoint) }) }
          : { kind: "error", baseUrl, message, ...(error instanceof CutexApiError ? { status: error.status } : {}) },
      );
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (current()) void this.connect();
      }, 5000);
    } finally {
      clearTimeout(timer);
      if (this.connectRead === controller) this.connectRead = null;
    }
  }

  /** Session feeds in a reconnect wait retry at once, with their backoff reset (live ones are left alone). */
  kickSessionFeeds(): void {
    for (const feed of this.sessionFeeds.values()) feed.reconnectNow();
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
      const list = await client.sessions("active", { signal: controller.signal });
      const stream = (list.management as { eventStream?: { streamId?: string; latest?: { cursor?: string } | null } } | null)
        ?.eventStream;
      if (stream?.streamId) position = { streamId: stream.streamId, after: stream.latest?.cursor ?? undefined };
    } catch {
      // fall through to fromLatest paging
    } finally {
      clearTimeout(timer);
      if (this.hostFeedRead === controller) this.hostFeedRead = null;
    }
    // A slower tail read from a previous connection/reset must never start an orphan feed.
    if (!current()) return;
    let refused = false;
    const feed = new EventFeed(
      client,
      {
        event: (envelope) => { if (current()) this.emit("hostEvent", envelope); },
        traffic: (sample) => { if (current()) this.hostTraffic.add(sample); },
        resync: (reason, detail) => {
          if (!current()) return;
          // users: the token's user / grant changed — the renderer re-reads the capabilities and lists.
          if (reason === "access_changed") this.emit("accessChanged", { changedAt: changedAtOf(detail) });
          // Host feed only drives sidebar refresh; restart from the live tail.
          void this.startHostFeed();
        },
        status: (status, error) => {
          if (!current()) return;
          // users: a refusal (403 access_pending / owner_required) is not a lost connection — the host
          // answers. Keep the feed's own backoff instead of reconnecting in a loop; once it streams
          // again (the owner assigned this device) the renderer re-reads what this device may see.
          if (status === "retrying" && error instanceof CutexApiError && error.status === 403) {
            refused = true;
            return;
          }
          if (status === "live" && refused) {
            refused = false;
            this.emit("accessChanged", { changedAt: null });
          }
          if (status === "retrying" && this.state.kind === "connected") void this.connect();
        },
      },
      { ...position, fromLatest: position.streamId === undefined },
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
   * arbitrary files. Anything else (already a host path, data: URLs) passes through.
   */
  private assertInputScope(client: CutexClient, generation: number): void {
    if (this.gen !== generation || this.client !== client) throw new Error("host switched");
  }

  private async remoteInput(sessionId: string, items: ExtraInput[], client: CutexClient, generation: number): Promise<ExtraInput[]> {
    this.assertInputScope(client, generation);
    if (!this.remote && !this.restricted) return items;
    const ctx = { remote: this.remote, restricted: this.restricted, picked: (path: string) => this.pickedImages.has(path) };
    const out: ExtraInput[] = [];
    for (const item of items) {
      this.assertInputScope(client, generation);
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
      const uploaded = await client.uploadAttachment(sessionId, bytes, mime);
      this.assertInputScope(client, generation);
      out.push({ type: "localImage", path: uploaded.path });
    }
    return out;
  }

  /**
   * The owner sees every persistent agent, also ones an agent created with `expose_to_im: false` (cutex
   * lists them only with `includeHidden=true`; hidden local-only sessions stay out: shared/hiddenSessions). Older cutex (400) and non-root tokens (403) refuse the switch: then
   * the plain listing, and not asked again on this connection.
   */
  private async activeSessions(client: CutexClient): Promise<SessionList> {
    if (!this.hiddenRefused) {
      try {
        const list = await client.sessions("active", { includeHidden: true });
        return { ...list, sessions: shownSessions(list.sessions) };
      } catch (error) {
        if (!(error instanceof CutexApiError && (error.status === 400 || error.status === 403))) throw error;
        if (this.client === client) this.hiddenRefused = true;
      }
    }
    return client.sessions("active");
  }

  async sidebar(): Promise<SidebarSnapshot> {
    const client = this.requireClient();
    const [active, retired, projects, hostRows] = await Promise.all([
      this.activeSessions(client),
      client.sessions("retired").catch(() => ({ sessions: [] })),
      client.projects().catch((error: unknown): ProjectsResponse | null => {
        if (error instanceof CutexApiError) return null;
        throw error;
      }),
      // users: `/v2/host/sessions` is owner-only; another user's rows (name, project) come from its
      // filtered summary instead, so the sidebar still groups its agents by project.
      this.allHostRows().catch((error: unknown) => (error instanceof CutexApiError && error.status === 403 ? this.summaryHostRows() : {})),
    ]);
    return { active: active.sessions, retired: retired.sessions, projects, hostRows };
  }

  /** Host rows of the agents a non-owner user sees (`GET /v2/summary`, filtered by cutex); {} on any error. */
  private async summaryHostRows(): Promise<Record<string, HostSessionRow>> {
    try {
      const summary = await this.requireClient().summary();
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

  private async allHostRows(): Promise<Record<string, HostSessionRow>> {
    const client = this.requireClient();
    const rows: Record<string, HostSessionRow> = {};
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await client.hostSessions("", cursor);
      for (const row of result.data) rows[row.id] = row;
      if (!result.nextCursor) return rows;
      cursor = result.nextCursor;
    }
    logError({ source: "sidebar-pagination", message: "host session listing truncated at page limit", pages: 50, rows: Object.keys(rows).length });
    return rows;
  }

  bootstrap(sessionId: string, turnLimit?: number) {
    return this.requireClient().bootstrap(sessionId, { turnLimit });
  }

  async history(sessionId: string, cursor?: string | null, limit = 20) {
    try {
      return await this.requireClient().history(sessionId, { limit, cursor });
    } catch (e) {
      if (e instanceof CutexApiError && (e.status === 404 || e.status === 409)) return null;
      throw e;
    }
  }

  async subscribe(sessionId: string, from: { streamId: string; after: string | null }): Promise<void> {
    this.sessionFeeds.get(sessionId)?.stop();
    const feed = new EventFeed(
      this.requireClient(),
      {
        event: (envelope) => this.emit("sessionEvent", { sessionId, envelope }),
        traffic: (sample) => { if (this.sessionFeeds.get(sessionId) === feed) this.sessionTraffic.add(sample); },
        resync: (reason) => {
          this.sessionFeeds.delete(sessionId);
          this.emit("sessionResync", { sessionId, reason });
        },
        status: (status) => this.emit("sessionStatus", { sessionId, status }),
      },
      { cutexSessionId: sessionId, streamId: from.streamId, after: from.after ?? undefined },
    );
    this.sessionFeeds.set(sessionId, feed);
    feed.start();
  }

  async unsubscribe(sessionId: string): Promise<void> {
    this.sessionFeeds.get(sessionId)?.stop();
    this.sessionFeeds.delete(sessionId);
  }

  async submit(sessionId: string, text: string, strategy: "auto" | "queue" | "interrupt", startIfOffline = false, options: SubmitOptions = {}) {
    const client = this.requireClient();
    const generation = this.gen;
    const clientUserMessageId = typeof options.clientUserMessageId === "string" && options.clientUserMessageId.length <= 128 ? options.clientUserMessageId : undefined;
    const trace = { sessionId, clientUserMessageId, hostId: this.state.kind === "connected" ? this.state.hostId : undefined };
    const items = await traceSendStage({ ...trace, stage: "prepare-input" }, (record) => logError({ ...record }),
      () => this.remoteInput(sessionId, sanitizeExtraInput(options.extra ?? []), client, generation));
    this.assertInputScope(client, generation);
    // An image-only message has no text item (cute-codex accepts any non-empty input list).
    const input = text.trim() || items.length === 0 ? [{ type: "text", text, text_elements: [] }, ...items] : items;
    const httpTrace = submitHttpTraceBuffer();
    const hostTraffic = this.hostTraffic, sessionTraffic = this.sessionTraffic;
    const result = await traceSendStage({ ...trace, stage: "daemon-submit" }, (record) => logError({
      ...record, httpStages: httpTrace.snapshot(),
      hostSse: hostTraffic.snapshot(), sessionSse: sessionTraffic.snapshot(),
    }), () => client.submitInput(sessionId, input, strategy, { startIfOffline, clientUserMessageId, onHttpTrace: httpTrace.observe }));
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
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
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
    const client = this.requireClient();
    const caps = await client.capabilities<CapabilitiesView>();
    if (this.client === client) this.restricted = !userAccessOf(caps).isOwner;
    return caps;
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
    return (await this.requireClient().request<{ profile: ProfileDetail }>("PATCH", this.profilePath(profile), { body: patch })).profile;
  }

  async createProfile(request: ProfileCreateRequest): Promise<ProfileDetail> {
    // Forward only the known fields (cutex validates kind / preset / URL).
    const body: Record<string, unknown> = { name: request.name.trim(), kind: request.kind };
    for (const k of ["preset", "baseUrl", "model"] as const) {
      const v = request[k]?.trim();
      if (v) body[k] = v;
    }
    // claude-accounts: a Claude profile's account (a well-formed id; `default` = leave it out).
    if (request.kind === "claude" && request.claudeAccount !== undefined && request.claudeAccount !== DEFAULT_CLAUDE_ACCOUNT) body.claudeAccount = claudeAccountId(request.claudeAccount);
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

  approvals(state: "pending" | "all"): Promise<ApprovalRecord[] | null> {
    return this.requireClient().approvals<ApprovalRecord>(state);
  }

  async decideApproval(approvalId: string, decision: ApprovalDecision, note?: string): Promise<ApprovalDecisionResult> {
    const client = this.requireClient();
    try {
      return { ok: true, approval: await client.decideApproval<ApprovalRecord>(approvalId, decision, note) };
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) return { ok: false, error: refusal };
      throw error;
    }
  }

  runtimePackages(): Promise<RuntimePackagesView | null> {
    return this.requireClient().runtimePackages<RuntimePackagesView>();
  }

  runtimePackageRun(runId: string): Promise<RuntimePackageRun | null> {
    if (typeof runId !== "string" || !/^rpu-[A-Za-z0-9-]{1,80}$/.test(runId)) throw new Error("bad run id");
    return this.requireClient().runtimePackageRun<RuntimePackageRun>(runId);
  }

  async startRuntimePackageRun(): Promise<RuntimePackageRunResult> {
    return this.runtimePackageRunCall(() => this.requireClient().startRuntimePackageRun<RuntimePackageRun>({ all: true }));
  }

  async revertRuntimePackageRun(runId: string): Promise<RuntimePackageRunResult> {
    if (typeof runId !== "string" || !/^rpu-[A-Za-z0-9-]{1,80}$/.test(runId)) throw new Error("bad run id");
    return this.runtimePackageRunCall(() => this.requireClient().revertRuntimePackageRun<RuntimePackageRun>(runId));
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

  runtimes(): Promise<RuntimesWire | null> {
    return this.requireClient().runtimes<RuntimesWire>();
  }

  // Claude accounts: bodies are rebuilt from known fields here (shared/claudeAccounts.ts), so no
  // API key or login can pass through this bridge; logins run in the owner's terminal.
  claudeAccounts(): Promise<ClaudeAccountList | null> {
    return this.requireClient().claudeAccounts<ClaudeAccountList>();
  }

  createClaudeAccount(request: ClaudeAccountCreate): Promise<ClaudeAccountResult> {
    const body = claudeAccountCreateBody(request);
    return this.claudeAccountCall(() => this.requireClient().createClaudeAccount<ClaudeAccount>(body));
  }

  renameClaudeAccount(id: string, label: string): Promise<ClaudeAccountResult> {
    const accountId = claudeAccountId(id);
    const patch = claudeAccountRenameBody(label);
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

  async createPairingCode(label?: string, userId?: string): Promise<PairingCodeView> {
    // The reply carries a one-time code: returned to the renderer only, never logged here.
    const r = await this.requireClient().createPairingCode(typeof label === "string" ? label : undefined, typeof userId === "string" ? { userId } : {});
    const bound = (r as { userId?: unknown }).userId;
    return { code: r.code, expiresAt: r.expiresAt, label: r.label ?? null, hostId: r.hostId, ...(r.instanceId ? { instanceId: r.instanceId } : {}), urls: Array.isArray(r.urls) ? r.urls : [], qr: r.qr, ...(typeof bound === "string" ? { userId: bound } : {}) };
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
      agentBusDefault: _agentBusDefault,
      agentBusRange: _agentBusRange,
      // peers-v2: through patchPeersSettings (loopback-only; a stray copy must not make every save fail remotely).
      peers: _peers,
      ...rest
    } = patch;
    return this.requireClient().request<GlobalSettings & { restartRequired: string[] }>("PATCH", "/v2/settings", { body: rest });
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

  putUserInstructions(content: string, expectedRevision: string): Promise<UserInstructions> {
    return this.requireClient().request<UserInstructions>("PUT", "/v2/user-instructions", { body: { content, expectedRevision } });
  }

  services(): Promise<ServicesList> {
    return this.requireClient().request<ServicesList>("GET", "/v2/services");
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

  async serviceAction(slug: string, action: "start" | "stop" | "restart"): Promise<ServiceView> {
    if (!["start", "stop", "restart"].includes(action)) throw new Error("bad service action");
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
    const launch = sanitizeLaunch(request.launch);
    if (launch) body.launch = launch;
    const r = await this.requireClient().request<{ cutexSessionId: string }>("POST", "/v2/human/agents", { body });
    return { cutexSessionId: r.cutexSessionId };
  }

  async createHumanSession(request: Parameters<DesktopApi["createHumanSession"]>[0]) {
    const body: Record<string, unknown> = { requestId: randomUUID(), start: !!request.start };
    if (request.cwd) body.cwd = request.cwd;
    if (request.profile) body.profile = request.profile;
    if (request.displayName?.trim()) body.displayName = request.displayName.trim().slice(0, 64).trim();
    const launch = sanitizeLaunch(request.launch);
    if (launch) body.launch = launch;
    const r = await this.requireClient().request<{ cutexSessionId: string }>("POST", "/v2/human/sessions", { body });
    return { cutexSessionId: r.cutexSessionId };
  }

  async sessionAction(sessionId: string, method: SessionActionMethod, params: Record<string, unknown>) {
    if (!(SESSION_ACTION_METHODS as readonly string[]).includes(method)) throw new Error(`method not allowed: ${method}`);
    if (method === "cutex/session/defaults/update") checkDefaultsPatch(params);
    return this.requireClient().cutex<unknown>(sessionId, method, params);
  }

  async forkSession(sessionId: string, request: { afterTurnId?: string | null; name?: string }): Promise<{ cutexSessionId: string }> {
    const params: Record<string, unknown> = { afterTurnId: request.afterTurnId ?? null };
    if (request.name?.trim()) params.name = request.name.trim();
    // cutex answers `{ newCutexSessionId, session, … }` (cutex/session/fork).
    const r = (await this.sessionAction(sessionId, "cutex/session/fork", params)) as { newCutexSessionId?: string; cutexSessionId?: string; session?: { cutexSessionId?: string } } | null;
    const id = r?.newCutexSessionId ?? r?.session?.cutexSessionId ?? r?.cutexSessionId;
    if (!id) throw new Error("cutex/session/fork returned no session");
    return { cutexSessionId: id };
  }

  deleteSession(sessionId: string, expectedRevision?: number): Promise<MutationResult> {
    return mutation(() => this.sessionAction(sessionId, "cutex/session/delete", expectedRevision === undefined ? {} : { expectedRevision }));
  }

  async revertHistory(sessionId: string, beforeTurnId: string, expectedRevision: number) {
    return this.requireClient().cutex<unknown>(sessionId, "cutex/session/history/revert", { beforeTurnId, expectedRevision });
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

  async subAgentThread(sessionId: string, threadId: string, opts?: { includeTurns?: boolean }): Promise<unknown> {
    return this.requireClient().native<unknown>(sessionId, "thread/read", { threadId, includeTurns: opts?.includeTurns !== false });
  }

  async projectMutation(projectId: string, expected: { authorityEpoch: number; projectRevision: number }, operation: ProjectMutationOperation) {
    return this.requireClient().request<unknown>("POST", "/v2/agent-management/project-mutations", {
      body: {
        schema: "cutex/human-management-project-mutation/v1",
        action_id: `desktop-${randomUUID()}`,
        project_id: projectId,
        expected_authority_epoch: expected.authorityEpoch,
        expected_project_revision: expected.projectRevision,
        operation,
      },
    });
  }

  async projectPresentation(projectId: string, expected: { authorityEpoch: number; presentationRevision: number }, presentation: { display_name: string; badge_label: string; color: string }) {
    return this.requireClient().request<unknown>("POST", "/v2/agent-management/project-presentation", {
      body: {
        schema: "cutex/human-management-project-presentation/v1",
        project_id: projectId,
        expected_authority_epoch: expected.authorityEpoch,
        expected_presentation_revision: expected.presentationRevision,
        presentation,
      },
    });
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
    return this.requireClient().asks<AskSummary>(filter);
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
      return { ok: false, error: { code: error.code, message, ...(tokens ? { tokens } : {}), ...(peers ? { peers } : {}), ...(userId ? { userId } : {}), ...(publicKey ? { publicKey } : {}) } };
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

  // ---------- optional components (cutex `components`, shared/components.ts) ----------
  // Owner only. The desktop only asks cutex to install / remove; cutex downloads, verifies, starts.

  components(): Promise<ComponentsList | null> {
    return this.requireClient().components();
  }

  componentAction(name: string, action: ComponentAction): Promise<ComponentResult> {
    return this.requireClient().componentAction(name, action);
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
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[], defaultPath: defaultPath || undefined };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  }

  // Local host only (a remote path means nothing here). Reveal, never open: opening could run it.
  async revealPath(path: string) {
    if (this.remote) throw new Error("the active host is remote: its files are not on this machine");
    if (!isAbsolute(path)) throw new Error("revealPath needs an absolute path");
    shell.showItemInFolder(path);
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

  queueList(sessionId: string) {
    return this.requireClient().queueList(sessionId);
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
   * session, a Claude turn runs).
   */
  async queuePromote(sessionId: string, queueId: string, expectedRevision: number, steer = false): Promise<QueuePromoteResult> {
    const client = this.requireClient();
    const { items } = await client.queueList(sessionId);
    const item = items.find((x) => x.queueId === queueId && x.revision === expectedRevision);
    if (!item) throw new Error(steer ? queueSteerErrorMessage("changed") : "queue item changed or already sent");
    if (steer) {
      try {
        const r = await client.queueSteer(sessionId, queueId, expectedRevision, { ifIdle: "start" });
        return { result: { disposition: r.disposition, turnId: r.turnId }, clientUserMessageId: r.clientUserMessageId, input: item.input };
      } catch (error) {
        const kind = error instanceof CutexApiError ? queueSteerErrorKind(error.code, error.details) : null;
        if (kind === null) throw error;
        throw new Error(queueSteerErrorMessage(kind, kind === "runtimeRefused" ? queueSteerErrorDetail((error as CutexApiError).details) : ""));
      }
    }
    await client.queueRemove(sessionId, queueId, expectedRevision);
    const result = await client.submitInput(sessionId, item.input, "auto", { clientUserMessageId: item.clientUserMessageId, origin: item.origin });
    return { result, clientUserMessageId: item.clientUserMessageId, input: item.input };
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
    try {
      const r = await this.requireClient().request<OwnerNotificationList>("GET", "/v2/owner-notifications", { query: { filter, agentId, limit } });
      return (Array.isArray(r?.notifications) ? r.notifications : []).map(asRecord).filter((n): n is OwnerNotification => n !== null);
    } catch (error) {
      if (error instanceof CutexApiError && (error.status === 404 || error.status === 405) && !error.code.startsWith("notification")) return [];
      throw error;
    }
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
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const safe = defaultName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120) || "conversation.md";
    const options = { defaultPath: safe.endsWith(".md") ? safe : `${safe}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, content, "utf8");
    return r.filePath;
  }
}

