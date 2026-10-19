/// <reference path="../src/main/env.d.ts" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonService } from "../src/main/daemon";
import type { PreloadBridge } from "../src/shared/ipc";
import type { HostsState } from "../src/shared/hosts";
import { viewKey } from "../src/renderer/src/lib/viewKey";
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
const fake = vi.hoisted(() => ({
  contents: null as null | { id: number; mainFrame: { url: string } },
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  event: null as null | ((event: unknown, name: string, payload: unknown) => void),
  daemon: null as DaemonService | null,
  create: null as null | ((hostId: string, epoch: string) => DaemonService),
  conn: null as TestConn | null,
  bridge: null as PreloadBridge | null,
  current: null as unknown as HostsState,
  calls: [] as {
    endpoint: string;
    session: string;
    method: string;
    params: unknown;
  }[],
  afterReply: null as null | ((method: unknown) => void),
  reply: null as null | Promise<unknown>,
  handshake: null as null | Promise<HostsState>
}));
vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: () => true,
    on() {},
    whenReady: () => Promise.resolve(),
    setPath() {},
    getPath: () => "/isolated/host-actions"
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => fake.handlers.set(channel, fn)
  },
  ipcRenderer: {
    on: (_channel: string, callback: typeof fake.event) => {
      fake.event = callback;
    },
    invoke: async (channel: string, ...args: unknown[]) => {
      const result = await fake.handlers.get(channel)!({
        sender: fake.contents,
        senderFrame: fake.contents!.mainFrame
      }, ...args);
      fake.afterReply?.(args[0]);
      return result;
    }
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
      on() {},
      send() {}
    };
    constructor() { fake.contents = this.webContents; }
    once() {}
    on() {}
    loadFile() {}
  },
  nativeTheme: {},
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  session: {
    defaultSession: {
      setPermissionRequestHandler() {},
      webRequest: { onBeforeRequest() {} }
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
    sessions() {
      return Promise.resolve({
        sessions: []
      });
    }
    projects() {
      return Promise.resolve({
        projects: []
      });
    }
    hostSessions() {
      return Promise.resolve({
        data: []
      });
    }
    cutex(session: string, method: string, params: unknown) {
      fake.calls.push({
        endpoint: this.endpoint.baseUrl,
        session,
        method,
        params
      });
      return fake.reply ?? Promise.resolve({});
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
    constructor(_emit: unknown, create: (hostId: string, epoch: string) => DaemonService) {
      fake.create = create;
    }
    start() {}
    onDaemonState() {}
    connection(hostId: string | null | undefined) {
      return fake.conn && fake.conn.hostId === hostId ? fake.conn : undefined;
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
  }
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  // Inspect actual overlay state without mounting a browser. No dialog implementation is mocked.
  return {
    ...actual,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()
  };
});
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  startDelegationSync: () => {},
  useDelegations: {
    getState: () => ({
      reset() {}
    })
  }
}));
vi.mock("../src/renderer/src/lib/jobStore", () => ({
  startJobSync: () => {},
  useJobs: {
    getState: () => ({
      reset() {}
    })
  }
}));
vi.mock("../src/renderer/src/lib/runtimePackageStore", () => ({
  startRuntimePackageSync: () => {}
}));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({
  startOwnerNotifySync: () => {},
  seedOwnerNotes() {},
  useOwnerNotify: {
    getState: () => ({
      reset() {}
    })
  }
}));
let store: (typeof import("../src/renderer/src/store"))["useApp"];
let originalRefresh!: () => Promise<void>;
let menus: typeof import("../src/renderer/src/lib/menus");
let overlays: typeof import("../src/renderer/src/lib/contextMenu");
const resource = (name: string, revision: number) => ({
  cutexSessionId: "same-session",
  displayName: name,
  revision,
  runtime: {
    activeTurnId: null,
    runtimeGeneration: 1
  }
}) as import("@cutex-desktop/protocol").SessionResource;
function seed(name: string, revision: number) {
  store.setState({
    sidebar: {
      active: [resource(name, revision)],
      retired: [],
      projects: [],
      hostRows: {}
    } as unknown as import("../src/shared/ipc").SidebarSnapshot,
    selectedId: "same-session"
  });
}
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
beforeEach(async () => {
  fake.daemon?.stop();
  vi.resetModules();
  fake.handlers.clear();
  fake.calls.length = 0;
  fake.reply = null;
  fake.handshake = null;
  fake.afterReply = null;
  fake.create = null;
  fake.conn = null;
  fake.current = shownHost("local", "epoch-a");
  await import("../src/main/index");
  await import("../src/preload/index");
  // HostManager is created once the app is ready (main/index.ts whenReady).
  for (let i = 0; i < 20 && !fake.create; i++) await Promise.resolve();
  endpoint("local", "epoch-a");
  vi.stubGlobal("window", {
    cutex: fake.bridge,
    alert() {}
  });
  store = (await import("../src/renderer/src/store")).useApp;
  store.getState().init();
  await fake.bridge!.api.hosts();
  menus = await import("../src/renderer/src/lib/menus");
  overlays = await import("../src/renderer/src/lib/contextMenu");
  originalRefresh = store.getState().refreshSidebar;
  store.setState({
    refreshSidebar: async () => {}
  });
  seed("LOCAL OLD AGENT", 7);
});
function changeRoute(host = "remote", epoch = "epoch-b") {
  endpoint(host, epoch);
  fake.event!({}, "hostsState", fake.current);
  seed("CURRENT DIFFERENT AGENT", 99);
}
function confirm(ok = true) {
  const dialog = overlays.useOverlayState().dialog;
  if (dialog?.kind !== "confirm") throw Error("missing actual confirmation");
  dialog.resolve(ok);
}
describe("route-scoped actual menu/store/preload/main actions", () => {
  it.each(["remote", "aba", "same-host"])("cancels old permanent-delete dialog on %s route change", async kind => {
    const pending = menus.deleteAgent(resource("LOCAL OLD AGENT", 7), key => key);
    const dialog = overlays.useOverlayState().dialog;
    expect(dialog?.kind).toBe("confirm");
    if (kind === "same-host") changeRoute("local", "epoch-c");else {
      changeRoute();
      if (kind === "aba") changeRoute("local", "epoch-c");
    }
    expect(overlays.useOverlayState().dialog).toBeNull();
    if (dialog?.kind !== "confirm") throw Error("missing original confirmation");
    dialog.resolve(true);
    expect(await pending).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(store.getState().selectedId).toBe("same-session");
  });
  it("fences confirmed dialog before its await continuation runs", async () => {
    const pending = menus.deleteAgent(resource("LOCAL OLD AGENT", 7), key => key);
    confirm();
    changeRoute();
    expect(await pending).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(store.getState().selectedId).toBe("same-session");
  });
  it("same binding metadata keeps dialog and normal delete uses captured intended revision", async () => {
    const pending = menus.deleteAgent(resource("LOCAL OLD AGENT", 7), key => key);
    const dialog = overlays.useOverlayState().dialog;
    fake.event!({}, "hostsState", {
      ...fake.current,
      weakSecretStorage: true
    });
    expect(overlays.useOverlayState().dialog).toBe(dialog);
    seed("UPDATED SAME HOST RESOURCE", 99);
    confirm();
    expect(await pending).toBe(true);
    expect(fake.calls).toEqual([{
      endpoint: "fake://local",
      session: "same-session",
      method: "cutex/session/delete",
      params: {
        expectedRevision: 7
      }
    }]);
  });
  it("cancel leaves normal delete untouched", async () => {
    const pending = menus.deleteAgent(resource("LOCAL OLD AGENT", 7), key => key);
    confirm(false);
    expect(await pending).toBe(false);
    expect(fake.calls).toEqual([]);
  });
  it.each([false, true])("rename does not apply old prompt after route switch (already confirmed=%s)", async confirmed => {
    const pending = menus.renameAgent(resource("LOCAL OLD AGENT", 7), key => key);
    const dialog = overlays.useOverlayState().dialog;
    if (dialog?.kind !== "prompt") throw Error("missing actual prompt");
    if (confirmed) dialog.resolve("intended for local");
    changeRoute();
    dialog.resolve("intended for local");
    await pending;
    expect(fake.calls).toEqual([]);
  });
  it("normal rename preserves original revision", async () => {
    const pending = menus.renameAgent(resource("LOCAL OLD AGENT", 7), key => key);
    const dialog = overlays.useOverlayState().dialog;
    if (dialog?.kind !== "prompt") throw Error("missing actual prompt");
    seed("UPDATED SAME HOST RESOURCE", 99);
    dialog.resolve("renamed");
    await pending;
    expect(fake.calls[0]).toEqual({
      endpoint: "fake://local",
      session: "same-session",
      method: "cutex/session/metadata/update",
      params: {
        expectedRevision: 7,
        displayName: "renamed"
      }
    });
  });
  it("generic menu confirm gates pre-bound destructive action after confirmation microtask", async () => {
    const action = vi.fn(async () => {});
    const pending = overlays.runAction({
      label: "archive",
      danger: true,
      confirm: "archive old agent",
      onSelect: action
    });
    confirm();
    changeRoute();
    await pending;
    expect(action).not.toHaveBeenCalled();
  });
  it("archive helper gates confirmed continuation", async () => {
    const pending = menus.archiveAgent(resource("LOCAL OLD AGENT", 7), key => key);
    confirm();
    changeRoute();
    expect(await pending).toBe(false);
    expect(fake.calls).toEqual([]);
  });
  it("late successful delete reply cannot clear current-host selection or announce old success", async () => {
    const pending = menus.deleteAgent(resource("LOCAL OLD AGENT", 7), key => key);
    fake.afterReply = method => {
      if (method === "deleteSession") {
        fake.afterReply = null;
        changeRoute();
      }
    };
    confirm();
    expect(await pending).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.endpoint).toBe("fake://local");
    expect(store.getState().selectedId).toBe("same-session");
    expect(store.getState().notice).toBeNull();
  });
  it("agent info confirmed before route change cannot write metadata", async () => {
    const entry = menus.agentMenu(resource("LOCAL OLD AGENT", 7), key => key).find(item => item && typeof item === "object" && item.label === "menu.editInfo");
    if (!entry || typeof entry !== "object") throw Error("missing info action");
    entry.onSelect();
    const dialog = overlays.useOverlayState().dialog;
    if (dialog?.kind !== "agentInfo") throw Error("missing agent info dialog");
    dialog.resolve({
      avatar: null,
      note: "old local note"
    });
    changeRoute();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fake.calls).toEqual([]);
  });
  it.each(["confirmation", "offline-result"])("Claude restart chain stops at %s route change", async boundary => {
    const agent = resource("LOCAL OLD AGENT", 7);
    agent.runtime.status = "online";
    agent.runtimeDefaults = {
      claudeAllowWrite: false,
      claudeAllowExec: true
    };
    const entry = menus.agentMenu(agent, key => key).find(item => item && typeof item === "object" && item.label === "menu.claudeTools");
    if (!entry || typeof entry !== "object") throw Error("missing tools action");
    const action = entry.submenu?.find(item => item && typeof item === "object" && item.label === "menu.claudeWrite");
    if (!action || typeof action !== "object") throw Error("missing write action");
    action.onSelect();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(overlays.useOverlayState().dialog?.kind).toBe("confirm");
    if (boundary === "confirmation") {
      confirm();
      changeRoute();
    } else {
      fake.afterReply = method => {
        if (method === "sessionAction" && fake.calls.at(-1)?.method === "cutex/runtime/offline") {
          fake.afterReply = null;
          changeRoute();
        }
      };
      confirm();
    }
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(fake.calls.map(call => call.method)).toEqual(boundary === "confirmation" ? ["cutex/session/defaults/update"] : ["cutex/session/defaults/update", "cutex/runtime/offline"]);
    expect(fake.calls.every(call => call.endpoint === "fake://local")).toBe(true);
    expect(store.getState().selectedId).toBe("same-session");
  });
  it("mutation sidebar refresh cannot overwrite a new host snapshot after a late accepted reply", async () => {
    store.setState({
      refreshSidebar: originalRefresh
    });
    const pending = menus.deleteAgent(resource("LOCAL OLD AGENT", 7), key => key);
    fake.afterReply = method => {
      if (method === "sidebar") {
        fake.afterReply = null;
        changeRoute();
      }
    };
    confirm();
    expect(await pending).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.endpoint).toBe("fake://local");
    expect(store.getState().sidebar?.active[0]?.displayName).toBe("CURRENT DIFFERENT AGENT");
    expect(store.getState().selectedId).toBe("same-session");
  });
  it("late retire result does not clear a different same-host selection", async () => {
    fake.reply = Promise.resolve({
      deleted: true
    });
    const pending = menus.archiveAgent(resource("LOCAL OLD AGENT", 7), key => key);
    fake.afterReply = method => {
      if (method === "sessionAction") {
        fake.afterReply = null;
        store.setState({
          selectedId: "another-session"
        });
      }
    };
    confirm();
    expect(await pending).toBe(true);
    expect(store.getState().selectedId).toBe("another-session");
  });
  it("runtime start is shown while cutex works and a failure stays visible on the agent", async () => {
    const agent = resource("LOCAL OLD AGENT", 7);
    agent.runtime.status = "offline";
    store.setState({ sessions: { [viewKey("local", "same-session")]: { startError: null, queue: [], version: 0 } as never } });
    const alert = vi.fn();
    vi.stubGlobal("window", { cutex: fake.bridge, alert });
    let fail!: (error: Error) => void;
    fake.reply = new Promise((_resolve, reject) => {
      fail = reject;
    });
    const start = menus.runtimeItem(agent, key => key);
    expect(start?.label).toBe("menu.start");
    const run = overlays.runAction(start!);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // Waiting for cutex: offered as 正在启动…, not as a second start.
    const pending = menus.runtimeItem(agent, key => key);
    expect(pending?.label).toBe("menu.starting");
    expect(pending?.disabled).toBe(true);
    fail(new Error("runtime_start_failed: object DACL is not service-private"));
    await run;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(store.getState().sessions[viewKey("local", "same-session")]?.startError).toContain("object DACL is not service-private");
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("object DACL is not service-private"));
    expect(menus.runtimeItem(agent, key => key)?.label).toBe("menu.start");
  });
  it("a runtime start answered with a non-online status counts as failed", async () => {
    const agent = resource("LOCAL OLD AGENT", 7);
    agent.runtime.status = "offline";
    store.setState({ sessions: { [viewKey("local", "same-session")]: { startError: null, queue: [], version: 0 } as never } });
    fake.reply = Promise.resolve({ runtimeGeneration: 2, status: "error" });
    await expect(store.getState().sessionAction("same-session", "cutex/runtime/online", { openVisibleTerminal: false })).rejects.toThrow(/error/);
    expect(store.getState().sessions[viewKey("local", "same-session")]?.startError).toMatch(/error/);
  });
  it("runtime stop (click twice) preserves the originally displayed runtime generation", async () => {
    const agent = resource("LOCAL OLD AGENT", 7);
    agent.runtime.status = "online";
    agent.runtime.runtimeGeneration = 11;
    const action = menus.runtimeItem(agent, key => key);
    if (!action) throw Error("missing stop action");
    expect(action.armed).toBeTruthy();
    expect(action.confirm).toBeUndefined();
    const replacement = resource("NEWER SAME HOST RUNTIME", 99);
    replacement.runtime.runtimeGeneration = 22;
    store.setState({
      sidebar: {
        ...store.getState().sidebar!,
        active: [replacement]
      }
    });
    // The second click lands after the sidebar moved on.
    await overlays.runAction(action);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fake.calls[0]).toEqual({
      endpoint: "fake://local",
      session: "same-session",
      method: "cutex/runtime/offline",
      params: {
        expectedRuntimeGeneration: 11
      }
    });
  });
});
