/// <reference path="../src/main/env.d.ts" />
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INVOKE_CHANNEL, SHELL_CHANNEL, UPDATE_CHANNEL, WINDOW_CHANNEL } from "../src/shared/ipc";
import { PLUGINS_CHANNEL } from "../src/shared/plugins";
import { KNOWN_ISSUES_CHANNEL } from "../src/shared/knownIssues";
import { LAUNCH_ART_CHANNEL } from "../src/shared/launchArt";
import type { PluginCatalog, PluginFrameResource } from "../src/shared/plugins";
import type { DaemonService } from "../src/main/daemon";
import type { PreloadBridge } from "../src/shared/ipc";
import type { HostsState } from "../src/shared/hosts";
type TestContents = { id: number; mainFrame: { url: string } };
/** The one host connection of these tests (multi-host P0: main routes by the binding's host). */
type TestConn = { hostId: string; routingEpoch: string; daemon: DaemonService };
/** One shown, connected host (the transport shape; P0 scope = that host). */
function shownHost(host: string, epoch: string): HostsState {
  return {
    scope: { kind: "host", id: host },
    active: host,
    hosts: [{ id: host, kind: host === "local" ? "local" : "ssh", label: host, target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, conn: { epoch, tunnel: null, daemon: { kind: "connecting", baseUrl: "" }, cutexBuild: null } }],
    groups: [],
    startOn: "local",
    tunnel: null,
    weakSecretStorage: false
  };
}
type ResourceRequest = { url: string; webContentsId: number; resourceType: string };
const fake = vi.hoisted(() => ({
  userData: "",
  contents: null as TestContents | null,
  windowActions: [] as string[],
  windowEvents: new Map<string, (...args: unknown[]) => void>(),
  respond: null as null | ((request: Request) => Response),
  beforeRequest: null as null | ((request: ResourceRequest, callback: (result: { cancel: boolean }) => void) => void),
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  event: null as null | ((event: unknown, name: string, payload: unknown) => void),
  daemon: null as DaemonService | null,
  create: null as null | ((hostId: string, epoch: string) => DaemonService),
  conn: null as TestConn | null,
  /** Other connected hosts (multi-host P0: outside the scope). */
  extra: [] as TestConn[],
  sent: [] as unknown[][],
  bridge: null as PreloadBridge | null,
  current: null as unknown as HostsState,
  calls: [] as {
    endpoint: string;
    session: string;
    input: unknown;
  }[],
  reply: null as null | Promise<unknown>,
  handshake: null as null | Promise<HostsState>,
  appEvents: new Map<string, ((...args: unknown[]) => void)[]>(),
  proxies: [] as unknown[],
  resolvers: [] as unknown[],
  proxyFailures: 0,
  hostsEmit: null as null | ((event: "hostsState", payload: HostsState) => void),
  /** fake.sent.length at each main → browser host sync (proves it runs before publication). */
  browserSyncs: [] as number[]
}));
vi.mock("../src/main/browser/install", async original => ({
  ...(await original<typeof import("../src/main/browser/install")>()),
  syncBrowserHosts: () => void fake.browserSyncs.push(fake.sent.length)
}));
vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: () => true,
    on: (name: string, callback: (...args: unknown[]) => void) => {
      const listeners = fake.appEvents.get(name) ?? [];
      listeners.push(callback);
      fake.appEvents.set(name, listeners);
    },
    removeListener: (name: string, callback: (...args: unknown[]) => void) => {
      fake.appEvents.set(name, (fake.appEvents.get(name) ?? []).filter(listener => listener !== callback));
    },
    configureHostResolver: (options: unknown) => fake.resolvers.push(options),
    whenReady: () => Promise.resolve(),
    setPath() {},
    getPath: () => fake.userData,
    getAppPath: () => fake.userData
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => fake.handlers.set(channel, fn),
    removeHandler: (channel: string) => void fake.handlers.delete(channel)
  },
  ipcRenderer: {
    on: (_channel: string, callback: typeof fake.event) => {
      fake.event = callback;
    },
    invoke: async (channel: string, ...args: unknown[]) => fake.handlers.get(channel)!({
      sender: fake.contents,
      senderFrame: fake.contents!.mainFrame
    }, ...args)
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, bridge: PreloadBridge) => {
      fake.bridge = bridge;
    }
  },
  BrowserWindow: class {
    webContents = {
      id: 42,
      mainFrame: { url: "file:///isolated/index.html" },
      setWindowOpenHandler() {},
      on: (name: string, callback: (...args: unknown[]) => void) => fake.windowEvents.set(name, callback),
      send: (...args: unknown[]) => void fake.sent.push(args)
    };
    constructor() { fake.contents = this.webContents; }
    static fromWebContents() {
      return { minimize: () => fake.windowActions.push("minimize") };
    }
    once() {}
    on() {}
    loadFile() {}
  },
  nativeTheme: {},
  protocol: {
    registerSchemesAsPrivileged() {},
    handle: (_scheme: string, respond: (request: Request) => Response) => { fake.respond = respond; }
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler() {},
      setProxy: async (config: unknown) => {
        if (fake.proxyFailures > 0) { fake.proxyFailures--; throw new Error("proxy service unavailable"); }
        fake.proxies.push(config);
      },
      webRequest: {
        onBeforeRequest: (_filter: unknown, listener: typeof fake.beforeRequest) => { fake.beforeRequest = listener; }
      }
    }
  },
  Menu: {},
  dialog: {},
  shell: {}
}));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    constructor(public endpoint: {
      baseUrl: string;
    }) {}
    host() {
      return new Promise(() => {});
    }
    submitInput(session: string, input: unknown) {
      fake.calls.push({
        endpoint: this.endpoint.baseUrl,
        session,
        input
      });
      return fake.reply ?? Promise.resolve({
        disposition: "started",
        turnId: "fake-turn"
      });
    }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream() {
    throw Error("network prohibited");
  }
}));
vi.mock("../src/main/daemon", async original => {
  const actual = await original<typeof import("../src/main/daemon")>();
  return {
    ...actual,
    DaemonService: class extends actual.DaemonService {
      constructor(...args: ConstructorParameters<typeof actual.DaemonService>) {
        super(...args);
        fake.daemon = this;
      }
    }
  };
});
vi.mock("../src/main/hosts", () => ({
  HostManager: class {
    constructor(emit: (event: "hostsState", payload: HostsState) => void, create: (hostId: string, epoch: string) => DaemonService) {
      fake.hostsEmit = emit;
      fake.create = create;
    }
    start() {}
    onDaemonState() {}
    connection(hostId: string | null | undefined) {
      return fake.conn && fake.conn.hostId === hostId ? fake.conn : fake.extra.find(conn => conn.hostId === hostId);
    }
    focus() {
      return fake.current.active;
    }
    state() {
      return fake.current;
    }
    hosts() {
      return fake.handshake ?? Promise.resolve(fake.current);
    }
  }
}));
vi.mock("../src/main/shell", () => ({
  DesktopShell: class {
    start() {}
    attach() {}
    appIcon() {}
    state() {
      return {
        prefs: {
          updateCheckMinutes: 0
        }
      };
    }
  }
}));
vi.mock("../src/main/updater", () => ({
  Updater: class {
    schedule() {}
    watchLaunch() {}
    sourceDir() { return null; }
    releaseDir() { return null; }
    state() { return { status: "idle" }; }
    // The known-issues fetch rides on the updater's transport: here an offline one.
    transport() { return () => Promise.reject(new Error("offline")); }
  }
}));
vi.mock("../src/main/errorLog", () => ({
  errorFields: () => ({}),
  logDir: () => "",
  logError() {}
}));
vi.mock("../src/main/winShortcuts", () => ({
  setWindowsAppId() {},
  setWindowAppDetails() {},
  syncWindowsShortcuts() {}
}));
vi.mock("../src/main/ownerAlert", () => ({
  demoOwnerAlertRequested: () => false,
  OwnerAlerts: class {
    start() {}
    isAlertSender() {
      return false;
    }
    onDaemonState() {}
    onHostEvent() {}
    forgetHost() {}
  }
}));
/** A new connection to `host` replaces the current one (main HostManager: a fresh daemon per connection). */
function endpoint(host: string, epoch: string) {
  fake.conn?.daemon.stop();
  fake.conn = { hostId: host, routingEpoch: epoch, daemon: fake.create!(host, epoch) };
  fake.current = shownHost(host, epoch);
  fake.daemon!.suspend({
    kind: "connecting",
    baseUrl: `fake://${host}`
  }, {
    remote: host !== "local"
  });
  fake.daemon!.useEndpoint({
    baseUrl: `fake://${host}`,
    token: "mock-only",
    configPath: "fake"
  }, {
    remote: host !== "local"
  });
}
function deliver() {
  fake.event!({}, "hostsState", fake.current);
}
const submit = () => fake.bridge!.api.submit("same-session", "old intent", "auto");
beforeEach(async () => {
  fake.daemon?.stop();
  vi.resetModules();
  fake.handlers.clear();
  fake.userData = mkdtempSync(join(tmpdir(), "cutex-ipc-boundary-"));
  fake.contents = null;
  fake.windowEvents.clear();
  fake.windowActions.length = 0;
  fake.respond = null;
  fake.beforeRequest = null;
  fake.calls.length = 0;
  fake.reply = null;
  fake.handshake = null;
  fake.appEvents.clear();
  fake.proxies.length = 0;
  fake.resolvers.length = 0;
  fake.proxyFailures = 0;
  fake.create = null;
  fake.conn = null;
  fake.extra.length = 0;
  fake.sent.length = 0;
  fake.current = shownHost("local", "epoch-a");
  await import("../src/main/index");
  await import("../src/preload/index");
  // HostManager is created once the app is ready (main/index.ts whenReady).
  for (let i = 0; i < 20 && !fake.create; i++) await Promise.resolve();
  endpoint("local", "epoch-a");
});
afterEach(() => {
  fake.daemon?.stop();
  for (const conn of fake.extra) conn.daemon.stop();
  fake.conn?.daemon.stop();
  rmSync(fake.userData, { recursive: true, force: true });
});
describe("main admission checks renderer-observed host binding", () => {
  it("rejects daemon requests before explicit startup handshake", async () => {
    await expect(submit()).rejects.toThrow("host binding");
    expect(fake.calls).toEqual([]);
  });
  it("startup handshake first delivers host state to renderer, then authorizes current binding", async () => {
    let observed = "";
    fake.bridge!.on("hostsState", state => {
      observed = state.active;
    });
    await fake.bridge!.api.hosts();
    expect(observed).toBe("local");
    await submit();
    expect(fake.calls[0]?.endpoint).toBe("fake://local");
  });
  it.each([false, true])("rejects old renderer requests before host notification (ABA=%s)", async aba => {
    fake.bridge!.on("hostsState", () => {});
    await fake.bridge!.api.hosts();
    endpoint("remote", "epoch-b");
    if (aba) endpoint("local", "epoch-c");
    await expect(submit()).rejects.toThrow("host binding");
    expect(fake.calls).toEqual([]);
    deliver();
    await submit();
    expect(fake.calls[0]?.endpoint).toBe(aba ? "fake://local" : "fake://remote");
  });
  it("blocks reentrant requests during host callbacks; a throwing listener neither starves others nor leaves the binding closed", async () => {
    let reentrant: Promise<unknown> | undefined;
    const seen: string[] = [];
    const unsubscribe = fake.bridge!.on("hostsState", () => {
      reentrant = submit().catch(error => error);
      throw Error("UI reset failed");
    });
    fake.bridge!.on("hostsState", state => { seen.push(state.active); });
    expect(deliver).toThrow("UI reset failed");
    expect(await reentrant).toBeInstanceOf(Error);
    expect(seen).toEqual(["local"]);
    await submit();
    expect(fake.calls).toHaveLength(1);
    unsubscribe();
  });
  it("reports several failing listeners together, still authorizing the binding", async () => {
    fake.bridge!.on("hostsState", () => { throw Error("first"); });
    fake.bridge!.on("hostsState", () => { throw Error("second"); });
    expect(deliver).toThrow("hostsState listeners failed");
    await submit();
    expect(fake.calls).toHaveLength(1);
  });
  it("does not authorize a notification with no renderer listener", async () => {
    deliver();
    await expect(submit()).rejects.toThrow("host binding");
    await fake.bridge!.api.hosts();
    await expect(submit()).rejects.toThrow("host binding");
  });
  it("late handshake cannot roll back a newer host event binding", async () => {
    fake.bridge!.on("hostsState", () => {});
    const old = fake.current;
    let release!: (value: HostsState) => void;
    fake.handshake = new Promise(resolve => {
      release = resolve;
    });
    const pending = fake.bridge!.api.hosts();
    endpoint("remote", "epoch-b");
    deliver();
    release(old);
    expect((await pending).active).toBe("remote");
    await submit();
    expect(fake.calls[0]?.endpoint).toBe("fake://remote");
  });
  it("preserves late-response generation rejection after the original-host request was dispatched", async () => {
    fake.bridge!.on("hostsState", () => {});
    await fake.bridge!.api.hosts();
    let release!: (value: unknown) => void;
    fake.reply = new Promise(resolve => {
      release = resolve;
    });
    const pending = submit();
    await Promise.resolve();
    expect(fake.calls[0]?.endpoint).toBe("fake://local");
    endpoint("remote", "epoch-b");
    release({
      disposition: "started"
    });
    await expect(pending).rejects.toThrow("host switched");
  });
  it("nested newer host event cannot authorize requests while an outer old-host callback is running", async () => {
    let reentrant: Promise<unknown> | undefined;
    const unsubscribe = fake.bridge!.on("hostsState", () => {
      endpoint("remote", "epoch-b");
      deliver();
      reentrant = submit().catch(error => error);
    });
    deliver();
    expect(await reentrant).toBeInstanceOf(Error);
    await expect(submit()).rejects.toThrow("host binding");
    expect(fake.calls).toEqual([]);
    unsubscribe();
    fake.bridge!.on("hostsState", () => {});
    await fake.bridge!.api.hosts();
    await submit();
    expect(fake.calls[0]?.endpoint).toBe("fake://remote");
  });
});

describe("multi-host P0: every connected host has its own binding", () => {
  /** A second host connected outside the scope (its own daemon service and routing epoch). */
  function connectBackground(host: string, epoch: string): DaemonService {
    const daemon = fake.create!(host, epoch);
    fake.extra.push({ hostId: host, routingEpoch: epoch, daemon });
    daemon.suspend({ kind: "connecting", baseUrl: `fake://${host}` }, { remote: true });
    daemon.useEndpoint({ baseUrl: `fake://${host}`, token: "mock-only", configPath: "fake" }, { remote: true });
    fake.current = { ...fake.current, hosts: [...fake.current.hosts, ...shownHost(host, epoch).hosts] };
    return daemon;
  }
  const focusOn = (host: string) => {
    fake.current = { ...fake.current, scope: { kind: "host", id: host }, active: host };
  };

  it("apiFor(host) calls go to that host's connection, bridge.api calls to the focus host", async () => {
    fake.bridge!.on("hostsState", () => {});
    connectBackground("ssh-t", "epoch-t");
    await fake.bridge!.api.hosts();
    await fake.bridge!.apiFor!("ssh-t").submit("same-session", "background intent", "auto");
    await submit();
    expect(fake.calls.map(call => call.endpoint)).toEqual(["fake://ssh-t", "fake://local"]);
    await expect(fake.bridge!.apiFor!("ssh-unknown").submit("same-session", "x", "auto")).rejects.toThrow("host binding");
  });

  it("a focus call is refused once the focus moved, even though the old focus host stays connected", async () => {
    fake.bridge!.on("hostsState", () => {});
    connectBackground("ssh-t", "epoch-t");
    await fake.bridge!.api.hosts();
    let release!: (value: unknown) => void;
    fake.reply = new Promise(resolve => {
      release = resolve;
    });
    const pending = submit();
    await Promise.resolve();
    expect(fake.calls[0]?.endpoint).toBe("fake://local");
    focusOn("ssh-t");
    release({ disposition: "started" });
    await expect(pending).rejects.toThrow("host switched");
    fake.reply = null;
    // Not yet observed by the renderer: its focus binding still names local.
    await expect(submit()).rejects.toThrow("host binding");
    // Background work of the old focus host keeps its binding.
    await fake.bridge!.apiFor!("local").submit("same-session", "background", "auto");
    expect(fake.calls.at(-1)?.endpoint).toBe("fake://local");
    deliver();
    await submit();
    expect(fake.calls.at(-1)?.endpoint).toBe("fake://ssh-t");
  });

  it("main tags each connection's events; preload drops those of a replaced connection", async () => {
    const seen: unknown[] = [];
    fake.bridge!.on("hostsState", () => {});
    fake.bridge!.on("hostEvent", payload => void seen.push(payload));
    const background = connectBackground("ssh-t", "epoch-t");
    await fake.bridge!.api.hosts();
    const envelope = { cutexSessionId: "w1", source: "cutex", correlation: {} };
    (background as unknown as { emit: (event: string, payload: unknown) => void }).emit("hostEvent", envelope);
    const tagged = fake.sent.filter(args => args[1] === "hostEvent");
    expect(tagged).toEqual([["cutex-desktop:event", "hostEvent", { hostId: "ssh-t", epoch: "epoch-t", envelope }]]);
    fake.event!({}, "hostEvent", tagged[0]![2]);
    expect(seen).toEqual([{ hostId: "ssh-t", epoch: "epoch-t", envelope }]);
    // An event of an older connection of that host, or of a host the renderer has not seen: dropped.
    fake.event!({}, "hostEvent", { hostId: "ssh-t", epoch: "epoch-old", envelope });
    fake.event!({}, "hostEvent", { hostId: "ssh-x", epoch: "epoch-t", envelope });
    expect(seen).toHaveLength(1);
    // Once main replaced the connection, the old daemon service says nothing more.
    fake.extra.length = 0;
    fake.sent.length = 0;
    (background as unknown as { emit: (event: string, payload: unknown) => void }).emit("hostEvent", envelope);
    expect(fake.sent).toEqual([]);
    background.stop();
  });
});

function appEvent() {
  return { sender: fake.contents, senderFrame: fake.contents!.mainFrame };
}
function invokeAs(event: unknown, channel: string, ...args: unknown[]) {
  return Promise.resolve().then(() => fake.handlers.get(channel)!(event, ...args));
}
const senderCases = [
  {
    name: "opaque plugin subframe",
    event: () => ({ sender: fake.contents, senderFrame: { url: "cutex-plugin://frame/untrusted/index.html" } })
  },
  {
    name: "subframe with the app URL",
    event: () => ({ sender: fake.contents, senderFrame: { url: fake.contents!.mainFrame.url } })
  },
  { name: "missing sender frame", event: () => ({ sender: fake.contents }) },
  { name: "null sender frame", event: () => ({ sender: fake.contents, senderFrame: null }) },
  { name: "blank subframe URL", event: () => ({ sender: fake.contents, senderFrame: { url: "" } }) },
  {
    name: "different window with the app URL",
    event: () => {
      const sender = { id: 43, mainFrame: { url: fake.contents!.mainFrame.url } };
      return { sender, senderFrame: sender.mainFrame };
    }
  },
  {
    name: "different window borrowing the main frame object",
    event: () => ({ sender: { ...fake.contents }, senderFrame: fake.contents!.mainFrame })
  },
  {
    name: "app top frame after an untrusted navigation",
    event: () => {
      fake.contents!.mainFrame.url = "https://untrusted.invalid/";
      return appEvent();
    }
  }
];
const channelCases = [
  { name: "host API", channel: INVOKE_CHANNEL, args: ["hosts", [], null] },
  {
    name: "daemon API with a valid host binding",
    channel: INVOKE_CHANNEL,
    args: ["submit", ["same-session", "untrusted intent", "auto"], { hostId: "local", epoch: "epoch-a" }]
  },
  { name: "desktop shell", channel: SHELL_CHANNEL, args: [{ op: "state" }] },
  { name: "updater", channel: UPDATE_CHANNEL, args: [{ op: "state" }] },
  { name: "known issues", channel: KNOWN_ISSUES_CHANNEL, args: [{ op: "get" }] },
  { name: "launch art state", channel: LAUNCH_ART_CHANNEL, args: [{ op: "state" }] },
  { name: "launch art import", channel: LAUNCH_ART_CHANNEL, args: [{ op: "import" }] },
  { name: "launch art clear", channel: LAUNCH_ART_CHANNEL, args: [{ op: "clear" }] },
  { name: "window controls", channel: WINDOW_CHANNEL, args: ["control", "minimize"] },
  { name: "plugin catalog", channel: PLUGINS_CHANNEL, args: [{ op: "list" }] },
  { name: "plugin preparation", channel: PLUGINS_CHANNEL, args: [{ op: "prepare" }] },
  { name: "plugin release", channel: PLUGINS_CHANNEL, args: [{ op: "release", id: "foreign-lease" }] }
];

describe("main IPC authority belongs to the app's exact top frame", () => {
  describe.each(senderCases)("$name", ({ event }) => {
    it.each(channelCases)("cannot invoke $name", async ({ channel, args }) => {
      await expect(invokeAs(event(), channel, ...args)).rejects.toThrow("untrusted sender");
      expect(fake.calls).toEqual([]);
      expect(fake.windowActions).toEqual([]);
    });
  });

  it("keeps non-daemon interfaces available to the legitimate app frame", async () => {
    await expect(invokeAs(appEvent(), SHELL_CHANNEL, { op: "state" })).resolves.toMatchObject({ prefs: {} });
    await expect(invokeAs(appEvent(), UPDATE_CHANNEL, { op: "state" })).resolves.toEqual({ status: "idle" });
    await expect(fake.bridge!.knownIssues!.get()).resolves.toEqual({ source: "none", error: "offline" });
    await expect(invokeAs(appEvent(), KNOWN_ISSUES_CHANNEL, { op: "drop" })).rejects.toThrow("unknown known-issues op");
    await expect(fake.bridge!.launchArt!.state()).resolves.toEqual({ imported: {} });
    await expect(invokeAs(appEvent(), LAUNCH_ART_CHANNEL, { op: "drop" })).rejects.toThrow("unknown launch-art op");
    // The folder comes from main's dialog only: a renderer-named folder is refused.
    await expect(invokeAs(appEvent(), LAUNCH_ART_CHANNEL, { op: "import", folder: fake.userData })).rejects.toThrow("unknown launch-art op");
    await expect(invokeAs(appEvent(), WINDOW_CHANNEL, "control", "minimize")).resolves.toBeUndefined();
    expect(fake.windowActions).toEqual(["minimize"]);
    await expect(fake.bridge!.plugins!.list()).resolves.toEqual({ plugins: [], errors: [] });
  });
});

async function preparePlugin(): Promise<PluginFrameResource> {
  const directory = join(fake.userData, "plugins", "sample");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({
    apiVersion: 1,
    id: "sample",
    name: "IPC boundary fixture",
    version: "1.0.0",
    entry: "index.html",
    capabilities: ["views"],
    contributes: { "main.page": [{ id: "sample.page", title: "Fixture" }] }
  }));
  writeFileSync(join(directory, "index.html"), "<p>isolated local fixture</p>");
  const catalog: PluginCatalog = await fake.bridge!.plugins!.list();
  expect(catalog.errors).toEqual([]);
  return fake.bridge!.plugins!.prepare({
    pluginId: "sample",
    fingerprint: catalog.plugins[0]!.fingerprint,
    instanceId: randomUUID(),
    channel: randomUUID()
  });
}
function requestAllowed(url: string, resourceType = "subFrame", webContentsId = fake.contents!.id): boolean {
  let result: { cancel: boolean } | undefined;
  fake.beforeRequest!({ url, resourceType, webContentsId }, response => { result = response; });
  expect(result).toBeDefined();
  return !result!.cancel;
}
function navigationAllowed(url: string, isMainFrame = false): boolean {
  const preventDefault = vi.fn();
  fake.windowEvents.get("will-frame-navigate")!({ url, isMainFrame, preventDefault });
  return preventDefault.mock.calls.length === 0;
}

describe("plugin documents use the owning window and a restricted navigation lifetime", () => {
  it("serves the owned document once, only as a subframe, and releases its navigation lease", async () => {
    const prepared = await preparePlugin();
    expect(requestAllowed(prepared.url)).toBe(true);
    expect(navigationAllowed(prepared.url)).toBe(true);
    for (const kind of ["mainFrame", "xhr", "script", "other"]) {
      expect(requestAllowed(prepared.url, kind)).toBe(false);
    }
    expect(requestAllowed(prepared.url, "subFrame", 43)).toBe(false);
    expect(requestAllowed(prepared.url + "?forged")).toBe(false);
    expect(navigationAllowed(prepared.url, true)).toBe(false);
    const response = fake.respond!(new Request(prepared.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(await response.text()).toContain("isolated local fixture");
    expect(fake.respond!(new Request(prepared.url)).status).toBe(404);
    await fake.bridge!.plugins!.release(prepared.id);
    expect(requestAllowed(prepared.url)).toBe(false);
    expect(navigationAllowed(prepared.url)).toBe(false);
  });

  it.each([
    "https://untrusted.invalid/?leak=private",
    "file:///private/secret.html",
    "data:text/html,<script>untrusted</script>",
    "about:blank",
    "cutex-plugin://frame/00000000-0000-0000-0000-000000000000/index.html"
  ])("blocks unowned subframe navigation before dispatch: %s", url => {
    expect(navigationAllowed(url)).toBe(false);
  });

  it.each(["render-process-gone", "destroyed"])("revokes prepared documents on %s", async event => {
    const prepared = await preparePlugin();
    fake.windowEvents.get(event)!();
    expect(requestAllowed(prepared.url)).toBe(false);
    expect(fake.respond!(new Request(prepared.url)).status).toBe(404);
  });

  it("revokes on main reload while preserving leases during child loads and in-place navigation", async () => {
    const prepared = await preparePlugin();
    const navigation = fake.windowEvents.get("did-start-navigation")!;
    navigation({}, prepared.url, false, false);
    expect(requestAllowed(prepared.url)).toBe(true);
    navigation({}, "file:///isolated/index.html#section", true, true);
    expect(requestAllowed(prepared.url)).toBe(true);
    navigation({}, "file:///isolated/index.html", false, true);
    expect(requestAllowed(prepared.url)).toBe(false);
    expect(fake.respond!(new Request(prepared.url)).status).toBe(404);
  });
});

describe("plugin frames cannot reach the network outside CSP (WebRTC, DNS prefetch)", () => {
  it("disables non-proxied UDP WebRTC on every webContents", () => {
    const policies: string[] = [];
    const popupGuard = vi.fn();
    const listeners = fake.appEvents.get("web-contents-created")!;
    for (const listener of listeners) listener({}, {
      getType: () => "webview",
      setWindowOpenHandler: popupGuard,
      setWebRTCIPHandlingPolicy: (policy: string) => policies.push(policy)
    });
    expect(policies).toEqual(["disable_non_proxied_udp"]);
    expect({ listeners: listeners.length, popupGuards: popupGuard.mock.calls.length }).toEqual({ listeners: 2, popupGuards: 1 });
  });

  it("leaves Chromium networking alone until the first plugin document, then contains it before serving one", async () => {
    await fake.bridge!.plugins!.list();
    expect(fake.proxies).toEqual([]);
    expect(fake.resolvers).toEqual([]);
    await preparePlugin();
    expect(fake.proxies).toEqual([{ mode: "fixed_servers", proxyRules: "socks5://127.0.0.1:9", proxyBypassRules: "<-loopback>" }]);
    expect(fake.resolvers).toEqual([{ enableBuiltInResolver: true, secureDnsMode: "secure", secureDnsServers: ["https://127.0.0.1:9/dns-query{?dns}"] }]);
    await preparePlugin();
    expect(fake.proxies).toHaveLength(1);
  });

  it("does not hand out a plugin document when containment fails, and retries next time", async () => {
    fake.proxyFailures = 1;
    await expect(preparePlugin()).rejects.toThrow("proxy service unavailable");
    expect(fake.proxies).toEqual([]);
    const prepared = await preparePlugin();
    expect(fake.proxies).toHaveLength(1);
    expect(requestAllowed(prepared.url)).toBe(true);
  });
});

describe("browser host revocation is wired into host-state publication (I2a B)", () => {
  it("syncs browser hosts synchronously before hostsState / daemonState reach the renderer, not for other events", () => {
    fake.browserSyncs.length = 0;
    fake.sent.length = 0;
    fake.hostsEmit!("hostsState", fake.current);
    expect(fake.browserSyncs).toEqual([0]);
    expect(fake.sent.map(args => args[1])).toEqual(["hostsState"]);
    const daemon = fake.daemon as unknown as { emit: (event: string, payload: unknown) => void };
    daemon.emit("daemonState", { kind: "unreachable", baseUrl: "fake://local", message: "down" });
    expect(fake.browserSyncs).toEqual([0, 1]);
    expect(fake.sent.map(args => args[1])).toEqual(["hostsState", "daemonState"]);
    daemon.emit("hostEvent", { cutexSessionId: "w1", source: "cutex", correlation: {} });
    expect(fake.browserSyncs).toEqual([0, 1]);
    expect(fake.sent).toHaveLength(3);
  });
});
