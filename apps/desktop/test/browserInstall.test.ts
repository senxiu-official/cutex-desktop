import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { HostManager } from "../src/main/hosts";
import type { BrowserEvent, BrowserRequest, BrowserTabMount, BrowserTabView } from "../src/shared/browser";
import { BROWSER_CHANNEL, DEFAULT_BROWSER_CONTROL_SETTINGS } from "../src/shared/browser";
import { browserDisplayUrl, installBrowser, syncBrowserHosts } from "../src/main/browser/install";

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
  messageBox: vi.fn(async (..._args: any[]) => ({ response: 1, checkboxChecked: false })),
}));
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
vi.mock("../src/main/browser/egressProxy", () => ({ startBrowserEgressProxy: electron.startProxy }));
vi.mock("../src/main/browser/tabIdentity", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/browser/tabIdentity")>();
  return { ...original, browserTabIdentityStorage: () => { let value: string | undefined; return { read: () => value, write: (next: string) => { value = next; } }; } };
});
vi.mock("electron", () => ({
  BrowserWindow: electron.nativeWindows,
  dialog: { showMessageBox: electron.messageBox },
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
  };
  /** initiator: Electron's initiatorOrigin. Default = a same-origin subresource / browser-started main frame. */
  denied(webContentsId: number, url = "http://localhost:26180/", resourceType = "mainFrame", initiator: string | null = resourceType === "mainFrame" ? null : sameOrigin(url)): boolean {
    const result: { cancel?: boolean }[] = [];
    if (!this.before) throw new Error("Session was not configured");
    this.before({ webContentsId, url, resourceType, ...(initiator === null ? {} : { initiatorOrigin: initiator }) }, value => result.push(value));
    expect(result).toHaveLength(1);
    return result[0]!.cancel === true;
  }
  response(guest: ContentsMock, url: string, statusCode: number, responseHeaders: Record<string, string[]>): void {
    if (!this.headers) throw new Error("Missing headers handler");
    this.headers({ webContentsId: guest.id, resourceType: "mainFrame", url, statusCode, responseHeaders }, () => {});
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
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
const cleanup: (() => void)[] = [];
let nextContentsId = 1;
function fixture(session = new SessionMock(), permissiveAppSender = false) {
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
    state: () => ({ hosts: [...conns.keys()].map(id => ({ id, kind: id === "local" ? "local" : "dev-direct" })) }) };
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

describe("main browser display URL redaction", () => {
  it("retains unrelated query keys rather than matching secret words as substrings", () => {
    expect(browserDisplayUrl("http://localhost/report?zipcode=2000&author=owner&decode=yes&sessionize=none#section"))
      .toBe("http://localhost/report?zipcode=2000&author=owner&decode=yes&sessionize=none");
  });
  it.each(["token", "accessToken", "refresh_token", "id-token", "api.key", "X-Amz-Signature", "authorization", "client_secret", "sessionId", "code", "ticket", "key", "sig", "jwt", "bearer", "otp", "x-jwt", "accessSig", "login_otp"])("redacts normalized secret query key %s", key => {
    expect(browserDisplayUrl(`http://localhost/report?${key}=private&author=owner#section`))
      .toBe("http://localhost/report?author=owner");
  });
});

describe("installed browser owner IPC / Electron boundary", () => {
  it("N2 loads only for explicit development sessions and supplies credentials only to exact admitted guests", async () => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2");
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("side-one", "https://example.test/page");
    expect(electron.startProxy).toHaveBeenCalledOnce(); expect(f.session.closeAllConnections).toHaveBeenCalledOnce();
    const proxy = electron.proxies[0], info = { isProxy: true, host: "127.0.0.1", port: proxy.port, scheme: "basic", realm: proxy.credentials.realm };
    const challenge = (contents: any, change = {}) => {
      const event = { preventDefault: vi.fn() }, callback = vi.fn();
      for (const listener of electron.appListeners.get("login") ?? []) listener(event, contents, {}, { ...info, ...change }, callback);
      return { event, callback };
    };
    expect(challenge(guest).callback.mock.calls).toEqual([[proxy.credentials.username, proxy.credentials.password]]);
    for (const contents of [null, f.owner, new ContentsMock(nextContentsId++, f.session), { ...guest, id: guest.id }])
      expect(challenge(contents).callback.mock.calls).toEqual([[]]);
    for (const change of [{ realm: "other" }, { host: "localhost" }, { port: 26070 }, { scheme: "digest" }])
      expect(challenge(guest, change).callback.mock.calls).toEqual([[]]);
    expect(challenge(guest, { isProxy: false }).callback).not.toHaveBeenCalled();
    expect(f.session.denied(guest.id, "https://example.test/resource", "script")).toBe(false);
    expect(f.session.denied(-1, "https://example.test/resource", "script")).toBe(true);
    await f.ipc({ op: "close", tabKey: "side-one" });
    expect(proxy.close).toHaveBeenCalledOnce(); expect(f.session.denied(guest.id, "https://example.test/resource")).toBe(true);
    expect(challenge(guest).callback).not.toHaveBeenCalled(); // Old challenge no longer belongs to any live run/guest.
    await flush(); expect(f.session.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({ proxyRules: "socks5://127.0.0.1:9" }));
  });
  it.each([["disable", false], ["reload", false], ["host-change", false], ["quit", false], ["disable", true], ["reload", true], ["host-change", true], ["quit", true]])("N2 %s revokes main credentials and closes live tunnels (packaged=%s)", async (cause, packaged) => {
    if (packaged) electron.packaged = true; else vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2");
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true }); await f.mount("side-one", "https://example.test/page");
    const proxy = electron.proxies[0];
    if (cause === "disable") await f.ipc({ op: "setEnabled", enabled: false });
    if (cause === "reload") f.owner.emit("did-start-navigation", {}, "app://index", false, true);
    if (cause === "host-change") { f.conns.get("local")!.routingEpoch = "epoch-b"; syncBrowserHosts(); }
    if (cause === "quit") for (const listener of electron.appListeners.get("before-quit") ?? []) listener();
    expect(proxy.close).toHaveBeenCalledOnce();
  });
  it("packaged: the owner switch (default on) starts N2 for the browser partition only; the env override is ignored", async () => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "off"); electron.packaged = true; electron.requested.length = 0;
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    expect(await f.ipc({ op: "externalPages" })).toEqual({ enabled: true, stored: true });
    const { guest } = await f.mount("side-one", "https://example.test/page");
    expect(electron.startProxy).toHaveBeenCalledOnce(); const proxy = electron.proxies[0];
    expect(f.session.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({ proxyRules: `http://127.0.0.1:${proxy.port}` }));
    // Only main-derived browser partitions are ever opened (session.fromPartition throws for any other).
    expect(new Set(electron.requested)).toEqual(new Set(["persist:browser-local"]));
    expect(guest.loads).toEqual(["https://example.test/page"]);
    expect(f.session.denied(guest.id, "https://example.test/resource", "script")).toBe(false);
    // Unregistered contents in the same partition (workers, popups, stale ids) stay denied.
    expect(f.session.denied(-1, "https://example.test/resource", "script")).toBe(true);
    expect(f.session.denied(guest.id + 1000, "https://example.test/resource", "script")).toBe(true);
    const info = { isProxy: true, host: "127.0.0.1", port: proxy.port, scheme: "basic", realm: proxy.credentials.realm };
    const challenge = (contents: any) => {
      const event = { preventDefault: vi.fn() }, callback = vi.fn();
      for (const listener of electron.appListeners.get("login") ?? []) listener(event, contents, {}, info, callback);
      return callback.mock.calls;
    };
    expect(challenge(guest)).toEqual([[proxy.credentials.username, proxy.credentials.password]]);
    // The app renderer, an unregistered webContents and a null (service-worker / system) request get nothing.
    expect(challenge(f.owner)).toEqual([[]]);
    expect(challenge(new ContentsMock(nextContentsId++, new SessionMock()))).toEqual([[]]);
    expect(challenge(null)).toEqual([[]]);
    // X3: last tab closes the listener and restores the session black hole.
    await f.ipc({ op: "close", tabKey: "side-one" }); expect(proxy.close).toHaveBeenCalledOnce();
    await flush(); expect(f.session.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({ proxyRules: "socks5://127.0.0.1:9" }));
  });
  it("packaged: switched off, external pages are refused and the proxy is never imported; on again re-arms open tabs", async () => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2"); electron.packaged = true;
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    expect(await f.ipc({ op: "externalPages", enabled: false })).toEqual({ enabled: false, stored: false });
    const { guest } = await f.mount();
    await expect(f.reserve("external", "https://example.test/")).rejects.toThrow("external_pages_off");
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "https://example.test/" })).rejects.toThrow("external_pages_off");
    expect(f.session.denied(guest.id, "https://example.test/resource", "script")).toBe(true);
    expect(electron.startProxy).not.toHaveBeenCalled(); expect(f.session.closeAllConnections).not.toHaveBeenCalled();
    expect(await f.ipc({ op: "externalPages", enabled: true })).toEqual({ enabled: true, stored: true });
    await until(() => f.session.closeAllConnections.mock.calls.length === 1); await flush();
    expect(electron.startProxy).toHaveBeenCalledOnce();
    // In-page requests of the already-open tab are admitted without a new address-bar navigation.
    expect(f.session.denied(guest.id, "https://example.test/resource", "script")).toBe(false);
    await f.ipc({ op: "navigate", tabKey: "side-one", url: "https://example.test/next" });
    expect(guest.loads.at(-1)).toBe("https://example.test/next");
  });
  it("packaged: switching off while a tab is open closes the listener and denies at once", async () => {
    electron.packaged = true;
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("side-one", "https://example.test/page"); const proxy = electron.proxies[0];
    await f.ipc({ op: "externalPages", enabled: false });
    expect(proxy.close).toHaveBeenCalledOnce();
    expect(f.session.denied(guest.id, "https://example.test/resource", "script")).toBe(true);
    // Loopback is reachable only once main itself navigated this tab there (owner address bar).
    expect(f.session.denied(guest.id, "http://localhost:26180/", "mainFrame")).toBe(true);
    await f.ipc({ op: "navigate", tabKey: "side-one", url: "http://localhost:26180/" });
    expect(f.session.denied(guest.id, "http://localhost:26180/", "mainFrame")).toBe(false);
    await flush(); expect(f.session.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({ proxyRules: "socks5://127.0.0.1:9" }));
    const info = { isProxy: true, host: "127.0.0.1", port: proxy.port, scheme: "basic", realm: proxy.credentials.realm }, callback = vi.fn();
    for (const listener of electron.appListeners.get("login") ?? []) listener({ preventDefault() {} }, guest, {}, info, callback);
    expect(callback.mock.calls).toEqual([[]]);
  });
  it("the switch is app-frame-only and exact; it works while the module is off", async () => {
    const f = fixture();
    await expect(f.ipc({ op: "externalPages", enabled: false }, { frame: {} })).rejects.toThrow("untrusted_sender");
    for (const raw of [{ op: "externalPages", enabled: "no" }, { op: "externalPages", enabled: false, hostId: "x" }])
      await expect(f.ipc(raw)).rejects.toThrow("invalid_browser_request");
    // Development override reported, never stored.
    expect(await f.ipc({ op: "externalPages" })).toEqual({ enabled: false, stored: true, forced: "off" });
    expect(await f.ipc({ op: "externalPages", enabled: false })).toEqual({ enabled: false, stored: false, forced: "off" });
  });
  it.each(["close", "disable"])("late base policy after %s cannot start an orphan N2 listener", async cause => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2"); const session = new SessionMock(), pending = deferred<void>();
    session.setProxy.mockImplementationOnce(() => pending.promise);
    const f = fixture(session); await f.ipc({ op: "setEnabled", enabled: true });
    const opening = f.reserve(), rejected = expect(opening).rejects.toMatchObject({ code: "lease_revoked" });
    await until(() => session.setProxy.mock.calls.length === 1);
    await f.ipc(cause === "close" ? { op: "close", tabKey: "side-one" } : { op: "setEnabled", enabled: false });
    pending.resolve(); await rejected;
    expect(electron.startProxy).not.toHaveBeenCalled(); expect(session.closeAllConnections).not.toHaveBeenCalled();
  });
  it("host A removal flushes only A browser partition while host B retains its N2 connection", async () => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2"); const f = fixture();
    f.conns.set("dev-b", { routingEpoch: "epoch-b", daemon: { ...f.daemon } });
    const other = new SessionMock(); electron.sessions.set("persist:browser-dev-b", other);
    await f.ipc({ op: "setEnabled", enabled: true }); const first = await f.mount();
    const binding = { hostId: "dev-b", epoch: "epoch-b" }, url = "https://example.test/other";
    const reserved = await f.ipc({ op: "open", tabKey: "side-two", url }, binding) as BrowserTabMount;
    expect(f.willAttach(reserved).denied).toBe(false);
    const guest = f.didAttach(new ContentsMock(nextContentsId++, other));
    await f.ipc({ op: "open", tabKey: "side-two", url, receipt: { src: reserved.src, webContentsId: guest.id } }, binding); await flush();
    expect(other.denied(guest.id, url)).toBe(false); const proxy = electron.proxies[0];
    f.conns.delete("local"); syncBrowserHosts(); await flush();
    expect(first.guest.dead).toBe(true); expect(guest.dead).toBe(false); expect(proxy.close).not.toHaveBeenCalled();
    expect(f.session.closeAllConnections).toHaveBeenCalledTimes(2); expect(other.closeAllConnections).toHaveBeenCalledOnce();
    expect(f.session.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({ proxyRules: "socks5://127.0.0.1:9" }));
    expect(other.denied(guest.id, url)).toBe(false);
    await f.ipc({ op: "close", tabKey: "side-two" }, binding); expect(proxy.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])("removed dev grant remains unreachable packaged=%s", async packaged => {
    electron.packaged = packaged;
    // No native image decoder or development grant surface exists in this fixture.
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true }); const { guest } = await f.mount();
    await expect(f.ipc({ op: "grant", tabKey: "side-one", target: "development-mcp",
      settings: DEFAULT_BROWSER_CONTROL_SETTINGS })).rejects.toThrow("invalid_browser_request");
    expect(guest.debugger.attach).not.toHaveBeenCalled();
    expect((await f.ipc({ op: "list" }))[0].control).toBeUndefined();
    expect(f.events.some(event => event.control)).toBe(false);
  });
  it.each(["connecting", "unreachable"])("N1 rechecks changed daemon capabilities after same-identity %s without closing the owner page", async kind => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    expect(f.daemon.capabilities).toHaveBeenCalledOnce();
    f.daemon.currentState = { kind }; syncBrowserHosts();
    f.daemon.capabilities.mockResolvedValue({ featureList: [] });
    f.daemon.currentState = { kind: "connected" }; syncBrowserHosts();
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/report/" })).rejects.toThrow("service_proxy_required");
    expect(f.daemon.capabilities).toHaveBeenCalledTimes(2); expect(guest.dead).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
  });
  it("N1 rejects a stale pre-disconnect capability reply even after the same daemon reconnects", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true }); await f.mount();
    const old = deferred<{ featureList: string[] }>();
    f.daemon.capabilities.mockImplementationOnce(() => old.promise);
    // I3 shares capability discovery between owner tabs and the per-host relay. Trigger a
    // real cache-invalidating disconnect rather than depending on an extra tab re-fetch.
    f.daemon.currentState = { kind: "unreachable" }; syncBrowserHosts();
    f.daemon.currentState = { kind: "connected" }; syncBrowserHosts();
    const pending = f.reserve("pending"); await until(() => f.daemon.capabilities.mock.calls.length === 2);
    f.daemon.currentState = { kind: "unreachable" }; syncBrowserHosts();
    f.daemon.capabilities.mockResolvedValue({ featureList: [] });
    f.daemon.currentState = { kind: "connected" }; syncBrowserHosts();
    old.resolve({ featureList: ["services-proxy"] }); await pending;
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/report/" })).rejects.toThrow("service_proxy_required");
    expect(f.daemon.capabilities).toHaveBeenCalledTimes(3); expect(f.request).not.toHaveBeenCalled();
  });
  it("N1 bounds automatic capability recovery failures instead of retrying on every host sync", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true }); const { guest } = await f.mount("service", "cutex:service/docs/");
    const before = f.daemon.capabilities.mock.calls.length;
    f.daemon.currentState = { kind: "unreachable" }; syncBrowserHosts();
    f.daemon.capabilities.mockRejectedValue(new Error("offline"));
    f.daemon.currentState = { kind: "connected" }; syncBrowserHosts(); await flush();
    for (let i = 0; i < 10; i++) { syncBrowserHosts(); await flush(); }
    expect(f.daemon.capabilities).toHaveBeenCalledTimes(before + 1); expect(guest.dead).toBe(false);
    expect(f.session.denied(guest.id, "http://docs.svc.localhost:26111/events", "xhr")).toBe(true);
  });
  it.each([false, true])("starts disabled and rejects other frames/guests even with permissive generic app predicate = %s", async permissiveAppSender => {
    const f = fixture(undefined, permissiveAppSender);
    await expect(f.reserve()).rejects.toThrow("module_disabled");
    const guest = new ContentsMock(999, f.session);
    for (const source of [{ frame: { url: "file:///same-app-iframe.html" } }, { frame: { url: "cutex-plugin://sandbox/document" } },
      { sender: guest, frame: guest.mainFrame }, { frame: undefined }, { frame: null }])
      await expect(f.ipc({ op: "setEnabled", enabled: true }, source)).rejects.toThrow("untrusted_sender");
    await expect(f.reserve()).rejects.toThrow("module_disabled");
    await f.ipc({ op: "setEnabled", enabled: true });
    const mounted = await f.mount();
    expect(mounted.guest.loads).toEqual(["http://localhost:26180/"]);
    await expect(f.ipc({ op: "setEnabled", enabled: false }, { frame: {} })).rejects.toThrow("untrusted_sender");
    expect(f.session.denied(mounted.guest.id)).toBe(false);
  });
  it("every owner operation is disabled before host admission, including list/close/stop", async () => {
    const f = fixture();
    f.conns.clear(); // No valid host: the module gate must win over host admission.
    const requests: BrowserRequest[] = [{ op: "list" }, { op: "open", tabKey: "side", url: "about:blank" },
      { op: "navigate", tabKey: "side", url: "about:blank" }, { op: "back", tabKey: "side" },
      { op: "forward", tabKey: "side" }, { op: "reload", tabKey: "side" },
      { op: "close", tabKey: "side" }, { op: "stop", tabKey: "side" }];
    for (const request of requests) await expect(f.ipc(request, { epoch: "old" })).rejects.toThrow("module_disabled");
  });
  it("requires both one-use will-attach admission and trusted receipt; raw id alone grants nothing", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(), guest = f.didAttach();
    expect(f.session.denied(guest.id)).toBe(true);
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
    const admitted = f.willAttach(reserved);
    expect(admitted.denied).toBe(false); expect(admitted.params.src).toBe("about:blank");
    expect(admitted.preferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
    await expect(f.ipc({ op: "open", tabKey: reserved.tabKey, url: "http://localhost:26180/",
      receipt: { src: "about:blank", webContentsId: guest.id } })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.ipc({ op: "open", tabKey: reserved.tabKey, url: "http://localhost:26180/",
      receipt: { src: reserved.src, webContentsId: guest.id } }, { frame: {} })).rejects.toThrow("untrusted_sender");
    expect(f.session.denied(guest.id)).toBe(true);
    await f.receipt(reserved, guest); await flush();
    expect(f.session.denied(guest.id)).toBe(false);
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.willAttach(reserved).denied).toBe(true);
  });
  it("binds concurrent same-partition mounts by receipt rather than did-attach arrival order", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const a = await f.reserve("a", "http://localhost:26180/a"), b = await f.reserve("b", "http://localhost:26180/b");
    expect(f.willAttach(a).denied).toBe(false); expect(f.willAttach(b).denied).toBe(false);
    const gb = f.didAttach(), ga = f.didAttach();
    await f.receipt(a, ga, "http://localhost:26180/a"); await f.receipt(b, gb, "http://localhost:26180/b"); await flush();
    expect(ga.loads).toEqual(["http://localhost:26180/a"]); expect(gb.loads).toEqual(["http://localhost:26180/b"]);
  });
  it("denies client certificates before the first admitted network load and retains the guard on close", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(), admission = f.willAttach(reserved);
    expect(admission.params.src).toBe("about:blank");
    const guest = f.didAttach();
    expect(f.session.denied(guest.id, "https://localhost:26180/", "mainFrame")).toBe(true);
    const originalLoad = guest.loadURL.bind(guest);
    vi.spyOn(guest, "loadURL").mockImplementation(async url => {
      expect(guest.listenerCount("select-client-certificate")).toBe(1);
      const event = { preventDefault: vi.fn() }, callback = vi.fn();
      guest.emit("select-client-certificate", event, "https://localhost:26180/", [{ subjectName: "Private owner identity" }], callback);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(callback.mock.calls).toEqual([[]]); // Never hand any OS certificate to the server.
      return originalLoad(url);
    });
    await f.receipt(reserved, guest); await flush();
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
    await f.ipc({ op: "close", tabKey: "side-one" });
    expect(guest.listenerCount("select-client-certificate")).toBe(1);
    expect(JSON.stringify(f.events)).not.toContain("Private owner identity");
  });
  it("destroys the guest if certificate hardening fails, before any permitted network navigation", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(); expect(f.willAttach(reserved).denied).toBe(false);
    const guest = f.didAttach(), originalOn = guest.on.bind(guest);
    vi.spyOn(guest, "on").mockImplementation((event, listener) => {
      if (event === "select-client-certificate") throw new Error("registration failed");
      return originalOn(event, listener);
    });
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
    expect(guest.dead).toBe(true); expect(guest.loads).toEqual([]);
    expect(f.session.denied(guest.id)).toBe(true);
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "http://localhost:26180/" })).rejects.toThrow("target_closed");
  });
  it.each(["missing-creation", "throwing-setter"])("closes a guest with %s instead of attaching without its early popup guard", async failure => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(); expect(f.willAttach(reserved).denied).toBe(false);
    const guest = new ContentsMock(nextContentsId++, f.session);
    if (failure === "throwing-setter") guest.setWindowOpenHandler.mockImplementation(() => { throw new Error("guard unavailable"); });
    f.didAttach(guest, failure !== "missing-creation");
    expect(guest.dead).toBe(true); expect(guest.loads).toEqual([]);
    expect(f.session.denied(guest.id)).toBe(true);
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
    expect(electron.nativeWindows).not.toHaveBeenCalled();
  });
  it("installs popup denial before did-attach and forwards at most one eligible owner-input link with no native window", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(); const admission = f.willAttach(reserved);
    expect(admission.denied).toBe(false);
    expect(admission.params).toMatchObject({ allowpopups: true }); expect(admission.preferences).toMatchObject({ disablePopups: false });
    const guest = new ContentsMock(nextContentsId++, f.session); guest.hostWebContents = f.owner;
    for (const listener of electron.appListeners.get("web-contents-created") ?? []) listener({}, guest);
    expect(guest.setWindowOpenHandler).toHaveBeenCalledOnce();
    expect(guest.popup("http://localhost:26180/before-admission")).toEqual({ action: "deny" });
    expect(f.events.filter(event => event.kind === "new-tab")).toHaveLength(0);
    f.didAttach(guest, false); await f.receipt(reserved, guest); await flush();
    expect(guest.setWindowOpenHandler).toHaveBeenCalledOnce(); // Receipt/hardening cannot replace the early handler.
    expect(guest.popup("http://localhost:26180/no-input?token=secret", { userGesture: true })).toEqual({ action: "deny" });
    expect(f.events.filter(event => event.kind === "new-tab")).toHaveLength(0);
    const diagnostic = f.events.findLast(event => event.kind === "diagnostic");
    expect(diagnostic).toMatchObject({ kind: "diagnostic", popupDiscardReason: "no_owner_input" });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
    // The owner hears about a page's own popup once (Chromium-style popup blocking).
    expect(f.events.at(-1)).toMatchObject({ kind: "blocked", blocked: "popup" });
    guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(guest.popup("http://localhost:26180/owner-link")).toEqual({ action: "deny" });
    expect(guest.popup("http://localhost:26180/second-link")).toEqual({ action: "deny" });
    expect(f.events.filter(event => event.kind === "new-tab")).toEqual([expect.objectContaining({ hostId: "local", newTabUrl: "http://localhost:26180/owner-link" })]);
    guest.emit("before-input-event", {}, { type: "keyDown" });
    expect(guest.popup("http://localhost:26180/rate-limited")).toEqual({ action: "deny" });
    expect(f.events.at(-1)).toMatchObject({ kind: "diagnostic", popupDiscardReason: "rate_limited" });
    expect(f.events.filter(event => event.kind === "new-tab")).toHaveLength(1);
    await f.ipc({ op: "setEnabled", enabled: false });
    expect(guest.popup("http://localhost:26180/after-disable")).toEqual({ action: "deny" });
    expect(f.events.filter(event => event.kind === "new-tab")).toHaveLength(1);
    expect(electron.nativeWindows).not.toHaveBeenCalled();
  });
  it("rejects receipts for unobserved guest, wrong embedder, wrong session, or changed target", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(); f.willAttach(reserved);
    const unknown = new ContentsMock(nextContentsId++, f.session);
    await expect(f.receipt(reserved, unknown)).rejects.toMatchObject({ code: "invalid_request" });
    const otherSession = f.didAttach(new ContentsMock(nextContentsId++, new SessionMock()));
    await expect(f.receipt(reserved, otherSession)).rejects.toMatchObject({ code: "invalid_request" });
    const wrongEmbedder = f.didAttach(); wrongEmbedder.hostWebContents = unknown;
    await expect(f.receipt(reserved, wrongEmbedder)).rejects.toMatchObject({ code: "invalid_request" });
    const guest = f.didAttach();
    await expect(f.receipt(reserved, guest, "http://localhost:26180/other")).rejects.toMatchObject({ code: "invalid_request" });
    expect(guest.loads).toHaveLength(0); expect(f.session.denied(guest.id)).toBe(true);
  });
  it("module disable synchronously clears mounted, unbound and reserved guests and denies old tickets", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    const reserved = await f.reserve("pending"), admitted = await f.reserve("unbound");
    f.willAttach(admitted); const unbound = f.didAttach();
    await f.ipc({ op: "setEnabled", enabled: false });
    expect(guest.dead).toBe(true); expect(unbound.dead).toBe(true);
    expect(f.session.denied(guest.id)).toBe(true);
    await expect(f.ipc({ op: "list" })).rejects.toThrow("module_disabled");
    await expect(f.ipc({ op: "stop", tabKey: "side-one" })).rejects.toThrow("module_disabled");
    await expect(f.ipc({ op: "close", tabKey: "side-one" })).rejects.toThrow("module_disabled");
    expect(f.willAttach(reserved).denied).toBe(true);
    await expect(f.reserve()).rejects.toThrow("module_disabled");
    await f.ipc({ op: "setEnabled", enabled: true });
    expect(await f.ipc({ op: "list" })).toEqual([]);
    expect(f.willAttach(reserved).denied).toBe(true);
    await expect(f.receipt(admitted, unbound)).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("closes a late did-attach completion immediately if the module was disabled after will-attach", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const reserved = await f.reserve(); expect(f.willAttach(reserved).denied).toBe(false);
    await f.ipc({ op: "setEnabled", enabled: false });
    const guest = f.didAttach();
    expect(guest.dead).toBe(true); // Not a 15-second orphan waiting for the unbound sweeper.
    expect(f.session.denied(guest.id)).toBe(true);
  });
  it.each(["reload", "in-place-main-frame", "crash"])("%s disables and clears old admission/guests until explicitly enabled again", async reason => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    const pending = await f.reserve("pending"); expect(f.willAttach(pending).denied).toBe(false);
    const unbound = f.didAttach();
    if (reason === "crash") f.owner.emit("render-process-gone", {}, { reason: "crashed" });
    else f.owner.emit("did-start-navigation", { url: "file:///app/index.html", isMainFrame: true, isSameDocument: reason === "in-place-main-frame" },
      "file:///app/index.html", reason === "in-place-main-frame", true);
    expect(guest.dead).toBe(true); expect(unbound.dead).toBe(true);
    expect(f.session.denied(guest.id)).toBe(true);
    await expect(f.ipc({ op: "list" })).rejects.toThrow("module_disabled");
    await f.ipc({ op: "setEnabled", enabled: true });
    await expect(f.receipt(pending, unbound)).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.willAttach(pending).denied).toBe(true);
    expect(await f.ipc({ op: "list" })).toEqual([]);
  });
  it("non-main-frame navigation cannot disable the owner module or invalidate its mounted guest", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    f.owner.emit("did-start-navigation", { url: "cutex-plugin://sandbox/document", isMainFrame: false, isSameDocument: false },
      "cutex-plugin://sandbox/document", false, false);
    expect(guest.dead).toBe(false); expect(f.session.denied(guest.id)).toBe(false);
    expect(await f.ipc({ op: "list" })).toHaveLength(1);
  });
  it("rejects same-generation epoch replacement on the very next network event, before polling", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    expect(f.session.denied(guest.id)).toBe(false);
    f.conns.set("local", { routingEpoch: "epoch-b", daemon: { ...f.daemon, generation: 1 } });
    expect(f.session.denied(guest.id)).toBe(true); // No timer advance and no IPC call between replacement/request.
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "http://localhost:26180/next" }, { epoch: "epoch-a" })).rejects.toThrow();
    await f.ipc({ op: "close", tabKey: "side-one" }, { epoch: "epoch-a" });
    expect(guest.dead).toBe(true);
  });
  it("rejects a replacement daemon object even when its epoch and numeric generation are unchanged", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { reserved, guest } = await f.mount();
    expect(f.session.denied(guest.id)).toBe(false);
    f.conns.set("local", { routingEpoch: "epoch-a", daemon: { ...f.daemon } });
    expect(f.session.denied(guest.id)).toBe(true); // Exact daemon identity is checked without waiting for the sweep.
    expect(await f.ipc({ op: "list" })).toEqual([]);
    expect(guest.dead).toBe(true);
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
    const replacement = await f.mount();
    expect(replacement.reserved.guestId).not.toBe(reserved.guestId);
    expect(f.session.denied(replacement.guest.id)).toBe(false);
    expect(f.session.denied(guest.id)).toBe(true);
  });
  it.each(["removed", "epoch", "daemon-identity", "generation"] as const)("main host sync immediately retires guests and tickets when the host is %s", async reason => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { reserved, guest } = await f.mount();
    const pending = await f.reserve("waiting");
    const original = f.conns.get("local")!;
    const eventCount = f.events.length;
    if (reason === "removed") f.conns.delete("local");
    else if (reason === "epoch") f.conns.set("local", { ...original, routingEpoch: "epoch-b" });
    else if (reason === "daemon-identity") f.conns.set("local", { ...original, daemon: { ...original.daemon } });
    else f.daemon.generation++;
    syncBrowserHosts();
    // No await, timer advance, request or IPC between the state change/hook and these assertions.
    expect(guest.dead).toBe(true);
    expect(guest.debugger.detach).toHaveBeenCalledOnce();
    const retired = f.events.slice(eventCount).filter(event => event.status === "closed").map(event => event.guestId);
    expect(retired).toEqual(expect.arrayContaining([reserved.guestId, pending.guestId]));
    // Restore an otherwise valid host before attempting reuse, so rejection is not just offline admission.
    f.daemon.currentState = { kind: "connected" }; f.conns.set("local", original);
    const fresh = await f.reserve("waiting");
    expect(fresh.guestId).not.toBe(pending.guestId);
    expect(f.willAttach(pending).denied).toBe(true);
    await expect(f.receipt(reserved, guest)).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.willAttach(fresh).denied).toBe(false);
  });
  it("main host sync safely handles missing windows and follows only the replacement window", async () => {
    expect(() => syncBrowserHosts()).not.toThrow();
    const first = fixture(); await first.ipc({ op: "setEnabled", enabled: true });
    const old = await first.mount();
    const second = fixture(first.session); // Installing a replacement disposes the first controller.
    expect(old.guest.dead).toBe(true);
    await expect(second.reserve()).rejects.toThrow("module_disabled");
    await second.ipc({ op: "setEnabled", enabled: true });
    const current = await second.mount();
    first.conns.clear(); syncBrowserHosts();
    expect(current.guest.dead).toBe(false); // The hook must no longer read the previous HostManager.
    first.owner.close(); // Late disposal of the old window must not clear the new hook.
    second.daemon.generation++; syncBrowserHosts();
    expect(current.guest.dead).toBe(true);
    second.owner.close();
    expect(() => syncBrowserHosts()).not.toThrow();
  });
  it.each(["connecting", "unreachable"])("keeps owner guests and mount tickets across same-identity %s, denying only daemon-backed service traffic", async kind => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { reserved, guest } = await f.mount();
    const service = await f.mount("service", "cutex:service/docs/");
    const pending = await f.reserve("waiting");
    const eventCount = f.events.length, daemonCalls = f.request.mock.calls.length;
    f.daemon.currentState = { kind }; syncBrowserHosts();
    expect(guest.dead).toBe(false); expect(service.guest.dead).toBe(false);
    expect(guest.debugger.detach).not.toHaveBeenCalled();
    expect(f.events.slice(eventCount).some(event => event.status === "closed")).toBe(false);
    expect(f.session.denied(guest.id, "http://localhost:26180/next.js", "script")).toBe(false);
    expect(f.session.denied(service.guest.id, "http://docs.svc.localhost:26111/events", "xhr")).toBe(true);
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/docs/" })).rejects.toThrow("service_unavailable");
    await expect(f.ipc({ op: "reload", tabKey: "service" })).rejects.toThrow("service_unavailable");
    expect(f.request).toHaveBeenCalledTimes(daemonCalls);
    expect(f.willAttach(pending).denied).toBe(false);
    const waiting = f.didAttach(); await f.receipt(pending, waiting); await flush();
    expect(waiting.dead).toBe(false); expect(waiting.loads).toEqual(["http://localhost:26180/"]);
    const beforeCaps = f.daemon.capabilities.mock.calls.length;
    const offlineNew = await f.mount("new-local-tab");
    expect(offlineNew.guest.dead).toBe(false); expect(f.daemon.capabilities).toHaveBeenCalledTimes(beforeCaps);
    await f.ipc({ op: "navigate", tabKey: "side-one", url: "http://localhost:26180/next#kept" });
    expect(guest.getURL()).toBe("http://localhost:26180/next#kept");
    f.daemon.currentState = { kind: "connected" }; syncBrowserHosts();
    // N1: service traffic remains denied until the post-recovery capability read completes.
    expect(f.session.denied(service.guest.id, "http://docs.svc.localhost:26111/events", "xhr")).toBe(true);
    await flush();
    expect(f.session.denied(service.guest.id, "http://docs.svc.localhost:26111/events", "xhr")).toBe(false);
    const rows = await f.ipc({ op: "list" }) as BrowserTabView[];
    expect(rows.find(row => row.tabKey === "side-one")?.guestId).toBe(reserved.guestId);
    expect(guest.dead).toBe(false); expect(service.guest.dead).toBe(false);
  });
  it("a service ticket completing during transient unreachability cannot navigate or close its owner guest", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    const ticket = deferred<unknown>();
    f.request.mockImplementation(async (_method, path) => path.endsWith("view-ticket") ? ticket.promise : { leaseId: "lease-docs" });
    const navigation = f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/docs/" });
    const rejected = expect(navigation).rejects.toThrow("service_unavailable");
    await until(() => f.request.mock.calls.some(([, path]) => path.endsWith("view-ticket")));
    f.daemon.currentState = { kind: "unreachable" }; syncBrowserHosts();
    ticket.resolve({ hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=fixture-late&next=%2F" });
    await rejected; await flush();
    expect(guest.dead).toBe(false); expect(guest.loads).toEqual(["http://localhost:26180/"]);
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-docs");
  });
  it("learns service capabilities after an offline-first tab recovers without requiring another open", async () => {
    const f = fixture(); f.daemon.currentState = { kind: "connecting" };
    await f.ipc({ op: "setEnabled", enabled: true });
    const { reserved, guest } = await f.mount();
    expect(f.daemon.capabilities).not.toHaveBeenCalled();
    f.daemon.currentState = { kind: "connected" }; syncBrowserHosts();
    await f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/docs/next" });
    expect(f.daemon.capabilities).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/next", start: true, routing: "host" } });
    expect((await f.ipc({ op: "list" }))[0].guestId).toBe(reserved.guestId);
    expect(guest.dead).toBe(false);
  });
  it.each(["stop", "navigate", "disable"])("late recovery capabilities cannot revive a service intent after %s", async action => {
    const f = fixture(); f.daemon.currentState = { kind: "unreachable" };
    await f.ipc({ op: "setEnabled", enabled: true }); const { guest } = await f.mount();
    const capabilities = deferred<{ featureList: string[] }>();
    f.daemon.capabilities.mockImplementationOnce(() => capabilities.promise);
    f.daemon.currentState = { kind: "connected" };
    const navigating = f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/docs/next" });
    const rejected = expect(navigating).rejects.toThrow("target_closed");
    await until(() => f.daemon.capabilities.mock.calls.length === 1);
    if (action === "stop") await f.ipc({ op: "stop", tabKey: "side-one" });
    else if (action === "navigate") await f.ipc({ op: "navigate", tabKey: "side-one", url: "http://localhost:26180/new" });
    else await f.ipc({ op: "setEnabled", enabled: false });
    capabilities.resolve({ featureList: ["services-proxy", "services-lifetime"] });
    await rejected;
    expect(f.request).not.toHaveBeenCalled();
    expect(guest.loads).toEqual(action === "navigate" ? ["http://localhost:26180/", "http://localhost:26180/new"] : ["http://localhost:26180/"]);
  });
  it("reload checks and reloads the live document without reconstructing its query or fragment from display state", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const raw = "http://localhost:26180/form?zipcode=2000&author=owner&accessToken=private#section";
    const { guest } = await f.mount("side-one", raw);
    expect((await f.ipc({ op: "list" }))[0].url).toBe("http://localhost:26180/form?zipcode=2000&author=owner");
    await f.ipc({ op: "reload", tabKey: "side-one" });
    expect(guest.reload).toHaveBeenCalledOnce(); expect(guest.getURL()).toBe(raw);
    expect(guest.loads).toEqual([raw]);
    expect(JSON.stringify(f.events)).not.toContain("private");
    for (const [blocked, code] of [["https://example.com/", "external_pages_off"], ["file:///private/test.html", "invalid_request"], ["javascript:alert(1)", "invalid_request"]]) {
      guest.url = blocked!;
      await expect(f.ipc({ op: "reload", tabKey: "side-one" })).rejects.toThrow(code);
    }
    expect(guest.reload).toHaveBeenCalledOnce();
  });
  it("service reload keeps the main-only exact path while reacquiring its ticket, never replaying auth URLs", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("service", "cutex:service/docs/");
    guest.url = "http://docs.svc.localhost:26111/next?token=private&author=owner";
    guest.emit("did-navigate", {}, guest.url);
    await f.ipc({ op: "reload", tabKey: "service" });
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/next?token=private&author=owner", start: true, routing: "host" } });
    expect(guest.reload).not.toHaveBeenCalled(); expect(JSON.stringify(f.events)).not.toContain("private");
  });
  it.each(["capabilities", "setProxy"] as const)("an open pending %s cannot mint a ticket after disable and re-enable", async stage => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const pendingCapabilities = deferred<{ featureList: string[] }>(), pendingProxy = deferred<void>();
    if (stage === "capabilities") f.daemon.capabilities.mockImplementationOnce(() => pendingCapabilities.promise);
    else f.session.setProxy.mockImplementationOnce(() => pendingProxy.promise);
    const opening = f.reserve();
    const rejected = expect(opening).rejects.toThrow();
    await until(() => stage === "capabilities" ? f.daemon.capabilities.mock.calls.length === 1 : f.session.setProxy.mock.calls.length === 1);
    await f.ipc({ op: "setEnabled", enabled: false });
    await f.ipc({ op: "setEnabled", enabled: true });
    pendingCapabilities.resolve({ featureList: ["services-proxy", "services-lifetime"] });
    pendingProxy.resolve();
    await rejected; await flush();
    expect(await f.ipc({ op: "list" })).toEqual([]);
    expect(f.events.some(event => event.status === "pending")).toBe(false);
    const { guest } = await f.mount();
    expect(f.session.denied(guest.id)).toBe(false);
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
  });
  it("Stop cancels service ticket completion instead of starting a later navigation", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    const ticket = deferred<unknown>();
    f.request.mockImplementation(async (_method, path) => path.endsWith("view-ticket") ? ticket.promise : { leaseId: "lease-docs" });
    const navigation = f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/docs/" });
    const rejected = expect(navigation).rejects.toThrow();
    await until(() => f.request.mock.calls.some(([, path]) => path.endsWith("view-ticket")));
    await f.ipc({ op: "stop", tabKey: "side-one" });
    ticket.resolve({ hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=fixture-late&next=%2F" });
    await rejected; await flush();
    expect(guest.stop).toHaveBeenCalledOnce();
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-docs");
  });
  it("reauthenticates the currently displayed service path, not its original path", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("service", "cutex:service/docs/");
    guest.url = "http://docs.svc.localhost:26111/next?q=1"; guest.emit("did-navigate", {}, guest.url);
    f.session.response(guest, guest.url, 401, { "X-Cutex-Service-Auth": ["ticket-required"] });
    await flush();
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/next?q=1", start: false, routing: "host" } });
  });
  it("loading/title events from the old URL do not release a newly acquired service lease", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    const ticket = deferred<unknown>();
    f.request.mockImplementation(async (_method, path) => path.endsWith("view-ticket") ? ticket.promise : { leaseId: "lease-docs" });
    const navigation = f.ipc({ op: "navigate", tabKey: "side-one", url: "cutex:service/docs/next" });
    await until(() => f.request.mock.calls.some(([, path]) => path.endsWith("view-ticket")));
    expect(guest.getURL()).toBe("http://localhost:26180/"); // New navigation has not committed yet.
    guest.emit("did-start-loading"); guest.emit("page-title-updated", {}, "Old document title"); guest.emit("did-stop-loading");
    expect(f.request.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    expect((await f.ipc({ op: "list" }))[0]).toMatchObject({ url: "cutex:service/docs/next" });
    ticket.resolve({ hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=fixture-loading&next=%2Fnext" });
    await navigation; await flush();
    expect(f.request.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    expect(guest.loads.at(-1)).toContain("http://docs.svc.localhost:26111/__cutex/auth?");
    await f.ipc({ op: "close", tabKey: "side-one" });
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-docs");
  });
  it("a local document's direct service link acquires a lease even without a 401 challenge", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    expect(f.request).not.toHaveBeenCalled();
    guest.url = "http://docs.svc.localhost:26111/linked?q=1";
    guest.emit("did-navigate", {}, guest.url); // Existing cookie succeeds; no onHeadersReceived 401.
    await flush();
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/docs/lease", { body: { holder: "desktop-browser" } });
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/linked?q=1", start: false, routing: "host" } });
    expect((await f.ipc({ op: "list" }))[0]).toMatchObject({ url: "cutex:service/docs/linked%3Fq%3D1" });
    expect(f.request.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    await f.ipc({ op: "close", tabKey: "side-one" });
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-docs");
  });
  it("switching service slug releases original lease and acquires/tickets the new service", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("service", "cutex:service/docs/");
    guest.url = "http://report.svc.localhost:26111/next"; guest.emit("did-navigate", {}, guest.url);
    await flush();
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-docs");
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/report/lease", { body: { holder: "desktop-browser" } });
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/report/view-ticket", { body: { path: "/next", start: false, routing: "host" } });
    expect(guest.loads.at(-1)).toContain("http://report.svc.localhost:26111/__cutex/auth?");
  });
  it("does not turn an unrelated local page's spoofed service header into a ticket exchange", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("service", "cutex:service/docs/");
    const calls = f.request.mock.calls.length, loads = guest.loads.length;
    f.session.response(guest, "http://localhost:26180/unrelated", 401, { "X-Cutex-Service-Auth": ["ticket-required"] });
    await flush();
    expect(f.request).toHaveBeenCalledTimes(calls); expect(guest.loads).toHaveLength(loads);
  });
  it("pending proxy setup from disposed window cannot activate or own replacement window session", async () => {
    const shared = new SessionMock(), pending = deferred<void>();
    shared.setProxy.mockImplementationOnce(() => pending.promise);
    const first = fixture(shared); await first.ipc({ op: "setEnabled", enabled: true });
    const opening = first.reserve(); const rejected = expect(opening).rejects.toThrow();
    await until(() => shared.setProxy.mock.calls.length === 1);
    first.owner.close();
    const second = fixture(shared); await second.ipc({ op: "setEnabled", enabled: true });
    const replacing = second.mount();
    // Session proxy changes are serialized across old/new window controllers.
    // The replacement cannot be ready while the old setProxy call is unresolved.
    pending.resolve(); await rejected;
    const { guest } = await replacing; await flush();
    expect(shared.denied(guest.id)).toBe(false);
    expect(shared.setProxy).toHaveBeenCalledTimes(2);
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
  });
  it("page redirects, iframe navigation and subresource egress cannot open external pages", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    for (const kind of ["will-frame-navigate", "will-redirect"]) {
      const event = { url: "https://example.com/", preventDefault: vi.fn() };
      guest.emit(kind, event); expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(f.session.denied(guest.id, "https://example.com/script.js", "script")).toBe(true);
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "https://example.com/" })).rejects.toThrow("external_pages_off");
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
  });
  it("0.1.3: the owner's own loopback dev server opens; the host's control ports never do", async () => {
    const f = fixture(); (f.daemon as any).getSettings = vi.fn(async () => ({ agentBusEffectivePort: 26160, agentBusPort: null }));
    await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
    // The fixture's management endpoint is 127.0.0.1:26111; the bus port came from /v2/settings.
    for (const url of ["http://127.0.0.1:26111/v2/health", "http://localhost:26111/", "http://[::1]:26160/"])
      await expect(f.ipc({ op: "navigate", tabKey: "side-one", url })).rejects.toThrow("protected_endpoint");
    await expect(f.reserve("other", "http://localhost:26160/")).rejects.toThrow("protected_endpoint");
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "http://169.254.169.254/" })).rejects.toThrow("reserved_address");
    expect(guest.loads).toEqual(["http://localhost:26180/"]);
  });
  it("0.1.3: pages reach only the loopback origins main admitted for their own tab, same-origin", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const first = await f.mount();
    const second = await f.mount("side-two", "http://localhost:26190/");
    expect(f.session.denied(first.guest.id, "http://localhost:26180/app.js", "script")).toBe(false);
    expect(f.session.denied(first.guest.id, "ws://localhost:26180/hmr", "webSocket")).toBe(false);
    // Another tab's admitted origin, another port, a foreign initiator, a control port: refused.
    expect(f.session.denied(second.guest.id, "http://localhost:26180/app.js", "script")).toBe(true);
    expect(f.session.denied(first.guest.id, "http://localhost:26181/", "xhr", "http://localhost:26180")).toBe(true);
    expect(f.session.denied(first.guest.id, "http://localhost:26180/api", "xhr", "https://example.test")).toBe(true);
    expect(f.session.denied(first.guest.id, "http://127.0.0.1:26111/v2/sessions", "xhr", "http://127.0.0.1:26111")).toBe(true);
    // A page-initiated top-level jump to an unadmitted loopback port reports why, without the URL.
    const before = f.events.length;
    expect(f.session.denied(first.guest.id, "http://localhost:9222/json", "mainFrame", "http://localhost:26180")).toBe(true);
    expect(f.events.slice(before).at(-1)).toMatchObject({ error: "private_address_blocked" });
    expect(JSON.stringify(f.events.slice(before))).not.toContain("9222");
    // Closing the tab drops its admission; a remount re-admits through main's own navigation.
    await f.ipc({ op: "close", tabKey: "side-two" });
    const again = await f.mount("side-two", "http://localhost:26190/");
    expect(f.session.denied(again.guest.id, "http://localhost:26190/x.js", "script")).toBe(false);
  });
  it("0.1.3: a page navigation event to an unadmitted loopback port is refused with its reason", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount();
    const event = { url: "http://localhost:5555/", isMainFrame: true, preventDefault: vi.fn() };
    guest.emit("will-navigate", event); expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.events.at(-1)).toMatchObject({ error: "private_address_blocked" });
    const same = { url: "http://localhost:26180/next", isMainFrame: true, preventDefault: vi.fn() };
    guest.emit("will-navigate", same); expect(same.preventDefault).not.toHaveBeenCalled();
  });
  it("0.1.3: an owner-typed tailnet / LAN URL opens without a prompt (websites off), scoped to that tab and origin", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    expect((await f.ipc({ op: "externalPages" })).enabled).toBe(false);
    const { guest } = await f.mount();
    const other = await f.mount("side-two", "http://localhost:26190/");
    await f.ipc({ op: "navigate", tabKey: "side-one", url: "http://100.64.0.27:8765/" });
    expect(guest.loads.at(-1)).toBe("http://100.64.0.27:8765/");
    // N2 runs for this LAN authority alone (websites stay off) and the partition uses it.
    expect(electron.startProxy).toHaveBeenCalledOnce();
    const options = electron.startProxy.mock.calls[0]![0] as { lanAllowed(h: string, p: number): boolean; publicAllowed(): boolean };
    expect(options.lanAllowed("100.64.0.27", 8765)).toBe(true); expect(options.lanAllowed("100.64.0.27", 9000)).toBe(false);
    expect(options.publicAllowed()).toBe(false);
    expect(f.session.setProxy).toHaveBeenLastCalledWith(expect.objectContaining({ proxyRules: `http://127.0.0.1:${electron.proxies[0].port}` }));
    const own = "http://100.64.0.27:8765";
    expect(f.session.denied(guest.id, `${own}/api`, "xhr")).toBe(false);
    expect(f.session.denied(guest.id, `${own}/`, "mainFrame")).toBe(false);
    // Same partition, other tab / other origin / other LAN target: refused.
    expect(f.session.denied(other.guest.id, `${own}/api`, "xhr", "http://localhost:26190")).toBe(true);
    expect(f.session.denied(guest.id, `${own}/api`, "xhr", "https://example.test")).toBe(true);
    expect(f.session.denied(guest.id, "http://10.0.0.10/", "xhr", own)).toBe(true);
    expect(f.session.denied(guest.id, "http://10.0.0.10/", "mainFrame", own)).toBe(true);
    // Websites stay off for public targets even in this tab.
    await expect(f.ipc({ op: "navigate", tabKey: "side-one", url: "https://example.test/" })).rejects.toThrow("external_pages_off");
    await f.ipc({ op: "close", tabKey: "side-one" });
    expect(options.lanAllowed("100.64.0.27", 8765)).toBe(false);
  });
  it("0.1.3: an owner LAN URL opens a fresh tab too; reserved and control addresses never", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("lan", "http://10.0.0.11:8080/");
    expect(guest.loads).toEqual(["http://10.0.0.11:8080/"]);
    expect(f.session.denied(guest.id, "http://10.0.0.11:8080/app.js", "script")).toBe(false);
    await expect(f.reserve("meta", "http://169.254.169.254/")).rejects.toThrow("reserved_address");
  });
  it("emits host-tagged lifecycle views with opaque guest IDs, not numeric Electron IDs", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { reserved, guest } = await f.mount();
    const tabs = await f.ipc({ op: "list" }) as BrowserTabView[];
    expect(tabs).toHaveLength(1); expect(tabs[0]!.guestId).toBe(reserved.guestId);
    expect(tabs[0]!.guestId).not.toBe(String(guest.id));
    expect(f.events.every(event => event.hostId === "local" && event.epoch === "epoch-a")).toBe(true);
    await f.ipc({ op: "close", tabKey: "side-one" });
    expect(f.events.at(-1)).toMatchObject({ status: "closed", guestId: reserved.guestId, epoch: "epoch-a" });
  });
});

describe("installed controlled tabs, downloads and site permissions (0.1.3)", () => {
  it("an owner-clicked POST popup becomes an owner tab that replays the exact URL and body once", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("side-one", "http://localhost:26180/");
    guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(guest.popup("http://localhost:26180/submit?token=secret", { postBody: { contentType: "application/x-www-form-urlencoded", data: [{ type: "rawData", bytes: Buffer.from("q=1") }] } }))
      .toEqual({ action: "deny" });
    const event = f.events.findLast(item => item.kind === "new-tab")!;
    expect(event).toMatchObject({ pool: "owner", newTabUrl: "http://localhost:26180/submit" });
    expect(event.newTabKey).toMatch(/^[0-9a-f-]{36}$/); expect(JSON.stringify(event)).not.toContain("secret");
    const load = vi.spyOn(ContentsMock.prototype, "loadURL");
    try {
      const next = await f.mount(event.newTabKey!, event.newTabUrl!);
      expect(next.reserved.partition).toBe("persist:browser-local");
      expect(load).toHaveBeenLastCalledWith("http://localhost:26180/submit?token=secret",
        { postData: [{ type: "rawData", bytes: Buffer.from("q=1") }], extraHeaders: "Content-Type: application/x-www-form-urlencoded\n" });
      // Redeemed once: the same key opening again only gets what the renderer asks for.
      await f.ipc({ op: "close", tabKey: event.newTabKey! });
      await f.mount(event.newTabKey!, event.newTabUrl!);
      expect(load).toHaveBeenLastCalledWith("http://localhost:26180/submit", undefined);
    } finally { load.mockRestore(); }
  });
  it("downloads: the owner's click opens the save dialog, a page's own download is cancelled with one notice", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("side-one", "http://localhost:26180/");
    const download = (contents: unknown, name = "report.csv") => {
      const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn(), getFilename: () => name, getURL: () => "http://localhost:26180/report.csv", setSaveDialogOptions: vi.fn() };
      f.session.emit("will-download", event, item, contents);
      return { cancelled: event.preventDefault.mock.calls.length > 0 && item.cancel.mock.calls.length > 0, options: item.setSaveDialogOptions.mock.calls[0]?.[0] };
    };
    // The owner's own navigation (the mount) counts as a gesture for 10 s; move past it.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11_000);
    cleanup.push(() => clock.mockRestore());
    expect(download(guest).cancelled).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ kind: "blocked", blocked: "download" });
    const notices = f.events.filter(item => item.kind === "blocked").length;
    expect(download(guest).cancelled).toBe(true);
    expect(f.events.filter(item => item.kind === "blocked")).toHaveLength(notices); // one notice per 10 s
    expect(download(new ContentsMock(nextContentsId++, f.session)).cancelled).toBe(true);
    guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    const allowed = download(guest, "../..\\evil:name?.exe");
    expect(allowed.cancelled).toBe(false);
    expect(allowed.options).toEqual({ title: "Save download", defaultPath: expect.stringMatching(/memory-only-user-data[\\/]_.._evil_name_.exe$/) });
  });
  it("site permissions: the owner answers a native dialog; a ticked choice is remembered for that origin and can be forgotten", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("side-one", "http://localhost:26180/");
    const request = f.session.setPermissionRequestHandler.mock.calls.at(-1)![0] as (...args: any[]) => void;
    const check = f.session.setPermissionCheckHandler.mock.calls.at(-1)![0] as (...args: any[]) => boolean;
    const ask = async (permission: string, details: Record<string, unknown>) => {
      const callback = vi.fn(); request(guest, permission, callback, details);
      for (let i = 0; i < 50 && !callback.mock.calls.length; i++) await Promise.resolve();
      return callback.mock.calls[0]?.[0];
    };
    electron.messageBox.mockClear().mockResolvedValueOnce({ response: 0, checkboxChecked: true });
    expect(await ask("media", { mediaTypes: ["audio"], requestingUrl: "http://localhost:26180/" })).toBe(true);
    expect(electron.messageBox).toHaveBeenCalledOnce();
    expect(electron.messageBox.mock.calls[0]![1]).toMatchObject({ message: "http://localhost:26180 wants to use: microphone", buttons: ["Allow", "Block"], cancelId: 1 });
    expect(await ask("media", { mediaTypes: ["audio"] })).toBe(true);
    expect(electron.messageBox).toHaveBeenCalledOnce();
    expect(check(guest, "media", "http://localhost:26180", { mediaType: "audio" })).toBe(true);
    expect(await ask("media", { mediaTypes: ["audio"], requestingUrl: "http://localhost:26181/" })).toBe(false); // cross-origin frame
    expect(electron.messageBox).toHaveBeenCalledOnce();
    expect(await f.ipc({ op: "sitePermissions" })).toEqual([{ pool: "owner", origin: "http://localhost:26180", permission: "microphone", allow: true }]);
    expect(await f.ipc({ op: "sitePermissions", forget: "all" })).toEqual([]);
    expect(check(guest, "media", "http://localhost:26180", { mediaType: "audio" })).toBe(false);
    await expect(f.ipc({ op: "sitePermissions", forget: { pool: "root", origin: "x" } })).rejects.toThrow();
  });
  it("site permissions: a prompt the owner may not see is announced in the app; a hidden window denies with a notice (Windows E4)", async () => {
    const f = fixture(); await f.ipc({ op: "setEnabled", enabled: true });
    const { guest } = await f.mount("side-one", "http://localhost:26180/");
    const request = f.session.setPermissionRequestHandler.mock.calls.at(-1)![0] as (...args: any[]) => void;
    const ask = async (permission: string, details: Record<string, unknown>) => {
      const callback = vi.fn(); request(guest, permission, callback, details);
      for (let i = 0; i < 50 && !callback.mock.calls.length; i++) await Promise.resolve();
      return callback.mock.calls[0]?.[0];
    };
    const notices = () => f.events.filter(event => event.kind === "blocked").map(event => [event.blocked, event.sitePermission]);
    const shown = () => f.events.filter(event => event.kind === "changed" && event.tabKey === "side-one").map(event => event.sitePermission?.state ?? null);
    f.windowState.focused = false;
    let answer!: (value: { response: number; checkboxChecked: boolean }) => void;
    electron.messageBox.mockClear().mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const pending = ask("media", { mediaTypes: ["video"], requestingUrl: "http://localhost:26180/" });
    for (let i = 0; i < 50 && !answer; i++) await Promise.resolve();
    // While the dialog is open the tab says so; the owner is pointed at it when the window is not in front.
    expect(shown().at(-1)).toBe("waiting");
    expect(electron.messageBox.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
    expect(notices()).toEqual([["permission-waiting", { state: "waiting", origin: "http://localhost:26180", permissions: ["camera"] }]]);
    answer({ response: 1, checkboxChecked: false });
    expect(await pending).toBe(false);
    expect(shown().at(-1)).toBeNull();
    expect(f.windowState.flashFrame.mock.calls).toEqual([[true], [false]]);
    f.windowState.visible = false;
    expect(await ask("notifications", { requestingUrl: "http://localhost:26180/" })).toBe(false);
    expect(electron.messageBox).toHaveBeenCalledOnce();
    expect(notices().at(-1)).toEqual(["permission-hidden", { state: "hidden", origin: "http://localhost:26180", permissions: ["notifications"] }]);
    expect(shown().at(-1)).toBe("hidden");
    expect(await f.ipc({ op: "sitePermissions" })).toEqual([]);
  });
});
