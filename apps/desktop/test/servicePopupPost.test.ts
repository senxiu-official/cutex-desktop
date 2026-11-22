// Service popup form (cross-review of fix/service-tab-jumps, 2026-11-18): a same-service POST target=_blank keeps its body
// through the ticket hop. Fixture: installBrowser's IPC/event boundary with the Electron mock (copied from browserInstall.test.ts).
import { EventEmitter } from "node:events";
import { basename, join } from "node:path";
import { networkInterfaces } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { HostManager } from "../src/main/hosts";
import type { BrowserEvent, BrowserRequest, BrowserTabMount, BrowserTabView } from "../src/shared/browser";
import { BROWSER_CHANNEL, DEFAULT_BROWSER_CONTROL_SETTINGS } from "../src/shared/browser";
import { BROWSER_PAUSE_MEDIA_SCRIPT, browserAppZoom, browserDisplayUrl, installBrowser, navigationFailure, syncBrowserHosts } from "../src/main/browser/install";
import { BrowserLeases } from "../src/main/browser/leases";
import { InAppProvider } from "../src/main/browser/provider";
import { BrowserLanTargets } from "../src/main/browser/lanTargets";

// Exercise installBrowser's public IPC/event boundary, not private functions or an alternate adapter.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  sessions: new Map<string, unknown>(),
  requested: [] as string[],
  appListeners: new Map<string, Set<(...args: any[]) => void>>(),
  nativeWindows: vi.fn(),
  packaged: false,
  proxies: [] as any[],
  startProxy: vi.fn(),
  menus: [] as { popup: ReturnType<typeof vi.fn> }[],
  buildFromTemplate: vi.fn((template: any[]) => { const menu = { popup: vi.fn() }; electron.menus.push(menu); return menu; }),
  messageBox: vi.fn(async (..._args: any[]) => ({ response: 1, checkboxChecked: false })),
}));
vi.mock("../src/main/browser/guestView", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/guestView")>();
  // In-memory store: tests never write browser-zoom.json under the cwd.
  return { ...actual, BrowserZoomStore: class extends actual.BrowserZoomStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/sitePermissions", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/sitePermissions")>();
  // In-memory store: tests never write browser-site-permissions.json under the cwd.
  return { ...actual, BrowserSitePermissionStore: class extends actual.BrowserSitePermissionStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/externalPages", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/externalPages")>();
  // In-memory store (default on): tests never write a browser-external.json under the cwd.
  return { ...actual, BrowserExternalPagesStore: class extends actual.BrowserExternalPagesStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/desktopLoopback", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/desktopLoopback")>();
  return { ...actual, BrowserDesktopLoopbackStore: class extends actual.BrowserDesktopLoopbackStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/certificateExceptions", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/certificateExceptions")>();
  // In-memory store: tests never write browser-certificate-exceptions.json under the cwd.
  return { ...actual, BrowserCertificateExceptionStore: class extends actual.BrowserCertificateExceptionStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/egressProxy", () => ({ startBrowserEgressProxy: electron.startProxy }));
vi.mock("../src/main/browser/tabIdentity", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/browser/tabIdentity")>();
  return { ...original, browserTabIdentityStorage: () => { let value: string | undefined; return { read: () => value, write: (next: string) => { value = next; } }; } };
});
vi.mock("electron", () => ({
  BrowserWindow: electron.nativeWindows,
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), off: vi.fn() },
  dialog: { showMessageBox: electron.messageBox },
  Menu: { buildFromTemplate: electron.buildFromTemplate },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => Promise<any>) => { electron.handlers.set(name, handler); },
    removeHandler: (name: string) => { electron.handlers.delete(name); },
  },
  session: { fromPartition: (name: string) => {
    electron.requested.push(name);
    const value = electron.sessions.get(name);
    if (!value) throw new Error(`Unexpected partition ${name}`);
    return value;
  } },
  app: {
    getPath: () => "memory-only-user-data",
    get isPackaged() { return electron.packaged; },
    on: (name: string, fn: (...args: any[]) => void) => {
      let listeners = electron.appListeners.get(name);
      if (!listeners) electron.appListeners.set(name, listeners = new Set());
      listeners.add(fn);
    },
    removeListener: (name: string, fn: (...args: any[]) => void) => { electron.appListeners.get(name)?.delete(fn); },
  },
}));

function sameOrigin(url: string): string { const parsed = new URL(url); return `${parsed.protocol.replace(/^ws/, "http")}//${parsed.host}`; }
class SessionMock extends EventEmitter {
  setProxy = vi.fn(async (_options: unknown) => {});
  closeAllConnections = vi.fn(async () => {});
  setPermissionRequestHandler = vi.fn();
  setPermissionCheckHandler = vi.fn();
  setDevicePermissionHandler = vi.fn();
  setCertificateVerifyProc = vi.fn();
  before?: (details: any, callback: (response: { cancel?: boolean }) => void) => void;
  headers?: (details: any, callback: (response: unknown) => void) => void;
  webRequest = {
    onBeforeRequest: (_filter: unknown, fn: SessionMock["before"]) => { this.before = fn; },
    onHeadersReceived: (_filter: unknown, fn: SessionMock["headers"]) => { this.headers = fn; },
    onCompleted: (_filter: unknown, fn: SessionMock["ended"]) => { this.ended = fn; },
    onErrorOccurred: (_filter: unknown, fn: SessionMock["ended"]) => { this.ended = fn; },
  };
  ended?: (details: any) => void;
  /** initiator: Electron's initiatorOrigin. Default = a same-origin subresource / browser-started main frame. */
  denied(webContentsId: number, url = "http://localhost:26180/", resourceType = "mainFrame", initiator: string | null = resourceType === "mainFrame" ? null : sameOrigin(url)): boolean {
    const result: { cancel?: boolean }[] = [];
    if (!this.before) throw new Error("Session was not configured");
    this.before({ webContentsId, url, resourceType, ...(initiator === null ? {} : { initiatorOrigin: initiator }) }, value => result.push(value));
    expect(result).toHaveLength(1);
    return result[0]!.cancel === true;
  }
  response(guest: ContentsMock, url: string, statusCode: number, responseHeaders: Record<string, string[]>, resourceType = "mainFrame"): void {
    if (!this.headers) throw new Error("Missing headers handler");
    this.headers({ webContentsId: guest.id, resourceType, url, statusCode, responseHeaders }, () => {});
  }
}
class DebuggerMock extends EventEmitter {
  attached = false;
  isAttached = () => this.attached;
  attach = vi.fn(() => { this.attached = true; });
  detach = vi.fn(() => { if (this.attached) { this.attached = false; this.emit("detach", {}, "detached"); } });
  sendCommand = vi.fn(async (_method: string, _params?: unknown): Promise<any> => ({}));
}
class ContentsMock extends EventEmitter {
  dead = false;
  url = "about:blank";
  mainFrame = {};
  hostWebContents?: ContentsMock;
  loads: string[] = [];
  reload = vi.fn(() => { this.emit("did-start-loading"); this.emit("did-navigate", {}, this.url); });
  stop = vi.fn();
  debugger = new DebuggerMock();
  executeJavaScriptInIsolatedWorld = vi.fn(async () => ({ width: 640, height: 360 }));
  setWebRTCIPHandlingPolicy = vi.fn();
  setZoomFactor = vi.fn();
  audioMuted = false;
  isAudioMuted = () => this.audioMuted;
  setBackgroundThrottling = vi.fn();
  setAudioMuted = vi.fn((muted: boolean) => { this.audioMuted = muted; });
  copyImageAt = vi.fn();
  downloadURL = vi.fn();
  undo = vi.fn(); redo = vi.fn(); cut = vi.fn(); copy = vi.fn(); paste = vi.fn(); selectAll = vi.fn();
  openHandler?: (details: any) => { action: string };
  setWindowOpenHandler = vi.fn((fn: (details: any) => { action: string }) => { this.openHandler = fn; });
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, getAllEntries: () => [], getActiveIndex: () => 0, goToOffset: vi.fn() };
  constructor(readonly id: number, readonly session: SessionMock) { super(); }
  isDestroyed() { return this.dead; }
  getType() { return "webview"; }
  isLoading() { return false; }
  getURL() { return this.url; }
  getTitle() { return "Fixture page"; }
  popup(url: string, extra: Record<string, unknown> = {}) {
    if (!this.openHandler) throw new Error("No early popup guard");
    return this.openHandler({ url, frameName: "_blank", features: "", disposition: "new-window", referrer: { url: "", policy: "default" }, ...extra });
  }
  async loadURL(url: string) { this.loads.push(url); this.url = url; this.emit("did-navigate", {}, url); }
  close() { if (!this.dead) { this.dead = true; this.emit("destroyed"); } }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function ownerReceipt(guest: ContentsMock, url: string, kind: "navigation" | "popup" = "navigation") {
  guest.emit("before-mouse-event", {}, { type: "mouseUp" });
  const call = guest.executeJavaScriptInIsolatedWorld.mock.calls.find((call: any[]) => call[0] === 1012) as any;
  const prefix = JSON.parse(/prefix=("[^"]+")/.exec(call[1][0].code)![1]!);
  guest.emit("console-message", { frame: guest.mainFrame, message: prefix + JSON.stringify({ url, kind }) });
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
const cleanup: (() => void)[] = [];
let nextContentsId = 1;
function fixture(session = new SessionMock(), permissiveAppSender = false, localKind: "local" | "ssh" = "local") {
  electron.sessions.set("persist:browser-local", session);
  const owner = new ContentsMock(nextContentsId++, session);
  const events: BrowserEvent[] = [];
  const request = vi.fn(async (_method: string, path: string, _options?: { body?: unknown }): Promise<unknown> => {
    const slug = path.split("/")[3];
    if (path.endsWith("view-ticket")) return { hostLabel: `${slug}.svc.localhost`, authPath: "/__cutex/auth?ticket=fixture-one-use&next=%2F" };
    return { leaseId: `lease-${slug}` };
  });
  const client = { endpoint: { baseUrl: "http://127.0.0.1:26111" }, request };
  const daemon = { generation: 1, currentState: { kind: "connected" }, activeClient: () => client,
    capabilities: vi.fn(async () => ({ featureList: ["services-proxy", "services-lifetime"] })) };
  const conns = new Map([["local", { routingEpoch: "epoch-a", daemon }]]);
  const hosts = { connection: (hostId: string) => conns.get(hostId), focus: () => "local",
    state: () => ({ hosts: [...conns.keys()].map(id => ({ id, kind: id === "local" ? localKind : id.startsWith("ssh-") ? "ssh" : "dev-direct" })) }) };
  const windowState = { visible: true, focused: true, flashFrame: vi.fn() };
  installBrowser(Object.assign(new EventEmitter(), { webContents: owner, isDestroyed: () => owner.dead, isVisible: () => windowState.visible, isMinimized: () => false,
    isFocused: () => windowState.focused, flashFrame: windowState.flashFrame, isFullScreen: () => false, setFullScreen: vi.fn() }) as unknown as BrowserWindow,
    () => hosts as unknown as HostManager,
    event => permissiveAppSender || (event.sender === owner as unknown && event.senderFrame === owner.mainFrame as unknown),
    (_name, event) => { events.push(event); });
  const ipc = (raw: unknown, options: { epoch?: string; hostId?: string; sender?: ContentsMock; frame?: unknown } = {}): Promise<any> => {
    const handler = electron.handlers.get(BROWSER_CHANNEL);
    if (!handler) throw new Error("Missing browser IPC handler");
    return handler({ sender: options.sender ?? owner, senderFrame: Object.hasOwn(options, "frame") ? options.frame : owner.mainFrame } as unknown as IpcMainInvokeEvent,
      raw, { hostId: options.hostId ?? "local", epoch: options.epoch ?? conns.get("local")?.routingEpoch ?? "" });
  };
  const reserve = (tabKey = "side-one", url = "http://localhost:26180/") => ipc({ op: "open", tabKey, url }) as Promise<BrowserTabMount>;
  const willAttach = (mount: BrowserTabMount, overrides: Record<string, unknown> = {}) => {
    const event = { sender: owner, preventDefault: vi.fn() };
    const params = { partition: mount.partition, src: mount.src, ...overrides };
    const preferences = { partition: params.partition, nodeIntegration: true, preload: "file:///forbidden.js" };
    owner.emit("will-attach-webview", event, preferences, params);
    return { denied: event.preventDefault.mock.calls.length > 0, params, preferences };
  };
  const didAttach = (guest = new ContentsMock(nextContentsId++, session), created = true) => {
    guest.hostWebContents = owner;
    if (created) for (const listener of electron.appListeners.get("web-contents-created") ?? []) listener({}, guest);
    owner.emit("did-attach-webview", {}, guest);
    return guest;
  };
  const receipt = (mount: BrowserTabMount, guest: ContentsMock, url = "http://localhost:26180/") =>
    ipc({ op: "open", tabKey: mount.tabKey, url, receipt: { src: mount.src, webContentsId: guest.id } });
  const mount = async (tabKey = "side-one", url = "http://localhost:26180/") => {
    const reserved = await reserve(tabKey, url);
    expect(willAttach(reserved).denied).toBe(false);
    const guest = didAttach(); await receipt(reserved, guest, url); await flush();
    return { reserved, guest };
  };
  cleanup.push(() => owner.close());
  return { session, owner, events, request, client, daemon, conns, ipc, reserve, willAttach, didAttach, receipt, mount, windowState };
}
beforeEach(() => {
  electron.handlers.clear(); electron.sessions.clear(); electron.appListeners.clear(); electron.nativeWindows.mockClear(); electron.packaged = false;
  electron.menus.length = 0; electron.buildFromTemplate.mockClear();
  electron.proxies.length = 0;
  // Baseline: the local-only tier (development override). N2 tests opt in with "n2" or packaged mode.
  vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "off");
  electron.startProxy.mockReset().mockImplementation(async () => {
    let active = true;
    const proxy = { port: 26291 + electron.proxies.length, credentials: { username: "test-only", password: "not-a-real-credential", realm: "test-realm" },
      isPublicBrowserUrl: (url: string) => active && /^https:\/\/example\.test\//.test(url), close: vi.fn(async () => { active = false; }) };
    electron.proxies.push(proxy); return proxy;
  });
});
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.unstubAllEnvs(); });


it("a same-service POST popup authenticates at the service root, then submits its body once to the exact address", async () => {
  const f = fixture();
  await f.ipc({ op: "setEnabled", enabled: true });
  const { guest } = await f.mount("service", "cutex:service/docs/");
  guest.url = "http://docs.svc.localhost:26111/";
  guest.emit("did-navigate", {}, guest.url);
  const url = "http://docs.svc.localhost:26111/submit?x=1";
  ownerReceipt(guest, url, "popup");
  guest.popup(url, { postBody: { contentType: "application/x-www-form-urlencoded", data: [{ type: "rawData", bytes: Buffer.from("q=1") }] } });
  const event = f.events.findLast(row => row.kind === "new-tab")!;
  expect(event.newTabUrl).toBe("cutex:service/docs/submit%3Fx%3D1");
  const load = vi.spyOn(ContentsMock.prototype, "loadURL");
  try {
    f.request.mockClear();
    await f.mount(event.newTabKey!, event.newTabUrl!);
    await flush();
    // The ticket lands on the root, never on the form's address (no GET of it first).
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/", start: true, routing: "host" } });
    const calls = (load.mock.calls as unknown as [string, unknown][]).map(([to, options]) => ({ to, post: (options as { postData?: { bytes: Buffer }[]; extraHeaders?: string } | undefined) }));
    const posts = calls.filter(c => c.post?.postData);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.to).toBe(url);
    expect(Buffer.from(posts[0]!.post!.postData![0]!.bytes).toString()).toBe("q=1");
    expect(posts[0]!.post!.extraHeaders).toBe("Content-Type: application/x-www-form-urlencoded\n");
    // The auth hop came first and carried no body.
    const auth = calls.findIndex(c => c.to.includes("/__cutex/auth"));
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(calls[auth]!.post?.postData).toBeUndefined();
    expect(auth).toBeLessThan(calls.indexOf(posts[0]!));
  } finally { load.mockRestore(); }
});

it("a service popup without a body keeps the one-hop ticket to its own address", async () => {
  const f = fixture();
  await f.ipc({ op: "setEnabled", enabled: true });
  const { guest } = await f.mount("service", "cutex:service/docs/");
  guest.url = "http://docs.svc.localhost:26111/";
  guest.emit("did-navigate", {}, guest.url);
  const url = "http://docs.svc.localhost:26111/sub";
  ownerReceipt(guest, url, "popup");
  guest.popup(url);
  const event = f.events.findLast(row => row.kind === "new-tab")!;
  f.request.mockClear();
  const { guest: popup } = await f.mount(event.newTabKey!, event.newTabUrl!);
  await flush();
  expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/sub", start: true, routing: "host" } });
  expect(popup.loads.filter(to => !to.includes("/__cutex/auth"))).toEqual([]);
});
