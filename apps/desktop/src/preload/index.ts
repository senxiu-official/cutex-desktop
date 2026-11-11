import { installDebugReactHook } from "../shared/debugReactHook";
import { DEBUG_CHANNEL, debugError, type DebugRequest } from "../shared/debug";
import { contextBridge, ipcRenderer } from "electron";
import { browserBridge } from "./browser";
import { FRAMES_CHANNEL, type FrameRequest } from "../shared/frames";
import { MODULE_PACKS_CHANNEL, type ModulePacksRequest } from "../shared/modulePacks";
import { MODULE_DEV_CHANNEL, type ModuleDevRequest } from "../shared/moduleDev";
import { MODULE_DATA_CHANNEL, type ModuleDataRequest } from "../shared/moduleData";
import { DESK_PET_CHANNEL, type DeskPetRequest } from "../shared/deskPet";
import { KNOWN_ISSUES_CHANNEL, type KnownIssuesRequest } from "../shared/knownIssues";
import { LAUNCH_ART_CHANNEL, type LaunchArtRequest } from "../shared/launchArt";
import { FONT_PACK_CHANNEL, type FontPackRequest } from "../shared/fontCatalog";
import { DIRECTOR_AVATARS_CHANNEL, type DirectorAvatarsRequest } from "../shared/directorAvatars";
import { PORTRAIT_PACKS_CHANNEL, type PortraitPacksRequest } from "../shared/portraitPacks";
import {
  EVENT_CHANNEL,
  HOST_METHOD_NAMES,
  HOST_TAGGED_EVENTS,
  INVOKE_CHANNEL,
  SHELL_CHANNEL,
  UPDATE_CHANNEL,
  WINDOW_CHANNEL,
  type DaemonApi,
  type DesktopApi,
  type DesktopEvents,
  type HostTag,
  type InvokeMethod,
  type PreloadBridge,
  type ShellRequest,
  type UpdateRequest,
} from "../shared/ipc";

// A one-time main-owned flag, including reloads after changing the setting.
let debugEnabled = ipcRenderer.sendSync(DEBUG_CHANNEL) === true;
if (debugEnabled) contextBridge.executeInMainWorld({ func: installDebugReactHook });
function invoke(channel: string, ...args: unknown[]): ReturnType<typeof ipcRenderer.invoke> {
  const call = ipcRenderer.invoke(channel, ...args);
  if (!debugEnabled || channel === DEBUG_CHANNEL) return call;
  return call.catch((error: unknown) => {
    const method = typeof args[0] === "string" ? args[0] : String((args[0] as { op?: string } | undefined)?.op ?? "request");
    void ipcRenderer.invoke(DEBUG_CHANNEL, { op: "report", entries: [debugError(error, `${channel}.${method}`)] } satisfies DebugRequest).catch(() => {});
    throw error;
  });
}

const METHODS: InvokeMethod[] = [
  "hosts",
  "sshConfigHosts",
  "addSshHost",
  "importSshHostToken",
  "pairSshHost",
  "setSshConnectAs",
  "updateSshHost",
  "removeSshHost",
  "switchHost",
  "setScope",
  "reconnectHost",
  "connectHost",
  "setHostAutoConnect",
  "setHostAppearance",
  "saveHostGroups",
  "testHost",
  "setHostStartOn",
  "sshPrompts",
  "answerSshPrompt",
  "identityState",
  "profileLinkState", "syncProfileLinks", "resetProfileLinks",
  "exportIdentity",
  "importIdentity",
  "copyIdentityKey",
  "importIdentityKey",
  "setIdentityName",
  "copyProfileToHost",
  "daemonState",
  "browseDirs",
  "approvals",
  "approvalsPage",
  "decideApproval",
  "approvalRules",
  "confirmApprovalRule",
  "createApprovalRule",
  "patchApprovalRule",
  "deleteApprovalRule",
  "approvalRuleAudit",
  "storage",
  "storageRefresh",
  "storageItems",
  "storageCleanupPreview",
  "storageCleanupExecute",
  "storageCleanupHistory",
  "storageCleanupRun",
  "runtimePackages",
  "runtimePackageRun",
  "startRuntimePackageRun",
  "revertRuntimePackageRun",
  "directorRotations",
  "directorRotation",
  "startDirectorRotation",
  "cancelDirectorRotation",
  "continueDirectorRotation",
  "stuckBusMessages",
  "discardStuckBusMessage",
  "delegationUpgradeSnapshot",
  "delegationUpgradeAction",
  "delegationUpgradeApproval",
  "delegationRoutingApprovals",
  "delegationUpgradeOperation",
  "delegationRetirementReview",
  "closeBusMessage",
  "busMessageEvidence",
  "runtimes",
  "runtimePrunePlan",
  "pruneRuntimes",
  "claudeAccounts",
  "addProfileVariant",
  "patchProfileVariant",
  "deleteProfileVariant",
  "createClaudeAccount",
  "renameClaudeAccount",
  "setClaudeAccountKey",
  "deleteClaudeAccount",
  "checkClaudeAccount",
  "kimiAccounts",
  "createKimiAccount",
  "renameKimiAccount",
  "deleteKimiAccount",
  "checkKimiAccount",
  "logoutKimiAccount",
  "startKimiLogin",
  "kimiLogin",
  "cancelKimiLogin",
  "profileQuotaDetail",
  "patchAgentSecurity",
  "sidebar",
  "sidebarLoadArchived",
  "sidebarPeek",
  "bootstrap",
  "createAgent",
  "abandonAgentCreate",
  "createHumanSession",
  "renameFormalAgent",
  "promoteQuickChat",
  "formalNameHistory",
  "patchNewThreadDefaults",
  "services",
  "registerService",
  "patchService",
  "serviceEligibleOwners",
  "deleteService",
  "serviceAction",
  "openService",
  "serviceLogs",
  "patchServicesSettings",
  "profileAccount",
  "profileLogin",
  "profileLoginStatus",
  "profileLoginCancel",
  "profileLogout",
  "notificationLevel",
  "setNotificationLevel",
  "history",
  "historyMedia",
  "eventBlob",
  "imageAction",
  "subscribe",
  "notesList", "notesGet", "notesCreate", "notesUpdate", "notesDelete",
  "sideOpen", "sideList", "sideRead", "sideSend", "sideInterrupt", "sideRespond", "sideClose",
  "unsubscribe",
  "submit",
  "interrupt",
  "listModels",
  "updateThreadSettings",
  "compactThread",
  "profileQuota",
  "profileResetCredits",
  "consumeResetCredit",
  "createProfile",
  "profilePresets",
  "duplicateProfile",
  "ccSwitchImportList",
  "ccSwitchImport",
  "deleteProfile",
  "readRateLimits",
  "windowsSandboxReadiness",
  "setupWindowsSandbox",
  "quotaConfig",
  "putQuotaConfig",
  "capabilities",
  "usage",
  "usagePrices",
  "putUsagePrices",
  "guidesPreferences",
  "putGuidesPreferences",
  "usageSources",
  "addUsageSource",
  "patchUsageSource",
  "deleteUsageSource",
  "rescanUsageSource",
  "fsDir",
  "fsFile",
  "hostFile",
  "fsSearch",
  "gitStatus",
  "gitDiff",
  "watchWorkspace",
  "unwatchWorkspace",
  "terminalList",
  "terminalCreate",
  "terminalAttach",
  "terminalDetach",
  "terminalInput",
  "terminalResize",
  "terminalKill",
  "codexRequest",
  "skillArchives",
  "archiveSkill",
  "restoreSkill",
  "managedMcp",
  "switchProfile",
  "sessionAction",
  "openExternal",
  "pickFolder",
  "revealPath",
  "revertHistory",
  "filesRevert",
  "forkSession",
  "forkPreview",
  "deleteSession",
  "projectRead",
  "operatorAction",
  "operatorRuntimeNotice",
  "projectMutation",
  "projectPresentation",
  "projectMemory",
  "projectMemoryFile",
  "projectMcp",
  "agentMcp",
  "setAgentMcpDisabled",
  "asks",
  "ask",
  "askAnswer",
  "artifact",
  "artifactStoreList",
  "artifactStoreGet",
  "artifactStoreContent",
  "artifactStoreDiff",
  "artifactStoreResolve",
  "artifactStoreUsage",
  "artifactStorePublish",
  "artifactStorePatch",
  "artifactStoreDelete",
  "alarms",
  "cancelAlarm",
  "ownerPins",
  "ownerPinUpdate",
  "workflowRuns",
  "workflowRun",
  "workflowRunAction",
  "restoreCandidates",
  "idleRuntimes",
  "stopIdle",
  "dismissRestoreCandidates",
  "quotaAutoContinue",
  "setQuotaAutoContinue",
  "cancelQuotaAutoContinue",
  "peers",
  "createPeerInvite",
  "addPeer",
  "patchPeer",
  "deletePeer",
  "peerInflight",
  "peerAgents",
  "peerAudit",
  "patchPeersSettings",
  "users",
  "createUser",
  "patchUser",
  "deleteUser",
  "bindUserToken",
  "bindUserPeer",
  "patchUsersSettings",
  "usersMe",
  "patchUsersMe",
  "usersMeDevices",
  "usersMeRemoveDevice",
  "userAvatar",
  "userLayout",
  "putUserLayout",
  "putLayoutPointer",
  "userHome",
  "putUserHome",
  "homeCover",
  "putHomeCover",
  "deleteHomeCover",
  "serviceTile",
  "serviceTileImage",
  "putUserPersonKeys",
  "ackTokenPersonChange",
  "upgradeStatus",
  "upgradeCheck",
  "upgradeStage",
  "upgradeApply",
  "upgradeCancel",
  "upgradeRollback",
  "upgradeRuns",
  "upgradeRun",
  "patchUpgradeSettings",
  "hostServiceInfo",
  "hostOwner",
  "setOwnerPerson",
  "clearOwnerPerson",
  "components",
  "componentAction",
  "componentConfigure",
  "componentIndexCheck",
  "askCommand",
  "jobs",
  "jobServiceCapabilities",
  "cancelJob",
  "jobOutput",
  "markExternalJob",
  "inboundMail",
  "putInboundMail",
  "testInboundMail",
  "deleteInboundMail",
  "nciVerification",
  "putNciVerification",
  "deleteNciVerification",
  "generateNciKey",
  "nciHelper",
  "saveNciHelper",
  "subAgentThread",
  "searchThread",
  "backgroundTerminals",
  "terminateBackgroundTerminal",
  "stopClaudeTask",
  "directorScopeCandidates",
  "directorReviewContent",
  "projectDirector",
  "directorHandovers",
  "directorStartReviews",
  "decideDirectorItem",
  "approveDirectorScope",
  "projectEvents",
  "projectBackground",
  "watchProjectEvents",
  "unwatchProjectEvents",
  "panConnection",
  "panConfigure",
  "panDisconnect",
  "panAuthStart",
  "panAuthPoll",
  "panAuthCode",
  "panFiles",
  "panSearch",
  "panMeta",
  "panDownloads",
  "panStartDownload",
  "panDownloadAction",
  "watchPan",
  "unwatchPan",
  "putUserInstructions",
  "userInstructions",
  "agentHarness",
  "claudeCodeSources",
  "claudeRuntime",
  "repinClaudeRuntime",
  "sessionSkills",
  "claudeModelStatus",
  "sessionSandboxExtras",
  "setSessionSandboxExtras",
  "claudePermissionRules",
  "setClaudePermissionRules",
  "claudeSkillsImportList",
  "importClaudeSkills",
  "patchSettings",
  "patchProxySettings",
  "getSettings",
  "createPairingCode",
  "pairingInvites",
  "createPairingInvite",
  "cancelPairingInvite",
  "relayPairing",
  "setRelayPairing",
  "approvePairingRequest",
  "denyPairingRequest",
  "clientTokens",
  "revokeClientToken",
  "renameClientToken",
  "updateClientToken",
  "ownerNewDevices",
  "ackOwnerNewDevice",
  "onlineClients",
  "closeOnlineClient",
  "resetModel",
  "deleteModel",
  "patchModel",
  "discoverModels",
  "profileModels",
  "profileAutoPick",
  "patchProfile",
  "profileImage",
  "putProfileImage",
  "getProfile",
  "listProfiles",
  "inputGet", "inputList", "inputHold", "inputRetry", "inputInterruptSend", "inputDismiss", "inputLeaseRelease", "queueMerge",
  "queueList",
  "queueUpdate",
  "queueRemove",
  "queuePromote",
  "queueMergeInsert",
  "queueMove",
  "queueYield",
  "queueResume",
  "asksPause",
  "asksResume",
  "agentPause",
  "agentResume",
  "stopTurn",
  "respond",
  "threadGoal",
  "setThreadGoal",
  "clearThreadGoal",
  "startReview",
  "collaborationModes",
  "setMemoryMode",
  "resetMemory",
  "experimentalFeatures",
  "setExperimentalFeature",
  "saveMarkdown",
  "pickImages",
  "ownerNotifications",
  "ownerNotificationsPage",
  "ownerNotifyAction",
  "safetyCheckDecide",
  "patchOwnerNotify",
  "notificationLevels",
  "patchNotificationLevels",
  "evaluateNotification",
];

type Listener = (payload: unknown) => void;
type HostBinding = import("../shared/hosts").HostBinding;
type HostsState = import("../shared/hosts").HostsState;
const listeners = new Map<string, Set<Listener>>();
/**
 * Per host: the connection (routing epoch) the renderer has seen (multi-host RFC §5). A call carries
 * its target host's binding; main admits it only for that exact connection (C-011 per host).
 */
const bindings = new Map<string, HostBinding>();
let observedHosts: HostsState | null = null;
let observation = 0;
let deliveringHosts = false;
const HOST_METHOD_SET: ReadonlySet<string> = new Set(HOST_METHOD_NAMES);
const TAGGED: ReadonlySet<string> = new Set(HOST_TAGGED_EVENTS);

const epochsOf = (state: HostsState | null) => new Map((state?.hosts ?? []).map((h) => [h.id, h.conn?.epoch ?? null] as const));

function deliverHosts(payload: HostsState): void {
  const revision = ++observation;
  const before = epochsOf(observedHosts);
  const after = epochsOf(payload);
  // Reentrant requests to a host whose connection changed must fail closed while the UI / store
  // resets; hosts whose connection did not change keep working.
  for (const [id, epoch] of bindings) if (after.get(id) !== epoch.epoch || before.get(id) !== epoch.epoch) bindings.delete(id);
  observedHosts = payload;
  // Nested delivery invalidates the outer reset. Leave authorization closed until a fresh
  // explicit handshake/event can deliver one coherent host snapshot to every listener.
  if (deliveringHosts) {
    bindings.clear();
    return;
  }
  const callbacks = listeners.get("hostsState");
  const failures: unknown[] = [];
  deliveringHosts = true;
  try {
    // Listeners are isolated: one that throws must neither starve the others of the new host
    // nor leave every daemon call failing until the next host event. Main still admits each
    // request against the target host's current routing epoch.
    for (const listener of [...(callbacks ?? [])]) {
      try { listener(payload); } catch (error) { failures.push(error); }
      if (revision !== observation) break;
    }
  } finally { deliveringHosts = false; }
  // A nested newer notification wins (it left every binding closed).
  if (revision === observation && callbacks?.size)
    for (const host of payload.hosts) if (typeof host.conn?.epoch === "string" && host.conn.epoch) bindings.set(host.id, { hostId: host.id, epoch: host.conn.epoch });
  // Still surface listener bugs to the caller (renderer error log), after authorizing.
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "hostsState listeners failed");
}

/** The binding of the focus host, marked as a focus call (none while a host notification is being delivered). */
const focusBinding = (): HostBinding | null => {
  const binding = deliveringHosts || !observedHosts ? undefined : bindings.get(observedHosts.active);
  return binding ? { ...binding, focus: true } : null;
};

const api = Object.fromEntries(
  METHODS.map((method) => [method, async (...args: unknown[]) => {
    const before = observation;
    if (HOST_METHOD_SET.has(method)) {
      const result = await invoke(INVOKE_CHANNEL, method, args, null);
      if (method === "hosts") {
        // The explicit startup handshake also updates the renderer before authorizing its API.
        // A late handshake may not replace a newer event or implicitly authorize an old intent.
        if (before === observation) deliverHosts(result);
        return observedHosts ?? result;
      }
      return result;
    }
    // Daemon call on the focus host: main refuses it, or its reply, once the focus moved or that
    // host reconnected ("host switched", HostBinding.focus).
    return invoke(INVOKE_CHANNEL, method, args, focusBinding());
  }]),
) as unknown as DesktopApi;

const DAEMON_METHODS = METHODS.filter((method) => !HOST_METHOD_SET.has(method));
const hostApis = new Map<string, DaemonApi>();
/** Daemon calls bound to one host's current connection (no focus check: background work of that host). */
function apiFor(hostId: string): DaemonApi {
  let hostApi = hostApis.get(hostId);
  if (!hostApi) {
    hostApi = Object.fromEntries(
      DAEMON_METHODS.map((method) => [method, (...args: unknown[]) => invoke(INVOKE_CHANNEL, method, args, deliveringHosts ? null : (bindings.get(hostId) ?? null))]),
    ) as unknown as DaemonApi;
    hostApis.set(hostId, hostApi);
  }
  return hostApi;
}

ipcRenderer.on(EVENT_CHANNEL, (_event, name: string, payload: unknown) => {
  if (name === "debug" && payload && typeof payload === "object" && "state" in payload) debugEnabled = (payload as { state: { enabled?: boolean } }).state.enabled === true;
  if (name === "hostsState") return deliverHosts(payload as HostsState);
  // An event of a connection the renderer has not seen yet, or of one already replaced: dropped
  // (the matching hostsState starts that host over anyway).
  if (TAGGED.has(name)) {
    const tag = payload as Partial<HostTag> | null;
    const binding = typeof tag?.hostId === "string" ? bindings.get(tag.hostId) : undefined;
    const seen = typeof tag?.hostId === "string" ? epochsOf(observedHosts).get(tag.hostId) : undefined;
    if (!tag || (binding?.epoch ?? seen) !== tag.epoch) return;
  }
  for (const listener of listeners.get(name) ?? []) listener(payload);
});

const bridge: PreloadBridge = {
  imageCache: {
    state: () => invoke("cutex-desktop:image-cache", { op: "state" }),
    configure: (settings) => invoke("cutex-desktop:image-cache", { op: "configure", settings }),
    clear: () => invoke("cutex-desktop:image-cache", { op: "clear" }),
  },
  debug: {
    initiallyEnabled: debugEnabled,
    state: () => invoke(DEBUG_CHANNEL, { op: "state" } satisfies DebugRequest),
    enable: value => invoke(DEBUG_CHANNEL, { op: "enable", value } satisfies DebugRequest),
    save: () => invoke(DEBUG_CHANNEL, { op: "save" } satisfies DebugRequest),
    reveal: () => invoke(DEBUG_CHANNEL, { op: "reveal" } satisfies DebugRequest),
    devtools: () => invoke(DEBUG_CHANNEL, { op: "devtools" } satisfies DebugRequest),
    report: entries => invoke(DEBUG_CHANNEL, { op: "report", entries } satisfies DebugRequest),
  },
  browser: browserBridge({ invoke: (channel, request, binding) => invoke(channel, request, binding), binding: hostId => deliveringHosts ? null : bindings.get(hostId) ?? null, subscribe: listener => bridge.on("browserEvent", listener) }),
  api,
  apiFor,
  frames: {
    prepareArtifactPage: (input, deskId) => invoke(FRAMES_CHANNEL, { op: "artifactPage", hostId: input.hostId, artifactId: input.artifactId, version: input.version, ...(input.large ? { large: true } : {}), ...(deskId === undefined ? {} : { deskId }) } satisfies FrameRequest),
    prepareFilePage: (input, deskId) => invoke(FRAMES_CHANNEL, { op: "filePage", hostId: input.hostId, path: input.path, ...(input.scope ? { scope: { kind: input.scope.kind, id: input.scope.id } } : {}), ...(input.large ? { large: true } : {}), ...(deskId === undefined ? {} : { deskId }) } satisfies FrameRequest),
    release: (id) => invoke(FRAMES_CHANNEL, { op: "release", id } satisfies FrameRequest),
    page: (id, call) => invoke(FRAMES_CHANNEL, { op: "page", id, call } satisfies FrameRequest),
    pageDataUsage: () => invoke(FRAMES_CHANNEL, { op: "pageDataUsage" } satisfies FrameRequest),
    pageDataClear: (hostId, artifactId) => invoke(FRAMES_CHANNEL, { op: "pageDataClear", hostId, artifactId } satisfies FrameRequest),
  },
  moduleDev: {
    state: () => invoke(MODULE_DEV_CHANNEL, { op: "state" } satisfies ModuleDevRequest),
    setEnabled: (enabled) => invoke(MODULE_DEV_CHANNEL, { op: "setEnabled", enabled } satisfies ModuleDevRequest),
    addFolder: () => invoke(MODULE_DEV_CHANNEL, { op: "addFolder" } satisfies ModuleDevRequest),
    removeFolder: (folder) => invoke(MODULE_DEV_CHANNEL, { op: "removeFolder", folder } satisfies ModuleDevRequest),
    report: (folder, rev, error) => invoke(MODULE_DEV_CHANNEL, { op: "report", folder, rev, error } satisfies ModuleDevRequest),
    onState: (listener) => bridge.on("moduleDev", listener),
  },
  moduleData: {
    read: (id, path) => invoke(MODULE_DATA_CHANNEL, { op: "read", id, path } satisfies ModuleDataRequest),
    write: (id, path, data) => invoke(MODULE_DATA_CHANNEL, { op: "write", id, path, data } satisfies ModuleDataRequest),
    remove: (id, path) => invoke(MODULE_DATA_CHANNEL, { op: "remove", id, path } satisfies ModuleDataRequest),
    list: (id, path) => invoke(MODULE_DATA_CHANNEL, { op: "list", id, path } satisfies ModuleDataRequest),
    usage: (id) => invoke(MODULE_DATA_CHANNEL, { op: "usage", id } satisfies ModuleDataRequest),
    pick: (id, filters) => invoke(MODULE_DATA_CHANNEL, { op: "pick", id, filters } satisfies ModuleDataRequest),
    save: (id, data, suggestedName, filters) => invoke(MODULE_DATA_CHANNEL, { op: "save", id, data, suggestedName, filters } satisfies ModuleDataRequest),
    folders: () => invoke(MODULE_DATA_CHANNEL, { op: "folders" } satisfies ModuleDataRequest),
    clear: (id) => invoke(MODULE_DATA_CHANNEL, { op: "clear", id } satisfies ModuleDataRequest),
  },
  modulePacks: {
    state: () => invoke(MODULE_PACKS_CHANNEL, { op: "state" } satisfies ModulePacksRequest),
    check: () => invoke(MODULE_PACKS_CHANNEL, { op: "check" } satisfies ModulePacksRequest),
    install: (input) => invoke(MODULE_PACKS_CHANNEL, { op: "install", id: input.id, ...(input.version !== undefined ? { version: input.version } : {}), ...(input.allowOlder ? { allowOlder: true } : {}) } satisfies ModulePacksRequest),
    remove: (input) => invoke(MODULE_PACKS_CHANNEL, { op: "remove", id: input.id } satisfies ModulePacksRequest),
    installLocal: () => invoke(MODULE_PACKS_CHANNEL, { op: "installLocal" } satisfies ModulePacksRequest),
    allowLocal: (input) => invoke(MODULE_PACKS_CHANNEL, { op: "allowLocal", allow: input.allow } satisfies ModulePacksRequest),
    localFailed: (input) => invoke(MODULE_PACKS_CHANNEL, { op: "localFailed", id: input.id, version: input.version, reason: input.reason } satisfies ModulePacksRequest),
    onState: (listener) => bridge.on("modulePacks", listener),
  },
  deskPet: {
    state: () => invoke(DESK_PET_CHANNEL, { op: "state" } satisfies DeskPetRequest),
    start: (labels) => invoke(DESK_PET_CHANNEL, { op: "start", labels } satisfies DeskPetRequest),
    stop: () => invoke(DESK_PET_CHANNEL, { op: "stop" } satisfies DeskPetRequest),
    set: (patch) => invoke(DESK_PET_CHANNEL, { op: "set", patch } satisfies DeskPetRequest),
    tick: (tick) => invoke(DESK_PET_CHANNEL, { op: "tick", ...tick } satisfies DeskPetRequest),
    reloadArt: () => invoke(DESK_PET_CHANNEL, { op: "reloadArt" } satisfies DeskPetRequest),
    openFolder: () => invoke(DESK_PET_CHANNEL, { op: "openFolder" } satisfies DeskPetRequest),
    preview: (id) => invoke(DESK_PET_CHANNEL, { op: "preview", id } satisfies DeskPetRequest),
    follow: (family) => invoke(DESK_PET_CHANNEL, { op: "follow", family } satisfies DeskPetRequest),
    onState: (listener) => bridge.on("deskPet", listener),
    onOpenSettings: (listener) => bridge.on("deskPetOpenSettings", () => listener()),
  },
  knownIssues: {
    get: (refresh) => invoke(KNOWN_ISSUES_CHANNEL, { op: "get", refresh: refresh === true } satisfies KnownIssuesRequest),
  },
  launchArt: {
    state: () => invoke(LAUNCH_ART_CHANNEL, { op: "state" } satisfies LaunchArtRequest),
    import: () => invoke(LAUNCH_ART_CHANNEL, { op: "import" } satisfies LaunchArtRequest),
    clear: () => invoke(LAUNCH_ART_CHANNEL, { op: "clear" } satisfies LaunchArtRequest),
  },
  fontPack: {
    state: () => invoke(FONT_PACK_CHANNEL, { op: "state" } satisfies FontPackRequest),
    import: () => invoke(FONT_PACK_CHANNEL, { op: "import" } satisfies FontPackRequest),
    remove: (id) => invoke(FONT_PACK_CHANNEL, { op: "remove", id } satisfies FontPackRequest),
    openFolder: () => invoke(FONT_PACK_CHANNEL, { op: "openFolder" } satisfies FontPackRequest),
    download: () => invoke(FONT_PACK_CHANNEL, { op: "download" } satisfies FontPackRequest),
    cancelDownload: () => invoke(FONT_PACK_CHANNEL, { op: "cancelDownload" } satisfies FontPackRequest),
    onState: (listener) => bridge.on("fontPack", listener),
  },
  directorAvatars: {
    list: () => invoke(DIRECTOR_AVATARS_CHANNEL, { op: "list" } satisfies DirectorAvatarsRequest),
    openFolder: () => invoke(DIRECTOR_AVATARS_CHANNEL, { op: "openFolder" } satisfies DirectorAvatarsRequest),
  },
  portraitPacks: {
    list: () => invoke(PORTRAIT_PACKS_CHANNEL, { op: "list" } satisfies PortraitPacksRequest),
    openFolder: () => invoke(PORTRAIT_PACKS_CHANNEL, { op: "openFolder" } satisfies PortraitPacksRequest),
    image: (ref, kind) => invoke(PORTRAIT_PACKS_CHANNEL, { op: "image", pack: ref.pack, theme: ref.theme, stem: ref.stem, kind } satisfies PortraitPacksRequest),
  },
  on(event, listener) {
    const set = listeners.get(event) ?? new Set();
    set.add(listener as Listener);
    listeners.set(event, set);
    return () => set.delete(listener as Listener);
  },
  platform: process.platform,
  window: {
    control: (action, deskId) => invoke(WINDOW_CHANNEL, "control", deskId === undefined ? action : { action, deskId }),
    desk: {
      ticket: (deskId) => invoke(WINDOW_CHANNEL, "desk", { op: "ticket", ...(deskId === undefined ? {} : { deskId }) }),
      focus: (deskId) => invoke(WINDOW_CHANNEL, "desk", { op: "focus", deskId }),
      close: (deskId) => invoke(WINDOW_CHANNEL, "desk", { op: "close", deskId }),
    },
    setChrome: (colors) => invoke(WINDOW_CHANNEL, "chrome", colors),
    setBackground: (color) => invoke(WINDOW_CHANNEL, "background", color),
    setScheme: (scheme) => invoke(WINDOW_CHANNEL, "scheme", scheme),
    nativeControls: process.platform === "win32" ? "right" : process.platform === "darwin" ? "left" : null,
  },
  shell: {
    remoteCopies: (request) => shellInvoke({ op: "remoteCopies", request }),
    filePathInfo: (hostId, path) => shellInvoke({ op: "filePathInfo", hostId, path }),
    filePath: (hostId, path, action) => shellInvoke({ op: "filePath", hostId, path, action }),
    state: () => shellInvoke({ op: "state" }),
    setCloseBehavior: (value) => shellInvoke({ op: "setCloseBehavior", value }),
    setLocale: (value) => shellInvoke({ op: "setLocale", value }),
    setTerms: (value) => shellInvoke({ op: "setTerms", value }),
    setAttention: (count) => shellInvoke({ op: "setAttention", count }),
    setUpdateCheckMinutes: (value) => shellInvoke({ op: "setUpdateCheckMinutes", value }),
    setUpdateProxy: (value) => shellInvoke({ op: "setUpdateProxy", value }),
    logError: (entry) => shellInvoke({ op: "logError", ...entry }),
    openLogs: () => shellInvoke({ op: "openLogs" }),
    openQuickstart: () => shellInvoke({ op: "openQuickstart" }),
    quit: () => shellInvoke({ op: "quit" }),
    rendererReady: () => shellInvoke({ op: "rendererReady" }),
    setZoom: (factor) => shellInvoke({ op: "setZoom", factor }),
    setNotifyOff: (value) => shellInvoke({ op: "setNotifyOff", value }),
    notify: (notification) => shellInvoke({ op: "notify", notification }),
    eventAlert: (alert) => shellInvoke({ op: "eventAlert", alert }),
    retractAlerts: (retract) => shellInvoke({ op: "retractAlerts", retract }),
    setAllowRemoteClose: (value) => shellInvoke({ op: "setAllowRemoteClose", value }),
    setMemoryHost: (value) => shellInvoke({ op: "setMemoryHost", value }),
    setMultiWindow: (value) => shellInvoke({ op: "setMultiWindow", value }),
    migrateMultiWindow: (value) => shellInvoke({ op: "migrateMultiWindow", value }),
    remoteClose: () => shellInvoke({ op: "remoteClose" }),
    answerRemoteClose: (action) => shellInvoke({ op: "answerRemoteClose", action }),
  },
  update: {
    state: () => invoke(UPDATE_CHANNEL, { op: "state" } satisfies UpdateRequest),
    check: () => invoke(UPDATE_CHANNEL, { op: "check" } satisfies UpdateRequest),
    apply: () => invoke(UPDATE_CHANNEL, { op: "apply" } satisfies UpdateRequest),
    setChannel: (channel: string) => invoke(UPDATE_CHANNEL, { op: "setChannel", channel } satisfies UpdateRequest),
    deleteOldReleases: () => invoke(UPDATE_CHANNEL, { op: "deleteOldReleases" } satisfies UpdateRequest),
  },
};

function shellInvoke<T>(request: ShellRequest): Promise<T> {
  return invoke(SHELL_CHANNEL, request) as Promise<T>;
}

contextBridge.exposeInMainWorld("cutex", bridge);

export type { DesktopEvents };
