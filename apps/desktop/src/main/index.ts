import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, protocol, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { EVENT_CHANNEL, HOST_METHOD_NAMES, INVOKE_CHANNEL, SHELL_CHANNEL, TITLEBAR_HEIGHT, UPDATE_CHANNEL, WINDOW_CHANNEL, type DaemonApi, type DaemonEvents, type DesktopApi, type DesktopEvents, type HostApi, type InvokeMethod, type ShellRequest, type UpdateRequest, type WindowAction } from "../shared/ipc";
import { isCloseBehavior, isShellLocale, isUpdateCheckMinutes } from "../shared/shell";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { unsupportedFeatureOf, unsupportedMessage } from "../shared/unsupported";
import { DaemonService } from "./daemon";
import { HostManager } from "./hosts";
import { hasImplicitLocalHost, localCutexConfigured } from "./localHost";
import { PersonIdentityService } from "./personIdentity";
import { DesktopShell } from "./shell";
import { initialWindowBounds, trackWindowState } from "./windowState";
import { MIN_WINDOW_SIZE } from "../shared/windowBounds";
import { Updater } from "./updater";
import { resolveUpdateRemote } from "../shared/update";
import { errorFields, logDir, logError } from "./errorLog";
import { setWindowAppDetails, setWindowsAppId, syncWindowsShortcuts } from "./winShortcuts";
import { demoOwnerAlertRequested, OwnerAlerts } from "./ownerAlert";
import { DesktopNotifications } from "./notifications";
import { sanitizeEventAlert, sanitizeRetract, sanitizeShellNotification } from "../shared/notificationLevels";
import { createPluginResourceService, PLUGIN_SCHEME } from "./plugins";
import { createPluginNetworkLockdown, PLUGIN_WEBRTC_POLICY } from "./pluginNetwork";
import { PLUGINS_CHANNEL, type PluginRequest } from "../shared/plugins";
import { FRAMES_CHANNEL, type FrameRequest } from "../shared/frames";
import { createFrameDocumentStore, type FrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { createArtifactPageService } from "./frames";

import type { HostBinding } from "../shared/hosts";
import { admitHostBinding } from "./hostFence";
import { browserHostEvent, installBrowser, syncBrowserHosts } from "./browser/install";

let mainWindow: BrowserWindow | null = null;
let pluginResources: ReturnType<typeof createPluginResourceService> | null = null;
// One store for every opaque frame document (plugin pages and agent pages, §10.2): one scheme, one lease check.
let frameDocuments: FrameDocumentStore | null = null;
let artifactPages: ReturnType<typeof createArtifactPageService> | null = null;
let pluginNetwork: ReturnType<typeof createPluginNetworkLockdown> | null = null;
// This scheme serves only one-use, main-owned documents. It never bypasses CSP.
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } }]);

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

function sendEvent<K extends keyof DesktopEvents>(event: K, payload: DesktopEvents[K]): void {
  if (event === "hostsState" || event === "daemonState") syncBrowserHosts();
  mainWindow?.webContents.send(EVENT_CHANNEL, event, payload);
}

const updater = new Updater(
  (status) => sendEvent("updateStatus", status),
  (channel) => resolveUpdateRemote(process.env.CUTEX_DESKTOP_UPDATE_REMOTE, desktopShell.state().prefs, channel),
  // The updater talks through its own Chromium session (system proxy, main/updateNet.ts); once the
  // agent-page / plugin containment is engaged its process-wide DNS lockdown stays, and the updater
  // moves its transfers to Node instead of loosening it.
  { contained: () => pluginNetwork?.engaged() ?? false },
);
desktopShell.onPrefsChanged = (prefs) => updater.schedule(prefs.updateCheckMinutes);

/**
 * One daemon service per host connection (multi-host RFC §4.3): its events are tagged with the host
 * and the connection's routing epoch here; once the connection is replaced or closed it says nothing more.
 */
function createDaemon(hostId: string, epoch: string): DaemonService {
  const daemon: DaemonService = new DaemonService((event, payload) => {
    const manager = hosts;
    if (!manager || manager.connection(hostId)?.daemon !== daemon) return;
    const tag = { hostId, epoch };
    if (event === "daemonState") {
      const state = payload as DaemonEvents["daemonState"];
      manager.onDaemonState(hostId, epoch, state);
      ownerAlerts.onDaemonState(hostId, state);
      return sendEvent("daemonState", { ...tag, state });
    }
    if (event === "hostEvent") {
      const envelope = payload as DaemonEvents["hostEvent"];
      // Big alerts are main-owned: they show even while the window is hidden to the tray.
      ownerAlerts.onHostEvent(hostId, envelope);
      // browser_claim approvals: main may grant by policy (local page / 一直允许 / profile setting).
      browserHostEvent(hostId, envelope);
      return sendEvent("hostEvent", { ...tag, envelope });
    }
    sendEvent(event, { ...tag, ...(payload as object) } as DesktopEvents[typeof event]);
  });
  return daemon;
}

const ownerAlerts = new OwnerAlerts({
  daemonFor: (hostId) => hosts?.connection(hostId)?.daemon ?? null,
  shell: desktopShell,
  mainWindow: () => mainWindow,
  openInApp: (hostId, agentId, notificationId) => sendEvent("ownerNotifyOpen", { hostId, agentId, notificationId }),
  openEvent: (key) => sendEvent("notifyClick", { key }),
});

// Desktop notifications the renderer's notifications module raises (shell op `notify`).
const desktopNotifications = new DesktopNotifications(desktopShell, (key) => sendEvent("notifyClick", { key }));

// Created after app ready (it needs userData / safeStorage).
let hosts: HostManager | null = null;
/** P2 person identity (main/personIdentity.ts); kept so quitting can clear a copied identity key. */
let identity: PersonIdentityService | null = null;

const ALLOWED: ReadonlySet<InvokeMethod> = new Set<InvokeMethod>([
  "hosts",
  "sshConfigHosts",
  "addSshHost",
  "pairSshHost",
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
  "identityState",
  "exportIdentity",
  "importIdentity",
  "copyIdentityKey",
  "importIdentityKey",
  "setIdentityName",
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
  "deleteProfile",
  "readRateLimits",
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
  "backgroundTerminals",
  "terminateBackgroundTerminal",
  "putUserInstructions",
  "userInstructions",
  "agentHarness",
  "patchSettings",
  "getSettings",
  "createPairingCode",
  "clientTokens",
  "revokeClientToken",
  "renameClientToken",
  "resetModel",
  "deleteModel",
  "patchModel",
  "discoverModels",
  "profileModels",
  "patchProfile",
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
  "patchOwnerNotify",
  "notificationLevels",
  "patchNotificationLevels",
  "evaluateNotification",
]);

/** Host list / scope / connection calls go to HostManager; everything else to the bound host's daemon. */
const HOST_METHODS: ReadonlySet<string> = new Set<keyof HostApi>(HOST_METHOD_NAMES);

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
    logError({ source: "invoke", method, hostId: typeof expected?.hostId === "string" ? expected.hostId : undefined, sessionId: typeof args?.[0] === "string" ? args[0] : undefined, ...errorFields(error) });
    // A Claude agent without this Codex feature: a recognisable message for a friendly notice.
    const feature = error instanceof CutexApiError ? unsupportedFeatureOf(error.code, error.details) : null;
    if (feature !== null) throw new Error(unsupportedMessage(feature));
    throw error;
  }
});

/**
 * The local QUICKSTART (identity menu → 帮助与文档): the portable install's source checkout, or the
 * repo of a dev run. No packaged copy and no configured URL: null hides the item.
 */
function quickstartPath(): string | null {
  const roots = [updater.sourceDir(), app.isPackaged ? null : join(app.getAppPath(), "..", "..")];
  for (const root of roots) {
    const path = root ? join(root, "docs", "QUICKSTART.md") : null;
    if (path && existsSync(path)) return path;
  }
  return null;
}

ipcMain.handle(SHELL_CHANNEL, (event, request: ShellRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  switch (request?.op) {
    case "setZoom":
      if (typeof request.factor !== "number" || !(request.factor >= 0.5 && request.factor <= 2.5)) throw new Error("bad zoom");
      event.sender.setZoomFactor(request.factor);
      return;
    case "state":
      return { ...desktopShell.state(), quickstart: quickstartPath() !== null };
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
      const path = quickstartPath();
      if (path) void shell.openPath(path);
      return;
    }
    case "quit":
      desktopShell.quit();
      return;
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

ipcMain.handle(PLUGINS_CHANNEL, async (event, request: PluginRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!pluginResources || !pluginNetwork) throw new Error("plugin catalog unavailable");
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("invalid plugin request");
  switch (request.op) {
    case "list":
      if (Object.keys(request).length !== 1) throw new Error("invalid plugin request");
      return pluginResources.list();
    case "prepare": {
      const { op: _op, ...input } = request;
      // No plugin document exists before Chromium networking is contained (pluginNetwork.ts).
      await pluginNetwork.ensure();
      return pluginResources.prepare(event.sender.id, input);
    }
    case "release":
      if (Object.keys(request).length !== 2 || typeof request.id !== "string") throw new Error("invalid plugin request");
      return pluginResources.release(event.sender.id, request.id);
    default:
      throw new Error("invalid plugin request");
  }
});

ipcMain.handle(FRAMES_CHANNEL, async (event, request: FrameRequest) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  if (!artifactPages) throw new Error("frames unavailable");
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("invalid frame request");
  switch (request.op) {
    case "artifactPage": {
      const { op: _op, ...input } = request;
      return artifactPages.prepare(event.sender.id, input);
    }
    case "release":
      if (Object.keys(request).length !== 2) throw new Error("invalid frame request");
      return artifactPages.release(event.sender.id, request.id);
    default:
      throw new Error("invalid frame request");
  }
});

ipcMain.handle(WINDOW_CHANNEL, (event, kind: "control" | "chrome", arg: unknown) => {
  if (!isAppSender(event)) throw new Error("untrusted sender");
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (kind === "control") {
    const action = arg as WindowAction;
    if (action === "minimize") win.minimize();
    else if (action === "toggleMaximize") (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === "close") win.close();
  } else if (kind === "chrome" && process.platform === "win32") {
    const { color, symbolColor } = arg as { color: string; symbolColor: string };
    if (/^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(symbolColor)) win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  }
});

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#161616" : "#ffffff",
    title: "Cutex",
    icon: desktopShell.appIcon(),
    autoHideMenuBar: true,
    // Custom title bar (TitleBar.tsx). Windows keeps native caption buttons via the overlay
    // (recolored by the renderer); macOS keeps traffic lights; Linux draws its own buttons.
    ...(process.platform === "win32"
      ? { titleBarStyle: "hidden" as const, titleBarOverlay: { color: nativeTheme.shouldUseDarkColors ? "#1c1c1d" : "#f6f6f7", symbolColor: nativeTheme.shouldUseDarkColors ? "#e5e5e5" : "#333333", height: TITLEBAR_HEIGHT } }
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
  installBrowser(mainWindow, () => hosts, isAppSender, sendEvent);
  mainWindow.once("ready-to-show", () => {
    if (initial.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  trackWindowState(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  const contents = mainWindow.webContents;
  const ownerId = contents.id;
  contents.on("will-frame-navigate", event => {
    if (event.isMainFrame ? !isAppUrl(event.url) : !frameDocuments?.ownsUrl(event.url, ownerId)) event.preventDefault();
  });
  // Drop all outstanding document leases on reload, renderer crash, or window disposal.
  contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) frameDocuments?.releaseOwner(ownerId);
  });
  contents.on("render-process-gone", () => frameDocuments?.releaseOwner(ownerId));
  contents.on("destroyed", () => frameDocuments?.releaseOwner(ownerId));
  // Native menu for text inputs and selected text; everything else uses the renderer menus
  // (which preventDefault, so this only fires where the renderer leaves it alone).
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const l = desktopShell.editLabels;
    if (params.isEditable) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) items.push({ label: word, click: () => mainWindow?.webContents.replaceMisspelling(word) });
      if (params.misspelledWord) {
        items.push({ label: l.addToDictionary, click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
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
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow ?? undefined });
  });
  setWindowAppDetails(mainWindow);
  desktopShell.attach(mainWindow);
  mainWindow.on("closed", () => (mainWindow = null));

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

app.on("second-instance", () => desktopShell.show());

// No UDP WebRTC in any of our webContents; plugin frames share the app window's (pluginNetwork.ts).
app.on("web-contents-created", (_event, contents) => contents.setWebRTCIPHandlingPolicy(PLUGIN_WEBRTC_POLICY));

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  frameDocuments = createFrameDocumentStore({ scheme: PLUGIN_SCHEME, limitMessage: "Too many prepared frame documents" });
  pluginResources = createPluginResourceService(join(app.getPath("userData"), "plugins"), { documents: frameDocuments });
  pluginNetwork = createPluginNetworkLockdown({
    setProxy: config => session.defaultSession.setProxy(config),
    configureHostResolver: options => app.configureHostResolver(options),
    devRendererUrl: process.env.ELECTRON_RENDERER_URL,
  });
  const network = pluginNetwork;
  artifactPages = createArtifactPageService({
    documents: frameDocuments,
    contentReader: hostId => {
      const daemon = hosts?.connection(hostId)?.daemon;
      return daemon && daemon.currentState.kind === "connected" ? daemon : null;
    },
    ensureContained: () => network.ensure(),
  });
  protocol.handle(PLUGIN_SCHEME, request => frameDocuments!.respond(request));
  session.defaultSession.webRequest.onBeforeRequest({ urls: [`${PLUGIN_SCHEME}://*/*`] }, (request, callback) => {
    // A frame URL is not authority to fetch it from another window, the parent, or a worker.
    callback({ cancel: request.resourceType !== "subFrame" || !mainWindow
      || request.webContentsId !== mainWindow.webContents.id
      || !frameDocuments!.ownsUrl(request.url, request.webContentsId) });
  });
  // Deny everything except writing the clipboard (copy buttons); reading it stays denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "clipboard-sanitized-write"));
  desktopShell.start();
  ownerAlerts.start();
  updater.schedule(desktopShell.state().prefs.updateCheckMinutes);
  createWindow();
  syncWindowsShortcuts();
  updater.watchLaunch((listener) => mainWindow?.webContents.on("render-process-gone", listener));
  // Dev: an isolated local cutex home / port (see AGENTS.md "Dev cutex daemon").
  // P2 person identity: the person key and its per-host claims (main/personIdentity.ts).
  const personIdentity = new PersonIdentityService(join(app.getPath("userData"), "identity"), (view) => sendEvent("identityState", view), () => mainWindow, () => hosts?.claimTargets() ?? []);
  identity = personIdentity;
  const localProbe = { home: process.env.CUTEX_DESKTOP_HOME || undefined, baseUrl: process.env.CUTEX_MANAGEMENT_URL || undefined };
  hosts = new HostManager(sendEvent, createDaemon, {
    identity: personIdentity,
    ...localProbe,
    // macOS is front-end only: no implicit local host unless a local cutex is configured (main/localHost.ts).
    localHost: hasImplicitLocalHost(process.platform, localCutexConfigured(localProbe)),
    onDisconnect: (hostId) => ownerAlerts.forgetHost(hostId),
  });
  // Dev only: sample big alerts without a daemon (screenshots).
  if (demoOwnerAlertRequested()) setTimeout(() => ownerAlerts.showDemo(), 1500);
  await hosts.start();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else desktopShell.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (!primaryInstance) return;
  // Synchronous kill: no ssh tunnel may outlive the app (every connection: tunnels, feeds, daemons).
  hosts?.stop();
});
app.on("will-quit", (event) => {
  // A copied identity key still waiting for its clear: clear it first (the clipboard outlives the app), then quit again.
  if (identity?.hasPendingKeyClears()) {
    event.preventDefault();
    void identity.clearCopiedKeysNow().finally(() => app.quit());
    return;
  }
  ownerAlerts.dispose();
  desktopShell.dispose();
});
