import { contextBridge, ipcRenderer } from "electron";
import { browserBridge } from "./browser";
import { PLUGINS_CHANNEL, type PluginRequest } from "../shared/plugins";
import { FRAMES_CHANNEL, type FrameRequest } from "../shared/frames";
import { MODULE_PACKS_CHANNEL, type ModulePacksRequest } from "../shared/modulePacks";
import { KNOWN_ISSUES_CHANNEL, type KnownIssuesRequest } from "../shared/knownIssues";
import { LAUNCH_ART_CHANNEL, type LaunchArtRequest } from "../shared/launchArt";
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

const METHODS: InvokeMethod[] = [
  "hosts",
  "sshConfigHosts",
  "addSshHost",
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
  "exportIdentity",
  "importIdentity",
  "copyIdentityKey",
  "importIdentityKey",
  "setIdentityName",
  "copyProfileToHost",
  "daemonState",
  "browseDirs",
  "approvals",
  "decideApproval",
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
  "runtimes",
  "claudeAccounts",
  "createClaudeAccount",
  "renameClaudeAccount",
  "deleteClaudeAccount",
  "checkClaudeAccount",
  "profileQuotaDetail",
  "patchAgentSecurity",
  "sidebar",
  "bootstrap",
  "createAgent",
  "createHumanSession",
  "patchNewThreadDefaults",
  "services",
  "registerService",
  "patchService",
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
  "forkSession",
  "deleteSession",
  "projectMutation",
  "projectPresentation",
  "projectMemory",
  "projectMemoryFile",
  "projectMcp",
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
  "workflowRuns",
  "workflowRun",
  "workflowRunAction",
  "restoreCandidates",
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
  "patchProfile",
  "profileImage",
  "putProfileImage",
  "getProfile",
  "listProfiles",
  "queueList",
  "queueUpdate",
  "queueRemove",
  "queuePromote",
  "queueMove",
  "queueYield",
  "queueResume",
  "asksPause",
  "asksResume",
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
      const result = await ipcRenderer.invoke(INVOKE_CHANNEL, method, args, null);
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
    return ipcRenderer.invoke(INVOKE_CHANNEL, method, args, focusBinding());
  }]),
) as unknown as DesktopApi;

const DAEMON_METHODS = METHODS.filter((method) => !HOST_METHOD_SET.has(method));
const hostApis = new Map<string, DaemonApi>();
/** Daemon calls bound to one host's current connection (no focus check: background work of that host). */
function apiFor(hostId: string): DaemonApi {
  let hostApi = hostApis.get(hostId);
  if (!hostApi) {
    hostApi = Object.fromEntries(
      DAEMON_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(INVOKE_CHANNEL, method, args, deliveringHosts ? null : (bindings.get(hostId) ?? null))]),
    ) as unknown as DaemonApi;
    hostApis.set(hostId, hostApi);
  }
  return hostApi;
}

ipcRenderer.on(EVENT_CHANNEL, (_event, name: string, payload: unknown) => {
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
  browser: browserBridge({ invoke: (channel, request, binding) => ipcRenderer.invoke(channel, request, binding), binding: hostId => deliveringHosts ? null : bindings.get(hostId) ?? null, subscribe: listener => bridge.on("browserEvent", listener) }),
  api,
  apiFor,
  plugins: {
    list: () => ipcRenderer.invoke(PLUGINS_CHANNEL, { op: "list" } satisfies PluginRequest),
    prepare: (input) => ipcRenderer.invoke(PLUGINS_CHANNEL, { ...input, op: "prepare" } satisfies PluginRequest),
    release: (id) => ipcRenderer.invoke(PLUGINS_CHANNEL, { op: "release", id } satisfies PluginRequest),
  },
  frames: {
    prepareArtifactPage: (input) => ipcRenderer.invoke(FRAMES_CHANNEL, { op: "artifactPage", hostId: input.hostId, artifactId: input.artifactId, version: input.version, ...(input.large ? { large: true } : {}) } satisfies FrameRequest),
    release: (id) => ipcRenderer.invoke(FRAMES_CHANNEL, { op: "release", id } satisfies FrameRequest),
  },
  modulePacks: {
    state: () => ipcRenderer.invoke(MODULE_PACKS_CHANNEL, { op: "state" } satisfies ModulePacksRequest),
    check: () => ipcRenderer.invoke(MODULE_PACKS_CHANNEL, { op: "check" } satisfies ModulePacksRequest),
    install: (input) => ipcRenderer.invoke(MODULE_PACKS_CHANNEL, { op: "install", id: input.id, ...(input.version !== undefined ? { version: input.version } : {}), ...(input.allowOlder ? { allowOlder: true } : {}) } satisfies ModulePacksRequest),
    remove: (input) => ipcRenderer.invoke(MODULE_PACKS_CHANNEL, { op: "remove", id: input.id } satisfies ModulePacksRequest),
    onState: (listener) => bridge.on("modulePacks", listener),
  },
  knownIssues: {
    get: (refresh) => ipcRenderer.invoke(KNOWN_ISSUES_CHANNEL, { op: "get", refresh: refresh === true } satisfies KnownIssuesRequest),
  },
  launchArt: {
    state: () => ipcRenderer.invoke(LAUNCH_ART_CHANNEL, { op: "state" } satisfies LaunchArtRequest),
    import: () => ipcRenderer.invoke(LAUNCH_ART_CHANNEL, { op: "import" } satisfies LaunchArtRequest),
    clear: () => ipcRenderer.invoke(LAUNCH_ART_CHANNEL, { op: "clear" } satisfies LaunchArtRequest),
  },
  on(event, listener) {
    const set = listeners.get(event) ?? new Set();
    set.add(listener as Listener);
    listeners.set(event, set);
    return () => set.delete(listener as Listener);
  },
  platform: process.platform,
  window: {
    control: (action) => ipcRenderer.invoke(WINDOW_CHANNEL, "control", action),
    setChrome: (colors) => ipcRenderer.invoke(WINDOW_CHANNEL, "chrome", colors),
    setBackground: (color) => ipcRenderer.invoke(WINDOW_CHANNEL, "background", color),
    nativeControls: process.platform === "win32" ? "right" : process.platform === "darwin" ? "left" : null,
  },
  shell: {
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
    remoteClose: () => shellInvoke({ op: "remoteClose" }),
    answerRemoteClose: (action) => shellInvoke({ op: "answerRemoteClose", action }),
  },
  update: {
    state: () => ipcRenderer.invoke(UPDATE_CHANNEL, { op: "state" } satisfies UpdateRequest),
    check: () => ipcRenderer.invoke(UPDATE_CHANNEL, { op: "check" } satisfies UpdateRequest),
    apply: () => ipcRenderer.invoke(UPDATE_CHANNEL, { op: "apply" } satisfies UpdateRequest),
    setChannel: (channel: string) => ipcRenderer.invoke(UPDATE_CHANNEL, { op: "setChannel", channel } satisfies UpdateRequest),
    deleteOldReleases: () => ipcRenderer.invoke(UPDATE_CHANNEL, { op: "deleteOldReleases" } satisfies UpdateRequest),
  },
};

function shellInvoke<T>(request: ShellRequest): Promise<T> {
  return ipcRenderer.invoke(SHELL_CHANNEL, request) as Promise<T>;
}

contextBridge.exposeInMainWorld("cutex", bridge);

export type { DesktopEvents };
