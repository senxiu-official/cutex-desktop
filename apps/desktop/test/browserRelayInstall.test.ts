import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { HostManager } from "../src/main/hosts";
import type { BrowserRelayOptions, RelayExecutionContext } from "../src/main/browser/relay";
import type { RelayBinding, RelayCommand, RelayGrant, RelayLease } from "../src/main/browser/relayTypes";
import type { BrowserEvent, BrowserMountIdentity, BrowserTabMount, BrowserTabView } from "../src/shared/browser";
import { BROWSER_CHANNEL, BROWSER_OWNER_INPUT_KINDS, DEFAULT_BROWSER_CONTROL_SETTINGS } from "../src/shared/browser";
import { browserHostEvent, installBrowser, syncBrowserHosts } from "../src/main/browser/install";
import { InAppProvider } from "../src/main/browser/provider";
import type { ApprovalRecord } from "../src/shared/ipc";

// This suite exercises the installed owner IPC boundary and the real registry, lease
// coordinator, provider, network and visibility guards. Only Electron primitives,
// device/provenance persistence and the already independently tested relay transport
// are replaced. No Electron process, socket, daemon, model or filesystem writes.
interface RelayStub {
  options: BrowserRelayOptions;
  online: boolean;
  binding(): RelayBinding;
  start: Mock<() => Promise<void>>;
  dispose: Mock<() => void>;
  grantLease: Mock<(input: RelayGrant) => Promise<RelayLease>>;
  activateLease: Mock<(id: string) => Promise<RelayLease>>;
  revokeLease: Mock<(id: string) => Promise<void>>;
  noteOwnerActivity: Mock<() => void>;
}
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  sessions: new Map<string, unknown>(),
  appListeners: new Map<string, Set<(...args: any[]) => void>>(),
  relays: [] as RelayStub[],
  identity: undefined as string | undefined,
  identityOwnerRouting: false,
  storageWrites: [] as string[],
  storageArchives: [] as string[],
  storageFailure: false,
  device: vi.fn(() => "device-fixture"),
  // Background carriers (carrier.ts) as created by main; the real module is guard-tested in browserCarrier.test.ts.
  createCarrier: vi.fn(),
  carriers: [] as { options: any; guest: any; destroy: Mock }[],
  startProxy: vi.fn(),
}));
vi.mock("../src/main/browser/carrier", async importOriginal => ({ ...await importOriginal<typeof import("../src/main/browser/carrier")>(),
  createBrowserCarrier: (options: unknown) => mocks.createCarrier(options) }));
vi.mock("../src/main/browser/egressProxy", () => ({ startBrowserEgressProxy: mocks.startProxy }));
vi.mock("../src/main/browser/externalPages", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/main/browser/externalPages")>();
  // In-memory store (default on): tests never write a browser-external.json under the cwd.
  return { ...actual, BrowserExternalPagesStore: class extends actual.BrowserExternalPagesStore { constructor() { super(null); } } };
});
vi.mock("../src/main/browser/device", () => ({ loadBrowserDeviceId: mocks.device }));
vi.mock("../src/main/browser/tabIdentity", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/browser/tabIdentity")>();
  return { ...original,
    browserTabIdentityStorage: () => ({
      read: () => mocks.identity,
      write: (value: string) => { if(mocks.storageFailure) throw Error("disk"); mocks.identity = value; mocks.storageWrites.push(value); },
      reset: (value: string) => { if(mocks.storageFailure) throw Error("archive"); if (mocks.identity !== undefined) mocks.storageArchives.push(mocks.identity); mocks.identity = value; mocks.storageWrites.push(value); },
    }),
    // Optional routing override: classify canonical tabs as owner-intended without proof, the
    // identity state whose failing first proof must close the record ensured just before it.
    createBrowserTabIdentity: (storage: Parameters<typeof original.createBrowserTabIdentity>[0]) => {
      const real = original.createBrowserTabIdentity(storage);
      return mocks.identityOwnerRouting ? { ...real, unproven: () => false, agent: () => false, requiresProof: () => false } : real;
    } };
});
vi.mock("../src/main/browser/relay", () => ({ BrowserRelay: class {
  online = false;
  readonly grants = new Map<string, RelayLease>();
  constructor(readonly options: BrowserRelayOptions) { mocks.relays.push(this); }
  binding(): RelayBinding { return { deviceId: this.options.deviceId, hostId: this.options.hostId,
    providerId: "browser", executor: "inApp", connectionGeneration: "11111111-2222-4333-8444-555555555555" }; }
  start = vi.fn(async () => { this.online = true; });
  noteOwnerActivity = vi.fn(() => {});
  dispose = vi.fn(() => {
    if (!this.online) return;
    this.online = false;
    for (const lease of this.options.localLeases()) this.options.revokeLocal(lease.leaseId, "stale_connection");
    this.grants.clear();
  });
  grantLease = vi.fn(async (input: RelayGrant): Promise<RelayLease> => {
    const lease: RelayLease = { leaseId: `lease-${this.options.hostId}-${this.grantLease.mock.calls.length}`,
      cutexSessionId: input.cutexSessionId, target: { hostId: this.options.hostId, deviceId: input.deviceId, guestId: input.guestId },
      state: "pending", title: input.title, url: input.url, agentName: "Fixture agent",
      origin: input.source.kind === "agent-open" ? "agent" : "owner" };
    this.grants.set(lease.leaseId, lease); return lease;
  });
  activateLease = vi.fn(async (id: string): Promise<RelayLease> => {
    const lease = this.grants.get(id); if (!lease) throw Error("Unknown fixture lease");
    const active: RelayLease = { ...lease, state: "active" }; this.grants.set(id, active); return active;
  });
  revokeLease = vi.fn(async (id: string) => { this.grants.delete(id); });
} }));
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(), nativeImage: { createFromBuffer: vi.fn(() => { throw Error("No image expected in wiring test"); }) },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => Promise<any>) => mocks.handlers.set(name, fn),
    removeHandler: (name: string) => mocks.handlers.delete(name) },
  app: { isPackaged: false, getPath: () => "memory-only-user-data",
    on(name: string, fn: (...args: any[]) => void) { let set = mocks.appListeners.get(name); if (!set) mocks.appListeners.set(name, set = new Set()); set.add(fn); },
    removeListener(name: string, fn: (...args: any[]) => void) { mocks.appListeners.get(name)?.delete(fn); } },
  session: { fromPartition(name: string) { const session = mocks.sessions.get(name); if (!session) throw Error(`Unexpected test partition ${name}`); return session; } },
}));

class SessionMock extends EventEmitter {
  setProxy = vi.fn(async () => {});
  closeAllConnections = vi.fn(async () => {});
  setPermissionRequestHandler = vi.fn();
  setPermissionCheckHandler = vi.fn();
  setDevicePermissionHandler = vi.fn();
  setCertificateVerifyProc = vi.fn();
  headers?: (details: any, done: (value: unknown) => void) => void;
  webRequest = { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn((_filter: unknown, callback: SessionMock["headers"]) => { this.headers = callback; }) };
  response(guest: ContentsMock, url: string, statusCode: number, responseHeaders: Record<string, string[]>) {
    this.headers?.({ webContentsId: guest.id, resourceType: "mainFrame", url, statusCode, responseHeaders }, () => {});
  }
}
class DebuggerMock extends EventEmitter {
  attached = false;
  isAttached = () => this.attached;
  attach = vi.fn(() => { this.attached = true; });
  detach = vi.fn(() => { if (this.attached) { this.attached = false; this.emit("detach", {}, "detached"); } });
  sendCommand = vi.fn(async (_method: string, _params?: unknown): Promise<any> => ({}));
}
let nextContents = 1;
class ContentsMock extends EventEmitter {
  id = nextContents++;
  dead = false;
  url = "about:blank";
  mainFrame = {};
  hostWebContents?: ContentsMock;
  debugger = new DebuggerMock();
  loads: string[] = [];
  stop = vi.fn();
  reload = vi.fn();
  setWindowOpenHandler = vi.fn();
  setWebRTCIPHandlingPolicy = vi.fn();
  executeJavaScriptInIsolatedWorld = vi.fn(async (): Promise<any> => ({ width: 640, height: 360 }));
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, getAllEntries: () => [], getActiveIndex: () => 0, goToOffset: vi.fn() };
  constructor(readonly session: SessionMock) { super(); }
  isDestroyed() { return this.dead; }
  getType() { return "webview"; }
  getURL() { return this.url; }
  getTitle() { return "Fixture page"; }
  isLoading() { return false; }
  async loadURL(url: string) { this.loads.push(url); this.url = url; this.emit("did-navigate", {}, url); }
  close() { if (!this.dead) { this.dead = true; this.emit("destroyed"); } }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
const cleanups: (() => void)[] = [];
function fixture(hostIds = ["local"], relayCapability = true, kinds: Record<string, "local" | "ssh" | "dev-direct"> = {}) {
  const connections = new Map(hostIds.map((id, index) => {
    mocks.sessions.set(`persist:browser-${id}`, new SessionMock());
    mocks.sessions.set(`persist:browser-agent-${id}`, new SessionMock());
    const request = vi.fn(async (_method: string, _path: string, _options?: unknown): Promise<unknown> => { throw Error("Unexpected daemon HTTP: mocked relay transport must own these calls"); });
    const client = { endpoint: { baseUrl: `http://127.0.0.1:${26111 + index}` }, request };
    const connection = { routingEpoch: `epoch-${id}`, daemon: { generation: 1, currentState: { kind: "connected" }, activeClient: () => client,
      capabilities: vi.fn(async () => ({ featureList: relayCapability ? ["browser-relay-v1"] : [] })) } };
    return [id, connection] as const;
  }));
  const owner = new ContentsMock(new SessionMock()), events: BrowserEvent[] = [];
  const window = Object.assign(new EventEmitter(), { webContents: owner, isDestroyed: () => owner.dead, isVisible: vi.fn(() => true), isMinimized: () => false,
    isFullScreen: () => false, setFullScreen: vi.fn() });
  const hosts = { connection: (id: string) => connections.get(id), focus: () => hostIds[0]!,
    state: () => ({ hosts: [...connections.keys()].map(id => ({ id, kind: kinds[id] ?? (id === "local" ? "local" : "dev-direct") })) }) };
  // The application predicate is intentionally permissive: install must independently
  // require this exact WebContents and mainFrame, including cleanup/hold IPC.
  installBrowser(window as unknown as BrowserWindow, () => hosts as unknown as HostManager, () => true, (_name, event) => events.push(event));
  const ipc = (request: unknown, options: { hostId?: string; epoch?: string; sender?: ContentsMock; frame?: unknown } = {}): Promise<any> => {
    const hostId = options.hostId ?? hostIds[0]!;
    const handler = mocks.handlers.get(BROWSER_CHANNEL); if (!handler) throw Error("Missing installed channel");
    return handler({ sender: options.sender ?? owner, senderFrame: Object.hasOwn(options, "frame") ? options.frame : owner.mainFrame } as unknown as IpcMainInvokeEvent,
      request, { hostId, epoch: options.epoch ?? connections.get(hostId)?.routingEpoch ?? "" });
  };
  const list = (hostId = hostIds[0]!) => ipc({ op: "list" }, { hostId }) as Promise<BrowserTabView[]>;
  const attach = (mount: BrowserTabMount) => {
    const before = { sender: owner, preventDefault: vi.fn() }, params = { partition: mount.partition, src: mount.src };
    owner.emit("will-attach-webview", before, { partition: mount.partition }, params);
    expect(before.preventDefault).not.toHaveBeenCalled();
    const guest = new ContentsMock(mocks.sessions.get(mount.partition) as SessionMock); guest.hostWebContents = owner;
    for (const fn of mocks.appListeners.get("web-contents-created") ?? []) fn({}, guest);
    owner.emit("did-attach-webview", {}, guest); return guest;
  };
  const mount = async (tabKey = "owner-one", url = "http://localhost:26180/", hostId = hostIds[0]!, identity?: BrowserMountIdentity) => {
    const reserved = await ipc({ op: "open", tabKey, url, ...(identity ? { identity } : {}) }, { hostId }) as BrowserTabMount;
    const guest = attach(reserved);
    await ipc({ op: "open", tabKey, url, ...(identity ? { identity } : {}), receipt: { src: reserved.src, webContentsId: guest.id } }, { hostId });
    await flush(); return { reserved, guest };
  };
  const enable = async () => { await ipc({ op: "setEnabled", enabled: true }); await until(() => hostIds.every(id => mocks.relays.some(peer => peer.options.hostId === id && peer.online))); };
  const peer = (hostId = hostIds[0]!) => { const value = mocks.relays.findLast(p => p.options.hostId === hostId); if (!value) throw Error("Relay not started"); return value; };
  cleanups.push(() => owner.close());
  return { connections, owner, window, events, ipc, list, attach, mount, enable, peer };
}
function command(peer: RelayStub, operation: RelayCommand["operation"], overrides: Partial<RelayCommand> = {}): RelayCommand {
  return { version: 1, providerId: "browser", deviceId: peer.options.deviceId, connectionGeneration: peer.binding().connectionGeneration,
    kind: "command", requestId: "request-one", dispatchSeq: 1, remainingMs: 30_000, cutexSessionId: "session-one", turnId: "turn-one",
    target: { hostId: peer.options.hostId, deviceId: peer.options.deviceId, guestId: null }, title: "Fixture action", purpose: "agent", operation, ...overrides };
}
function context() {
  const controller = new AbortController(), deadline = Date.now() + 30_000;
  const value: RelayExecutionContext = { signal: controller.signal, deadline, remainingMs: () => Math.max(0, deadline - Date.now()) };
  return { controller, value };
}
async function pendingOwnerGrant(f: ReturnType<typeof fixture>, tabKey = "owner-one", hostId = "local") {
  const target = (await f.list(hostId)).find(item => item.tabKey === tabKey)!;
  const expected = { guestId: target.guestId, pageGeneration: target.pageGeneration };
  const grant = f.ipc({ op: "grantAgent", tabKey, sessionId: "session-one", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, expected }, { hostId });
  // Attach a rejection handler immediately; race tests deliberately revoke before awaiting.
  void grant.catch(() => {});
  await until(() => f.events.some(event => event.tabKey === tabKey && event.hostId === hostId && event.lease?.state === "pending"));
  const row = (await f.list(hostId)).find(item => item.tabKey === tabKey)!;
  return { grant, leaseId: row.lease!.leaseId, row };
}
async function pendingAgentOpen(f: ReturnType<typeof fixture>, url = "http://localhost:26180/new?token=private&view=one#private", hostId = "local") {
  const peer = f.peer(hostId), ctx = context(), request = command(peer, { kind: "tabs.open", url });
  const result = peer.options.execute(request, ctx.value); void result.catch(() => {});
  await until(() => f.events.some(event => event.kind === "agent-open" && event.openIntent?.requestId === request.requestId));
  const event = f.events.findLast(event => event.kind === "agent-open" && event.openIntent?.requestId === request.requestId)!;
  return { peer, ctx, request, result, event, intent: event.openIntent! };
}
beforeEach(() => {
  mocks.handlers.clear(); mocks.sessions.clear(); mocks.appListeners.clear(); mocks.relays.length = 0;
  mocks.carriers.length = 0;
  mocks.createCarrier.mockReset().mockImplementation((options: any) => {
    const guest = new ContentsMock(mocks.sessions.get(`persist:browser-agent-${options.hostId}`) as SessionMock);
    guest.getType = () => "window";
    const destroy = vi.fn(() => guest.close());
    options.guard(guest);
    mocks.carriers.push({ options, guest, destroy });
    return { guest, destroy };
  });
  mocks.startProxy.mockReset().mockImplementation(async () => ({ port: 26391, credentials: { username: "test-only", password: "not-a-real-credential", realm: "test-realm" },
    isPublicBrowserUrl: (url: string) => /^https:\/\/example\.test\//.test(url), close: vi.fn(async () => {}) }));
  mocks.identity = undefined; mocks.identityOwnerRouting = false; mocks.storageWrites.length = 0; mocks.storageArchives.length = 0; mocks.storageFailure=false; mocks.device.mockClear();
  // These relay tests pin the local-only tier (development override); N2 coverage is in browserInstall.
  vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "off");
});
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) dispose(); await flush(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function serviceModelFixture(kind: "local" | "ssh" | "dev-direct" = "local") {
  const f = fixture(["local"], true, { local: kind }), connection = f.connections.get("local")!, client = connection.daemon.activeClient();
  connection.daemon.capabilities.mockResolvedValue({ featureList: ["browser-relay-v1", "services-proxy", "services-lifetime"] });
  const tickets = new Map<string, string>(); let sequence = 0;
  const respond = async (method: string, path: string, options?: unknown): Promise<unknown> => {
    const slug = path.split("/")[3]!;
    if (path.endsWith("/view-ticket")) {
      const body = (options as { body: { path: string; start: boolean } }).body;
      const authPath = `/__cutex/auth?ticket=dummy-${++sequence}`;
      tickets.set(`http://${slug}.svc.localhost:26111${authPath}`, `http://${slug}.svc.localhost:26111${body.path}`);
      return { hostLabel: `${slug}.svc.localhost`, authPath };
    }
    if (method === "POST" && path.endsWith("/lease")) return { leaseId: `svc-${slug}` };
    return {};
  };
  client.request.mockImplementation(respond);
  // Remote browser bootstrap must not use a direct desktop-loopback document.
  await f.enable(); const { guest, reserved } = await f.mount("owner-one", kind === "ssh" ? "about:blank" : "http://localhost:26180/");
  const commit = (url: string) => { guest.url = tickets.get(url) ?? url; guest.emit("did-navigate", {}, guest.url); };
  vi.spyOn(guest, "loadURL").mockImplementation(async url => { guest.loads.push(url); commit(url); });
  guest.debugger.sendCommand.mockImplementation(async (method, params: any) => { if (method === "Page.navigate") commit(params.url); return {}; });
  const pending = await pendingOwnerGrant(f);
  await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
  const run = (url: string, ctx = context()) => ({ ctx, result: f.peer().options.execute(command(f.peer(), { kind: "tab.navigate", url },
    { leaseId: pending.leaseId, target: { hostId: "local", deviceId: f.peer().options.deviceId, guestId: reserved.guestId } }), ctx.value) });
  return { ...f, connection, client, guest, reserved, pending, run, respond };
}

describe("model service navigation uses guarded main bootstrap", () => {
  it.each(["local", "ssh", "dev-direct"] as const)("%s resolves a cutex:service wait URL to its live port without performing navigation", async kind => {
    const f = await serviceModelFixture(kind), alias="cutex:service/docs/encoded%252Fpart%3Fq%3Da%2526b";
    await f.run(alias).result;
    f.guest.debugger.sendCommand.mockClear(); f.client.request.mockClear();
    f.guest.debugger.sendCommand.mockImplementation(async method => method === "Page.getFrameTree"
      ? {frameTree:{frame:{id:"main",url:f.guest.url}}} : {});
    const result=await f.peer().options.execute(command(f.peer(), {kind:"tab.act",action:{kind:"wait",condition:{kind:"url",url:alias}}},
      {leaseId:f.pending.leaseId,target:{hostId:"local",deviceId:f.peer().options.deviceId,guestId:f.reserved.guestId}}),context().value);
    expect(result).toMatchObject({kind:"tab.act"});
    expect(f.guest.debugger.sendCommand.mock.calls.some(([method])=>method==="Page.getFrameTree")).toBe(true);
    expect(f.guest.debugger.sendCommand.mock.calls.some(([method])=>method==="Page.navigate" || method.startsWith("Input."))).toBe(false);
    expect(f.client.request).not.toHaveBeenCalled();
  });
  it.each(["http://docs.svc.localhost:26111/__cutex/auth", "http://docs.svc.localhost:26111/a/../%5f%5fcutex/auth",
    "cutex:service/docs/a/../%255f%255fcutex/auth", "cutex:service/docs/%252e%252e/__cutex/auth"])("agent open rejects normalized private service endpoint before allocating: %s", async url => {
    const f=fixture(); await f.enable(); const peer=f.peer();
    await expect(peer.options.execute(command(peer,{kind:"tabs.open",url}),context().value)).rejects.toMatchObject({code:"permission_denied"});
    expect(await f.list()).toEqual([]); expect(mocks.storageWrites).toEqual([]); expect(peer.grantLease).not.toHaveBeenCalled();
    expect(f.events.some(event=>event.kind==="agent-open")).toBe(false);
  });
  it.each(["local", "ssh", "dev-direct"] as const)("%s resolves cutex:service navigate through its current connection port without double decoding", async kind => {
    const f = await serviceModelFixture(kind);
    const result = await f.run("cutex:service/docs/encoded%252Fpart%3Fq%3Da%2526b").result;
    expect(result).toMatchObject({ kind: "tab.navigate", url: "http://docs.svc.localhost:26111/encoded%2Fpart?q=a%26b" });
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/encoded%2Fpart?q=a%26b", start: true, routing: "host" } });
    expect(JSON.stringify(result)).not.toMatch(/__cutex|ticket|dummy/);
  });
  it("an intermediate private auth navigation never becomes the public URL or service retry path", async () => {
    const f = await serviceModelFixture();
    f.guest.debugger.sendCommand.mockImplementation(async (method, params: any) => {
      if (method === "Page.navigate") { f.guest.url = params.url; f.guest.emit("did-navigate", {}, params.url); }
      return {};
    });
    const result = await f.run("http://docs.svc.localhost:26111/next?q=one").result;
    expect(f.guest.url).toContain("/__cutex/auth?ticket=dummy-");
    expect(result).toMatchObject({ url: "http://docs.svc.localhost:26111/next?q=one" });
    expect(JSON.stringify(await f.list())).not.toMatch(/__cutex|ticket|dummy-/);
    const publicUrl = "http://docs.svc.localhost:26111/next?q=one";
    f.guest.session.response(f.guest, publicUrl, 401, { "X-Cutex-Service-Auth": ["ticket-required"] }); await flush();
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/next?q=one", start: false, routing: "host" } });
  });
  it("starts a stopped/new service before navigating, keeps auth URL private, and transfers renewal on a new slug", async () => {
    const f = await serviceModelFixture();
    f.client.request.mockImplementation(async (method, path, options) => {
      if (path.endsWith("/view-ticket") && !(options as { body: { start: boolean } }).body.start) throw Error("stopped service requires explicit start");
      return f.respond(method, path, options);
    });
    const result = await f.run("http://docs.svc.localhost:26111/first").result;
    expect(result).toMatchObject({ kind: "tab.navigate", url: "http://docs.svc.localhost:26111/first" });
    expect(JSON.stringify(result)).not.toContain("ticket");
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/lease", { body: { holder: "desktop-browser" } });
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/first", start: true, routing: "host" } });
    const nav = f.guest.debugger.sendCommand.mock.calls.find(([method]) => method === "Page.navigate")!;
    expect(nav[1]).toEqual({ url: "http://docs.svc.localhost:26111/__cutex/auth?ticket=dummy-1" });
    expect(f.owner.executeJavaScriptInIsolatedWorld).toHaveBeenCalled();
    await f.run("http://reports.svc.localhost:26111/next").result;
    expect(f.client.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/svc-docs");
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/reports/lease", { body: { holder: "desktop-browser" } });
  });
  it("each explicit model navigation resets both bounded authentication retry counters", async () => {
    const f = await serviceModelFixture();
    for (const path of ["/first", "/second"]) {
      const url = `http://docs.svc.localhost:26111${path}`;
      await f.run(url).result;
      f.guest.session.response(f.guest, url, 401, { "X-Cutex-Service-Auth": ["ticket-required"] }); await flush();
      expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path, start: false, routing: "host" } });
      const count = f.client.request.mock.calls.filter(([, route]) => route.endsWith("/view-ticket")).length;
      f.guest.session.response(f.guest, url, 401, { "X-Cutex-Service-Auth": ["ticket-required"] }); await flush();
      expect(f.client.request.mock.calls.filter(([, route]) => route.endsWith("/view-ticket"))).toHaveLength(count);
    }
    expect(f.client.request.mock.calls.filter(([, route]) => route.endsWith("/view-ticket"))).toHaveLength(4);
  });
  it("service renewal outlives the completed tool deadline without retaining tool authority", async () => {
    vi.useFakeTimers(); const f = await serviceModelFixture(); await f.run("http://docs.svc.localhost:26111/").result;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/lease/svc-docs");
    expect(f.client.request).not.toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/svc-docs");
  });
  it.each(["cancel", "epoch"])("a late bootstrap after %s cannot dispatch a ticket or reacquire control", async mode => {
    const f = await serviceModelFixture(), reply = deferred<unknown>();
    f.client.request.mockImplementation(async (method, path, options) => path.endsWith("/view-ticket") ? reply.promise : f.respond(method, path, options));
    const run = f.run("http://docs.svc.localhost:26111/"); const rejected = expect(run.result).rejects.toBeDefined();
    await until(() => f.client.request.mock.calls.some(([, path]) => path.endsWith("/view-ticket")));
    if (mode === "cancel") run.ctx.controller.abort();
    else { f.connection.routingEpoch = "replacement-epoch"; syncBrowserHosts(); }
    reply.resolve({ hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=dummy-late" }); await rejected; await flush();
    expect(f.guest.debugger.sendCommand.mock.calls.some(([method]) => method === "Page.navigate")).toBe(false);
    expect(f.client.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/svc-docs");
  });
  it("recovers host capabilities but requires a fresh owner grant before any service command", async () => {
    const f = await serviceModelFixture();
    f.connection.daemon.currentState.kind = "unreachable"; syncBrowserHosts(); await flush();
    f.connection.daemon.currentState.kind = "connected"; syncBrowserHosts(); await until(() => f.peer().online);
    await expect(f.run("http://docs.svc.localhost:26111/").result).rejects.toMatchObject({ code: "lease_revoked" });
    expect(f.client.request).not.toHaveBeenCalled();
    const pending = await pendingOwnerGrant(f);
    await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
    const peer = f.peer();
    await peer.options.execute(command(peer, { kind: "tab.navigate", url: "http://docs.svc.localhost:26111/recovered" },
      { leaseId: pending.leaseId, target: { hostId: "local", deviceId: peer.options.deviceId, guestId: f.reserved.guestId } }), context().value);
    expect(f.connection.daemon.capabilities.mock.calls.length).toBeGreaterThan(1);
    expect(f.client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/recovered", start: true, routing: "host" } });
  });
});

describe("installed I3 per-host relay lifetime", () => {
  it("stays absent while disabled and creates one relay per actual HostConnection/client", async () => {
    const f = fixture(["local", "dev-b"]); syncBrowserHosts(); await flush(); expect(mocks.relays).toHaveLength(0);
    await f.enable(); expect(mocks.relays).toHaveLength(2); expect(mocks.device).toHaveBeenCalledOnce();
    for (const id of ["local", "dev-b"]) expect(f.peer(id).options.client).toBe(f.connections.get(id)!.daemon.activeClient());
    expect(f.peer("local").options.client).not.toBe(f.peer("dev-b").options.client);
    syncBrowserHosts(); syncBrowserHosts(); await flush(); expect(mocks.relays).toHaveLength(2);
    await f.ipc({ op: "setEnabled", enabled: false });
    for (const peer of mocks.relays) { expect(peer.dispose).toHaveBeenCalledOnce(); expect(peer.online).toBe(false); }
    await expect(f.ipc({ op: "list" })).rejects.toThrow("module_disabled");
  });
  it("missing capability never constructs a relay or writes device storage", async () => {
    const f = fixture(["local"], false); await f.ipc({ op: "setEnabled", enabled: true }); await flush();
    expect(mocks.relays).toHaveLength(0); expect(mocks.device).not.toHaveBeenCalled();
  });
  it.each(["epoch", "generation", "disconnect", "remove"])("%s retires only the affected host relay and its authority", async change => {
    const f = fixture(["local", "dev-b"]); await f.enable();
    const first = await f.mount(), second = await f.mount("other", "http://localhost:26181/", "dev-b");
    const pending = await pendingOwnerGrant(f);
    await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
    const old = f.peer(), unaffected = f.peer("dev-b"), conn = f.connections.get("local")!;
    if (change === "epoch") conn.routingEpoch = "epoch-replaced";
    if (change === "generation") conn.daemon.generation++;
    if (change === "disconnect") conn.daemon.currentState.kind = "unreachable";
    if (change === "remove") f.connections.delete("local");
    syncBrowserHosts(); await flush();
    expect(old.dispose).toHaveBeenCalledOnce(); expect(old.options.localLeases()).toEqual([]);
    expect(f.events.filter(event => event.guestId === first.reserved.guestId).at(-1)?.control).toBeUndefined();
    expect(first.guest.debugger.isAttached()).toBe(false);
    expect(unaffected.dispose).not.toHaveBeenCalled(); expect(second.guest.dead).toBe(false);
    // Health loss revokes authority but preserves the owner's DOM; identity loss closes it.
    expect(first.guest.dead).toBe(change !== "disconnect");
  });
});

describe("installed I3 owner two-phase grants and IPC identity", () => {
  it("main rejects a consented old document before contacting the lease peer", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(); const row = (await f.list())[0]!;
    guest.emit("did-navigate", {}, guest.getURL());
    await expect(f.ipc({ op: "grantAgent", tabKey: row.tabKey, sessionId: "session-one", settings: DEFAULT_BROWSER_CONTROL_SETTINGS,
      expected: { guestId: row.guestId, pageGeneration: row.pageGeneration } })).rejects.toMatchObject({ code: "stale_request" });
    expect(f.peer().grantLease).not.toHaveBeenCalled();
  });
  it("main detects same-URL reload while the pending grant waits for a hold", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(); const pending = await pendingOwnerGrant(f);
    guest.emit("did-start-navigation", {}, guest.getURL(), false, true);
    await expect(f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true })).rejects.toMatchObject({ code: "stale_connection" });
    // The owner's grant call learns why it ended, not a bare revocation.
    await expect(pending.grant).rejects.toMatchObject({ code: "stale_connection" });
    expect(f.peer().activateLease).not.toHaveBeenCalled(); expect(guest.debugger.attach).not.toHaveBeenCalled();
  });
  it.each(BROWSER_OWNER_INPUT_KINDS)("0.1.3 co-control: owner %s (capture IPC, guest mouse / keyboard) never pauses the grant", async kind => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), pending = await pendingOwnerGrant(f);
    await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
    const input = { op: "ownerInput", tabKey: "owner-one", kind };
    for (const source of [{ frame: {} }, { frame: null }, { sender: guest }])
      await expect(f.ipc(input, source)).rejects.toThrow("untrusted_sender");
    await f.ipc(input, { epoch: "old" }); await flush();
    for (const type of ["mouseDown", "mouseUp", "mouseMove", "mouseWheel"]) guest.emit("before-mouse-event", {}, { type });
    guest.emit("before-input-event", {}, { type: "keyDown" });
    expect((await f.list())[0]?.control?.state).toBe("granted");
    expect(f.peer().revokeLease).not.toHaveBeenCalled();
  });

  it("0.1.3: explicit pause keeps the lease; one-click resume continues the same lease; revoke is separate", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), pending = await pendingOwnerGrant(f);
    await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
    await f.ipc({ op: "pauseLease", tabKey: "owner-one", leaseId: "someone-else" });
    expect((await f.list())[0]?.control?.state).toBe("granted");
    await f.ipc({ op: "pauseLease", tabKey: "owner-one", leaseId: pending.leaseId }); await flush();
    const paused = (await f.list())[0]!;
    expect(paused.control?.state).toBe("paused"); expect(paused.lease?.leaseId).toBe(pending.leaseId);
    expect(guest.debugger.isAttached()).toBe(false); expect(f.peer().revokeLease).not.toHaveBeenCalled();
    await f.ipc({ op: "resumeLease", tabKey: "owner-one", leaseId: pending.leaseId, settings: DEFAULT_BROWSER_CONTROL_SETTINGS });
    const resumed = (await f.list())[0]!;
    expect(resumed.control?.state).toBe("granted"); expect(resumed.lease?.leaseId).toBe(pending.leaseId);
    expect(f.peer().activateLease).toHaveBeenCalledOnce();
    await f.ipc({ op: "pauseLease", tabKey: "missing", leaseId: pending.leaseId }); // idempotent no-op
  });
  it("requires pending lease then exact holdReady before provider preparation and activation", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), pending = await pendingOwnerGrant(f), peer = f.peer();
    expect(pending.row.pool).toBe("owner"); expect(pending.row.lease?.state).toBe("pending");
    expect(guest.debugger.attach).not.toHaveBeenCalled(); expect(peer.activateLease).not.toHaveBeenCalled();
    expect(f.owner.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    expect(peer.grantLease).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: "owner" }, cutexSessionId: "session-one", guestId: pending.row.guestId }));
    const activation = deferred<RelayLease>(); peer.activateLease.mockReturnValueOnce(activation.promise);
    const held = f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true });
    await until(() => peer.activateLease.mock.calls.length === 1);
    expect(guest.debugger.attach).toHaveBeenCalledOnce(); expect(f.owner.executeJavaScriptInIsolatedWorld).toHaveBeenCalled();
    expect(peer.options.localLeases()[0]?.state).toBe("active"); // Relay may receive commands; execution still awaits HTTP confirmation.
    expect((await f.list())[0]?.lease?.state).toBe("pending"); // UI waits for confirmation.
    activation.resolve({ ...peer.options.localLeases()[0]!, state: "active" }); await held; await pending.grant;
    expect((await f.list())[0]?.lease?.state).toBe("active");
    await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true });
    expect(peer.activateLease).toHaveBeenCalledOnce(); expect(guest.debugger.attach).toHaveBeenCalledOnce();
  });
  it("rejects wrong frames, guest senders, forged leases and cross-host readiness without activating", async () => {
    const f = fixture(["local", "dev-b"]); await f.enable(); const { guest } = await f.mount();
    await f.mount("owner-one", "http://localhost:26181/", "dev-b"); const pending = await pendingOwnerGrant(f);
    const hold = { op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true };
    for (const source of [{ frame: {} }, { frame: null }, { sender: guest }]) {
      await expect(f.ipc({ op: "grantAgent", tabKey: "owner-one", sessionId: "session-two", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, expected: { guestId: pending.row.guestId, pageGeneration: pending.row.pageGeneration } }, source)).rejects.toThrow("untrusted_sender");
      await expect(f.ipc(hold, source)).rejects.toThrow("untrusted_sender");
      await expect(f.ipc({ op: "releaseLease", tabKey: "owner-one", leaseId: pending.leaseId }, source)).rejects.toThrow("untrusted_sender");
    }
    await expect(f.ipc({ ...hold, leaseId: "forged" })).rejects.toMatchObject({ code: "lease_revoked" });
    await expect(f.ipc(hold, { hostId: "dev-b" })).rejects.toMatchObject({ code: "lease_revoked" });
    await expect(f.ipc(hold, { epoch: "stale" })).rejects.toThrow("host binding");
    await f.ipc({ op: "releaseLease", tabKey: "owner-one", leaseId: "forged" });
    expect((await f.list())[0]?.lease?.state).toBe("pending"); expect(f.peer().activateLease).not.toHaveBeenCalled();
    expect(guest.debugger.attach).not.toHaveBeenCalled();
    await f.ipc({ ...hold, held: false }, { epoch: "stale" }); await expect(pending.grant).rejects.toMatchObject({ code: "lease_limit" });
    expect(f.peer().options.localLeases()).toEqual([]);
  });
  it.each([false, true])("waits for activation before executing a racing command; aborted=%s", async aborted => {
    const f = fixture(); await f.enable(); const { reserved } = await f.mount(), pending = await pendingOwnerGrant(f), peer = f.peer();
    const activation = deferred<RelayLease>(); peer.activateLease.mockReturnValueOnce(activation.promise);
    const held = f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true });
    await until(() => peer.activateLease.mock.calls.length === 1);
    const ctx = context(), request = command(peer, { kind: "tab.release" }, { leaseId: pending.leaseId,
      target: { hostId: "local", deviceId: peer.options.deviceId, guestId: reserved.guestId } });
    const execution = peer.options.execute(request, ctx.value); void execution.catch(() => {});
    await flush();
    expect(peer.revokeLease).not.toHaveBeenCalled();
    expect((await f.list())[0]?.lease?.state).toBe("pending");
    if (aborted) ctx.controller.abort();
    activation.resolve({ ...peer.options.localLeases()[0]!, state: "active" });
    await held; await pending.grant;
    if (aborted) {
      await expect(execution).rejects.toMatchObject({ code: "cancelled" });
      expect((await f.list())[0]?.lease?.state).toBe("active");
      expect(peer.revokeLease).not.toHaveBeenCalled();
    } else {
      await expect(execution).resolves.toEqual({ kind: "tab.release" });
      expect((await f.list())[0]?.lease).toBeUndefined();
      expect(peer.revokeLease).toHaveBeenCalledOnce();
    }
  });
  it("forged renderer pool and lease authority are rejected before relay calls", async () => {
    const f = fixture(); await f.enable(); await f.mount();
    await expect(f.ipc({ op: "grantAgent", tabKey: "owner-one", sessionId: "session-one", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, leaseId: "forged" })).rejects.toThrow("invalid_browser_request");
    await expect(f.ipc({ op: "open", tabKey: "new-owner", url: "http://localhost/", identity: { agentOpened: true } })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(f.ipc({ op: "open", tabKey: "new-owner", url: "http://localhost/", identity: { pendingOpen: "forged" } })).rejects.toMatchObject({ code: "stale_request" });
    expect(f.peer().grantLease).not.toHaveBeenCalled(); expect(mocks.storageWrites).toEqual([]);
  });
  it("late activation cannot resurrect a released lease or attached debugger", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), pending = await pendingOwnerGrant(f), peer = f.peer();
    const activation = deferred<RelayLease>(); peer.activateLease.mockReturnValueOnce(activation.promise);
    const held = f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); void held.catch(() => {});
    await until(() => peer.activateLease.mock.calls.length === 1); const active = peer.options.localLeases()[0]!;
    await f.ipc({ op: "releaseLease", tabKey: "owner-one", leaseId: pending.leaseId });
    await expect(pending.grant).rejects.toMatchObject({ code: "lease_revoked" });
    activation.resolve(active); await expect(held).rejects.toMatchObject({ code: "lease_revoked" }); await flush();
    expect(peer.options.localLeases()).toEqual([]); expect((await f.list())[0]?.lease).toBeUndefined();
    expect((await f.list()).find((row: any) => row.guestId === pending.row.guestId)?.control).toBeUndefined(); expect(guest.debugger.isAttached()).toBe(false);
  });
  it("a grant to a tab the owner cannot see ends with target_hidden, not a bare revocation (Windows E5)", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), pending = await pendingOwnerGrant(f), peer = f.peer();
    f.window.isVisible.mockReturnValue(false); // e.g. a Windows window fully covered by another app (Chromium occlusion)
    await expect(f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true })).rejects.toMatchObject({ code: "target_hidden" });
    await expect(pending.grant).rejects.toMatchObject({ code: "target_hidden" }); await flush();
    expect(peer.activateLease).not.toHaveBeenCalled(); expect(peer.revokeLease).toHaveBeenCalledWith(pending.leaseId);
    expect((await f.list())[0]?.lease).toBeUndefined(); expect(guest.debugger.isAttached()).toBe(false);
  });
  it("activation refusal cleans provider and local lease without retrying grant or activation", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), pending = await pendingOwnerGrant(f), peer = f.peer();
    peer.activateLease.mockRejectedValueOnce(Object.assign(Error("approval_denied"), { code: "approval_denied" }));
    await expect(f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true })).rejects.toMatchObject({ code: "approval_denied" });
    await expect(pending.grant).rejects.toMatchObject({ code: "approval_denied" }); await flush();
    expect(peer.grantLease).toHaveBeenCalledOnce(); expect(peer.activateLease).toHaveBeenCalledOnce(); expect(peer.revokeLease).toHaveBeenCalledWith(pending.leaseId);
    expect((await f.list())[0]?.control).toBeUndefined(); expect(guest.debugger.isAttached()).toBe(false);
  });
});

describe("installed I3 held background agent-open", () => {
  it.each(["local", "ssh", "dev-direct"] as const)("%s opens a main-resolved service alias and never sends its private bootstrap URL to the relay", async kind => {
    const f = fixture(["local"], true, { local: kind }), conn = f.connections.get("local")!;
    conn.daemon.capabilities.mockResolvedValue({ featureList: ["browser-relay-v1", "services-proxy", "services-lifetime"] });
    const client = conn.daemon.activeClient();
    client.request.mockImplementation(async (method, path) => path.endsWith("/view-ticket")
      ? { hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=private-bootstrap" }
      : method === "POST" && path.endsWith("/lease") ? { leaseId: "service-lease" } : {});
    await f.enable();
    const open = await pendingAgentOpen(f, "cutex:service/docs/encoded%252Fpart%3Fq%3Da%2526b");
    const { guest } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1);
    const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true });
    const result = await open.result;
    expect(result).toMatchObject({ kind: "tabs.open", tab: { url: "http://docs.svc.localhost:26111/encoded%2Fpart?q=a%26b" } });
    expect(client.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/encoded%2Fpart?q=a%26b", start: true, routing: "host" } });
    expect(guest.loads).toEqual(["http://docs.svc.localhost:26111/__cutex/auth?ticket=private-bootstrap"]);
    expect(JSON.stringify([result, f.events, open.peer.grantLease.mock.calls])).not.toMatch(/__cutex|ticket|private-bootstrap/);
    expect(guest.debugger.attach).not.toHaveBeenCalled();
  });
  it.each([["https://example.com/", "external_pages_off"], ["http://100.64.0.27:8765/", "private_address_blocked"], ["http://nas.local/", "private_address_blocked"], ["http://docs.svc.localhost/first", "service_proxy_required"],
    ["cutex:service/docs/first", "service_proxy_required"]])("pre-dispatch refusal of %s is immediate and allocates no card/provenance", async (url, code) => {
    // A host without browser-refusal-reasons gets the established external_pages_unavailable.
    const legacy = code === "external_pages_off" || code === "private_address_blocked" ? "external_pages_unavailable" : code;
    const f = fixture(); await f.enable(); const peer = f.peer();
    await expect(peer.options.execute(command(peer, { kind: "tabs.open", url }), context().value)).rejects.toMatchObject({ code: legacy });
    expect(f.events.some(event => event.kind === "agent-open")).toBe(false); expect(await f.list()).toEqual([]);
    expect(mocks.storageWrites).toEqual([]); expect(peer.grantLease).not.toHaveBeenCalled();
  });
  it.each([["https://example.com/", "external_pages_off"], ["http://nas.local/", "private_address_blocked"]])("a host advertising browser-refusal-reasons receives the precise refusal for %s", async (url, code) => {
    const f = fixture(), conn = f.connections.get("local")!;
    conn.daemon.capabilities.mockResolvedValue({ featureList: ["browser-relay-v1", "browser-refusal-reasons"] });
    await f.enable(); const peer = f.peer();
    await expect(peer.options.execute(command(peer, { kind: "tabs.open", url }), context().value)).rejects.toMatchObject({ code });
  });
  it("a forged receipt from the main frame rejects the pending open immediately and rolls back only its unconfirmed provenance", async () => {
    const original = JSON.stringify([["local", "12345678-1234-4234-8234-123456789abc"]]); mocks.identity = original;
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    const identity = { pendingOpen: open.intent.requestId, agentOpened: true as const };
    const reserved = await f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity }); const guest = f.attach(reserved);
    await expect(f.ipc({ op: "open", tabKey: open.intent.tabKey, url: "http://localhost:26180/forged", identity,
      receipt: { src: reserved.src, webContentsId: guest.id } })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(open.result).rejects.toMatchObject({ code: "invalid_request" });
    expect(await f.list()).toEqual([]); expect(mocks.identity).toBe(original); expect(guest.loads).toEqual([]);
    expect(open.peer.grantLease).not.toHaveBeenCalled();
  });
  it("a failed guest navigation reports navigation_failed, destroys the pending card and does not wait for its deadline", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    const identity = { pendingOpen: open.intent.requestId, agentOpened: true as const };
    const reserved = await f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity }); const guest = f.attach(reserved);
    vi.spyOn(guest, "loadURL").mockRejectedValueOnce(Error("private native navigation failure"));
    await f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity, receipt: { src: reserved.src, webContentsId: guest.id } });
    await expect(open.result).rejects.toMatchObject({ code: "navigation_failed" });
    expect(guest.dead).toBe(true); expect(await f.list()).toEqual([]); expect(mocks.identity).toBe("[]");
    expect(JSON.stringify(f.events)).not.toContain("private native");
  });
  // 2026-10-15 (Windows audit, agent on an SSH host): an agent opened cutex:service/<slug> after its
  // ephemeral service had been reclaimed. The daemon's 404 service_not_found is not a relay code, so
  // it became browser_unavailable and the relay reported the write as outcome_unknown, while the card
  // flashed and was discarded. A daemon refusal about the service is a definite service_unavailable.
  it.each(["service_not_found", "service_reclaimed", "service_start_failed"])("a %s from the daemon fails the open as service_unavailable, not an uncertain outcome", async daemonCode => {
    const f = fixture(["local", "ssh-a"], true, { "ssh-a": "ssh" }), connection = f.connections.get("ssh-a")!;
    connection.daemon.capabilities.mockResolvedValue({ featureList: ["browser-relay-v1", "services-proxy", "services-lifetime"] });
    connection.daemon.activeClient().request.mockImplementation(async () => { throw Object.assign(Error("private daemon detail"), { code: daemonCode }); });
    await f.enable(); const open = await pendingAgentOpen(f, "cutex:service/ccusage-flow/", "ssh-a");
    const identity = { pendingOpen: open.intent.requestId, agentOpened: true as const };
    const reserved = await f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity }, { hostId: "ssh-a" }); const guest = f.attach(reserved);
    await f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity, receipt: { src: reserved.src, webContentsId: guest.id } }, { hostId: "ssh-a" });
    await expect(open.result).rejects.toMatchObject({ code: "service_unavailable" });
    expect(open.peer.grantLease).not.toHaveBeenCalled(); expect(await f.list("ssh-a")).toEqual([]);
    expect(f.events.some(event => event.kind === "agent-open-cancel" && event.openRequestId === open.intent.requestId)).toBe(true);
    expect(JSON.stringify(f.events)).not.toContain("private daemon");
  });
  it("main deadline also cancels a post-mount grant before its own longer hold timeout", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.enable(); const peer = f.peer(), ctx = context();
    ctx.value.remainingMs = () => 1000;
    const result = peer.options.execute(command(peer, { kind: "tabs.open", url: "http://localhost:26180/" }), ctx.value); void result.catch(() => {});
    await until(() => f.events.some(event => event.kind === "agent-open")); const intent = f.events.find(event => event.openIntent)!.openIntent!;
    const { guest } = await f.mount(intent.tabKey, intent.url, "local", { pendingOpen: intent.requestId, agentOpened: true });
    await until(() => peer.options.localLeases().length === 1);
    await vi.advanceTimersByTimeAsync(1000); await expect(result).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(await f.list()).toEqual([]); expect(guest.dead).toBe(true); expect(peer.activateLease).not.toHaveBeenCalled();
    expect(mocks.identity).toBe("[]");
  });
  it("a lost renderer confirmation followed by fallback discard closes the confirmed main record too", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    const { guest } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1); const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true }); await open.result;
    await f.ipc({ op: "openRefused", requestId: open.intent.requestId, code: "stale_connection" });
    expect(await f.list()).toEqual([]); expect(guest.dead).toBe(true); expect(open.peer.options.localLeases()).toEqual([]);
    expect(JSON.parse(mocks.identity!)).toEqual([["local", open.intent.tabKey]]); // Confirmed provenance is retained.
  });
  it("corrupt provenance keeps its original bytes and recovers unknown owner cards only in the isolated pool", async () => {
    mocks.identity = "{broken-original"; const f = fixture(); await f.enable();
    const { reserved, guest } = await f.mount();
    expect(reserved).toMatchObject({ pool: "agent", partition: "persist:browser-agent-local", recovery: "browser_identity_recovered" });
    expect(guest.dead).toBe(false); expect((await f.list())[0]?.pool).toBe("agent");
    expect(mocks.identity).toBe("{broken-original"); expect(mocks.storageWrites).toEqual([]);
  });
  it("new main-reserved owner tabs stay owner when degraded; reset/restart cannot promote an old unproven tab", async () => {
    mocks.identity="{broken-original"; const f=fixture(); await f.enable();
    const old="00000000-0000-4000-8000-000000000001", unknown="00000000-0000-4000-8000-000000000002";
    const recovered=await f.mount(old); expect(recovered.reserved.pool).toBe("agent");
    const fresh=await f.ipc({op:"reserveOwnerTab"}); expect(fresh).toEqual({tabKey:expect.stringMatching(/^[0-9a-f-]{36}$/)}); expect(fresh.tabKey).not.toBe(old);
    const owner=await f.mount(fresh.tabKey); expect(owner.reserved).toMatchObject({pool:"owner",partition:"persist:browser-local"});
    expect(owner.reserved.recovery).toBeUndefined(); expect(mocks.identity).toBe("{broken-original");
    await expect(f.ipc({op:"resetOrigins"},{frame:{}})).rejects.toThrow("untrusted_sender"); expect(mocks.storageArchives).toEqual([]);
    await f.ipc({op:"resetOrigins"}); expect(mocks.storageArchives).toEqual(["{broken-original"]);
    expect(recovered.guest.dead).toBe(false); expect(owner.guest.dead).toBe(false); // no repartition/reload
    f.owner.close(); const restarted=fixture(); await restarted.enable();
    expect((await restarted.mount(old)).reserved.pool).toBe("agent");
    expect((await restarted.mount(fresh.tabKey)).reserved.pool).toBe("owner");
    expect((await restarted.mount(unknown)).reserved).toMatchObject({pool:"agent",recovery:"browser_identity_recovered"});
    await expect(restarted.ipc({op:"reserveOwnerTab",tabKey:old})).rejects.toThrow("invalid_browser_request");
  });
  it("a full strict owner store admits new tabs and isolates the evicted restored tab", async () => {
    const rows = Array.from({ length: 4096 }, (_, n) => ["local", `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`]);
    mocks.identity = JSON.stringify({ version: 2, strict: true, agent: [], owner: rows });
    const f = fixture(); await f.enable();
    expect((await f.mount(rows[0]![1]!)).reserved.pool).toBe("owner");
    const fresh = await f.ipc({ op: "reserveOwnerTab" });
    expect((await f.mount(fresh.tabKey)).reserved.pool).toBe("owner");
    expect(JSON.parse(mocks.identity!).owner).toHaveLength(4096);
    f.owner.close(); const restarted = fixture(); await restarted.enable();
    expect((await restarted.mount(rows[1]![1]!)).reserved).toMatchObject({ pool: "agent", recovery: "browser_identity_recovered" });
    expect((await restarted.mount(rows[0]![1]!)).reserved.pool).toBe("owner");
  });
  it("renderer crash retires reserved owner rows before re-enabling", async () => {
    const f = fixture(); await f.enable();
    await f.ipc({ op: "reserveOwnerTab" });
    expect(await f.list()).toHaveLength(1);
    f.owner.emit("render-process-gone", {}, { reason: "crashed" });
    await f.enable(); expect(await f.list()).toEqual([]);
    await f.ipc({ op: "reserveOwnerTab" }); expect(await f.list()).toHaveLength(1);
  });
  it("failed provenance writes do not publish a fresh owner record; reset failure leaves the original and isolation intact", async () => {
    mocks.identity=JSON.stringify({version:2,strict:true,agent:[],owner:[]});
    const f=fixture(); await f.enable(); mocks.storageFailure=true;
    await expect(f.ipc({op:"reserveOwnerTab"})).rejects.toMatchObject({code:"browser_identity_unavailable"});
    expect(await f.list()).toEqual([]); expect(mocks.storageWrites).toEqual([]);
    f.owner.close(); mocks.identity="broken"; const next=fixture();await next.enable();
    await expect(next.ipc({op:"resetOrigins"})).rejects.toMatchObject({code:"browser_identity_unavailable"});
    expect(mocks.identity).toBe("broken"); expect(mocks.storageArchives).toEqual([]);
    expect((await next.mount()).reserved.pool).toBe("agent");
  });
  it("ignores a proven owner's LRU refresh write failure", async () => {
    const proven = "12345678-1234-4234-8234-123456789abc";
    mocks.identity = JSON.stringify({ version: 2, strict: true, agent: [], owner: [["local", proven], ["local", "12345678-1234-4234-8234-123456789abd"]] });
    const f = fixture(); await f.enable(); mocks.storageFailure = true;
    await expect(f.ipc({ op: "open", tabKey: proven, url: "http://localhost/" })).resolves.toMatchObject({ tabKey: proven, pool: "owner" });
    expect(await f.list()).toHaveLength(1);
  });
  it("closes the record ensured just before a failing first owner proof", async () => {
    // Strict routing sends an unproven canonical tab to the agent recovery pool before
    // registerOwner, so the first-proof failure path needs identity routing that treats the tab
    // as owner-intended without proof (identityOwnerRouting) — a strict first proof then writes
    // and must fail before owner cookies are mounted, closing the record registry.ensure made.
    mocks.identityOwnerRouting = true;
    const fresh = "12345678-1234-4234-8234-123456789abe";
    mocks.identity = JSON.stringify({ version: 2, strict: true, agent: [], owner: [] });
    const f = fixture(); await f.enable(); mocks.storageFailure = true;
    await expect(f.ipc({ op: "open", tabKey: fresh, url: "http://localhost/" })).rejects.toMatchObject({ code: "browser_identity_unavailable" });
    expect(await f.list()).toEqual([]); // not left behind for the next mount to adopt
    expect(mocks.storageWrites).toEqual([]);
  });
  it("only native embedder input/window focus marks device activity; guest/CDP input and owner IPC do not", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), peer = f.peer();
    guest.emit("before-input-event", {}, { type: "keyDown" }); guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    await f.ipc({ op: "ownerInput", tabKey: "owner-one", kind: "pointerdown" }); expect(peer.noteOwnerActivity).not.toHaveBeenCalled();
    f.owner.emit("before-input-event", {}, { type: "keyDown" }); f.owner.emit("before-mouse-event", {}, { type: "mouseDown" }); f.window.emit("focus");
    expect(peer.noteOwnerActivity).toHaveBeenCalledTimes(3);
    await f.ipc({ op: "setEnabled", enabled: false }); f.window.emit("focus"); expect(peer.noteOwnerActivity).toHaveBeenCalledTimes(3);
    f.owner.close(); expect(f.window.listenerCount("focus")).toBe(0);
  });
  it("a native listener-removal failure cannot interrupt the remaining authority-reducing cleanup", async () => {
    const f = fixture(); await f.enable(); const { guest } = await f.mount(), peer = f.peer();
    vi.spyOn(f.owner, "removeListener").mockImplementation(() => { throw Error("native already destroyed"); });
    expect(() => f.owner.close()).not.toThrow();
    expect(guest.dead).toBe(true); expect(peer.dispose).toHaveBeenCalledOnce(); expect(mocks.handlers.has(BROWSER_CHANNEL)).toBe(false);
    expect(f.window.listenerCount("focus")).toBe(0); expect(mocks.appListeners.get("login")?.size).toBe(0);
    expect(mocks.appListeners.get("web-contents-created")?.size).toBe(0); expect(mocks.appListeners.get("before-quit")?.size).toBe(0);
  });
  it("mounts the exact receipt in agent partition, preserves raw URL only for navigation, confirms after hold without revealing or attaching CDP", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f), intent = open.intent;
    const raw = (open.request.operation as { kind: "tabs.open"; url: string }).url;
    expect(intent.url).toBe("http://localhost:26180/new?view=one"); expect(open.event.pool).toBe("agent");
    expect(mocks.storageWrites).toHaveLength(1); expect(JSON.parse(mocks.storageWrites[0]!)).toEqual([["local", intent.tabKey]]);
    f.window.isVisible.mockReturnValue(false); // A truly hidden host cannot accidentally pass visibility.
    const identity = { pendingOpen: intent.requestId, agentOpened: true as const };
    const reserved = await f.ipc({ op: "open", tabKey: intent.tabKey, url: intent.url, identity }) as BrowserTabMount;
    expect(reserved.partition).toBe("persist:browser-agent-local"); const guest = f.attach(reserved);
    const receipt = { op: "open", tabKey: intent.tabKey, url: intent.url, identity, receipt: { src: reserved.src, webContentsId: guest.id } };
    await expect(f.ipc(receipt, { frame: {} })).rejects.toThrow("untrusted_sender");
    expect(guest.loads).toEqual([]); await f.ipc(receipt);
    await until(() => open.peer.grantLease.mock.calls.length === 1);
    expect(guest.loads).toEqual([raw]); const pending = (await f.list())[0]!;
    expect(pending.url).toBe(intent.url); expect(pending.pool).toBe("agent"); expect(pending.lease?.state).toBe("pending");
    expect(open.peer.grantLease).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: "agent-open", requestId: intent.requestId }, url: intent.url }));
    expect(f.events.some(event => event.kind === "agent-open-confirm")).toBe(false);
    await f.ipc({ op: "holdReady", tabKey: intent.tabKey, leaseId: pending.lease!.leaseId, held: true });
    await expect(open.result).resolves.toMatchObject({ kind: "tabs.open", tab: { guestId: reserved.guestId, url: intent.url } });
    expect(f.events.filter(event => event.kind === "agent-open-confirm").map(event => event.openRequestId)).toEqual([intent.requestId]);
    expect(f.events.some(event => event.kind === "reveal")).toBe(false); expect(f.owner.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    expect(guest.debugger.attach).not.toHaveBeenCalled(); expect(guest.debugger.sendCommand).not.toHaveBeenCalled();
    expect((await f.list())[0]?.control?.state).toBe("granted"); expect((await f.list())[0]?.lease?.state).toBe("active");
    expect(JSON.stringify(f.events)).not.toContain("private");
    await expect(f.ipc(receipt)).rejects.toMatchObject({ code: "invalid_request" }); // Receipt is one-use.
  });
  it.each(["scope_invalid", "scope_unsupported"] as const)("renderer %s refusal preserves its typed result and closes the pending guest", async code => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    await expect(f.ipc({ op: "openRefused", requestId: open.intent.requestId, code }, { frame: {} })).rejects.toThrow("untrusted_sender");
    await f.ipc({ op: "openRefused", requestId: open.intent.requestId, code });
    await expect(open.result).rejects.toMatchObject({ code }); expect(await f.list()).toEqual([]);
    expect(open.peer.grantLease).not.toHaveBeenCalled(); expect(f.events.some(event => event.kind === "agent-open-confirm")).toBe(false);
    expect(f.events.some(event => event.kind === "agent-open-cancel" && event.openRequestId === open.intent.requestId)).toBe(true);
  });
  it("an owner click in a shared agent tab opens its popup in the agent pool, without inheriting a lease or opener", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    const { guest } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1); const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true }); await open.result;
    const handler = (guest.setWindowOpenHandler.mock.calls as unknown as [(details: { url: string }) => { action: string }][])[0]![0];
    // Co-control: the owner's own click during the lease is the owner's gesture (not the agent's).
    guest.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(handler({ url: "http://localhost:26180/popup?code=secret" })).toEqual({ action: "deny" });
    const event = f.events.findLast(event => event.kind === "new-tab")!;
    expect(event.pool).toBe("agent"); expect(event.newTabKey).not.toBe(open.intent.tabKey); expect(event.newTabAgent).toBeUndefined();
    expect(event.newTabUrl).toBe("http://localhost:26180/popup"); // display URL only; main keeps the exact one
    const next = await f.mount(event.newTabKey!, event.newTabUrl!, "local", { agentOpened: true });
    expect(next.reserved.partition).toBe("persist:browser-agent-local");
    expect(next.guest.loads.at(-1)).toBe("http://localhost:26180/popup?code=secret");
    expect((await f.list()).find(row => row.tabKey === event.newTabKey)?.lease).toBeUndefined();
    expect(f.peer().grantLease).toHaveBeenCalledOnce();
    expect(guest.setWindowOpenHandler).toHaveBeenCalledOnce();
  });
  it("the leased agent's own click opens a tab granted to it under the opener lease when the host has browser-popup-grant", async () => {
    const f = fixture(), conn = f.connections.get("local")!;
    conn.daemon.capabilities.mockResolvedValue({ featureList: ["browser-relay-v1", "browser-popup-grant"] });
    await f.enable(); const open = await pendingAgentOpen(f);
    const { guest } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1); const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true }); await open.result;
    const handler = (guest.setWindowOpenHandler.mock.calls as unknown as [(details: { url: string }) => { action: string }][])[0]![0];
    const acting = vi.spyOn(InAppProvider.prototype, "agentInput").mockReturnValue(true);
    try { expect(handler({ url: "http://localhost:26180/child" })).toEqual({ action: "deny" }); } finally { acting.mockRestore(); }
    const event = f.events.findLast(item => item.kind === "new-tab")!;
    expect(event).toMatchObject({ pool: "agent", newTabAgent: true, newTabGranted: true });
    await f.mount(event.newTabKey!, event.newTabUrl!, "local", { agentOpened: true });
    await until(() => open.peer.grantLease.mock.calls.length === 2);
    expect(open.peer.grantLease.mock.calls[1]![0]).toMatchObject({ cutexSessionId: lease.cutexSessionId, source: { kind: "popup", openerLeaseId: lease.leaseId } });
  });
  it("without browser-popup-grant the agent's popup tab stays ungranted", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    const { guest } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1); const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true }); await open.result;
    const handler = (guest.setWindowOpenHandler.mock.calls as unknown as [(details: { url: string }) => { action: string }][])[0]![0];
    const acting = vi.spyOn(InAppProvider.prototype, "agentInput").mockReturnValue(true);
    try { handler({ url: "http://localhost:26180/child" }); } finally { acting.mockRestore(); }
    const event = f.events.findLast(item => item.kind === "new-tab")!;
    expect(event.newTabAgent).toBe(true); expect(event.newTabGranted).toBeUndefined();
    await f.mount(event.newTabKey!, event.newTabUrl!, "local", { agentOpened: true }); await flush();
    expect(open.peer.grantLease).toHaveBeenCalledOnce();
  });
  it("abort before receipt rejects the old intent and closes pending registry state", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f); open.ctx.controller.abort();
    await expect(open.result).rejects.toMatchObject({ code: "cancelled" }); expect(await f.list()).toEqual([]);
    await expect(f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity: { pendingOpen: open.intent.requestId, agentOpened: true } })).rejects.toMatchObject({ code: "stale_request" });
    expect(open.peer.grantLease).not.toHaveBeenCalled(); expect(f.owner.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });
  it("abort while awaiting hold revokes the pending relay lease and destroys the mounted agent guest", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    const { guest } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1); const lease = open.peer.options.localLeases()[0]!;
    open.ctx.controller.abort(); await expect(open.result).rejects.toMatchObject({ code: "cancelled" }); await flush();
    expect(open.peer.revokeLease).toHaveBeenCalledWith(lease.leaseId); expect(open.peer.options.localLeases()).toEqual([]);
    expect(guest.dead).toBe(true); expect(await f.list()).toEqual([]); expect(guest.debugger.attach).not.toHaveBeenCalled();
    expect(f.events.some(event => event.kind === "agent-open-confirm")).toBe(false);
  });
  it("module disable aborts pending open and cannot be undone by late renderer receipt", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f);
    await f.ipc({ op: "setEnabled", enabled: false }); await expect(open.result).rejects.toMatchObject({ code: "browser_disabled" });
    await expect(f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity: { pendingOpen: open.intent.requestId } })).rejects.toThrow("module_disabled");
    expect(open.peer.grantLease).not.toHaveBeenCalled(); expect(open.peer.dispose).toHaveBeenCalledOnce();
    expect(f.events.some(event => event.kind === "agent-open-confirm")).toBe(false);
  });
  it("forged command lease/session cannot reach the real provider through the installed execute callback", async () => {
    const f = fixture(); await f.enable(); const { reserved, guest } = await f.mount(), peer = f.peer();
    const pending = await pendingOwnerGrant(f); await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
    guest.debugger.sendCommand.mockClear(); const ctx = context();
    for (const overrides of [{ leaseId: "forged" }, { leaseId: pending.leaseId, cutexSessionId: "other-session" },
      { leaseId: pending.leaseId, target: { hostId: "local", deviceId: peer.options.deviceId, guestId: "browser-other-guest" } }]) {
      const request = command(peer, { kind: "tab.snapshot" }, {
        target: { hostId: "local", deviceId: peer.options.deviceId, guestId: reserved.guestId }, ...overrides });
      await expect(peer.options.execute(request, ctx.value)).rejects.toMatchObject({ code: "lease_revoked" });
    }
    expect(guest.debugger.sendCommand).not.toHaveBeenCalled();
    const release = command(peer, { kind: "tab.release" }, { leaseId: pending.leaseId,
      target: { hostId: "local", deviceId: peer.options.deviceId, guestId: reserved.guestId } });
    await expect(peer.options.execute(release, ctx.value)).resolves.toEqual({ kind: "tab.release" });
    expect((await f.list())[0]?.lease).toBeUndefined(); expect((await f.list())[0]?.control).toBeUndefined();
  });
});

// browser_claim policy in main (owner decision 2026-10-13): main grants local pages itself, by the
// same exact owner-tab selection (lease source claim) — cutex's approval record is never bypassed.
describe("browser claims decided in main", () => {
  const digest = "c".repeat(64);
  const claim = (id: string, session: string, urlHint?: string): ApprovalRecord => ({ approvalId: id, kind: "browser_claim", state: "pending",
    reason: "browser_owner_tab_selection", requesterCutexSessionId: session, requesterName: "Reader", summary: "Select an owner browser tab",
    requestSha256: digest, createdAt: new Date().toISOString(), details: { version: 1, cutexSessionId: session, agentName: "Reader",
      requestId: "request", deviceId: "device", hostId: "local", connectionGeneration: "connection", threadId: "thread", runtimeGeneration: 1,
      intentDigest: digest, reason: "Read the page", sharesOwnerLogin: true, ...(urlHint ? { urlHint } : {}) } });
  const feed = (record: ApprovalRecord) => browserHostEvent("local", { cutex: { method: "cutex/approvals/changed", params: { reason: "requested", approval: record } } } as never);
  async function holdLease(f: ReturnType<typeof fixture>, tabKey: string) {
    await until(() => f.events.some(event => event.tabKey === tabKey && event.lease?.state === "pending"));
    const leaseId = f.events.findLast(event => event.tabKey === tabKey && event.lease)!.lease!.leaseId;
    await f.ipc({ op: "holdReady", tabKey, leaseId, held: true }); return leaseId;
  }
  it("auto-grants a loopback owner tab matching the urlHint with the claim's approval, then tells the owner", async () => {
    const f = fixture(); await f.enable(); await f.mount("owner-one", "http://localhost:26180/");
    feed(claim("apr-local", "session-local", "http://localhost:26180/"));
    await holdLease(f, "owner-one");
    await until(() => f.events.some(event => event.kind === "claim-granted"));
    expect(f.peer().grantLease).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cutexSessionId: "session-local", source: { kind: "claim", approvalId: "apr-local" } }));
    expect(f.events.findLast(event => event.kind === "claim-granted")?.claimGrant).toEqual({ agentName: "Reader", reason: "local" });
    expect((await f.list())[0]?.lease?.auto).toBe("local");
    expect(await f.ipc({ op: "claimAudit" })).toEqual([expect.objectContaining({ approvalId: "apr-local", reason: "local", origin: "http://localhost:26180" })]);
  });
  it("leaves a non-local claim to the owner card: no lease, no new tab", async () => {
    const f = fixture(); await f.enable(); await f.mount("owner-one", "http://localhost:26180/");
    feed(claim("apr-mail", "session-mail", "https://mail.example.com/inbox")); await flush(); await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.peer().grantLease).not.toHaveBeenCalled();
    expect(f.events.some(event => event.kind === "claim-open" || event.kind === "claim-granted")).toBe(false);
  });
  it("opens a claim's local urlHint in a new owner tab, waits for it to attach, then grants that exact tab", async () => {
    const f = fixture(); await f.enable();
    feed(claim("apr-open", "session-open", "http://localhost:26180/yemao"));
    await until(() => f.events.some(event => event.kind === "claim-open"));
    const intent = f.events.find(event => event.kind === "claim-open")!.claimOpen!;
    expect(intent).toMatchObject({ url: "http://localhost:26180/yemao", sessionId: "session-open" });
    await f.mount(intent.tabKey, intent.url); // the renderer's held card mounting main's reserved owner key
    for (let i = 0; i < 40 && !f.peer().grantLease.mock.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(f.peer().grantLease).toHaveBeenCalledWith(expect.objectContaining({ cutexSessionId: "session-open", source: { kind: "claim", approvalId: "apr-open" } }));
    await holdLease(f, intent.tabKey);
    expect((await f.list()).find(tab => tab.tabKey === intent.tabKey)).toMatchObject({ pool: "owner", lease: { auto: "local" } });
  });
  it("a forged renderer cannot grant beyond policy", async () => {
    const f = fixture(); await f.enable(); await f.mount("owner-one", "http://localhost:26180/");
    const target = (await f.list())[0]!, expected = { guestId: target.guestId, pageGeneration: target.pageGeneration };
    // 一直允许 only rides on a claim cutex consumes; a page URL is never renderer-chosen.
    await expect(f.ipc({ op: "grantAgent", tabKey: "owner-one", sessionId: "s", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, expected, remember: true })).rejects.toThrow("invalid_browser_request");
    await expect(f.ipc({ op: "claimOpen", approvalId: "apr-x", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, url: "https://mail.example.com/" })).rejects.toThrow("invalid_browser_request");
    await expect(f.ipc({ op: "claimPolicy", profile: "p", mode: "everything" })).rejects.toThrow("invalid_browser_request");
    // claimOpen reads the record from cutex: a non-local hint is refused, an unknown claim too.
    const daemon = f.connections.get("local")!.daemon as unknown as { approvals: Mock };
    daemon.approvals = vi.fn(async () => [claim("apr-ext", "session-ext", "https://mail.example.com/")]);
    await expect(f.ipc({ op: "claimOpen", approvalId: "apr-ext", settings: DEFAULT_BROWSER_CONTROL_SETTINGS })).rejects.toMatchObject({ code: "external_pages_unavailable" });
    await expect(f.ipc({ op: "claimOpen", approvalId: "apr-missing", settings: DEFAULT_BROWSER_CONTROL_SETTINGS })).rejects.toMatchObject({ code: "approval_denied" });
    expect(f.peer().grantLease).not.toHaveBeenCalled(); expect(f.events.some(event => event.kind === "claim-open")).toBe(false);
  });
  it("一直允许 is recorded only after the claim grant succeeds, and the owner's revoke ends it", async () => {
    const f = fixture(); await f.enable(); await f.mount("owner-one", "http://localhost:26180/");
    const target = (await f.list())[0]!, expected = { guestId: target.guestId, pageGeneration: target.pageGeneration };
    f.peer().grantLease.mockRejectedValueOnce(new Error("approval_denied"));
    await expect(f.ipc({ op: "grantAgent", tabKey: "owner-one", sessionId: "session-remember", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, approvalId: "apr-r1", expected, remember: true })).rejects.toThrow();
    expect(await f.ipc({ op: "claimAllows" })).toEqual([]);
    const grant = f.ipc({ op: "grantAgent", tabKey: "owner-one", sessionId: "session-remember", settings: DEFAULT_BROWSER_CONTROL_SETTINGS, approvalId: "apr-r2", expected, remember: true });
    const leaseId = await holdLease(f, "owner-one"); await grant;
    expect(await f.ipc({ op: "claimAllows" })).toEqual([expect.objectContaining({ sessionId: "session-remember", origin: "http://localhost:26180" })]);
    await f.ipc({ op: "releaseLease", tabKey: "owner-one", leaseId, owner: true });
    expect(await f.ipc({ op: "claimAllows" })).toEqual([]);
  });
});

// Owner option C (2026-10-18): agent-opened tabs run in main's offscreen background carrier and are
// operated while hidden; owner tabs (and owner tabs granted to an agent) keep the visible-only rule.
describe("background carrier for agent tabs", () => {
  const PAGE = "http://localhost:26180/page?token=private-one";
  async function backgroundAgentTab(f: ReturnType<typeof fixture>, url = PAGE) {
    const open = await pendingAgentOpen(f, url);
    const identity = { pendingOpen: open.intent.requestId, agentOpened: true as const, carrier: "background" as const };
    const mount = await f.ipc({ op: "open", tabKey: open.intent.tabKey, url: open.intent.url, identity }) as BrowserTabMount;
    const carrier = mocks.carriers.at(-1)!;
    await until(() => open.peer.options.localLeases().length === 1);
    const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true });
    await open.result;
    const frame = (guest: ContentsMock, wait?: Promise<void>) => guest.debugger.sendCommand.mockImplementation(async (method: string) => {
      if (method === "Page.getFrameTree") { await wait; return { frameTree: { frame: { id: "main", url: guest.url } } }; }
      return {};
    });
    const act = (url = PAGE) => open.peer.options.execute(command(open.peer, { kind: "tab.act", action: { kind: "wait", condition: { kind: "url", url } } },
      { leaseId: lease.leaseId, requestId: `request-${Math.random()}`, target: { hostId: "local", deviceId: open.peer.options.deviceId, guestId: mount.guestId } }), context().value);
    return { open, mount, carrier, guest: carrier.guest as ContentsMock, lease, act, frame, tabKey: open.intent.tabKey };
  }
  it("main creates the carrier itself: agent partition session, popup / WebRTC guard, exact main-only URL, no webview", async () => {
    const f = fixture(); await f.enable();
    const { mount, carrier, guest } = await backgroundAgentTab(f);
    expect(mount).toMatchObject({ carrier: "background", pool: "agent", partition: "persist:browser-agent-local", src: "" });
    expect(mocks.createCarrier).toHaveBeenCalledOnce(); expect(carrier.options.hostId).toBe("local");
    expect(guest.session).toBe(mocks.sessions.get("persist:browser-agent-local"));
    expect(guest.setWindowOpenHandler).toHaveBeenCalledOnce(); expect(guest.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith("disable_non_proxied_udp");
    expect(guest.loads).toEqual([PAGE]);
    // The same partition session hooks attribute (and only admit) the carrier by its webContents id.
    const agentSession = mocks.sessions.get("persist:browser-agent-local") as SessionMock;
    const before = agentSession.webRequest.onBeforeRequest.mock.calls[0]![1] as (details: unknown, done: (value: { cancel?: boolean }) => void) => void;
    const denied = (webContentsId: number, url: string) => { let cancel: boolean | undefined; before({ webContentsId, url, resourceType: "script", initiatorOrigin: "http://localhost:26180" }, value => { cancel = value.cancel; }); return cancel === true; };
    expect(denied(guest.id, "http://localhost:26180/app.js")).toBe(false);
    expect(denied(guest.id + 999, "http://localhost:26180/app.js")).toBe(true);
    expect(denied(guest.id, "http://localhost:26111/v2/sessions")).toBe(true); // the host's control endpoint
    expect((await f.list())[0]).toMatchObject({ carrier: "background", pool: "agent" });
    expect(JSON.stringify(f.events)).not.toContain("private-one");
    // The card's re-render gets the same carrier back, never a second one.
    await expect(f.ipc({ op: "open", tabKey: mount.tabKey, url: "http://localhost:26180/page", identity: { agentOpened: true, carrier: "background" } })).resolves.toMatchObject({ carrier: "background", guestId: mount.guestId });
    expect(mocks.createCarrier).toHaveBeenCalledOnce();
  });
  it("the agent acts while the app window is hidden; the visibility probe never runs and app focus is untouched", async () => {
    const f = fixture(); await f.enable();
    const { guest, act, frame } = await backgroundAgentTab(f);
    f.window.isVisible.mockReturnValue(false); f.owner.executeJavaScriptInIsolatedWorld.mockClear(); frame(guest);
    await expect(act()).resolves.toMatchObject({ kind: "tab.act" });
    // The carrier's dialog guard held the debugger and handed it to the provider (no tab_busy).
    expect(guest.debugger.attach).toHaveBeenCalledTimes(2); expect(guest.debugger.detach).toHaveBeenCalledOnce();
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, scale: 1 });
    expect(f.owner.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });
  it("while no agent binding holds it, the carrier's guard dismisses page dialogs (none reaches the owner's desktop)", async () => {
    const f = fixture(); await f.enable();
    const { guest, act, frame } = await backgroundAgentTab(f);
    expect(guest.debugger.isAttached()).toBe(true);
    expect(guest.debugger.sendCommand.mock.calls.some(([method]) => method === "Page.enable")).toBe(true);
    guest.debugger.emit("message", {}, "Page.javascriptDialogOpening", { type: "confirm", message: "page dialog" });
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith("Page.handleJavaScriptDialog", { accept: false });
    // Bound: the guard is out of the way; exactly one answer comes (the executor's own dismissal).
    frame(guest); await act(); guest.debugger.sendCommand.mockClear();
    guest.debugger.emit("message", {}, "Page.javascriptDialogOpening", { type: "alert", message: "x" });
    await vi.waitFor(() => expect(guest.debugger.sendCommand.mock.calls.filter(([method]) => method === "Page.handleJavaScriptDialog")).toHaveLength(1));
  });
  it("an owner tab never gets a background carrier and keeps target_hidden when granted", async () => {
    const f = fixture(); await f.enable();
    await expect(f.ipc({ op: "open", tabKey: "owner-x", url: "http://localhost:26180/", identity: { carrier: "background" } })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(f.ipc({ op: "open", tabKey: "owner-x", url: "http://localhost:26180/", identity: { carrier: "background" }, receipt: { src: "x", webContentsId: 1 } })).rejects.toThrow("invalid_browser_request");
    expect(mocks.createCarrier).not.toHaveBeenCalled();
    const { guest, reserved } = await f.mount();
    await expect(f.ipc({ op: "toBackground", tabKey: "owner-one" })).rejects.toMatchObject({ code: "permission_denied" });
    const pending = await pendingOwnerGrant(f); await f.ipc({ op: "holdReady", tabKey: "owner-one", leaseId: pending.leaseId, held: true }); await pending.grant;
    f.window.isVisible.mockReturnValue(false);
    guest.debugger.sendCommand.mockImplementation(async (method: string) => method === "Page.getFrameTree" ? { frameTree: { frame: { id: "main", url: guest.url } } } : {});
    await expect(f.peer().options.execute(command(f.peer(), { kind: "tab.act", action: { kind: "wait", condition: { kind: "url", url: guest.url } } },
      { leaseId: pending.leaseId, target: { hostId: "local", deviceId: f.peer().options.deviceId, guestId: reserved.guestId } }), context().value)).rejects.toMatchObject({ code: "target_hidden" });
    expect(mocks.createCarrier).not.toHaveBeenCalled();
  });
  it("bring to front: the running action finishes first, new ones are busy, the lease survives and the webview reopens the exact URL", async () => {
    const f = fixture(); await f.enable();
    const { guest, act, frame, tabKey, lease, mount } = await backgroundAgentTab(f);
    const gate = deferred<void>(); frame(guest, gate.promise);
    const running = act(); let runningDone = false; void running.then(() => { runningDone = true; }, () => {});
    await until(() => guest.debugger.sendCommand.mock.calls.some(([method]) => method === "Page.getFrameTree"));
    let reserved: BrowserTabMount | undefined;
    const front = f.ipc({ op: "open", tabKey, url: "http://localhost:26180/page", identity: { agentOpened: true } }).then((value: BrowserTabMount) => { reserved = value; });
    await flush();
    expect(reserved).toBeUndefined(); expect((await f.list())[0]?.handover).toBe(true);
    await expect(act()).rejects.toMatchObject({ code: "busy" });
    gate.resolve(); await running; expect(runningDone).toBe(true);
    await front;
    expect(reserved).toMatchObject({ guestId: mount.guestId, pool: "agent" }); expect(reserved!.carrier).toBeUndefined();
    const webview = f.attach(reserved!);
    await f.ipc({ op: "open", tabKey, url: "http://localhost:26180/page", identity: { agentOpened: true }, receipt: { src: reserved!.src, webContentsId: webview.id } });
    await until(() => webview.loads.length === 1); await flush();
    expect(webview.loads).toEqual([PAGE]); expect(guest.dead).toBe(true);
    expect(f.peer().options.localLeases().map(item => item.leaseId)).toEqual([lease.leaseId]);
    const row = (await f.list())[0]!;
    expect(row).toMatchObject({ guestId: mount.guestId, pool: "agent", lease: { leaseId: lease.leaseId, state: "active" }, control: { state: "granted" } });
    expect(row.carrier).toBeUndefined(); expect(row.handover).toBeUndefined();
    // In front the visible-only rule applies again.
    f.window.isVisible.mockReturnValue(false); frame(webview);
    await expect(act()).rejects.toMatchObject({ code: "target_hidden" });
  });
  it("run in background: the webview page moves into a new carrier, the lease and a pause survive", async () => {
    const f = fixture(); await f.enable(); const open = await pendingAgentOpen(f, PAGE);
    const { guest: webview, reserved } = await f.mount(open.intent.tabKey, open.intent.url, "local", { pendingOpen: open.intent.requestId, agentOpened: true });
    await until(() => open.peer.options.localLeases().length === 1); const lease = open.peer.options.localLeases()[0]!;
    await f.ipc({ op: "holdReady", tabKey: open.intent.tabKey, leaseId: lease.leaseId, held: true }); await open.result;
    await f.ipc({ op: "pauseLease", tabKey: open.intent.tabKey, leaseId: lease.leaseId });
    await f.ipc({ op: "toBackground", tabKey: open.intent.tabKey });
    const carrier = mocks.carriers.at(-1)!;
    expect(webview.dead).toBe(true); expect(carrier.guest.loads).toEqual([PAGE]);
    const row = (await f.list())[0]!;
    expect(row).toMatchObject({ guestId: reserved.guestId, carrier: "background", lease: { leaseId: lease.leaseId }, control: { state: "paused" } });
    await f.ipc({ op: "resumeLease", tabKey: open.intent.tabKey, leaseId: lease.leaseId, settings: DEFAULT_BROWSER_CONTROL_SETTINGS });
    f.window.isVisible.mockReturnValue(false);
    carrier.guest.debugger.sendCommand.mockImplementation(async (method: string) => method === "Page.getFrameTree" ? { frameTree: { frame: { id: "main", url: carrier.guest.url } } } : {});
    await expect(open.peer.options.execute(command(open.peer, { kind: "tab.act", action: { kind: "wait", condition: { kind: "url", url: PAGE } } },
      { leaseId: lease.leaseId, target: { hostId: "local", deviceId: open.peer.options.deviceId, guestId: reserved.guestId } }), context().value)).resolves.toMatchObject({ kind: "tab.act" });
    // Closing the tab destroys the carrier and ends the lease.
    await f.ipc({ op: "close", tabKey: open.intent.tabKey });
    expect(carrier.guest.dead).toBe(true); expect(open.peer.options.localLeases()).toEqual([]);
  });
  it("N2 answers the proxy challenge for the exact carrier only (no hostWebContents), never for a stray window", async () => {
    vi.stubEnv("CUTEX_DESKTOP_BROWSER_EGRESS", "n2");
    const f = fixture(); await f.enable();
    const { guest } = await backgroundAgentTab(f, "https://example.test/page");
    expect(guest.hostWebContents).toBeUndefined(); await flush();
    const info = { isProxy: true, host: "127.0.0.1", port: 26391, scheme: "basic", realm: "test-realm" };
    const challenge = (contents: unknown) => { const callback = vi.fn(); for (const fn of mocks.appListeners.get("login") ?? []) fn({ preventDefault() {} }, contents, {}, info, callback); return callback.mock.calls; };
    expect(challenge(guest)).toEqual([["test-only", "not-a-real-credential"]]);
    const stray = new ContentsMock(mocks.sessions.get("persist:browser-agent-local") as SessionMock);
    expect(challenge(stray)).toEqual([[]]); expect(challenge(f.owner)).toEqual([[]]);
  });
});
