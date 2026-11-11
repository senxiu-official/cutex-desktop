import { ImageCache, currentImageCache, installImageCache } from "./imageCache";
import { DEBUG_CHANNEL, debugEntries, type DebugRequest } from "../shared/debug";
import { DebugMode } from "./debugMode";
import { guardStdio } from "./stdioGuard";
import { appWindows, markOwnerWindow, ownerWindow } from "./appWindows";
import { localFileAction, localFileOpenInfo } from "./localFiles";
import { createRemoteCopies } from "./remoteCopiesIpc";
import { initialCaption, isOverlayColor, isSymbolColor } from "../shared/windowChrome";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell, webContents, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { EVENT_CHANNEL, HOST_METHOD_NAMES, INVOKE_CHANNEL, SHELL_CHANNEL, TITLEBAR_HEIGHT, UPDATE_CHANNEL, WINDOW_CHANNEL, type DaemonApi, type DaemonEvents, type DesktopApi, type DesktopEvents, type HostApi, type InvokeMethod, type ShellRequest, type UpdateRequest, type WindowAction } from "../shared/ipc";
import { isCloseBehavior, isShellLocale, isUpdateCheckMinutes } from "../shared/shell";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { unsupportedFeatureOf, unsupportedMessage } from "../shared/unsupported";
import { DaemonService } from "./daemon";
import { applyLoopbackNoProxy } from "../shared/loopbackNoProxy";
import { HostManager } from "./hosts";
import { hasImplicitLocalHost, localCutexConfigured } from "./localHost";
import { PersonIdentityService } from "./personIdentity";
import { DesktopShell } from "./shell";
import { initialWindowBounds, settleRestoredBounds, trackWindowState, loadWindowBackground, saveWindowBackground } from "./windowState";
import { setAppScheme } from "./appScheme";
import { MIN_WINDOW_SIZE } from "../shared/windowBounds";
import { Updater } from "./updater";
import { handleKnownIssuesRequest, KnownIssuesSource } from "./knownIssues";
import { KNOWN_ISSUES_CHANNEL, type KnownIssuesRequest } from "../shared/knownIssues";
import { handleLaunchArtRequest, LaunchArtStore } from "./launchArt";
import { LAUNCH_ART_CHANNEL, LAUNCH_ART_DIR, type LaunchArtRequest } from "../shared/launchArt";
import { nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import { DirectorAvatarStore, handleDirectorAvatarsRequest } from "./directorAvatars";
import { DIRECTOR_AVATAR_DIR, DIRECTOR_AVATAR_PX, DIRECTOR_AVATARS_CHANNEL, type DirectorAvatarsRequest } from "../shared/directorAvatars";
import { handlePortraitPacksRequest, PortraitPackStore } from "./portraitPacks";
import { FontPackStore, handleFontPackRequest } from "./fontPack";
import type { Transport } from "./updateTransport";
import { FONT_PACK_CHANNEL, FONT_PACK_DIR, FONT_SCHEME, parseFontPackRequest } from "../shared/fontCatalog";
import { PORTRAIT_PACK_DIR, PORTRAIT_PACKS_CHANNEL, type PortraitPacksRequest } from "../shared/portraitPacks";
import { resolveUpdateRemote } from "../shared/update";
import { resolveQuickstart, type QuickstartTarget } from "../shared/quickstart";
import { errorFields, logDir, logError } from "./errorLog";
import { setWindowAppDetails, setWindowsAppId, syncWindowsShortcuts } from "./winShortcuts";
import { DeskPetService } from "./deskPet";
import { packArtOf } from "./deskPetPackArt";
import { demoOwnerAlertRequested, OwnerAlerts } from "./ownerAlert";
import { DesktopNotifications } from "./notifications";
import { sanitizeEventAlert, sanitizeRetract, sanitizeShellNotification } from "../shared/notificationLevels";
import { createPluginNetworkLockdown, PLUGIN_WEBRTC_POLICY } from "./pluginNetwork";
import { FRAMES_CHANNEL, type FrameRequest } from "../shared/frames";
import { createFrameDocumentStore, type FrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { createArtifactPageService, FRAME_SCHEME, preparePlaced } from "./frames";
import { createPageStorage, type PageStorage } from "./pageStorage";
import { MODULE_API_VERSION } from "@cutex-desktop/plugin-sdk";
import { localPacksDefault, ModulePackService, modulePackRequestAllowed, modulePackSource, PackError } from "./modulePacks";
import { localModulePrompts } from "./localModulePrompts";
import { MODULE_DEV_HOST, ModuleDevService, moduleDevPrompts } from "./moduleDev";
import { MODULE_DEV_CHANNEL, parseModuleDevRequest } from "../shared/moduleDev";
import { ModuleDataService } from "./moduleData";
import { moduleDataPrompts } from "./moduleDataPrompts";
import { MODULE_DATA_CHANNEL, MODULE_DATA_DIR, parseModuleDataRequest } from "../shared/moduleData";
import { createUpdateNet } from "./updateNet";
import { BUILT_IN_MODULE_IDS, LOCAL_SAFE_START_ARG, MODULE_PACK_SCHEME, MODULE_PACKS_CHANNEL, parseModulePacksRequest } from "../shared/modulePacks";
import { parseReleaseInfo } from "../shared/update";

import type { HostBinding } from "../shared/hosts";
import { admitHostBinding } from "./hostFence";
import { addBrowserWindow, browserAppZoom, browserEmbeddable, browserHostEvent, installBrowser, syncBrowserHosts } from "./browser/install";
import { ClientPresenceService, presenceIdentity } from "./clientPresence";
import { RemoteCloseCountdown, type RemoteCloseView } from "../shared/remoteClose";
import { DeskShell } from "./deskShell";
import { confirmParent, frameRequestAllowed } from "./deskWindows";

// First: a console write to a closed pipe must never become the main-process error dialog (main/stdioGuard.ts).
guardStdio([process.stdout, process.stderr]);

let mainWindow: BrowserWindow | null = null;
// One store for every opaque frame document (plugin pages and agent pages, §10.2): one scheme, one lease check.
let frameDocuments: FrameDocumentStore | null = null;
let artifactPages: ReturnType<typeof createArtifactPageService> | null = null;
/** Channel A of agent pages (pageStorage.ts), in userData/artifact-pages. */
let pageStorage: PageStorage | null = null;
let pluginNetwork: ReturnType<typeof createPluginNetworkLockdown> | null = null;
let deskPet: DeskPetService | null = null;
// Signed first-party module packs (main/modulePacks.ts, docs/desktop-modules.md §23).
let modulePacks: ModulePackService | null = null;
// Modules loaded from a folder (main/moduleDev.ts, §30.5).
let moduleDev: ModuleDevService | null = null;
// A module's own data folder and the native file pick / save (main/moduleData.ts, §30.6).
let moduleData: ModuleDataService | null = null;
// This scheme serves only one-use, main-owned documents. It never bypasses CSP.
// Loopback (cutex, SSH tunnels) never through a proxy: explicit NO_PROXY for Node and child processes.
applyLoopbackNoProxy(process.env);

// cutex-module serves only files of verified signed packs to the app window's main frame (§23.5): CORS
// for module scripts, no fetch API, no CSP bypass.
protocol.registerSchemesAsPrivileged([
  { scheme: FRAME_SCHEME, privileges: { standard: true, secure: true } },
  { scheme: MODULE_PACK_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true } },
  // 中文字体包 files for the app window's fonts (main/fontPack.ts): catalog names only.
  { scheme: FONT_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true } },
]);

// Windows taskbar grouping: an explicit AppUserModelID shared with the launchers (before any window).
setWindowsAppId();

// Dev: a separate profile dir (own prefs, own single-instance lock) — see AGENTS.md "UI preview".
if (process.env.CUTEX_DESKTOP_USER_DATA) app.setPath("userData", process.env.CUTEX_DESKTOP_USER_DATA);

// Single instance: a second launch focuses the running window. CUTEX_DESKTOP_MULTI_INSTANCE=1 skips
// the lock (e.g. a dev build from a worktree next to the owner's running instance).
const primaryInstance = process.env.CUTEX_DESKTOP_MULTI_INSTANCE === "1" || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

const desktopShell = new DesktopShell(
  () => mainWindow,
  () => createWindow(),
  (command) => sendEvent("shellCommand", { command }),
);

// Desk windows (multi-window, main/deskShell.ts): drawn by the main window's renderer, admitted only by ticket.
const desks = new DeskShell({
  mainWindow: () => mainWindow,
  // 多窗口 off (desktop-prefs.json): no new desk tickets and no admission; open desks stay until closed.
  enabled: () => desktopShell.multiWindow,
  icon: () => desktopShell.appIcon(),
  background: () => loadWindowBackground() ?? (nativeTheme.shouldUseDarkColors ? "#0e0e0f" : "#f1f1f3"),
  ownsFrameUrl: (url, place) => !!frameDocuments?.ownsUrl(url, place),
  // A desk went: its agent pages / HTML files (leased to its webContents) go with it, channels and open confirm included.
  releaseFrames: (place) => {
    artifactPages?.releasePlace(place);
    frameDocuments?.releaseOwner(place);
  },
  emit: (event) => sendEvent("deskWindow", event),
  contextMenu: (win) => installEditMenu(win),
  created: (win) => {
    debugMode.register(win);
    markOwnerWindow(win);
    desktopShell.attachDesk(win);
  },
  // The in-app browser in desks (multi-window P5): the same per-window hardening as the main window's.
  browser: { embeddable: browserEmbeddable, add: addBrowserWindow },
});
desktopShell.desks = desks;

function sendEvent<K extends keyof DesktopEvents>(event: K, payload: DesktopEvents[K]): void {
  if (event === "hostsState" || event === "daemonState") syncBrowserHosts();
  // An SSH question (passphrase / password / host key) needs the window, also from the tray.
  if (event === "sshPrompts" && (payload as DesktopEvents["sshPrompts"]).prompts.length > 0) desktopShell.show();
  mainWindow?.webContents.send(EVENT_CHANNEL, event, payload);
}

const updater = new Updater(
  (status) => sendEvent("updateStatus", status),
  (channel) => resolveUpdateRemote(process.env.CUTEX_DESKTOP_UPDATE_REMOTE, desktopShell.state().prefs, channel),
  // The updater talks through its own Chromium session (system proxy, main/updateNet.ts); once the
  // agent-page / plugin containment is engaged its process-wide DNS lockdown stays, and the updater
  // moves its transfers to Node instead of loosening it.
  // Its proxy is this desktop's own update proxy (Settings → 网络代理: system / none / manual).
  { contained: () => pluginNetwork?.engaged() ?? false, proxy: () => desktopShell.updateProxyConfig() },
);
const debugMode = new DebugMode({ logs: logDir, emit: event => sendEvent("debug", event), platform: process.platform, version: () => app.getVersion(), flush: () => mainWindow?.webContents.executeJavaScript("window.__cutexDebugFlush?.()") ?? Promise.resolve() });

desktopShell.onPrefsChanged = (prefs) => updater.schedule(prefs.updateCheckMinutes);
// A relaunch exits without before-quit: lifecycle hosts hear `closing exited` first (bounded, main/clientPresence.ts).
updater.beforeExit = () => clientPresence?.reportExited() ?? Promise.resolve();
desktopShell.onUpdateProxyChanged = () => updater.reconfigureProxy();

/**
 * One daemon service per host connection (multi-host RFC §4.3): its events are tagged with the host
 * and the connection's routing epoch here; once the connection is replaced or closed it says nothing more.
 */
function createDaemon(hostId: string, epoch: string): DaemonService {
  const daemon: DaemonService = new DaemonService((event, payload) => {
    const manager = hosts;
    if (!manager || manager.connection(hostId)?.daemon !== daemon) return;
    const tag = { hostId, epoch };
    if (event === "accessChanged") manager.onAccessChanged(hostId, epoch);
    if (event === "daemonState") {
      const state = payload as DaemonEvents["daemonState"];
      manager.onDaemonState(hostId, epoch, state);
      ownerAlerts.onDaemonState(hostId, state);
      clientPresence?.onDaemonState(hostId, state);
      return sendEvent("daemonState", { ...tag, state });
    }
    if (event === "hostEvent") {
      const envelope = payload as DaemonEvents["hostEvent"];
      // Big alerts are main-owned: they show even while the window is hidden to the tray.
      ownerAlerts.onHostEvent(hostId, envelope);
      // browser_claim approvals: main may grant by policy (local page / 一直允许 / profile setting).
      browserHostEvent(hostId, envelope);
      // client-remote-close: a close request for this desktop instance starts the countdown (main-owned).
      clientPresence?.onHostEvent(hostId, envelope);
      return sendEvent("hostEvent", { ...tag, envelope });
    }
    sendEvent(event, { ...tag, ...(payload as object) } as DesktopEvents[typeof event]);
  });
  // Pairing v2: allowing a full-control device asks here, in a native dialog that shows its code (main/pairingInvites.ts).
  daemon.pairingHostLabel = () => hosts?.state().hosts.find((h) => h.id === hostId)?.label ?? hostId;
  daemon.pairingConfirm = async (options) => {
    const win = ownerWindow(mainWindow);
    const box = { type: "warning" as const, title: options.title, message: options.message, detail: options.detail, buttons: options.buttons, defaultId: 1, cancelId: 1, noLink: true };
    const answer = win && !win.isDestroyed() ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
    return answer.response === 0;
  };
  return daemon;
}

const ownerAlerts = new OwnerAlerts({
  daemonFor: (hostId) => hosts?.connection(hostId)?.daemon ?? null,
  shell: desktopShell,
  ownerWindow: () => ownerWindow(mainWindow),
  openInApp: (hostId, agentId, notificationId) => sendEvent("ownerNotifyOpen", { hostId, agentId, notificationId }),
  openEvent: (key) => sendEvent("notifyClick", { key }),
});

/**
 * Remote close (cutex `client-remote-close`, main/clientPresence.ts): the countdown is main's, so it
 * runs out also when no window can show it (hidden to the tray, never created, renderer gone). Its
 * end quits the desktop app only — the quit path (before-quit / will-quit below) stops SSH tunnels and
 * feeds, never a cutex daemon, runtime-host or service.
 */
const remoteClose = new RemoteCloseCountdown({
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  report: (hostId, instanceId, outcome) => clientPresence?.report(hostId, instanceId, outcome) ?? Promise.resolve(),
  quit: () => desktopShell.quit(),
  // A quit held open (a will-quit flush that never settles, a native modal) must not leave the dialog at 正在关闭.
  forceQuit: () => {
    console.warn("[cutex-desktop] remote close: the quit did not finish; exiting");
    app.exit(0);
  },
  onChange: (view) => {
    sendEvent("remoteClose", { view });
    if (view && !view.closing) revealForRemoteClose();
  },
});

/** The countdown must be seen to be cancelled: a hidden / minimised window comes up (without taking focus). */
function revealForRemoteClose(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.showInactive();
  if (!win.isFocused()) win.flashFrame(true);
}

/** Created after app ready (userData for the install id). */
let clientPresence: ClientPresenceService | null = null;
desktopShell.onAllowRemoteCloseChanged = (allowed) => {
  clientPresence?.resendAll();
  // Switched off while a countdown runs: the desktop stays (the hosts hear `cancelled`).
  if (!allowed && remoteClose.view()) void remoteClose.cancel();
};

// Desktop notifications the renderer's notifications module raises (shell op `notify`).
const desktopNotifications = new DesktopNotifications(desktopShell, (key) => sendEvent("notifyClick", { key }));

// Created after app ready (it needs userData / safeStorage).
let hosts: HostManager | null = null;
let remoteCopies: ReturnType<typeof createRemoteCopies> | null = null;
/** P2 person identity (main/personIdentity.ts); kept so quitting can clear a copied identity key. */
let identity: PersonIdentityService | null = null;

const ALLOWED: ReadonlySet<InvokeMethod> = new Set<InvokeMethod>([
  "profileLinkState", "syncProfileLinks", "resetProfileLinks",
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
]);

/** Host list / scope / connection calls go to HostManager; everything else to the bound host's daemon. */
const HOST_METHODS: ReadonlySet<string> = new Set<keyof HostApi>(HOST_METHOD_NAMES);

ipcMain.handle("cutex-desktop:image-cache", async (event, request) => {
  if (!isAppSender(event)) throw Error("untrusted sender");
  const cache = currentImageCache(); if (!cache) throw Error("starting up");
  if (request?.op === "state") return cache.state();
  if (request?.op === "configure") return cache.configure(request.settings);
  if (request?.op === "clear") return cache.clear();
  throw Error("unknown image cache operation");
});
ipcMain.handle(INVOKE_CHANNEL, async (event, method: InvokeMethod, args: unknown[], expected: HostBinding | null) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!ALLOWED.has(method)) throw new Error(`unknown method ${String(method)}`);
  if (HOST_METHODS.has(method)) {
    if (!hosts) throw new Error("starting up");
    const fn = hosts[method as keyof HostApi] as (...a: unknown[]) => Promise<unknown>;
    return fn.apply(hosts, args);
  }
  // Admission check, before any daemon method side effect (host / epoch / focus fence, main/hostFence.ts).
  const fence = admitHostBinding(() => hosts, expected);
  const daemon = fence.daemon;
  const fn = daemon[method as keyof DaemonApi] as (...a: unknown[]) => Promise<unknown>;
  try {
    const result = (await fn.apply(daemon, args)) as Awaited<ReturnType<DesktopApi[typeof method]>>;
    // A reply from a connection that has since been replaced or closed must not reach the UI.
    fence.check();
    return result;
  } catch (error) {
    debugMode.recordError(error, `invoke.${method}`);
    logError({ source: "invoke", method, hostId: typeof expected?.hostId === "string" ? expected.hostId : undefined, sessionId: typeof args?.[0] === "string" ? args[0] : undefined, ...errorFields(error) });
    // A Claude agent without this Codex feature: a recognisable message for a friendly notice.
    const feature = error instanceof CutexApiError ? unsupportedFeatureOf(error.code, error.details) : null;
    if (feature !== null) throw new Error(unsupportedMessage(feature));
    throw error;
  }
});

/**
 * QUICKSTART for the identity menu's 帮助与文档 (shared/quickstart.ts): the portable install's source
 * checkout, the release package's own copy, the repo of a dev run, else (packaged) the published page.
 */
function quickstartTarget(): QuickstartTarget | null {
  return resolveQuickstart({ sourceDir: updater.sourceDir(), releaseDir: updater.releaseDir(), appPath: app.getAppPath(), packaged: app.isPackaged }, existsSync, join);
}

ipcMain.on(DEBUG_CHANNEL, event => { event.returnValue = isAppSender(event) && desktopShell.state().prefs.debugMode === true; });

ipcMain.handle(DEBUG_CHANNEL, async (event, request: DebugRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!request || typeof request !== "object") throw new Error("invalid debug request");
  const keys = request.op === "enable" ? ["op", "value"] : request.op === "report" ? ["op", "entries"] : ["op"];
  if (Object.keys(request).some(key => !keys.includes(key))) throw new Error("unknown debug field");
  switch (request.op) {
    case "state": return debugMode.state();
    case "enable":
      if (typeof request.value !== "boolean") throw new Error("invalid debug switch");
      desktopShell.setDebugMode(request.value);
      return debugMode.setEnabled(request.value);
    case "report":
      if (debugMode.state().enabled) debugMode.report(debugEntries(request.entries));
      return;
    case "save": return debugMode.save();
    case "reveal": { const path = debugMode.bundlePath(); if (path) shell.showItemInFolder(path); return; }
    case "devtools": if (debugMode.state().enabled) event.sender.openDevTools({ mode: "detach" }); return;
    default: throw new Error("unknown debug operation");
  }
});

ipcMain.handle(SHELL_CHANNEL, (event, request: ShellRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  switch (request?.op) {
    case "remoteCopies":
      if (!remoteCopies) throw new Error("starting up");
      return remoteCopies.request(request.request);
    case "filePathInfo":
      if (Object.keys(request).some((key) => !["op", "hostId", "path"].includes(key))) throw new Error("unknown local file info field");
      return localFileOpenInfo(request.hostId, request.path);
    case "filePath":
      if (Object.keys(request).some((key) => !["op", "hostId", "path", "action"].includes(key))) throw new Error("unknown local file request field");
      return localFileAction(request.hostId, request.path, request.action, shell);
    case "setZoom":
      if (typeof request.factor !== "number" || !(request.factor >= 0.5 && request.factor <= 2.5)) throw new Error("bad zoom");
      event.sender.setZoomFactor(request.factor);
      desks.setZoom(request.factor);
      browserAppZoom(request.factor); // Guests follow their window; a remembered page zoom is re-applied on top.
      return;
    case "state":
      return { ...desktopShell.state(), quickstart: quickstartTarget() !== null };
    case "setCloseBehavior":
      if (!isCloseBehavior(request.value)) throw new Error("bad close behavior");
      return desktopShell.setCloseBehavior(request.value);
    case "setLocale":
      if (isShellLocale(request.value)) desktopShell.setLocale(request.value);
      return;
    case "setTerms":
      desktopShell.setTerms(request.value);
      return;
    case "setAttention":
      desktopShell.setAttention(request.count);
      return;
    case "logError":
      logError({ source: "renderer", message: String(request.message ?? "").slice(0, 2000), stack: typeof request.stack === "string" ? request.stack.slice(0, 4000) : undefined, kind: request.kind });
      return;
    case "openQuickstart": {
      const target = quickstartTarget();
      if (target?.kind === "file") void shell.openPath(target.path);
      else if (target?.kind === "url") void shell.openExternal(target.url);
      return;
    }
    case "quit":
      desktopShell.quit();
      return;
    case "setAllowRemoteClose":
      if (typeof request.value !== "boolean") throw new Error("bad value");
      return desktopShell.setAllowRemoteClose(request.value);
    case "setMemoryHost":
      return desktopShell.setMemoryHost(request.value);
    case "setMultiWindow":
    case "migrateMultiWindow":
      return desktopShell.setMultiWindow(request.op === "setMultiWindow" ? "set" : "migrate", request.value);
    case "remoteClose":
      return remoteClose.view() satisfies RemoteCloseView | null;
    case "answerRemoteClose":
      if (request.action !== "cancel" && request.action !== "now") throw new Error("bad action");
      return remoteClose.answer(request.action);
    case "rendererReady":
      updater.confirmReady();
      return;
    case "openLogs":
      mkdirSync(logDir(), { recursive: true });
      void shell.openPath(logDir());
      return;
    case "setUpdateCheckMinutes":
      if (!isUpdateCheckMinutes(request.value)) throw new Error("bad update interval");
      return desktopShell.setUpdateCheckMinutes(request.value);
    case "setUpdateProxy":
      return desktopShell.setUpdateProxy(request.value);
    case "setNotifyOff": {
      const state = desktopShell.setNotifyOff(request.value);
      ownerAlerts.onNotifyOffChanged();
      return state;
    }
    case "notify":
      if (!desktopShell.notifyOff.desktop) desktopNotifications.show(sanitizeShellNotification(request.notification));
      return;
    case "eventAlert":
      if (!desktopShell.notifyOff.bigAlert) ownerAlerts.showEvent(sanitizeEventAlert(request.alert));
      return;
    case "retractAlerts": {
      const retract = sanitizeRetract(request.retract);
      ownerAlerts.retract(retract);
      desktopNotifications.retract(retract);
      return;
    }
    default:
      throw new Error("unknown shell op");
  }
});

ipcMain.handle(UPDATE_CHANNEL, (event, request: UpdateRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  switch (request?.op) {
    case "state":
      return updater.state();
    case "check":
      return updater.check();
    case "apply":
      return updater.apply();
    case "setChannel":
      return updater.setChannel(String(request.channel));
    case "deleteOldReleases":
      return updater.deleteOldReleases();
    default:
      throw new Error("unknown update op");
  }
});

// Settings → 关于 → 已知问题: the release branch's list, fetched here through the updater's transport.
let knownIssues: KnownIssuesSource | null = null;
ipcMain.handle(KNOWN_ISSUES_CHANNEL, (event, request: KnownIssuesRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  knownIssues ??= new KnownIssuesSource({ transport: updater.transport(), cacheFile: join(app.getPath("userData"), "known-issues.json") });
  return handleKnownIssuesRequest(knownIssues, request);
});

// Settings → 外观 → 启动页立绘: imported launcher art in userData (main/launchArt.ts); the folder comes
// from main's own dialog, never from the renderer.
let launchArt: LaunchArtStore | null = null;
ipcMain.handle(LAUNCH_ART_CHANNEL, (event, request: LaunchArtRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  launchArt ??= new LaunchArtStore(join(app.getPath("userData"), LAUNCH_ART_DIR));
  return handleLaunchArtRequest(launchArt, request, async () => {
    const options = { properties: ["openDirectory"] as "openDirectory"[] };
    // On the window the owner is using (a desk on another display included).
    const parent = ownerWindow(mainWindow);
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
});

// 中文字体包: the big CJK fonts in userData (main/fontPack.ts), imported from a folder picked in main's own dialog or
// downloaded (下载并安装) through the updater's own network session — the user's update proxy; once plugin
// containment is engaged, Node through that proxy — never a renderer, page or frame session.
let fontPack: FontPackStore | null = null;
const fontPackStore = () => (fontPack ??= new FontPackStore(join(app.getPath("userData"), FONT_PACK_DIR), undefined, (state) => sendEvent("fontPack", state)));
let fontPackTransport: Transport | null = null;
const fontPackNetwork = () => ({ transport: (fontPackTransport ??= createUpdateNet({ contained: () => pluginNetwork?.engaged() ?? false, proxy: () => desktopShell.updateProxyConfig() }).transport) });
ipcMain.handle(FONT_PACK_CHANNEL, (event, raw: unknown) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  const request = parseFontPackRequest(raw);
  if (!request) throw new Error("unknown font-pack op");
  return handleFontPackRequest(fontPackStore(), request, async () => {
    const options = { properties: ["openDirectory"] as "openDirectory"[] };
    const parent = ownerWindow(mainWindow);
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  }, (dir) => shell.openPath(dir), join(app.getPath("userData"), FONT_PACK_DIR), fontPackNetwork);
});

// 「Director 头像」: the personal portrait folder in userData (main/directorAvatars.ts), read here and
// handed over as small PNG data URLs; the renderer never sees a path it could load.
let directorAvatars: DirectorAvatarStore | null = null;
ipcMain.handle(DIRECTOR_AVATARS_CHANNEL, (event, request: DirectorAvatarsRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  directorAvatars ??= new DirectorAvatarStore(join(app.getPath("userData"), DIRECTOR_AVATAR_DIR), (bytes) => {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const scale = Math.min(1, DIRECTOR_AVATAR_PX / Math.min(width, height));
    const resized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "best" }) : image;
    return resized.toPNG();
  });
  return handleDirectorAvatarsRequest(directorAvatars, request, (dir) => shell.openPath(dir));
});

// 拟人头像包: the owner's pack folder in userData (main/portraitPacks.ts); pictures go over as data URLs on request.
let portraitPacks: PortraitPackStore | null = null;
ipcMain.handle(PORTRAIT_PACKS_CHANNEL, (event, request: PortraitPacksRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  portraitPacks ??= new PortraitPackStore(join(app.getPath("userData"), PORTRAIT_PACK_DIR));
  return handlePortraitPacksRequest(portraitPacks, request, (dir) => shell.openPath(dir));
});

ipcMain.handle(MODULE_PACKS_CHANNEL, async (event, raw: unknown) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!modulePacks) throw new Error("module packs unavailable");
  const request = parseModulePacksRequest(raw);
  try {
    switch (request.op) {
      case "state":
        return modulePacks.view();
      case "check":
        return await modulePacks.check();
      case "install":
        return await modulePacks.install(request);
      case "remove":
        return await modulePacks.remove(request);
      case "installLocal":
        return await modulePacks.installLocal();
      case "allowLocal":
        return await modulePacks.allowLocal(request.allow);
      case "localFailed":
        return modulePacks.localFailed(request);
    }
  } catch (error) {
    // Only "busy" reaches here (operation failures come back in the view's lastError).
    throw new Error(error instanceof PackError ? `${error.code}: ${error.message}` : "module pack request failed");
  }
});

ipcMain.handle(MODULE_DEV_CHANNEL, async (event, raw: unknown) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!moduleDev) throw new Error("module developer mode unavailable");
  const request = parseModuleDevRequest(raw);
  switch (request.op) {
    case "state":
      return moduleDev.view();
    case "setEnabled":
      return await moduleDev.setEnabled(request.enabled);
    case "addFolder":
      return await moduleDev.addFolder();
    case "removeFolder":
      return moduleDev.removeFolder(request.folder);
    case "report":
      return moduleDev.report(request.folder, request.rev, request.error);
  }
});

ipcMain.handle(MODULE_DATA_CHANNEL, async (event, raw: unknown) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!moduleData) throw new Error("unavailable: module data is not ready");
  const request = parseModuleDataRequest(raw);
  switch (request.op) {
    case "read":
      return await moduleData.read(request.id, request.path);
    case "write":
      return await moduleData.write(request.id, request.path, request.data);
    case "remove":
      return await moduleData.remove(request.id, request.path);
    case "list":
      return await moduleData.list(request.id, request.path);
    case "usage":
      return await moduleData.usage(request.id);
    case "pick":
      return await moduleData.pick(request.id, request.filters);
    case "save":
      return await moduleData.save(request.id, request.data, request.suggestedName, request.filters);
    case "folders":
      return moduleData.folders();
    case "clear":
      return await moduleData.clear(request.id);
  }
});

ipcMain.handle(FRAMES_CHANNEL, async (event, request: FrameRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!artifactPages) throw new Error("frames unavailable");
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("invalid frame request");
  switch (request.op) {
    case "artifactPage":
    case "filePage": {
      // Optional deskId (multi-window P4): the document is leased to that desk's webContents only — a desk this
      // window opened and that is still open; anything else is refused before anything is read.
      return preparePlaced(artifactPages, desks.registry, event.sender.id, request);
    }
    case "release":
      if (Object.keys(request).length !== 2) throw new Error("invalid frame request");
      return artifactPages.release(event.sender.id, request.id);
    case "page": {
      if (Object.keys(request).length !== 3) throw new Error("invalid frame request");
      return artifactPages.page(event.sender.id, request.id, request.call);
    }
    case "pageDataUsage":
      if (Object.keys(request).length !== 1) throw new Error("invalid frame request");
      return pageStorage!.usage();
    case "pageDataClear": {
      if (Object.keys(request).length !== 3) throw new Error("invalid frame request");
      return pageStorage!.clear({ hostId: request.hostId, artifactId: request.artifactId });
    }
    default:
      throw new Error("invalid frame request");
  }
});

ipcMain.handle(WINDOW_CHANNEL, (event, kind: "control" | "chrome" | "background" | "scheme" | "desk", arg: unknown) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  const main = BrowserWindow.fromWebContents(event.sender);
  if (!main) return;
  if (kind === "desk") return deskRequest(event.sender.id, arg);
  if (kind === "control") {
    // A desk's own controls name it; main acts only on a desk this window opened and that is still open.
    const named = arg !== null && typeof arg === "object" ? (arg as { action?: unknown; deskId?: unknown }) : null;
    const win = named ? desks.resolve(event.sender.id, named.deskId) : main;
    if (!win) throw new Error("unknown desk");
    const action = (named ? named.action : arg) as WindowAction;
    if (action === "minimize") win.minimize();
    else if (action === "toggleMaximize") (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === "close") win.close();
  } else if (kind === "scheme") {
    // The app's light / dark: cutex's own browser pages follow it (main/appScheme, browser/pageScheme).
    setAppScheme(arg);
  } else if (kind === "background") {
    if (typeof arg === "string" && /^#[0-9a-f]{6}$/i.test(arg)) {
      main.setBackgroundColor(arg);
      desks.setBackground(arg);
      saveWindowBackground(arg);
    }
  } else if (kind === "chrome" && process.platform === "win32") {
    const { color, symbolColor } = arg as { color: string; symbolColor: string };
    // The fill may be transparent (#rrggbbaa, docs/design/029); the symbols stay opaque (shared/windowChrome).
    if (isOverlayColor(color) && isSymbolColor(symbolColor)) {
      main.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
      desks.setChrome({ color, symbolColor });
    }
  }
});

/** WINDOW_CHANNEL desk ops from the main window's renderer (shared/ipc.ts DeskBridge). */
function deskRequest(senderId: number, arg: unknown): unknown {
  const request = arg !== null && typeof arg === "object" && !Array.isArray(arg) ? (arg as Record<string, unknown>) : {};
  switch (request.op) {
    case "ticket":
      return desks.ticket(senderId, request.deskId);
    case "focus":
      if (request.deskId === null) {
        desktopShell.show();
        return true;
      }
      return desks.focus(senderId, request.deskId);
    case "close":
      desks.close(senderId, request.deskId);
      return;
    default:
      throw new Error("unknown desk op");
  }
}

/** The app window only: the big alert window has its own channel (main/ownerAlert.ts). */
function isAppSender(event: IpcMainInvokeEvent): boolean {
  if (ownerAlerts.isAlertSender(event.sender)) return false;
  return !!mainWindow && event.sender === mainWindow.webContents
    && !!event.senderFrame && event.senderFrame === mainWindow.webContents.mainFrame
    && isAppUrl(event.senderFrame.url);
}

function isAppUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  return url.startsWith("file://") || (!!devUrl && url.startsWith(devUrl));
}

function createWindow(): void {
  // Last size / position / maximized state, fitted to the displays connected now (main/windowState.ts).
  const initial = initialWindowBounds();
  mainWindow = new BrowserWindow({
    ...initial.bounds,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    // The colour the page last reported (theme + palette, window-background.json), else the OS theme's.
    backgroundColor: loadWindowBackground() ?? (nativeTheme.shouldUseDarkColors ? "#0e0e0f" : "#f1f1f3"),
    title: "Cutex",
    icon: desktopShell.appIcon(),
    autoHideMenuBar: true,
    // Custom title bar (TitleBar.tsx). Windows keeps native caption buttons via the overlay, its fill
    // transparent so the window bar shows through (docs/design/029; the renderer sets the symbols' colour); macOS keeps traffic lights; Linux draws its own buttons.
    ...(process.platform === "win32"
      ? { titleBarStyle: "hidden" as const, titleBarOverlay: { ...initialCaption(nativeTheme.shouldUseDarkColors), height: TITLEBAR_HEIGHT } }
      : process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset" as const }
        : { frame: false }),
    webPreferences: {
      webviewTag: true,
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Before tracking: the bounds Windows gave it are not quite the ones asked for (it grew on every start).
  settleRestoredBounds(mainWindow, initial.bounds);
  installBrowser(mainWindow, () => hosts, isAppSender, sendEvent, () => desktopShell.locale);
  mainWindow.once("ready-to-show", () => {
    if (initial.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  trackWindowState(mainWindow);
  const win = mainWindow;
  debugMode.register(win);
  win.webContents.setWindowOpenHandler((details) => {
    // A desk window with main's one-use ticket (main/deskWindows.ts); nothing else opens.
    const desk = desks.openResponse(win, details);
    if (desk) return desk;
    if (/^https?:\/\//.test(details.url)) void shell.openExternal(details.url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child, details) => void desks.adopt(win, child, details.frameName));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  const contents = mainWindow.webContents;
  const ownerId = contents.id;
  contents.on("will-frame-navigate", event => {
    if (event.isMainFrame ? !isAppUrl(event.url) : !frameDocuments?.ownsUrl(event.url, ownerId)) event.preventDefault();
  });
  // Drop all outstanding document leases on reload, renderer crash, or window disposal.
  // Agent pages lose their channels with them (an open submit dialog closes as cancelled).
  // The desks are drawn by this document: they go with it (a reload reopens the remembered ones).
  const releaseFrames = () => {
    desks.closeAll();
    frameDocuments?.releaseOwner(ownerId);
    artifactPages?.releaseOwner(ownerId);
  };
  contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      releaseFrames();
      // A reload or a crash says no stop to anyone: the pet's module has to claim it again.
      deskPet?.rendererGone();
    }
  });
  // Half a minute up with no crash or hang: local modules did not break this start (§23.14).
  const healthy = setTimeout(() => modulePacks?.localStartHealthy(), 30_000);
  mainWindow.on("unresponsive", () => clearTimeout(healthy));
  contents.on("render-process-gone", () => {
    clearTimeout(healthy);
    releaseFrames();
    deskPet?.rendererGone();
  });
  contents.on("destroyed", releaseFrames);
  installEditMenu(mainWindow);
  markOwnerWindow(mainWindow);
  setWindowAppDetails(mainWindow);
  desktopShell.attach(mainWindow);
  mainWindow.on("closed", () => {
    // Every window counts for window-all-closed: the pet must not keep the app alive.
    deskPet?.dispose();
    desks.closeAll();
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

/**
 * Native menu for text inputs and selected text; everything else uses the renderer menus (which
 * preventDefault, so this only fires where the renderer leaves it alone). Main window and desks.
 */
function installEditMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const l = desktopShell.editLabels;
    if (params.isEditable) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      if (params.misspelledWord) {
        items.push({ label: l.addToDictionary, click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
        items.push({ type: "separator" });
      }
      items.push(
        { role: "undo", label: l.undo, enabled: params.editFlags.canUndo },
        { role: "redo", label: l.redo, enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", label: l.cut, enabled: params.editFlags.canCut },
        { role: "copy", label: l.copy, enabled: params.editFlags.canCopy },
        { role: "paste", label: l.paste, enabled: params.editFlags.canPaste },
        { role: "selectAll", label: l.selectAll },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy", label: l.copy }, { role: "selectAll", label: l.selectAll });
    }
    if (items.length && !win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

/** The release page the packaged app records (package.json), for the module index's repository. */
function ownPackageJson(): unknown {
  try {
    return JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function ownReleasePage(): string | null {
  try {
    const info = parseReleaseInfo(JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")));
    return "reason" in info ? null : (info.releasePage ?? null);
  } catch {
    return null;
  }
}

app.on("second-instance", () => desktopShell.show());

// No UDP WebRTC in any of our webContents; plugin frames share the app window's (pluginNetwork.ts).
app.on("web-contents-created", (_event, contents) => contents.setWebRTCIPHandlingPolicy(PLUGIN_WEBRTC_POLICY));

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  const imageCache = new ImageCache(join(app.getPath("userData"), "image-cache"));
  installImageCache(imageCache);
  void imageCache.cleanup().catch(() => {});
  const imageCacheTimer = setInterval(() => { void imageCache.cleanup().catch(() => {}); }, 60 * 60_000);
  imageCacheTimer.unref?.();
  app.on("will-quit", () => clearInterval(imageCacheTimer));
  debugMode.setEnabled(desktopShell.state().prefs.debugMode === true);
  frameDocuments = createFrameDocumentStore({ scheme: FRAME_SCHEME, limitMessage: "Too many prepared frame documents" });
  pluginNetwork = createPluginNetworkLockdown({
    setProxy: config => session.defaultSession.setProxy(config),
    configureHostResolver: options => app.configureHostResolver(options),
    devRendererUrl: process.env.ELECTRON_RENDERER_URL,
  });
  const network = pluginNetwork;
  const pages = (pageStorage = createPageStorage({ root: join(app.getPath("userData"), "artifact-pages") }));
  artifactPages = createArtifactPageService({
    documents: frameDocuments,
    // Multi-window P4: a page for a desk is leased only while that desk is still this renderer's and open.
    placeOpen: (owner, place) => {
      const desk = desks.registry.byContents(place);
      return !!desk && desk.ownerId === owner && !desk.window.isDestroyed() && !desk.window.webContents.isDestroyed();
    },
    contentReader: hostId => {
      const daemon = hosts?.connection(hostId)?.daemon;
      return daemon && daemon.currentState.kind === "connected" ? daemon : null;
    },
    ensureContained: () => network.ensure(),
    // File pages read the file from that host (workspace route or fs-file-read), like the file view itself.
    fileReader: hostId => {
      const daemon = hosts?.connection(hostId)?.daemon;
      return daemon && daemon.currentState.kind === "connected" ? daemon : null;
    },
    // The three page channels (docs/design/004-artifact-page-bridge.md): A storage in userData, B a native
    // confirm before an owner message to the page's agent, C clipboard text.
    page: {
      storage: pages,
      host: hostId => {
        const daemon = hosts?.connection(hostId)?.daemon;
        if (!daemon || daemon.currentState.kind !== "connected") return null;
        return { artifactStoreGet: id => daemon.artifactStoreGet(id), submit: (sessionId, text) => daemon.submit(sessionId, text, "auto", true, { clientUserMessageId: randomUUID() }) };
      },
      confirm: async (owner, text, signal, place) => {
        // The window the frame was prepared for (bound at prepare): the owner's own, or a desk it opened and that is still open.
        const win = confirmParent(owner, place, desks.registry, (id) => {
          const contents = webContents.fromId(id);
          return contents && !contents.isDestroyed() ? BrowserWindow.fromWebContents(contents) : null;
        });
        if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null;
        if (!win.isFocused()) win.flashFrame(true);
        try {
          const answer = await dialog.showMessageBox(win, { type: "question", title: text.title, message: text.message, detail: text.detail, buttons: [text.send, text.cancel], defaultId: 1, cancelId: 1, noLink: true, signal });
          return !signal.aborted && answer.response === 0;
        } finally {
          if (!win.isDestroyed()) win.flashFrame(false);
        }
      },
      writeClipboard: text => clipboard.writeText(text),
      locale: () => desktopShell.locale,
    },
  });
  protocol.handle(FRAME_SCHEME, request => frameDocuments!.respond(request));
  const dataPrompts = moduleDataPrompts(() => mainWindow, () => desktopShell.locale);
  const data = (moduleData = new ModuleDataService({
    root: join(app.getPath("userData"), MODULE_DATA_DIR),
    known: (id) => BUILT_IN_MODULE_IDS.includes(id) || !!modulePacks?.installedIds().includes(id) || !!moduleDev?.ids().includes(id),
    prompts: dataPrompts,
  }));
  // An unpackaged run or a self-built package; never a CI release package (the owner's stored switch does not change it).
  const devBuild = localPacksDefault({ packaged: app.isPackaged, packageJson: ownPackageJson() });
  modulePacks = new ModulePackService({
    root: join(app.getPath("userData"), "modules"),
    source: modulePackSource({ releasePage: app.isPackaged ? ownReleasePage() : null, packaged: app.isPackaged, env: process.env }),
    // The updater's own Chromium session (system / manual update proxy); Node once plugin containment is engaged.
    transport: createUpdateNet({ contained: () => pluginNetwork?.engaged() ?? false, proxy: () => desktopShell.updateProxyConfig() }).transport,
    appModuleApi: MODULE_API_VERSION,
    local: {
      defaultAllowed: devBuild,
      internal: devBuild,
      skip: process.argv.includes(LOCAL_SAFE_START_ARG),
      reservedIds: BUILT_IN_MODULE_IDS,
      prompts: localModulePrompts(() => mainWindow, () => desktopShell.locale),
      data: { has: (id) => data.has(id), bytes: (id) => data.bytes(id), delete: (id) => data.delete(id), confirmRemove: (id, bytes) => dataPrompts.confirmRemove(id, bytes) },
    },
    onChange: (view) => sendEvent("modulePacks", view),
    log: (text) => console.log(`[module-packs] ${text}`),
  });
  const packs = modulePacks;
  const devModules = new ModuleDevService({
    file: join(app.getPath("userData"), "module-dev.json"),
    appModuleApi: MODULE_API_VERSION,
    reservedIds: BUILT_IN_MODULE_IDS,
    skip: process.argv.includes(LOCAL_SAFE_START_ARG),
    internal: devBuild,
    prompts: moduleDevPrompts(() => mainWindow, () => desktopShell.locale),
    onChange: (view) => sendEvent("moduleDev", view),
  });
  moduleDev = devModules;
  protocol.handle(FONT_SCHEME, request => fontPackStore().respond(request));
  protocol.handle(MODULE_PACK_SCHEME, request => (new URL(request.url).hostname === MODULE_DEV_HOST ? devModules.respond(request) : packs.respond(request)));
  // Electron keeps ONE onBeforeRequest listener per session (a second call replaces the first), so both
  // privileged schemes share this one; each branch decides only for its own scheme.
  session.defaultSession.webRequest.onBeforeRequest({ urls: [`${MODULE_PACK_SCHEME}://*/*`, `${FRAME_SCHEME}://*/*`] }, (request, callback) => {
    if (request.url.startsWith(`${MODULE_PACK_SCHEME}:`)) {
      // Pack code is for the app window's own document: no plugin / agent-page frame, worker, fetch or other window.
      const main = mainWindow?.webContents;
      // A desk mirrors the main document's pack <link> stylesheets (lib/deskDocument): its own main frame may
      // load those, never a pack script (the desk runs no code of its own).
      const desk = main && request.webContentsId !== undefined ? desks.registry.byContents(request.webContentsId) : null;
      const deskFrame = desk && desk.ownerId === main?.id && !desk.window.isDestroyed() ? { id: desk.contentsId, mainFrame: desk.window.webContents.mainFrame } : null;
      callback({ cancel: !(modulePackRequestAllowed(request, main ? { id: main.id, mainFrame: main.mainFrame } : null) || (request.resourceType === "stylesheet" && modulePackRequestAllowed(request, deskFrame))) });
      return;
    }
    // The main window and its desks only (frame owner group), each only its own leases (main/deskWindows.ts).
    callback({ cancel: !frameRequestAllowed(request, mainWindow?.webContents.id ?? null, desks.registry, (url, place) => frameDocuments!.ownsUrl(url, place)) });
  });
  // Deny everything except writing the clipboard (copy buttons); reading it stays denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "clipboard-sanitized-write"));
  desktopShell.start();
  desks.watchDisplays();
  ownerAlerts.start();
  deskPet = new DeskPetService({
    dir: join(app.getPath("userData"), "desk-pet"),
    isAppSender,
    packArt: () => modulePacks && packArtOf({ paths: (prefix) => modulePacks!.dataPaths("desk-pet", prefix), read: (path) => modulePacks!.dataFile("desk-pet", path) }),
    locale: () => desktopShell.locale,
    sendView: (view) => sendEvent("deskPet", view),
    openSettings: () => {
      desktopShell.show();
      sendEvent("deskPetOpenSettings", {});
    },
    openPath: (dir) => shell.openPath(dir),
    log: (message) => console.warn(message),
  });
  deskPet.register();
  updater.schedule(desktopShell.state().prefs.updateCheckMinutes);
  createWindow();
  syncWindowsShortcuts();
  updater.watchLaunch((listener) => mainWindow?.webContents.on("render-process-gone", listener));
  // Dev: an isolated local cutex home / port (see AGENTS.md "Dev cutex daemon").
  // P2 person identity: the person key and its per-host claims (main/personIdentity.ts).
  const personIdentity = new PersonIdentityService(join(app.getPath("userData"), "identity"), (view) => sendEvent("identityState", view), () => ownerWindow(mainWindow), () => hosts?.claimTargets() ?? []);
  identity = personIdentity;
  const localProbe = { home: process.env.CUTEX_DESKTOP_HOME || undefined, baseUrl: process.env.CUTEX_MANAGEMENT_URL || undefined };
  clientPresence = new ClientPresenceService({
    daemonFor: (hostId) => hosts?.connection(hostId)?.daemon ?? null,
    allowRemoteClose: () => desktopShell.allowRemoteClose,
    identity: () => presenceIdentity(join(app.getPath("userData"), "client-install.json"), app.getVersion(), process.platform),
    onCloseRequested: (hostId, request) => void remoteClose.request(hostId, request),
  });
  hosts = new HostManager(sendEvent, createDaemon, {
    onProfileLinkState: (state) => sendEvent("profileLinkState", state),
    identity: personIdentity,
    ...localProbe,
    // macOS is front-end only: no implicit local host unless a local cutex is configured (main/localHost.ts).
    localHost: hasImplicitLocalHost(process.platform, localCutexConfigured(localProbe)),
    onDisconnect: (hostId) => {
      ownerAlerts.forgetHost(hostId);
      clientPresence?.forgetHost(hostId);
      remoteClose.forgetHost(hostId);
    },
    onSshPrompts: (prompts) => sendEvent("sshPrompts", { prompts }),
  });
  // Dev only: sample big alerts without a daemon (screenshots).
  if (demoOwnerAlertRequested()) setTimeout(() => ownerAlerts.showDemo(), 1500);
  await hosts.start();
  remoteCopies = createRemoteCopies(app.getPath("userData"), () => hosts, shell, async () => {
    // Downloads page → 更改文件夹: main's own dialog, on the window the owner is using.
    const options = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const parent = ownerWindow(mainWindow);
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  app.on("activate", () => {
    if (appWindows().length === 0) createWindow();
    else desktopShell.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!primaryInstance) return;
  // Lifecycle hosts (cutex `client-presence-lifecycle`) first hear `closing exited` over the still-open
  // connections: the first quit waits for it (at most EXIT_REPORT_TIMEOUT_MS, all hosts in parallel), then
  // quits again; without such a host nothing waits. Tray quit, closing the last window and remote close
  // all come through here; the updater's relaunch (app.exit) calls reportExited itself.
  if (clientPresence?.beforeQuit(() => event.preventDefault(), () => app.quit())) return;
  // Synchronous kill: no ssh tunnel may outlive the app (every connection: tunnels, feeds, daemons).
  // "daemons" = this app's DaemonService connections (HTTP feeds); cutex itself keeps running.
  clientPresence?.stop();
  remoteCopies?.dispose();
  hosts?.stop();
});
app.on("will-quit", (event) => {
  // A copied identity key still waiting for its clear: clear it first (the clipboard outlives the app), then quit again.
  // An agent page's storage changes not written yet (pageStorage writes within 250 ms): first to disk, then quit again.
  if (pageStorage?.pending()) {
    event.preventDefault();
    void pageStorage.flush().catch(() => undefined).finally(() => app.quit());
    return;
  }
  if (identity?.hasPendingKeyClears()) {
    event.preventDefault();
    void identity.clearCopiedKeysNow().finally(() => app.quit());
    return;
  }
  ownerAlerts.dispose();
  deskPet?.dispose();
  remoteClose.dispose();
  desktopShell.dispose();
});
