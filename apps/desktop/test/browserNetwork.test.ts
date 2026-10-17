import { EventEmitter } from "node:events";
import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { BROWSER_LOCAL_PROXY, createBrowserUrlPolicy, createBrowserWindowOpenHandler, denyBrowserClientCertificates, hardenBrowserGuest, installBrowserSessionPolicy, revokeBrowserSessionPolicy,
  type BrowserNetworkHost, type BrowserPopupPolicyOptions } from "../src/main/browser/network";

function sessionMock() {
  const emitter = new EventEmitter();
  let request: any, check: any, device: any, cert: any, before: any, headers: any;
  const proxy = vi.fn(async () => {});
  const session = Object.assign(emitter, { setPermissionRequestHandler: (fn: any) => { request = fn; },
    setPermissionCheckHandler: (fn: any) => { check = fn; }, setDevicePermissionHandler: (fn: any) => { device = fn; },
    setCertificateVerifyProc: (fn: any) => { cert = fn; }, setProxy: proxy,
    webRequest: { onBeforeRequest: (_filter: any, fn: any) => { before = fn; }, onHeadersReceived: (_filter: any, fn: any) => { headers = fn; } } });
  return { session: session as unknown as Session, proxy, emitter,
    permission() { const callback = vi.fn(); request(null, "media", callback); return callback.mock.calls[0]?.[0]; },
    check: () => check(), device: () => device(),
    cert(errorCode: number, verificationResult: string) { const callback = vi.fn(); cert({ errorCode, verificationResult }, callback); return callback.mock.calls[0]?.[0]; },
    request(url: string, resourceType = "mainFrame", webContentsId = 7) {
      const callback = vi.fn(); before({ url, resourceType, webContentsId }, callback); return callback.mock.calls[0]?.[0];
    },
    response(details: any) { const callback = vi.fn(); headers(details, callback); return callback; },
  };
}
function guestMock() {
  const guest = new EventEmitter();
  let open: any;
  const webRTC = vi.fn();
  const setWindowOpenHandler = vi.fn((fn: any) => { open = fn; });
  Object.assign(guest, { id: 7, setWebRTCIPHandlingPolicy: webRTC, setWindowOpenHandler });
  return { guest: guest as unknown as WebContents, emitter: guest, webRTC, setWindowOpenHandler,
    open: (url: string, extra = {}) => open({ url, frameName: "_blank", disposition: "new-window", features: "", ...extra }) };
}
describe("browser local URL policy", () => {
  it.each(["http://localhost:26111/", "https://127.0.0.1:26112/a", "http://[::1]:26113/", "about:blank"])("allows local literal %s", url => {
    expect(createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }) }).isNavigationAllowed(url)).toBe(true);
  });
  it.each(["https://example.com/", "file:///secret", "data:text/html,x", "javascript:alert(1)", "http://localhost.evil/",
    "http://localhost./", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/",
    "http://user:pass@localhost/", "http://localhost\\@example.com/", " http://localhost/", "http://localhost/\n", "about:blank#x", "http://other.svc.localhost:26111/"])("denies %s", url => {
    const policy = createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }) });
    expect(policy.isNavigationAllowed(url)).toBe(false);
    expect(policy.isRequestAllowed(url, "script")).toBe(false);
  });
  it("SSH never interprets remote loopback as desktop loopback", () => {
    const policy = createBrowserUrlPolicy({ getHost: () => ({ kind: "ssh" }) });
    expect(policy.isNavigationAllowed("http://127.0.0.1:26111/")).toBe(false);
    expect(policy.isNavigationAllowed("http://localhost:26111/")).toBe(false);
    expect(policy.isNavigationAllowed("about:blank")).toBe(true);
  });
  it("service origins use current connection port and capability on any host", () => {
    let host: BrowserNetworkHost | undefined = { kind: "ssh", serviceProxy: true, connectionPort: 26111 };
    const policy = createBrowserUrlPolicy({ getHost: () => host });
    expect(policy.isNavigationAllowed("http://report.svc.localhost:26111/path")).toBe(true);
    expect(policy.isRequestAllowed("ws://report.svc.localhost:26111/socket", "webSocket")).toBe(true);
    expect(policy.isNavigationAllowed("https://report.svc.localhost:26111/")).toBe(false);
    expect(policy.isNavigationAllowed("http://report.svc.localhost:26112/")).toBe(false);
    host.connectionPort = 26112;
    expect(policy.isNavigationAllowed("http://report.svc.localhost:26111/")).toBe(false);
    expect(policy.isNavigationAllowed("http://report.svc.localhost:26112/")).toBe(true);
    host.serviceProxy = false;
    expect(policy.isNavigationAllowed("http://report.svc.localhost:26112/")).toBe(false);
    host = undefined;
    expect(policy.isNavigationAllowed("about:blank")).toBe(false);
  });
  it("WebSocket is resource-only; every external subresource is denied", () => {
    const policy = createBrowserUrlPolicy({ getHost: () => ({ kind: "dev-direct" }) });
    expect(policy.isRequestAllowed("ws://localhost:26111/ws", "webSocket")).toBe(true);
    expect(policy.isNavigationAllowed("ws://localhost:26111/ws")).toBe(false);
    for (const type of ["image", "script", "xhr", "stylesheet", "font", "media", "subFrame", "webSocket", "other"])
      expect(policy.isRequestAllowed("https://example.com/", type)).toBe(false);
    expect(policy.isRequestAllowed("about:blank", "subFrame")).toBe(true);
    expect(policy.isRequestAllowed("about:blank", "script")).toBe(false);
  });
  it("public origins cannot be smuggled through service localUrl metadata", () => {
    expect(createBrowserUrlPolicy({ getHost: () => ({ kind: "local", serviceLocalUrls: ["https://example.com/"] }) })
      .isNavigationAllowed("https://example.com/")).toBe(false);
  });
});
describe("browser dedicated session hardening", () => {
  const options = () => ({ partition: "persist:browser-local", registeredHostIds: ["local"],
    policy: createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }), admitted: () => true }), acceptWebContents: (id: number) => id === 7 });
  it("denies permissions/devices and invalid certificates, cancels downloads", async () => {
    const mock = sessionMock(); await installBrowserSessionPolicy(mock.session, options());
    expect(mock.permission()).toBe(false); expect(mock.check()).toBe(false); expect(mock.device()).toBe(false);
    expect(mock.cert(-202, "CERT_AUTHORITY_INVALID")).toBe(-2);
    expect(mock.cert(0, "NOT_OK")).toBe(-2);
    expect(mock.cert(0, "OK")).toBe(-3); // Default Chromium verification, not unconditional trust.
    // Electron 44 really reports net::ErrorToString(): "net::OK" for a valid chain (the docs say "OK").
    // Matching only "OK" refused every HTTPS page (Windows acceptance E4, 0.1.3).
    expect(mock.cert(0, "net::OK")).toBe(-3);
    expect(mock.cert(-202, "net::ERR_CERT_AUTHORITY_INVALID")).toBe(-2);
    expect(mock.cert(0, "net::ERR_CERT_REVOKED")).toBe(-2);
    expect(mock.cert(-200, "net::OK")).toBe(-2);
    expect(mock.cert(0, "net::net::OK")).toBe(-2);
    expect(mock.cert(0, "xnet::OK")).toBe(-2);
    const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn() };
    mock.emitter.emit("will-download", event, item);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(item.cancel).toHaveBeenCalledOnce();
    expect(mock.proxy).toHaveBeenCalledWith(BROWSER_LOCAL_PROXY);
  });
  it("denies before proxy setup completes and after dispose; no unknown guests or workers", async () => {
    const mock = sessionMock(); let release!: () => void;
    mock.proxy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const ready = installBrowserSessionPolicy(mock.session, options());
    expect(mock.request("http://localhost:26111/")).toEqual({ cancel: true });
    release(); const control = await ready;
    expect(mock.request("http://localhost:26111/")).toEqual({ cancel: false });
    expect(mock.request("http://localhost:26111/", "xhr", -1)).toEqual({ cancel: true });
    expect(mock.request("http://localhost:26111/", "xhr", 8)).toEqual({ cancel: true });
    expect(mock.request("about:blank", "mainFrame", 8)).toEqual({ cancel: false });
    expect(mock.request("about:blank", "script", 8)).toEqual({ cancel: true });
    expect(mock.request("https://example.com/", "script")).toEqual({ cancel: true });
    control.dispose();
    expect(mock.request("http://localhost:26111/")).toEqual({ cancel: true });
  });
  it("does not touch a default/plugin or unknown partition; idempotent per browser session", async () => {
    const mock = sessionMock();
    await expect(installBrowserSessionPolicy(mock.session, { ...options(), partition: "" })).rejects.toThrow();
    expect(mock.proxy).not.toHaveBeenCalled();
    const first = installBrowserSessionPolicy(mock.session, options());
    expect(installBrowserSessionPolicy(mock.session, options())).toBe(first);
    await first;
    await expect(installBrowserSessionPolicy(mock.session, { ...options(), partition: "persist:browser-agent-local" })).rejects.toThrow();
    expect(mock.proxy).toHaveBeenCalledOnce();
  });
  it("failed setup cannot later silently enable traffic", async () => {
    const mock = sessionMock(); mock.proxy.mockRejectedValueOnce(new Error("proxy failure"));
    await expect(installBrowserSessionPolicy(mock.session, options())).rejects.toThrow("proxy failure");
    expect(mock.request("http://localhost:26111/")).toEqual({ cancel: true });
    await expect(installBrowserSessionPolicy(mock.session, options())).rejects.toThrow("proxy failure");
  });
  it("window recreation installs fresh registry/policy closures without duplicate download handlers", async () => {
    const mock = sessionMock();
    const first = await installBrowserSessionPolicy(mock.session, options());
    first.dispose();
    expect(mock.request("http://localhost:26111/")).toEqual({ cancel: true });
    const second = await installBrowserSessionPolicy(mock.session, { ...options(), acceptWebContents: id => id === 8 });
    expect(mock.request("http://localhost:26111/", "mainFrame", 7)).toEqual({ cancel: true });
    expect(mock.request("http://localhost:26111/", "mainFrame", 8)).toEqual({ cancel: false });
    first.dispose(); // Late disposal must not evict the replacement registration.
    expect(await installBrowserSessionPolicy(mock.session, options())).toBe(second);
    expect(mock.proxy).toHaveBeenCalledTimes(2);
    const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn() };
    mock.emitter.emit("will-download", event, item);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(item.cancel).toHaveBeenCalledOnce();
    second.dispose();
  });
  it("synchronously revokes pending setup; its late completion cannot reactivate or evict new window policy", async () => {
    const mock = sessionMock(); let finishOldProxy!: () => void;
    mock.proxy.mockImplementationOnce(() => new Promise<void>(resolve => { finishOldProxy = resolve; }));
    const old = installBrowserSessionPolicy(mock.session, options());
    const rejected = expect(old).rejects.toThrow("revoked during setup");
    revokeBrowserSessionPolicy(mock.session);
    expect(mock.request("http://localhost:26111/")).toEqual({ cancel: true });
    const replacement = installBrowserSessionPolicy(mock.session, { ...options(), acceptWebContents: id => id === 8 });
    expect(mock.proxy).toHaveBeenCalledTimes(1); // Shared queue waits for the old configuration.
    finishOldProxy(); await rejected;
    const replacementControl = await replacement;
    expect(mock.request("http://localhost:26111/", "mainFrame", 8)).toEqual({ cancel: false });
    expect(installBrowserSessionPolicy(mock.session, options())).toBe(replacement);
    expect(mock.request("http://localhost:26111/", "mainFrame", 7)).toEqual({ cancel: true });
    expect(mock.request("http://localhost:26111/", "mainFrame", 8)).toEqual({ cancel: false });
    expect(mock.proxy).toHaveBeenCalledTimes(2);
    revokeBrowserSessionPolicy(mock.session);
    expect(mock.request("http://localhost:26111/", "mainFrame", 8)).toEqual({ cancel: true });
    replacementControl.dispose();
  });
  it("observes main-frame response for current guest only with normalized copied headers", async () => {
    const mock = sessionMock(), onResponse = vi.fn();
    await installBrowserSessionPolicy(mock.session, { ...options(), onResponse });
    const headers = { "X-Cutex-Service-Error": ["authentication_required"] };
    const details = { url: "http://localhost:26111/", statusCode: 401, webContentsId: 7, resourceType: "mainFrame", responseHeaders: headers };
    expect(mock.response(details)).toHaveBeenCalledWith({});
    expect(onResponse).toHaveBeenCalledWith(7, { url: details.url, statusCode: 401, headers: { "x-cutex-service-error": ["authentication_required"] } });
    headers["X-Cutex-Service-Error"].push("changed");
    expect(onResponse.mock.calls[0]![1].headers["x-cutex-service-error"]).toHaveLength(1);
    mock.response({ ...details, resourceType: "subFrame" }); mock.response({ ...details, webContentsId: 8 });
    expect(onResponse).toHaveBeenCalledOnce();
  });
});
describe("browser guest navigation and popup denial", () => {
  const policy = () => createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }), admitted: () => true });
  it.each([0, 1, 2])("rejects client certificate selection with %s offered identities, before later guest hardening", count => {
    const mock = guestMock(), order: string[] = [];
    denyBrowserClientCertificates(mock.guest);
    const event = { preventDefault: vi.fn(() => { order.push("preventDefault"); }) };
    const callback = vi.fn(() => { order.push("callback"); });
    const certificates = Array.from({ length: count }, () => new Proxy({}, { get() { throw new Error("Must not inspect/select an identity"); } }));
    mock.emitter.emit("select-client-certificate", event, "https://localhost:26111/private?token=not-logged", certificates, callback);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callback.mock.calls).toEqual([[]]); // No first certificate, undefined argument or UI selection.
    expect(order).toEqual(["preventDefault", "callback"]);
    expect(mock.webRTC).not.toHaveBeenCalled();
  });
  it("early and later hardening share one persistent client-certificate deny handler", () => {
    const mock = guestMock(), unrelated = guestMock();
    denyBrowserClientCertificates(mock.guest); denyBrowserClientCertificates(mock.guest);
    const dispose = hardenBrowserGuest(mock.guest, { hostId: "local", policy: policy() });
    expect(mock.emitter.listenerCount("select-client-certificate")).toBe(1);
    expect(unrelated.emitter.listenerCount("select-client-certificate")).toBe(0);
    dispose();
    for (let attempt = 0; attempt < 2; attempt++) {
      const event = { preventDefault: vi.fn() }, callback = vi.fn();
      mock.emitter.emit("select-client-certificate", event, "https://localhost/", [{ data: "never-selected" }], callback);
      expect(event.preventDefault).toHaveBeenCalledOnce(); expect(callback.mock.calls).toEqual([[]]);
    }
  });
  it("a failed certificate-handler registration propagates to the caller and is not marked installed", () => {
    const mock = guestMock();
    const listener = vi.spyOn(mock.emitter, "on").mockImplementationOnce(() => { throw new Error("registration failed"); });
    expect(() => denyBrowserClientCertificates(mock.guest)).toThrow("registration failed");
    listener.mockRestore();
    denyBrowserClientCertificates(mock.guest);
    expect(mock.emitter.listenerCount("select-client-certificate")).toBe(1);
  });
  it.each(["will-navigate", "will-frame-navigate", "will-redirect"])("checks every %s event", kind => {
    const mock = guestMock(), blocked = vi.fn();
    hardenBrowserGuest(mock.guest, { hostId: "local", policy: policy(), onBlocked: blocked });
    const allowed = { url: "http://localhost:26111/", preventDefault: vi.fn() };
    mock.emitter.emit(kind, allowed); expect(allowed.preventDefault).not.toHaveBeenCalled();
    const denied = { url: "https://example.com/", preventDefault: vi.fn() };
    mock.emitter.emit(kind, denied); expect(denied.preventDefault).toHaveBeenCalledOnce();
    expect(blocked).toHaveBeenCalledOnce();
    expect(mock.webRTC).toHaveBeenCalledWith("disable_non_proxied_udp");
  });
  it("always denies a BrowserWindow, forwarding only admitted HTTP owner activation under same host", () => {
    const mock = guestMock(), onNewTab = vi.fn(); let activation = false;
    let current: BrowserPopupPolicyOptions | undefined = { hostId: "local", webContentsId: 7, policy: policy(), onNewTab,
      consumeOwnerGesture: () => { const yes = activation; activation = false; return yes; } };
    mock.guest.setWindowOpenHandler(createBrowserWindowOpenHandler(() => current));
    const dispose = hardenBrowserGuest(mock.guest, { hostId: "local", policy: policy() });
    expect(mock.setWindowOpenHandler).toHaveBeenCalledOnce(); // Hardening never replaces the early guard.
    expect(mock.open("http://localhost:26111/")).toEqual({ action: "deny" });
    expect(onNewTab).not.toHaveBeenCalled();
    activation = true;
    expect(mock.open("http://localhost:26111/")).toEqual({ action: "deny" });
    expect(onNewTab).toHaveBeenCalledWith({ hostId: "local", url: "http://localhost:26111/" });
    mock.open("http://localhost:26111/"); expect(onNewTab).toHaveBeenCalledOnce();
    activation = true;
    mock.open("https://example.com/"); mock.open("javascript:alert(1)");
    mock.open("http://localhost:26111/", { postBody: { data: [] } });
    expect(onNewTab).toHaveBeenCalledOnce();
    current = undefined; dispose(); mock.open("http://localhost:26111/");
    expect(onNewTab).toHaveBeenCalledOnce();
  });
  it("no activation source means deny; page-supplied userGesture never grants forwarding", () => {
    const mock = guestMock(), onNewTab = vi.fn();
    mock.guest.setWindowOpenHandler(createBrowserWindowOpenHandler(() => ({ hostId: "local", webContentsId: 7, policy: policy(), onNewTab })));
    expect(mock.open("http://localhost:26111/", { userGesture: true })).toEqual({ action: "deny" });
    expect(onNewTab).not.toHaveBeenCalled();
  });
  it("missing admission, policy and gesture reject with enum-only diagnostics and no owner UI forwarding", () => {
    const mock = guestMock(), onNewTab = vi.fn(), diagnostic = vi.fn(), consumeOwnerGesture = vi.fn(() => true);
    let current: BrowserPopupPolicyOptions | undefined;
    mock.guest.setWindowOpenHandler(createBrowserWindowOpenHandler(() => current, diagnostic));
    expect(mock.open("http://localhost/?ticket=secret")).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenLastCalledWith("unavailable");
    current = { hostId: "local", webContentsId: 7, policy: policy(), consumeOwnerGesture, onNewTab };
    for (const url of ["about:blank", "javascript:alert(1)", "data:text/html,secret", "file:///secret", "cutex:service/docs/", "ws://localhost/"])
      expect(mock.open(url)).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenLastCalledWith("invalid_url");
    expect(mock.open("https://example.com/?secret=secret")).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenLastCalledWith("policy_denied");
    expect(mock.open("http://localhost/", { postBody: { data: [] } })).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenLastCalledWith("post_body");
    expect(consumeOwnerGesture).not.toHaveBeenCalled(); expect(onNewTab).not.toHaveBeenCalled();
    consumeOwnerGesture.mockReturnValue(false);
    expect(mock.open("http://localhost/")).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenLastCalledWith("no_owner_gesture");
    expect(diagnostic.mock.calls.every(call => call.length === 1 && !String(call[0]).includes("secret"))).toBe(true);
  });
  it("service links forward only as same-host HTTP URLs using the current policy, without native windows", () => {
    const mock = guestMock(), onNewTab = vi.fn();
    let host: BrowserNetworkHost | undefined = { kind: "ssh", serviceProxy: true, connectionPort: 26111 };
    const current = { hostId: "ssh-one", policy: createBrowserUrlPolicy({ getHost: () => host }), consumeOwnerGesture: () => true, onNewTab };
    mock.guest.setWindowOpenHandler(createBrowserWindowOpenHandler(() => current));
    expect(mock.open("http://docs.svc.localhost:26111/path")).toEqual({ action: "deny" });
    expect(onNewTab).toHaveBeenCalledWith({ hostId: "ssh-one", url: "http://docs.svc.localhost:26111/path" });
    host = undefined;
    expect(mock.open("http://docs.svc.localhost:26111/path")).toEqual({ action: "deny" });
    expect(onNewTab).toHaveBeenCalledOnce();
  });
  it.each(["options", "policy", "gesture", "forwarder", "diagnostic"])("%s exceptions still return native-window denial", stage => {
    const mock = guestMock(), diagnostic = vi.fn(() => { if (stage === "diagnostic") throw new Error("ignore"); });
    const explode = () => { throw new Error("ignore"); };
    const options = { hostId: "local", policy: stage === "policy" ? { isNavigationAllowed: explode, isRequestAllowed: explode, refusal: explode } : policy(),
      consumeOwnerGesture: stage === "gesture" ? explode : () => true, onNewTab: stage === "forwarder" ? explode : vi.fn() };
    mock.guest.setWindowOpenHandler(createBrowserWindowOpenHandler(stage === "options" ? explode : () => options, diagnostic));
    expect(mock.open(stage === "diagnostic" ? "about:blank" : "http://localhost/")).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenCalledOnce();
  });
  it("missing forwarding callback never spends owner activation", () => {
    const mock = guestMock(), consumeOwnerGesture = vi.fn(() => true), diagnostic = vi.fn();
    mock.guest.setWindowOpenHandler(createBrowserWindowOpenHandler(() => ({ hostId: "local", webContentsId: 7, policy: policy(), consumeOwnerGesture }), diagnostic));
    expect(mock.open("http://localhost/")).toEqual({ action: "deny" });
    expect(diagnostic).toHaveBeenCalledWith("no_forwarder"); expect(consumeOwnerGesture).not.toHaveBeenCalled();
  });
  it("disposed guest stays closed even if source frame keeps running", () => {
    const mock = guestMock(); const dispose = hardenBrowserGuest(mock.guest, { hostId: "local", policy: policy() });
    dispose(); const event = { url: "http://localhost:26111/", preventDefault: vi.fn() };
    mock.emitter.emit("will-frame-navigate", event); expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
