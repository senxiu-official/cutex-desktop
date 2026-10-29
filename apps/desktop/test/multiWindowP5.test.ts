// Multi-window P5 (docs/desktop-modules.md §24.17): the in-app browser in desk windows. A tab drawn in a desk has
// its <webview> embedded by that desk's webContents (the renderer creates it from the desk's document), so the
// browser's hardening is per window: every desk joins main/browser/install.ts as another embedder (same
// will-attach / did-attach checks, receipts bound to the consuming window, prompts parented to the tab's window,
// N2 credentials, cleanup on close), and main/deskShell.ts gives a desk the webview tag only once that hardening
// is installed, adding the desk before anything else is wired. Electron is mocked; the renderer side is in
// multiWindowP5Renderer.test.tsx.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { HostManager } from "../src/main/hosts";
import type { BrowserEvent, BrowserTabMount } from "../src/shared/browser";
import { BROWSER_CHANNEL, DEFAULT_BROWSER_CONTROL_SETTINGS } from "../src/shared/browser";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  sessions: new Map<string, unknown>(),
  appListeners: new Map<string, Set<(...args: any[]) => void>>(),
  nativeWindows: vi.fn(),
  proxies: [] as any[],
  startProxy: vi.fn(),
  messageBox: vi.fn(async (..._args: any[]) => ({ response: 1, checkboxChecked: false })),
  /** The options install.ts hands its InAppProvider (visibility / focus hooks, driven directly below). */
  provider: undefined as any,
}));
vi.mock("../src/main/browser/provider", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/provider")>();
  return { ...actual, InAppProvider: class extends actual.InAppProvider { constructor(options: any) { super(options); electron.provider = { instance: this, options }; } } };
});
vi.mock("../src/main/browser/sitePermissions", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/sitePermissions")>();
  return { ...actual, BrowserSitePermissionStore: class extends actual.BrowserSitePermissionStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/externalPages", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/externalPages")>();
  return { ...actual, BrowserExternalPagesStore: class extends actual.BrowserExternalPagesStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/desktopLoopback", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/desktopLoopback")>();
  return { ...actual, BrowserDesktopLoopbackStore: class extends actual.BrowserDesktopLoopbackStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/egressProxy", () => ({ startBrowserEgressProxy: electron.startProxy }));
vi.mock("../src/main/browser/tabIdentity", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/browser/tabIdentity")>();
  return { ...original, browserTabIdentityStorage: () => { let value: string | undefined; return { read: () => value, write: (next: string) => { value = next; } }; } };
});
// main/deskShell.ts's window-state persistence (files under userData): fixed bounds here.
vi.mock("../src/main/windowState", () => ({
  initialDeskBounds: () => ({ bounds: { x: 10, y: 10, width: 900, height: 700 }, maximized: false }),
  forgetDeskBounds: vi.fn(), trackWindowState: vi.fn(), workAreas: () => [],
}));
vi.mock("electron", () => ({
  BrowserWindow: electron.nativeWindows,
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), off: vi.fn() },
  dialog: { showMessageBox: electron.messageBox },
  screen: { on: vi.fn() },
  shell: { openExternal: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => Promise<any>) => { electron.handlers.set(name, handler); },
    removeHandler: (name: string) => { electron.handlers.delete(name); },
  },
  session: { fromPartition: (name: string) => {
    const value = electron.sessions.get(name);
    if (!value) throw new Error(`Unexpected partition ${name}`);
    return value;
  } },
  app: {
    getPath: () => "memory-only-user-data",
    isPackaged: false,
    on: (name: string, fn: (...args: any[]) => void) => {
      let listeners = electron.appListeners.get(name);
      if (!listeners) electron.appListeners.set(name, listeners = new Set());
      listeners.add(fn);
    },
    removeListener: (name: string, fn: (...args: any[]) => void) => { electron.appListeners.get(name)?.delete(fn); },
  },
}));

import { addBrowserWindow, browserEmbeddable, installBrowser } from "../src/main/browser/install";
import { DeskShell } from "../src/main/deskShell";
import { BrowserLeases } from "../src/main/browser/leases";

class SessionMock extends EventEmitter {
  setProxy = vi.fn(async (_options: unknown) => {});
  closeAllConnections = vi.fn(async () => {});
  setPermissionRequestHandler = vi.fn();
  setPermissionCheckHandler = vi.fn();
  setDevicePermissionHandler = vi.fn();
  setCertificateVerifyProc = vi.fn();
  before?: (details: any, callback: (response: { cancel?: boolean }) => void) => void;
  webRequest = {
    onBeforeRequest: (_filter: unknown, fn: SessionMock["before"]) => { this.before = fn; },
    onHeadersReceived: vi.fn(),
  };
  denied(webContentsId: number, url = "http://localhost:26180/"): boolean {
    const result: { cancel?: boolean }[] = [];
    this.before!({ webContentsId, url, resourceType: "mainFrame" }, value => result.push(value));
    return result[0]!.cancel === true;
  }
}
class ContentsMock extends EventEmitter {
  dead = false;
  url = "about:blank";
  mainFrame = {};
  hostWebContents?: ContentsMock;
  loads: string[] = [];
  debugger = Object.assign(new EventEmitter(), { attach: vi.fn(), detach: vi.fn(), isAttached: () => false, sendCommand: vi.fn(async () => ({})) });
  executeJavaScriptInIsolatedWorld = vi.fn(async (..._args: unknown[]): Promise<unknown> => false);
  setWebRTCIPHandlingPolicy = vi.fn();
  setWindowOpenHandler = vi.fn();
  stop = vi.fn();
  reload = vi.fn();
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, getAllEntries: () => [], getActiveIndex: () => 0, goToOffset: vi.fn() };
  constructor(readonly id: number, readonly session: SessionMock, private readonly type: "webview" | "window" = "webview") { super(); }
  isDestroyed() { return this.dead; }
  getType() { return this.type; }
  isLoading() { return false; }
  getURL() { return this.url; }
  getTitle() { return "Fixture page"; }
  async loadURL(url: string) { this.loads.push(url); this.url = url; this.emit("did-navigate", {}, url); }
  close() { if (!this.dead) { this.dead = true; this.emit("destroyed"); } }
}
/** An app window (the main one or a desk): the parts the browser reads (visibility, focus, full screen). */
function appWindow(contents: ContentsMock) {
  const state = { visible: true, minimized: false, focused: true, destroyed: false };
  const win = Object.assign(new EventEmitter(), { webContents: contents, state,
    isDestroyed: () => state.destroyed || contents.dead, isVisible: () => state.visible, isMinimized: () => state.minimized,
    isFocused: () => state.focused, flashFrame: vi.fn(), isFullScreen: () => false, setFullScreen: vi.fn() });
  return win;
}
type AppWindow = ReturnType<typeof appWindow>;

async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
const cleanup: (() => void)[] = [];
let nextId = 1;
const emitApp = (name: string, ...args: unknown[]) => { for (const listener of electron.appListeners.get(name) ?? []) listener(...args); };

function fixture() {
  const session = new SessionMock();
  electron.sessions.set("persist:browser-local", session);
  const owner = new ContentsMock(nextId++, session, "window");
  const main = appWindow(owner);
  const events: BrowserEvent[] = [];
  const client = { endpoint: { baseUrl: "http://127.0.0.1:26111" }, request: vi.fn(async () => ({})) };
  const daemon = { generation: 1, currentState: { kind: "connected" }, activeClient: () => client, capabilities: vi.fn(async () => ({ featureList: [] })) };
  const conns = new Map([["local", { routingEpoch: "epoch-a", daemon }]]);
  const hosts = { connection: (hostId: string) => conns.get(hostId), focus: () => "local", state: () => ({ hosts: [{ id: "local", kind: "local" }] }) };
  installBrowser(main as unknown as BrowserWindow, () => hosts as unknown as HostManager,
    event => event.sender === owner as unknown && event.senderFrame === owner.mainFrame as unknown, (_name, event) => { events.push(event); });
  // Every IPC still comes from the main window's renderer (it draws the desks too).
  const ipc = (raw: unknown): Promise<any> => electron.handlers.get(BROWSER_CHANNEL)!({ sender: owner, senderFrame: owner.mainFrame } as unknown as IpcMainInvokeEvent, raw, { hostId: "local", epoch: "epoch-a" });
  const reserve = (tabKey: string, url = "http://localhost:26180/") => ipc({ op: "open", tabKey, url }) as Promise<BrowserTabMount>;
  /** A new app window's webContents comes into being (app web-contents-created), not yet added anywhere. */
  const window = () => {
    const contents = new ContentsMock(nextId++, session, "window");
    emitApp("web-contents-created", {}, contents);
    return appWindow(contents);
  };
  /** A desk window, added to the browser as an embedder (what DeskShell.adopt does first). */
  const desk = () => { const win = window(); expect(addBrowserWindow(win as unknown as BrowserWindow)).toBe(true); return win; };
  const willAttach = (into: ContentsMock, mount: BrowserTabMount) => {
    const event = { sender: into, preventDefault: vi.fn() };
    const params: Record<string, unknown> = { partition: mount.partition, src: mount.src };
    // A renderer asking for more than the browser grants: Node, a preload, popups, web security off.
    const preferences: Record<string, unknown> = { partition: mount.partition, nodeIntegration: true, preload: "file:///forbidden.js", webSecurity: false, webviewTag: true };
    into.emit("will-attach-webview", event, preferences, params);
    return { denied: event.preventDefault.mock.calls.length > 0, params, preferences };
  };
  const didAttach = (into: ContentsMock) => {
    const guest = new ContentsMock(nextId++, session);
    guest.hostWebContents = into;
    emitApp("web-contents-created", {}, guest);
    into.emit("did-attach-webview", {}, guest);
    return guest;
  };
  const receipt = (mount: BrowserTabMount, guest: ContentsMock, url = "http://localhost:26180/") =>
    ipc({ op: "open", tabKey: mount.tabKey, url, receipt: { src: mount.src, webContentsId: guest.id } });
  const mountIn = async (into: AppWindow, tabKey: string, url = "http://localhost:26180/") => {
    const reserved = await reserve(tabKey, url);
    expect(willAttach(into.webContents, reserved).denied).toBe(false);
    const guest = didAttach(into.webContents); await receipt(reserved, guest, url); await flush();
    return { reserved, guest };
  };
  cleanup.push(() => owner.close());
  return { session, owner, main, events, ipc, reserve, window, desk, willAttach, didAttach, receipt, mountIn };
}

beforeEach(() => {
  electron.handlers.clear(); electron.sessions.clear(); electron.appListeners.clear(); electron.proxies.length = 0;
  electron.messageBox.mockReset().mockResolvedValue({ response: 1, checkboxChecked: false });
  vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "off");
  electron.startProxy.mockReset().mockImplementation(async () => {
    const proxy = { port: 26291 + electron.proxies.length, credentials: { username: "test-only", password: "not-a-real-credential", realm: "test-realm" },
      isPublicBrowserUrl: (url: string) => /^https:\/\/example\.test\//.test(url), close: vi.fn(async () => {}) };
    electron.proxies.push(proxy); return proxy;
  });
});
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.unstubAllEnvs(); });

describe("the browser in desk windows: per-window hardening (main/browser/install.ts, P5)", () => {
  it("a desk's webview passes the same will-attach checks: renderer preferences replaced, one-use ticket, receipt, network", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const reserved = await f.reserve("desk-tab");
    const admission = f.willAttach(desk.webContents, reserved);
    expect(admission.denied).toBe(false);
    // The same enforced bag as the main window's (attachPolicy.ts): no Node, no preload, no nested webview.
    expect(admission.preferences).toMatchObject({ nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true, webviewTag: false });
    expect(admission.preferences).not.toHaveProperty("preload");
    expect(admission.params.src).toBe("about:blank");
    const guest = f.didAttach(desk.webContents);
    await f.receipt(reserved, guest); await flush();
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
    // One use: the same ticket again (in any window) is refused.
    expect(f.willAttach(desk.webContents, reserved).denied).toBe(true);
    expect(f.willAttach(f.owner, reserved).denied).toBe(true);
    // The session policy attributes it like a main-window tab (N2 / admission per tab + origin unchanged).
    expect(f.session.denied(guest.id, "http://localhost:26180/")).toBe(false);
    expect(f.session.denied(guest.id, "http://localhost:26999/")).toBe(true);
    // The desk is an embedder; the main window's own hooks are still installed (adding a window tears nothing down).
    const main = await f.mountIn(f.main, "main-tab");
    expect(main.guest.loads).toEqual(["http://localhost:26180/"]);
    expect(electron.handlers.has(BROWSER_CHANNEL)).toBe(true);
    expect(browserEmbeddable()).toBe(true);
  });

  it("a window the browser has not added refuses every attach from its first moment, and burns the ticket", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const stranger = f.window();
    const reserved = await f.reserve("stray");
    expect(f.willAttach(stranger.webContents, reserved).denied).toBe(true);
    // The ticket shown to the wrong window is gone: the main window cannot use it either.
    expect(f.willAttach(f.owner, reserved).denied).toBe(true);
    // A guest embedded there anyway gets no receipt, even for a ticket the main window consumed.
    const fresh = await f.reserve("stray-2");
    expect(f.willAttach(f.owner, fresh).denied).toBe(false);
    const guest = f.didAttach(stranger.webContents);
    await expect(f.receipt(fresh, guest)).rejects.toMatchObject({ code: "invalid_request" });
    expect(guest.loads).toEqual([]);
  });

  it("a receipt binds the guest to the window that consumed the ticket (a desk ticket, a main-window guest: refused)", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const reserved = await f.reserve("crossed");
    expect(f.willAttach(desk.webContents, reserved).denied).toBe(false);
    const elsewhere = f.didAttach(f.owner);
    await expect(f.receipt(reserved, elsewhere)).rejects.toMatchObject({ code: "invalid_request" });
    expect(elsewhere.loads).toEqual([]);
  });

  it("a site-permission prompt parents to the desk the tab is drawn in, and follows that desk's visibility", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { guest } = await f.mountIn(desk, "desk-tab");
    const request = f.session.setPermissionRequestHandler.mock.calls.at(-1)![0] as (...args: any[]) => void;
    const ask = async (permission: string) => {
      const callback = vi.fn(); request(guest, permission, callback, { requestingUrl: "http://localhost:26180/", mediaTypes: ["video"] });
      for (let i = 0; i < 50 && !callback.mock.calls.length; i++) await Promise.resolve();
      return callback.mock.calls[0]?.[0];
    };
    expect(await ask("media")).toBe(false);
    expect(electron.messageBox).toHaveBeenCalledOnce();
    expect(electron.messageBox.mock.calls[0]![0]).toBe(desk);
    // The desk minimised (the main window still on screen): no invisible dialog, a notice instead.
    desk.state.minimized = true;
    expect(await ask("notifications")).toBe(false);
    expect(electron.messageBox).toHaveBeenCalledOnce();
    expect(f.events.at(-1)).toMatchObject({ kind: "blocked", blocked: "permission-hidden", tabKey: "desk-tab" });
    // A main-window tab still asks over the main window.
    const main = await f.mountIn(f.main, "main-tab");
    const callback = vi.fn(); request(main.guest, "media", callback, { requestingUrl: "http://localhost:26180/", mediaTypes: ["audio"] });
    for (let i = 0; i < 50 && !callback.mock.calls.length; i++) await Promise.resolve();
    expect(electron.messageBox.mock.calls.at(-1)![0]).toBe(f.main);
  });

  it("downloads in a desk tab: the owner's click opens the save dialog, a page's own download is cancelled", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { guest } = await f.mountIn(desk, "desk-tab");
    const download = () => {
      const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn(), getFilename: () => "report.csv", getURL: () => "http://localhost:26180/report.csv", setSaveDialogOptions: vi.fn() };
      f.session.emit("will-download", event, item, guest);
      return { cancelled: item.cancel.mock.calls.length > 0, dialog: item.setSaveDialogOptions.mock.calls.length > 0 };
    };
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11_000);
    cleanup.push(() => clock.mockRestore());
    expect(download()).toEqual({ cancelled: true, dialog: false });
    guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    // Electron parents this save dialog to the guest's owner window: its embedder, the desk (checked in Electron 44).
    expect(download()).toEqual({ cancelled: false, dialog: true });
  });

  it("an agent's download in a desk tab needs that desk on screen (the main window being visible is not enough)", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { guest } = await f.mountIn(desk, "desk-tab");
    // An active, unpaused agent lease acting in this tab (the lease machinery itself is browserRelayInstall's).
    const lease = vi.spyOn(BrowserLeases.prototype, "forGuest").mockReturnValue({ state: "active", agentName: "Alice" } as never);
    const acting = vi.spyOn(electron.provider.instance, "agentInput").mockReturnValue(true);
    cleanup.push(() => { lease.mockRestore(); acting.mockRestore(); });
    const download = () => {
      const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn(), getFilename: () => "report.csv", getURL: () => "http://localhost:26180/report.csv", setSaveDialogOptions: vi.fn() };
      f.session.emit("will-download", event, item, guest);
      return { cancelled: item.cancel.mock.calls.length > 0, dialog: item.setSaveDialogOptions.mock.calls.length > 0 };
    };
    desk.state.minimized = true;
    expect(f.main.isVisible() && !f.main.isMinimized()).toBe(true);
    expect(download()).toEqual({ cancelled: true, dialog: false });
    expect(f.events.at(-1)).toMatchObject({ kind: "blocked", blocked: "download-hidden", tabKey: "desk-tab" });
    // The desk back on screen: the save dialog opens, titled with the agent.
    desk.state.minimized = false;
    expect(download()).toEqual({ cancelled: false, dialog: true });
  });

  it("an agent's visibility and keyboard-focus checks inspect the desk the tab is drawn in", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { reserved } = await f.mountIn(desk, "desk-tab");
    const hooks = electron.provider.options;
    // Only the desk's document holds this guest's <webview> (shown, focused); the main window's has none.
    desk.webContents.executeJavaScriptInIsolatedWorld.mockResolvedValue({ width: 800, height: 600 });
    f.owner.executeJavaScriptInIsolatedWorld.mockResolvedValue(false);
    await expect(hooks.ensureVisible(reserved.guestId, { ...DEFAULT_BROWSER_CONTROL_SETTINGS, hiddenTarget: "reject" }, {})).resolves.toEqual({ width: 800, height: 600 });
    desk.webContents.executeJavaScriptInIsolatedWorld.mockResolvedValue(true);
    await expect(hooks.keyboardFocused(reserved.guestId)).resolves.toBe(true);
    desk.webContents.executeJavaScriptInIsolatedWorld.mockClear();
    await hooks.restoreFocus(reserved.guestId);
    expect(desk.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
    expect(f.owner.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    // The desk minimised (the main window still shown): hidden, not focused.
    desk.state.minimized = true;
    await expect(hooks.ensureVisible(reserved.guestId, { ...DEFAULT_BROWSER_CONTROL_SETTINGS, hiddenTarget: "reject" }, {})).rejects.toMatchObject({ code: "target_hidden" });
    await expect(hooks.keyboardFocused(reserved.guestId)).resolves.toBe(false);
  });

  it("did-attach in a desk keeps only a guest that desk itself embeds", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const reserved = await f.reserve("desk-tab");
    expect(f.willAttach(desk.webContents, reserved).denied).toBe(false);
    // The desk's did-attach reports a guest embedded by the main window: closed at once, never held unbound.
    const guest = new ContentsMock(nextId++, f.session); guest.hostWebContents = f.owner;
    emitApp("web-contents-created", {}, guest);
    desk.webContents.emit("did-attach-webview", {}, guest);
    expect(guest.dead).toBe(true);
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("an owner click in a desk tab's page makes popups an app tab opened next to that tab (new-tab names the opener)", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { guest } = await f.mountIn(desk, "desk-tab");
    const handler = guest.setWindowOpenHandler.mock.calls[0]![0] as (details: any) => { action: string };
    const popup = (url: string) => handler({ url, frameName: "_blank", features: "", disposition: "new-window", referrer: { url: "", policy: "default" } });
    expect(popup("http://localhost:26180/no-gesture")).toEqual({ action: "deny" });
    expect(f.events.filter(event => event.kind === "new-tab")).toHaveLength(0);
    guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(popup("http://localhost:26180/next")).toEqual({ action: "deny" }); // Never a native window.
    expect(f.events.filter(event => event.kind === "new-tab")).toEqual([expect.objectContaining({ tabKey: "desk-tab", newTabUrl: "http://localhost:26180/next" })]);
    expect(electron.nativeWindows).not.toHaveBeenCalled();
  });

  it("N2: a desk tab's guest gets the proxy credentials; once the desk closed, none", async () => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2");
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { guest } = await f.mountIn(desk, "desk-tab", "https://example.test/page");
    const proxy = electron.proxies[0];
    const challenge = (contents: unknown) => {
      const callback = vi.fn();
      emitApp("login", { preventDefault: vi.fn() }, contents, {}, { isProxy: true, host: "127.0.0.1", port: proxy.port, scheme: "basic", realm: proxy.credentials.realm }, callback);
      return callback.mock.calls;
    };
    expect(challenge(guest)).toEqual([[proxy.credentials.username, proxy.credentials.password]]);
    // A guest embedded by a window the browser never added gets nothing.
    const stray = new ContentsMock(nextId++, f.session); stray.hostWebContents = f.window().webContents;
    expect(challenge(stray)).toEqual([[]]);
    // The same attached guest, still mounted, now reported as embedded by a window never added: nothing.
    const stranger = f.window().webContents;
    guest.hostWebContents = stranger;
    expect(f.events.filter(event => event.tabKey === "desk-tab").at(-1)).toMatchObject({ status: "attached" });
    expect(challenge(guest)).toEqual([[]]);
    guest.hostWebContents = desk.webContents;
    expect(challenge(guest)).toEqual([[proxy.credentials.username, proxy.credentials.password]]);
    desk.emit("closed"); desk.webContents.close();
    expect(challenge(guest)).not.toEqual([[proxy.credentials.username, proxy.credentials.password]]);
  });

  it("a desk closing retires what it embedded: its tabs unmount, unbound guests and tickets go, its hooks are removed", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const { guest } = await f.mountIn(desk, "desk-tab");
    const main = await f.mountIn(f.main, "main-tab");
    const pending = await f.reserve("pending");
    expect(f.willAttach(desk.webContents, pending).denied).toBe(false);
    const unbound = f.didAttach(desk.webContents);
    desk.emit("closed");
    expect(guest.dead).toBe(true);
    expect(unbound.dead).toBe(true);
    expect(f.events.filter(event => event.tabKey === "desk-tab").at(-1)).toMatchObject({ status: "unmounted" });
    await expect(f.receipt(pending, unbound)).rejects.toMatchObject({ code: "invalid_request" });
    // Its own hooks are gone; the early guard stays and refuses (the window may outlive its desk entry briefly).
    expect(desk.webContents.listenerCount("did-attach-webview")).toBe(0);
    expect(desk.webContents.listenerCount("before-input-event")).toBe(0);
    expect(desk.listenerCount("focus")).toBe(0);
    const late = await f.reserve("late");
    expect(f.willAttach(desk.webContents, late).denied).toBe(true);
    // The main window's tab is untouched; a new desk can be added.
    expect(main.guest.dead).toBe(false);
    expect(f.events.filter(event => event.tabKey === "main-tab").at(-1)).toMatchObject({ status: "attached" });
    const next = f.desk();
    expect((await f.mountIn(next, "again")).guest.loads).toEqual(["http://localhost:26180/"]);
  });

  it("a desk closing unmounts every tab it drew even if one guest throws", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const first = await f.mountIn(desk, "desk-a");
    const second = await f.mountIn(desk, "desk-b");
    // The first guest's native object fails every call (already gone underneath).
    let broken = true;
    const isDestroyed = first.guest.isDestroyed.bind(first.guest);
    first.guest.isDestroyed = () => { if (broken) throw new Error("Object has been destroyed"); return isDestroyed(); };
    expect(() => desk.emit("closed")).not.toThrow();
    broken = false;
    expect(second.guest.dead).toBe(true);
    expect(f.events.filter(event => event.tabKey === "desk-b").at(-1)).toMatchObject({ status: "unmounted" });
  });

  it("the browser torn down (main window gone): a desk can no longer be added and its attaches are refused", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const desk = f.desk();
    const reserved = await f.reserve("desk-tab");
    expect(desk.webContents.listenerCount("did-attach-webview")).toBe(1);
    f.owner.close();
    expect(browserEmbeddable()).toBe(false);
    // The torn-down install leaves no hooks in the still-open desk (only its early refuse-all guard).
    expect(desk.webContents.listenerCount("did-attach-webview")).toBe(0);
    expect(desk.webContents.listenerCount("will-attach-webview")).toBe(1);
    expect(desk.webContents.listenerCount("before-input-event")).toBe(0);
    expect(desk.webContents.listenerCount("before-mouse-event")).toBe(0);
    expect(desk.listenerCount("focus")).toBe(0);
    expect(addBrowserWindow(f.window() as unknown as BrowserWindow)).toBe(false);
    expect(f.willAttach(desk.webContents, reserved).denied).toBe(true);
  });
});

describe("desk windows get the webview tag only after the browser's hardening (main/deskShell.ts, P5)", () => {
  /** A BrowserWindow stand-in for DeskShell: records the order listeners are added in. */
  function deskWindow(order: string[]) {
    const contents = Object.assign(new EventEmitter(), { id: nextId++, setWindowOpenHandler: vi.fn(() => order.push("setWindowOpenHandler")), setZoomFactor: vi.fn(), isDestroyed: () => false });
    const on = contents.on.bind(contents);
    contents.on = ((name: string, fn: (...args: any[]) => void) => { order.push(`on:${name}`); return on(name, fn); }) as typeof contents.on;
    return Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false, destroy: vi.fn(), show: vi.fn(), maximize: vi.fn(), setBounds: vi.fn(), isVisible: () => true, isMinimized: () => false });
  }
  function shell(browser?: { embeddable(): boolean; add(win: BrowserWindow): boolean }) {
    const deps = { enabled: () => true, mainWindow: () => null, icon: () => ({}) as never, background: () => "#000", ownsFrameUrl: () => false, releaseFrames: vi.fn(), emit: vi.fn(), contextMenu: vi.fn(), created: vi.fn(), ...(browser ? { browser } : {}) };
    return new DeskShell(deps);
  }
  const main = { webContents: { id: 9001 }, isDestroyed: () => false, getNormalBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) };
  const open = (desks: DeskShell) => {
    const ticket = desks.ticket(main.webContents.id, undefined)!;
    const response = desks.openResponse(main as unknown as BrowserWindow, { url: "about:blank", frameName: ticket.name })!;
    return { ticket, prefs: (response as unknown as { overrideBrowserWindowOptions: { webPreferences: Record<string, unknown> } }).overrideBrowserWindowOptions.webPreferences };
  };

  it("no browser installed: no webview tag, and every attach in the desk is refused", () => {
    const desks = shell({ embeddable: () => false, add: () => false });
    const { ticket, prefs } = open(desks);
    expect(prefs.webviewTag).toBe(false);
    const order: string[] = [];
    const win = deskWindow(order);
    expect(desks.adopt(main as unknown as BrowserWindow, win as unknown as BrowserWindow, ticket.name)).not.toBeNull();
    const event = { preventDefault: vi.fn() };
    win.webContents.emit("will-attach-webview", event, {}, {});
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("the browser installed: the tag is on, and the desk is added as an embedder before anything else is wired", () => {
    const order: string[] = [];
    const add = vi.fn(() => { order.push("browser.add"); return true; });
    const desks = shell({ embeddable: () => true, add });
    const { ticket, prefs } = open(desks);
    expect(prefs).toMatchObject({ webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined });
    const win = deskWindow(order);
    desks.adopt(main as unknown as BrowserWindow, win as unknown as BrowserWindow, ticket.name);
    expect(add).toHaveBeenCalledWith(win);
    expect(order[0]).toBe("browser.add");
    // The browser decides attaches here: DeskShell adds no refuse-all of its own.
    expect(order).not.toContain("on:will-attach-webview");
  });

  it("an unadmitted window is destroyed before the browser ever sees it", () => {
    const add = vi.fn(() => true);
    const desks = shell({ embeddable: () => true, add });
    const win = deskWindow([]);
    expect(desks.adopt(main as unknown as BrowserWindow, win as unknown as BrowserWindow, "cutex-desk-forged")).toBeNull();
    expect(win.destroy).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("end to end: before the browser is installed a desk opens without the tag; after, with it, and its webview attaches", async () => {
    const desks = shell({ embeddable: browserEmbeddable, add: win => addBrowserWindow(win) });
    // Nothing installed yet (the previous test's install was torn down with its main window).
    expect(open(desks).prefs.webviewTag).toBe(false);
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { ticket, prefs } = open(desks);
    expect(prefs.webviewTag).toBe(true);
    // The desk's webContents exists first (web-contents-created), then did-create-window adopts it.
    const created = f.window();
    const win = Object.assign(created, { destroy: vi.fn(), show: vi.fn(), maximize: vi.fn(), setBounds: vi.fn() });
    Object.assign(created.webContents, { setZoomFactor: vi.fn() });
    const reserved = await f.reserve("desk-tab");
    // An attach racing ahead of adopt is refused by the early guard (and its ticket burnt).
    expect(f.willAttach(created.webContents, reserved).denied).toBe(true);
    expect(desks.adopt(main as unknown as BrowserWindow, win as unknown as BrowserWindow, ticket.name)).not.toBeNull();
    const { guest } = await f.mountIn(created, "desk-tab-2");
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
  });
});
