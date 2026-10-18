import { describe, expect, it, vi } from "vitest";
import { createBrowserChannel, parseBrowserRequest } from "../src/main/browser/channel";
import { browserBridge } from "../src/preload/browser";
import { BROWSER_CHANNEL, BROWSER_OWNER_INPUT_KINDS, DEFAULT_BROWSER_CONTROL_SETTINGS, isBrowserControlSettings, normalizeBrowserControlSettings, type BrowserEvent, type BrowserRequest } from "../src/shared/browser";
import { HOST_TAGGED_EVENTS, type DesktopEvents, type HostTag } from "../src/shared/ipc";
import type { HostBinding } from "../src/shared/hosts";

function fixture(initiallyEnabled = true) {
  let enabled = initiallyEnabled;
  const connections = new Map([
    ["local", { routingEpoch: "epoch-local", daemon: { generation: 1 } }],
    ["ssh-other", { routingEpoch: "epoch-remote", daemon: { generation: 1 } }],
  ]);
  const hosts = { connection: (id: string | null | undefined) => id ? connections.get(id) : undefined, focus: () => "local" };
  const execute = vi.fn(async (_request: Exclude<BrowserRequest, { op: "setEnabled" }>, _host: string): Promise<unknown> => "result");
  const setEnabled = vi.fn((value: boolean) => { enabled = value; });
  const resetOrigins = vi.fn();
  const handle = createBrowserChannel({ isAppSender: (event: { trusted: boolean }) => event.trusted,
    getHosts: () => hosts, isEnabled: () => enabled, setEnabled, resetOrigins, execute });
  return { connections, execute, setEnabled, resetOrigins, handle };
}
describe("browser narrow channel parsing", () => {
  it.each([
    { op: "list" }, { op: "setEnabled", enabled: false }, { op: "resetOrigins" }, { op: "reserveOwnerTab" },
    { op: "open", tabKey: "side", url: "about:blank" },
    { op: "open", tabKey: "side", url: "about:blank", receipt: { src: "about:blank#fixture", webContentsId: 4 } },
    { op: "navigate", tabKey: "side", url: "http://localhost:26111/" },
    ...BROWSER_OWNER_INPUT_KINDS.map(kind => ({ op: "ownerInput", tabKey: "side", kind })),
    { op: "back", tabKey: "side" }, { op: "forward", tabKey: "side" },
    { op: "reload", tabKey: "side" }, { op: "stop", tabKey: "side" },
    { op: "close", tabKey: "side", unmount: true },
  ])("accepts exact owner shape $op", request => { expect(parseBrowserRequest(request)).toEqual(request); });
  it.each([
    null, [], {}, { op: "grant", tabKey: "side" }, { op: "evaluate", tabKey: "side" },
    { op: "reserveOwnerTab", tabKey: "forged-old-agent" }, { op: "resetOrigins", path: "arbitrary" },
    { op: "list", hostId: "ssh-other" }, { op: "setEnabled", enabled: "yes" },
    { op: "setEnabled", enabled: true, hostId: "local" }, { op: "close", tabKey: "side", unmount: 1 },
    { op: "open", tabKey: "side", url: "about:blank", partition: "persist:browser-local" },
    { op: "navigate", tabKey: "side", url: "http://localhost/\n" },
    { op: "navigate", tabKey: "side", url: "x".repeat(8001) },
    { op: "stop", tabKey: "" }, { op: "stop", tabKey: "bad\0id" },
    { op: "ownerInput", tabKey: "side" }, { op: "ownerInput", tabKey: "side", kind: "hover" },
    { op: "ownerInput", tabKey: "side", kind: "guest-keyboard" }, { op: "ownerInput", tabKey: "side", kind: "pointerdown", trusted: true },
    { op: "ownerInput", tabKey: "side", kind: "wheel", hostId: "other" },
    { op: "open", tabKey: "side", url: "about:blank", receipt: { src: "s", webContentsId: 0 } },
    { op: "open", tabKey: "side", url: "about:blank", receipt: { src: "s", webContentsId: 1, hostId: "local" } },
  ])("rejects extra authority, malformed fields and unsupported operations %#", request => {
    expect(() => parseBrowserRequest(request)).toThrow();
  });
});
describe("browser channel authority and host fence", () => {
  it("reset is exact, main-owner-only and module-gated but does not require a remote host", async () => {
    const f = fixture(); f.connections.clear();
    await expect(f.handle({trusted:false}, {op:"resetOrigins"}, null)).rejects.toThrow("untrusted_sender");
    expect(f.resetOrigins).not.toHaveBeenCalled();
    await f.handle({trusted:true}, {op:"resetOrigins"}, null); expect(f.resetOrigins).toHaveBeenCalledOnce();
    await f.handle({trusted:true}, {op:"setEnabled",enabled:false}, null);
    await expect(f.handle({trusted:true}, {op:"resetOrigins"}, null)).rejects.toThrow("module_disabled");
    expect(f.resetOrigins).toHaveBeenCalledOnce(); expect(f.execute).not.toHaveBeenCalled();
  });
  it("removed development grants are rejected even from a current trusted owner", async () => {
    const f = fixture();
    for (const target of ["development-mcp", "agent", ""]) {
      const request = { op: "grant", tabKey: "side", target, settings: DEFAULT_BROWSER_CONTROL_SETTINGS };
      expect(() => parseBrowserRequest(request)).toThrow("invalid_browser_request");
      await expect(f.handle({ trusted: true }, request, { hostId: "local", epoch: "epoch-local" })).rejects.toThrow("invalid_browser_request");
    }
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("rejects every operation from a plugin/guest sender, including enabling or cleanup", async () => {
    const f = fixture();
    for (const request of [{ op: "setEnabled", enabled: true }, { op: "list" }, { op: "close", tabKey: "side" }, { op: "stop", tabKey: "side" }, { op: "ownerInput", tabKey: "side", kind: "wheel" }])
      await expect(f.handle({ trusted: false }, request, { hostId: "local", epoch: "epoch-local" })).rejects.toThrow("untrusted_sender");
    expect(f.execute).not.toHaveBeenCalled(); expect(f.setEnabled).not.toHaveBeenCalled();
  });
  it("module lifecycle is app-only, independent of current host connectivity", async () => {
    const f = fixture(); f.connections.clear();
    await f.handle({ trusted: true }, { op: "setEnabled", enabled: false }, null);
    expect(f.setEnabled).toHaveBeenCalledWith(false); expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(["list", "open", "navigate", "back", "forward", "reload", "close", "stop", "ownerInput"])("module disabled rejects %s before host admission", async op => {
    const f = fixture(false); f.connections.clear();
    const request = op === "list" ? { op } : op === "open" || op === "navigate" ? { op, tabKey: "side", url: "about:blank" } : op === "ownerInput" ? { op, tabKey: "side", kind: "wheel" } : { op, tabKey: "side" };
    await expect(f.handle({ trusted: true }, request, null)).rejects.toThrow("module_disabled");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("enabled cleanup stays host-unfenced, but disabling takes effect before its next dispatch", async () => {
    const f = fixture();
    await f.handle({ trusted: true }, { op: "setEnabled", enabled: false }, null);
    await expect(f.handle({ trusted: true }, { op: "stop", tabKey: "side" }, { hostId: "local", epoch: "old" })).rejects.toThrow("module_disabled");
    await f.handle({ trusted: true }, { op: "setEnabled", enabled: true }, null);
    await expect(f.handle({ trusted: true }, { op: "stop", tabKey: "side" }, { hostId: "local", epoch: "old" })).resolves.toBe("result");
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it.each(["open", "navigate", "back", "forward", "reload", "list"])("refuses stale epoch before %s executes", async op => {
    const f = fixture();
    const request = op === "list" ? { op } : op === "open" || op === "navigate" ? { op, tabKey: "side", url: "about:blank" } : { op, tabKey: "side" };
    await expect(f.handle({ trusted: true }, request, { hostId: "local", epoch: "old" })).rejects.toThrow("host binding unavailable");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("targets explicit bound host regardless of the focused host", async () => {
    const f = fixture();
    await expect(f.handle({ trusted: true }, { op: "list" }, { hostId: "ssh-other", epoch: "epoch-remote" })).resolves.toBe("result");
    expect(f.execute.mock.calls[0]?.[1]).toBe("ssh-other");
    await expect(f.handle({ trusted: true }, { op: "list" }, { hostId: "ssh-other", epoch: "epoch-remote", focus: true })).rejects.toThrow("invalid_browser_binding");
  });
  it.each(["close", "stop", "ownerInput"])("keeps %s available with old epoch or disconnected target", async op => {
    const f = fixture(); f.connections.delete("ssh-other");
    const request = { op, tabKey: "side", ...(op === "ownerInput" ? { kind: "wheel" } : {}) };
    await expect(f.handle({ trusted: true }, request, { hostId: "ssh-other", epoch: "old" })).resolves.toBe("result");
    expect(f.execute.mock.calls[0]?.[1]).toBe("ssh-other");
    expect(f.execute).toHaveBeenCalledWith(parseBrowserRequest(request), "ssh-other", undefined);
    await expect(f.handle({ trusted: true }, request, null)).rejects.toThrow("invalid_browser_binding");
  });
  it("rejects a result if its daemon generation changed during an awaited operation", async () => {
    const f = fixture();
    f.execute.mockImplementationOnce(async () => { f.connections.get("local")!.daemon.generation++; return "late"; });
    await expect(f.handle({ trusted: true }, { op: "list" }, { hostId: "local", epoch: "epoch-local" })).rejects.toThrow("host switched");
  });
  it("rejects a result after same-generation connection replacement", async () => {
    const f = fixture();
    f.execute.mockImplementationOnce(async () => { f.connections.set("local", { routingEpoch: "epoch-new", daemon: { generation: 1 } }); return "late"; });
    await expect(f.handle({ trusted: true }, { op: "list" }, { hostId: "local", epoch: "epoch-local" })).rejects.toThrow("host switched");
  });
});
describe("browser preload bindings", () => {
  it("exposes product grants but no development grant, raw script, CDP or generic execution", async () => {
    const invoke = vi.fn(async () => undefined);
    const bridge = browserBridge({ invoke, binding: () => ({ hostId: "remote", epoch: "epoch", focus: true }), subscribe: () => () => {} });
    const browser = bridge.forHost("remote");
    expect(browser).not.toHaveProperty("grant");
    expect(Object.keys(browser).sort()).toEqual(["agents", "back", "claimAllowRevoke", "claimAllows", "claimAudit", "claimOpen", "claimPolicy", "clearIdempotency", "close", "forward", "grantAgent", "holdReady", "list", "navigate", "open", "openRefused", "ownerInput", "pauseLease", "profileTools", "releaseLease", "reload", "reserveOwnerTab", "resumeLease", "settings", "stop", "toBackground", "toolItem", "turnShot", "turnShots"]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("re-reads target host binding for every call and never includes focus", async () => {
    let observed: HostBinding = { hostId: "ssh-other", epoch: "epoch-a", focus: true };
    const invoke = vi.fn(async () => []), binding = vi.fn((_host: string) => observed);
    const bridge = browserBridge({ invoke, binding, subscribe: () => () => {} });
    const browser = bridge.forHost("ssh-other");
    await browser.list();
    expect(invoke).toHaveBeenLastCalledWith(BROWSER_CHANNEL, { op: "list" }, { hostId: "ssh-other", epoch: "epoch-a" });
    observed = { hostId: "ssh-other", epoch: "epoch-b", focus: true };
    await browser.navigate("side", "about:blank");
    expect(invoke).toHaveBeenLastCalledWith(BROWSER_CHANNEL, { op: "navigate", tabKey: "side", url: "about:blank" }, { hostId: "ssh-other", epoch: "epoch-b" });
    expect(binding.mock.calls.map(([host]) => host)).toEqual(["ssh-other", "ssh-other"]);
  });
  it("missing connection passes no authority for opening but permits explicit-host stop/close", async () => {
    const invoke = vi.fn(async () => undefined);
    const bridge = browserBridge({ invoke, binding: () => null, subscribe: () => () => {} });
    const browser = bridge.forHost("ssh-other");
    await browser.open("side", "about:blank");
    expect(invoke).toHaveBeenLastCalledWith(BROWSER_CHANNEL, { op: "open", tabKey: "side", url: "about:blank" }, null);
    await browser.stop("side");
    expect(invoke).toHaveBeenLastCalledWith(BROWSER_CHANNEL, { op: "stop", tabKey: "side" }, { hostId: "ssh-other", epoch: "" });
    await browser.close("side", { unmount: true });
    expect(invoke).toHaveBeenLastCalledWith(BROWSER_CHANNEL, { op: "close", tabKey: "side", unmount: true }, { hostId: "ssh-other", epoch: "" });
    await browser.ownerInput("side", "keydown");
    expect(invoke).toHaveBeenLastCalledWith(BROWSER_CHANNEL, { op: "ownerInput", tabKey: "side", kind: "keydown" }, { hostId: "ssh-other", epoch: "" });
  });
  it("passes two-phase receipt exactly without adding arbitrary Electron authority", async () => {
    const invoke = vi.fn(async () => undefined);
    const bridge = browserBridge({ invoke, binding: () => ({ hostId: "local", epoch: "epoch" }), subscribe: () => () => {} });
    const receipt = { src: "about:blank#fixture-ticket", webContentsId: 5 };
    await bridge.forHost("local").open("side", "about:blank", receipt);
    expect(invoke).toHaveBeenCalledWith(BROWSER_CHANNEL, { op: "open", tabKey: "side", url: "about:blank", receipt }, { hostId: "local", epoch: "epoch" });
  });
  it("uses the already HostTag-filtered event subscription and returns its unsubscribe", () => {
    const unsubscribe = vi.fn(), subscribe = vi.fn((_listener: (event: BrowserEvent) => void) => unsubscribe);
    const bridge = browserBridge({ invoke: async () => undefined, binding: () => null, subscribe });
    const listener = vi.fn(); expect(bridge.subscribe(listener)).toBe(unsubscribe);
    expect(subscribe).toHaveBeenCalledWith(listener);
  });
});

describe("browser control settings and HostTag coverage", () => {
  it("defaults unknown persisted preferences and strictly bounds IPC values", () => {
    expect(normalizeBrowserControlSettings(null)).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
    expect(normalizeBrowserControlSettings({ hiddenTarget: "reject", viewport: { width: 0, height: 900 }, idleDetachSeconds: Infinity }))
      .toEqual({ hiddenTarget: "reject", viewport: { width: 1280, height: 900 }, idleDetachSeconds: 30 });
    expect(isBrowserControlSettings(DEFAULT_BROWSER_CONTROL_SETTINGS)).toBe(true);
    for (const idleDetachSeconds of [0, 4, 601, NaN, 5.5]) expect(isBrowserControlSettings({ ...DEFAULT_BROWSER_CONTROL_SETTINGS, idleDetachSeconds })).toBe(false);
  });
  it("N3 requires every HostTag payload key to be enrolled (checked by web/node tsc, not only Vitest)", () => {
    type Tagged<T> = { [K in keyof T]: T[K] extends HostTag ? K : never }[keyof T];
    type Coverage<T> = Exclude<Tagged<T>, typeof HOST_TAGGED_EVENTS[number]> extends never ? true : false;
    const complete: Coverage<DesktopEvents> = true;
    // Negative fixture: a hypothetical forgotten tagged event must fail compilation.
    // @ts-expect-error missing event cannot satisfy coverage
    const missing: Coverage<DesktopEvents & { missingTaggedFixture: HostTag & { value: number } }> = true;
    expect(complete).toBe(true); expect(missing).toBe(true);
    expect(HOST_TAGGED_EVENTS).toContain("browserEvent");
  });
});
