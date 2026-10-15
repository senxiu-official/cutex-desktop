import { describe, expect, it, vi } from "vitest";
import type { AuthInfo, Session } from "electron";
import { createBrowserEgress } from "../src/main/browser/egress";
import { BROWSER_LOCAL_PROXY, createBrowserUrlPolicy, installBrowserSessionPolicy, revokeBrowserSessionPolicy } from "../src/main/browser/network";
import { queueBrowserSessionProxy } from "../src/main/browser/sessionProxy";

const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const session = { setProxy: vi.fn(async () => {}), closeAllConnections: vi.fn(async () => {}) };
  const proxy = { port: 26291, credentials: { username: "test-user", password: "dummy-private-only", realm: "test-realm" },
    isPublicBrowserUrl: vi.fn((url: string) => url === "https://example.test/"), close: vi.fn(async () => {}) };
  const factory = vi.fn(async (_options: { onClosed?(): void }) => proxy), load = vi.fn(async () => ({ startBrowserEgressProxy: factory }));
  const owner = { on: true };
  const control = createBrowserEgress({ isEnabled: () => owner.on, load: load as any });
  const info = { isProxy: true, host: "127.0.0.1", port: proxy.port, scheme: "basic", realm: proxy.credentials.realm } as AuthInfo;
  return { session, target: session as unknown as Session, proxy, factory, load, control, info, owner };
}
describe("N2 lifecycle and credential boundary", () => {
  it.each([["off", () => false], ["throwing", () => { throw new Error("store broken"); }]])("never imports the proxy while the owner switch is %s", async (_label, isEnabled) => {
    const f = fixture(), control = createBrowserEgress({ isEnabled: isEnabled as () => boolean, load: f.load as any });
    await control.enableSession(f.target); control.revokeSession(f.target); control.stop();
    expect(f.load).not.toHaveBeenCalled(); expect(f.session.setProxy).not.toHaveBeenCalled();
    expect(control.isEnabled()).toBe(false);
    expect(control.isAllowed("https://example.test/")).toBe(false); expect(control.credentialsFor(f.target, f.info)).toBeUndefined();
    expect(f.session.closeAllConnections).not.toHaveBeenCalled();
  });
  it("switching off gates URLs and credentials synchronously; stop() closes the listener and restores the blackhole", async () => {
    const f = fixture(); await f.control.enableSession(f.target);
    expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(true);
    f.owner.on = false;
    expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(false);
    expect(f.control.isAllowed("https://example.test/")).toBe(false);
    expect(f.control.credentialsFor(f.target, f.info)).toBeUndefined();
    f.control.stop(); expect(f.proxy.close).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(f.session.setProxy).toHaveBeenLastCalledWith(BROWSER_LOCAL_PROXY));
    // While off, a new tab never re-imports or re-arms anything.
    await f.control.enableSession(f.target); expect(f.factory).toHaveBeenCalledOnce();
    f.owner.on = true; await f.control.enableSession(f.target);
    expect(f.factory).toHaveBeenCalledTimes(2); expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(true);
  });
  it("a switch-off during proxy startup never configures the session", async () => {
    const f = fixture(), pending = deferred<typeof f.proxy>();
    f.factory.mockImplementationOnce(() => pending.promise);
    const ready = f.control.enableSession(f.target), failed = expect(ready).rejects.toThrow("browser_egress_revoked");
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce());
    f.owner.on = false; pending.resolve(f.proxy); await failed;
    expect(f.session.setProxy).not.toHaveBeenCalled(); expect(f.control.credentialsFor(f.target, f.info)).toBeUndefined();
  });
  it("waits for proxy setup AND old pooled connections before admitting any external URL", async () => {
    const f = fixture(); let flush!: () => void;
    f.session.closeAllConnections.mockImplementationOnce(() => new Promise<void>(resolve => { flush = resolve; }));
    const ready = f.control.enableSession(f.target);
    await vi.waitFor(() => expect(f.session.closeAllConnections).toHaveBeenCalledOnce());
    expect(f.control.isAllowed("https://example.test/")).toBe(false); expect(f.control.credentialsFor(f.target, f.info)).toBeUndefined();
    flush(); await ready;
    expect(f.session.setProxy).toHaveBeenCalledWith({ mode: "fixed_servers", proxyRules: "http://127.0.0.1:26291", proxyBypassRules: BROWSER_LOCAL_PROXY.proxyBypassRules });
    expect(f.control.isAllowed("https://example.test/")).toBe(true);
    expect(f.control.isAllowed("http://127.0.0.1/")).toBe(false);
  });
  it("credentials require exact enabled session, proxy endpoint, Basic scheme and per-run realm", async () => {
    const f = fixture(); await f.control.enableSession(f.target);
    expect(f.control.credentialsFor(f.target, f.info)).toEqual({ username: "test-user", password: "dummy-private-only" });
    expect(f.control.credentialsFor({} as Session, f.info)).toBeUndefined();
    for (const change of [{ isProxy: false }, { host: "localhost" }, { host: "example.test" }, { port: 26070 }, { scheme: "digest" }, { realm: "other-run" }])
      expect(f.control.credentialsFor(f.target, { ...f.info, ...change })).toBeUndefined();
    f.control.stop();
    expect(f.control.credentialsFor(f.target, f.info)).toBeUndefined(); expect(f.control.isAllowed("https://example.test/")).toBe(false);
    expect(f.proxy.close).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(f.session.setProxy).toHaveBeenLastCalledWith(BROWSER_LOCAL_PROXY));
    expect(f.session.closeAllConnections).toHaveBeenCalledTimes(2);
  });
  it("revokes a late startup without reactivating and closes its eventual proxy", async () => {
    const f = fixture(); let finish!: (value: typeof f.proxy) => void;
    f.factory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const ready = f.control.enableSession(f.target), rejection = expect(ready).rejects.toThrow("browser_egress_revoked");
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce()); f.control.stop(); finish(f.proxy); await rejection;
    expect(f.proxy.close).toHaveBeenCalledOnce(); expect(f.session.setProxy).not.toHaveBeenCalled();
    expect(f.control.isAllowed("https://example.test/")).toBe(false);
  });
  it("revokes pending session configuration and serializes blackhole restoration before re-enable", async () => {
    const f = fixture(); let finish!: () => void;
    f.session.setProxy.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const ready = f.control.enableSession(f.target), rejection = expect(ready).rejects.toThrow("browser_egress_revoked");
    await vi.waitFor(() => expect(f.session.setProxy).toHaveBeenCalledOnce()); f.control.stop();
    const reopened = f.control.enableSession(f.target); finish(); await rejection; await reopened;
    expect(f.session.setProxy.mock.calls.map(call => (call as any)[0].proxyRules)).toEqual([
      "http://127.0.0.1:26291", BROWSER_LOCAL_PROXY.proxyRules, "http://127.0.0.1:26291",
    ]);
    expect(f.session.closeAllConnections).toHaveBeenCalledTimes(3);
    expect(f.control.credentialsFor(f.target, f.info)).toBeDefined();
  });
  it("unexpected listener close synchronously gates all sessions; failures do not revive a session", async () => {
    const f = fixture(); await f.control.enableSession(f.target); f.factory.mock.calls[0]![0].onClosed!();
    expect(f.control.isAllowed("https://example.test/")).toBe(false); expect(f.proxy.close).toHaveBeenCalledOnce();
    const broken = fixture(); broken.session.closeAllConnections.mockRejectedValueOnce(new Error("flush failed"));
    await expect(broken.control.enableSession(broken.target)).rejects.toThrow("flush failed");
    expect(broken.control.credentialsFor(broken.target, broken.info)).toBeUndefined();
    // Session failure is local; the caller's last-tab/global lifecycle owns listener shutdown.
    expect(broken.proxy.close).not.toHaveBeenCalled(); broken.control.stop(); expect(broken.proxy.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])("serializes replacement controllers behind old N2 setup and restoration (reject=%s)", async rejects => {
    const old = fixture(), replacement = fixture(), pending = deferred<void>(); replacement.proxy.port = 26292;
    old.session.setProxy.mockImplementationOnce(() => pending.promise);
    const first = old.control.enableSession(old.target), failed = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(old.session.setProxy).toHaveBeenCalledOnce()); old.control.stop();
    const next = replacement.control.enableSession(old.target);
    await Promise.resolve(); await Promise.resolve(); expect(old.session.setProxy).toHaveBeenCalledTimes(1);
    if (rejects) pending.reject(new Error("old setup failed")); else pending.resolve();
    await failed; await next;
    expect(old.session.setProxy.mock.calls.map(call => (call as any)[0].proxyRules)).toEqual([
      "http://127.0.0.1:26291", BROWSER_LOCAL_PROXY.proxyRules, "http://127.0.0.1:26292",
    ]);
    expect(old.control.isSessionAllowed(old.target, "https://example.test/")).toBe(false);
    expect(replacement.control.isSessionAllowed(old.target, "https://example.test/")).toBe(true);
    expect(replacement.control.credentialsFor(old.target, { ...replacement.info, port: 26292 })).toBeDefined();
  });
  it("base policy joins the same per-session queue between old cleanup and replacement N2", async () => {
    const old = fixture(), replacement = fixture(), pending = deferred<void>(); replacement.proxy.port = 26292;
    Object.assign(old.session, { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {},
      setCertificateVerifyProc() {}, on() {}, webRequest: { onBeforeRequest() {}, onHeadersReceived() {} } });
    old.session.setProxy.mockImplementationOnce(() => pending.promise);
    const first = old.control.enableSession(old.target), failed = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(old.session.setProxy).toHaveBeenCalledOnce()); old.control.stop();
    const base = installBrowserSessionPolicy(old.target, { partition: "persist:browser-local", registeredHostIds: ["local"],
      policy: createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }) }), acceptWebContents: () => true });
    const reopened = base.then(() => replacement.control.enableSession(old.target));
    expect(old.session.setProxy).toHaveBeenCalledTimes(1); pending.resolve(); await failed; await reopened;
    expect(old.session.setProxy.mock.calls.map(call => (call as any)[0].proxyRules)).toEqual([
      "http://127.0.0.1:26291", BROWSER_LOCAL_PROXY.proxyRules, BROWSER_LOCAL_PROXY.proxyRules, "http://127.0.0.1:26292",
    ]);
    expect(replacement.control.isSessionAllowed(old.target, "https://example.test/")).toBe(true);
    revokeBrowserSessionPolicy(old.target);
  });
  it("revokes A synchronously and restores only A, leaving ready partition B authorized", async () => {
    const f = fixture(), b = fixture(); await f.control.enableSession(f.target); await f.control.enableSession(b.target);
    f.control.revokeSession(f.target);
    expect(f.control.credentialsFor(f.target, f.info)).toBeUndefined();
    expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(false);
    expect(f.control.credentialsFor(b.target, f.info)).toBeDefined();
    expect(f.control.isSessionAllowed(b.target, "https://example.test/")).toBe(true);
    await vi.waitFor(() => expect(f.session.closeAllConnections).toHaveBeenCalledTimes(2));
    expect(f.session.setProxy).toHaveBeenLastCalledWith(BROWSER_LOCAL_PROXY);
    expect(b.session.setProxy).toHaveBeenCalledTimes(1); expect(b.session.closeAllConnections).toHaveBeenCalledTimes(1); expect(f.proxy.close).not.toHaveBeenCalled();
  });
  it.each([false, true])("pending A cannot revive or revoke replacement A/B after single-session revocation (reject=%s)", async rejects => {
    const f = fixture(), b = fixture(), pending = deferred<void>();
    await f.control.enableSession(b.target); f.session.setProxy.mockImplementationOnce(() => pending.promise);
    const first = f.control.enableSession(f.target), failed = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(f.session.setProxy).toHaveBeenCalledOnce());
    f.control.revokeSession(f.target); const replacement = f.control.enableSession(f.target);
    expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(false);
    expect(f.control.isSessionAllowed(b.target, "https://example.test/")).toBe(true);
    if (rejects) pending.reject(new Error("old A failed")); else pending.resolve();
    await failed; await replacement;
    expect(f.session.setProxy.mock.calls.map(call => (call as any)[0].proxyRules)).toEqual([
      "http://127.0.0.1:26291", BROWSER_LOCAL_PROXY.proxyRules, "http://127.0.0.1:26291",
    ]);
    expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(true);
    expect(f.control.isSessionAllowed(b.target, "https://example.test/")).toBe(true);
    expect(b.session.setProxy).toHaveBeenCalledTimes(1); expect(f.proxy.close).not.toHaveBeenCalled();
  });
  it("revocation while start is pending invalidates A without touching unconfigured sessions or pending B", async () => {
    const f = fixture(), b = fixture(), pending = deferred<typeof f.proxy>();
    f.factory.mockImplementationOnce(() => pending.promise);
    const aReady = f.control.enableSession(f.target), failed = expect(aReady).rejects.toThrow("browser_egress_revoked");
    const bReady = f.control.enableSession(b.target);
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce()); f.control.revokeSession(f.target);
    expect(f.session.setProxy).not.toHaveBeenCalled(); expect(f.session.closeAllConnections).not.toHaveBeenCalled();
    pending.resolve(f.proxy); await failed; await bReady;
    expect(f.session.setProxy).not.toHaveBeenCalled(); expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(false);
    expect(f.control.isSessionAllowed(b.target, "https://example.test/")).toBe(true); expect(f.proxy.close).not.toHaveBeenCalled();
  });
  it("an A configuration failure restores A only, never revoking ready B", async () => {
    const f = fixture(), b = fixture(); await f.control.enableSession(b.target);
    f.session.closeAllConnections.mockRejectedValueOnce(new Error("A flush failed"));
    await expect(f.control.enableSession(f.target)).rejects.toThrow("A flush failed");
    await vi.waitFor(() => expect(f.session.closeAllConnections).toHaveBeenCalledTimes(2));
    expect(f.control.isSessionAllowed(f.target, "https://example.test/")).toBe(false);
    expect(f.control.isSessionAllowed(b.target, "https://example.test/")).toBe(true);
    expect(b.session.setProxy).toHaveBeenCalledTimes(1); expect(f.proxy.close).not.toHaveBeenCalled();
  });
});

describe("shared browser Session proxy queue", () => {
  it("runs first work synchronously, publishes reentrant work and recovers after rejection", async () => {
    const session = {}, gate = deferred<void>(), order: number[] = []; let reentrant!: Promise<void>;
    const first = queueBrowserSessionProxy(session, () => { order.push(1); reentrant = queueBrowserSessionProxy(session, () => { order.push(2); }); return gate.promise; });
    expect(order).toEqual([1]);
    const failed = expect(first).rejects.toThrow("old failed"); gate.reject(new Error("old failed"));
    await failed; await reentrant; expect(order).toEqual([1, 2]);
    await queueBrowserSessionProxy(session, () => { order.push(3); }); expect(order).toEqual([1, 2, 3]);
  });
  it("a blocked session never blocks another partition's queue", async () => {
    const a = {}, b = {}, gate = deferred<void>();
    const first = queueBrowserSessionProxy(a, () => gate.promise);
    const work = vi.fn(); await queueBrowserSessionProxy(b, work); expect(work).toHaveBeenCalledOnce();
    gate.resolve(); await first;
  });
});
