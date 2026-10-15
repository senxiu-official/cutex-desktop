import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserServiceSession, parseBrowserServiceUrl, safeServicePath, serviceDisplayUrl } from "../src/main/browser/services";
import { BrowserRelayError, browserServiceRelayError } from "../src/main/browser/relayTypes";

function fixture(lifetime = true, isAvailable?: () => boolean, idempotentLease?: () => boolean) {
  let port = 26070;
  const request = vi.fn(async (_method: string, path: string) => path.endsWith("view-ticket") ?
    { hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=one-use&next=%2F" } : { leaseId: "lease-1" });
  const check = vi.fn();
  const onError = vi.fn();
  const session = new BrowserServiceSession({ client: { request: request as any }, target: { slug: "docs", path: "/" },
    check, isAvailable, connectionPort: () => port, lifetime, idempotentLease, onError });
  return { session, request, check, onError, setPort: (value: number) => { port = value; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("browser service proxy", () => {
  it("decodes cutex key exactly once and round trips encoded path/query", () => {
    const target = { slug: "docs", path: "/a%20b?q=hello%20world" };
    expect(parseBrowserServiceUrl(serviceDisplayUrl(target))).toEqual(target);
    expect(parseBrowserServiceUrl("cutex://service/docs")).toBeNull();
    expect(parseBrowserServiceUrl("cutex:service/docs/%ZZ")).toBeNull();
  });
  it("refuses credentials, old tunnel ports, internal auth paths, and ambiguous paths", () => {
    for (const url of ["http://u:p@docs.svc.localhost:26070/", "http://docs.svc.localhost:26071/", "http://docs.svc.localhost:26070/__cutex/auth?ticket=x"])
      expect(parseBrowserServiceUrl(url, 26070)).toBeNull();
    expect(parseBrowserServiceUrl("http://docs.svc.localhost:26070/a?q=1", 26070)).toEqual({ slug: "docs", path: "/a?q=1" });
    // An agent dropping the proxy port still means this host's service (owner report 2026-10-13).
    expect(parseBrowserServiceUrl("http://reader-doodle.svc.localhost/", 26070)).toEqual({ slug: "reader-doodle", path: "/" });
    expect(parseBrowserServiceUrl("https://reader-doodle.svc.localhost/", 26070)).toBeNull();
    for (const path of ["//evil", "/\\evil", "/a\n", "/__cutex/auth", "/#x"]) expect(safeServicePath(path)).toBe(false);
  });
  it("starts owner service, acquires lease, and re-reads current connection port", async () => {
    const f = fixture();
    expect(await f.session.start()).toContain(":26070/__cutex/auth?");
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/", start: true, routing: "host" } });
    f.setPort(26080);
    expect(await f.session.ticket()).toContain(":26080/");
    f.session.dispose();
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-1");
  });
  it("bounds authentication retries and never exposes ticket via display URL", async () => {
    const f = fixture(false);
    await f.session.start(); await f.session.retryAuthentication();
    await expect(f.session.retryAuthentication()).rejects.toThrow("service_auth_failed");
    expect(f.request).toHaveBeenCalledTimes(2);
    f.session.dispose();
  });
  it("reauthenticates the current service path, not the initially opened page", async () => {
    const f = fixture(false); await f.session.start();
    f.session.setPath("/page2?keep=1"); await f.session.retryAuthentication();
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/view-ticket", { body: { path: "/page2?keep=1", start: false, routing: "host" } });
    f.session.dispose();
  });
  it("reacquires lease_not_found after daemon restart", async () => {
    const f = fixture(); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "lease_not_found" });
    await f.session.renew();
    expect(f.request.mock.calls.filter(([, p]) => p.endsWith("/lease"))).toHaveLength(2);
    f.session.dispose();
  });
  it("checks service tombstone on service_not_found, not on arbitrary errors", async () => {
    const f = fixture(); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "service_not_found" }).mockRejectedValueOnce({ code: "service_reclaimed" });
    await expect(f.session.renew()).rejects.toEqual({ code: "service_reclaimed" });
    expect(f.request).toHaveBeenCalledWith("GET", "/v2/services/docs");
    f.session.dispose();
  });
  it("fences a late lease reply and releases it", async () => {
    const f = fixture(); f.check.mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("host switched"); });
    await expect(f.session.start()).rejects.toThrow("host switched");
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/lease-1");
    f.session.dispose();
  });
  it("stops scheduled renewal on disposal", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); await f.session.start(); f.session.dispose();
      const calls = f.request.mock.calls.length;
      await vi.advanceTimersByTimeAsync(180_000);
      expect(f.request).toHaveBeenCalledTimes(calls);
      await expect(f.session.ticket()).rejects.toThrow("target_closed");
    } finally { vi.useRealTimers(); }
  });
});

describe("browser service transient health", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refuses all foreground requests while unavailable, checking identity first", async () => {
    const isAvailable = vi.fn(() => false);
    const f = fixture(true, isAvailable);
    await expect(f.session.start()).rejects.toThrow("service_unavailable");
    await expect(f.session.ticket()).rejects.toThrow("service_unavailable");
    await expect(f.session.retryAuthentication()).rejects.toThrow("service_unavailable");
    await expect(f.session.renew()).rejects.toThrow("service_unavailable");
    expect(f.request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    isAvailable.mockClear();
    f.check.mockImplementation(() => { throw new Error("identity_revoked"); });
    await expect(f.session.ticket()).rejects.toThrow("identity_revoked");
    expect(isAvailable).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it("retains the lease without offline RPCs and automatically resumes within five seconds", async () => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    available = false;
    await vi.advanceTimersByTimeAsync(74_999);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    available = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-1");
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.request).toHaveBeenCalledTimes(4);
    f.session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reacquires a lost lease after recovery and renews only the replacement", async () => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    available = false;
    await vi.advanceTimersByTimeAsync(60_000);
    available = true;
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockResolvedValueOnce({ leaseId: "lease-2" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.request.mock.calls.filter(([, path]) => path.endsWith("/lease"))).toHaveLength(2);
    expect(f.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-2");
    f.session.dispose();
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/lease-2");
  });

  it.each(["resolve", "reject"] as const)("pauses an in-flight renewal that later %ss while offline", async (outcome) => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    const reply = deferred<{ leaseId: string }>();
    f.request.mockImplementationOnce(() => reply.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    available = false;
    if (outcome === "resolve") reply.resolve({ leaseId: "ignored-renewal-body" });
    else reply.reject(new Error("transport_failed"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    available = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-1");
    expect(f.request).toHaveBeenCalledTimes(4);
    f.session.dispose();
  });

  it("keeps a late replacement lease while offline without issuing a cleanup RPC", async () => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    const reply = deferred<{ leaseId: string }>();
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockImplementationOnce(() => reply.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    available = false;
    reply.resolve({ leaseId: "lease-2" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.request).toHaveBeenCalledTimes(4);
    expect(f.request.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    expect(f.onError).not.toHaveBeenCalled();
    await expect(f.session.ticket()).rejects.toThrow("service_unavailable");
    available = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-2");
    expect(f.request).toHaveBeenCalledTimes(5);
    f.session.dispose();
  });

  it("retries a replacement acquisition interrupted by an outage", async () => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    const reply = deferred<{ leaseId: string }>();
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockImplementationOnce(() => reply.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    available = false;
    reply.reject(new Error("transport_failed"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.request).toHaveBeenCalledTimes(4);
    expect(f.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    available = true;
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockResolvedValueOnce({ leaseId: "lease-2" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.request).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-2");
    f.session.dispose();
  });

  it.each([false, true])("never treats an identity error as temporary (already paused: %s)", async (alreadyPaused) => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    available = false;
    if (alreadyPaused) await vi.advanceTimersByTimeAsync(60_000);
    // Sharing the external error message must not confer the private retry marker.
    f.check.mockImplementation(() => { throw new Error("service_unavailable"); });
    await vi.advanceTimersByTimeAsync(alreadyPaused ? 5_000 : 60_000);
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("service_unavailable");
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/lease-1");
    expect(vi.getTimerCount()).toBe(0);
    available = true;
    f.check.mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.request).toHaveBeenCalledTimes(3);
    await expect(f.session.ticket()).rejects.toThrow("target_closed");
  });

  it("disposes a paused lease immediately and never retries after health recovery", async () => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    available = false;
    await vi.advanceTimersByTimeAsync(60_000);
    f.session.dispose(); f.session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.request).toHaveBeenCalledTimes(3);
    available = true;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("rejects a late start lease while offline without requesting a ticket", async () => {
    let available = true;
    const f = fixture(true, () => available);
    const reply = deferred<{ leaseId: string }>();
    f.request.mockImplementationOnce(() => reply.promise);
    const result = expect(f.session.start()).rejects.toThrow("service_unavailable");
    available = false;
    reply.resolve({ leaseId: "lease-1" });
    await result;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.onError).not.toHaveBeenCalled();
    f.session.dispose();
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/lease-1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("rejects a late ticket while offline (lifetime: %s)", async (lifetime) => {
    let available = true;
    const f = fixture(lifetime, () => available);
    await f.session.start();
    const reply = deferred<{ hostLabel: string; authPath: string }>();
    f.request.mockImplementationOnce(() => reply.promise);
    const result = expect(f.session.ticket()).rejects.toThrow("service_unavailable");
    available = false;
    reply.resolve({ hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=late" });
    await result;
    expect(f.request).toHaveBeenCalledTimes(lifetime ? 3 : 2);
    f.session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not adopt a late lease after identity revocation even while unavailable", async () => {
    let available = true;
    const f = fixture(true, () => available);
    const reply = deferred<{ leaseId: string }>();
    f.request.mockImplementationOnce(() => reply.promise);
    const result = expect(f.session.start()).rejects.toThrow("identity_revoked");
    available = false;
    f.check.mockImplementation(() => { throw new Error("identity_revoked"); });
    reply.resolve({ leaseId: "late-lease" });
    await result;
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/late-lease");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.request).toHaveBeenCalledTimes(2);
    f.session.dispose();
  });

  it("ignores an in-flight renewal completion after explicit disposal", async () => {
    let available = true;
    const f = fixture(true, () => available);
    await f.session.start();
    const reply = deferred<{ leaseId: string }>();
    f.request.mockImplementationOnce(() => reply.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    f.session.dispose();
    available = false;
    reply.resolve({ leaseId: "ignored-renewal-body" });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.request).toHaveBeenCalledTimes(4);
    expect(f.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("service failures as relay codes (a reclaimed service is not an uncertain browser outcome)", () => {
  const daemon = (code: string) => Object.assign(Error("private daemon detail"), { code });
  it.each(["service_not_found", "service_reclaimed", "service_start_failed", "lease_not_found", "not_found"])("daemon %s → service_unavailable", code => {
    expect(browserServiceRelayError(daemon(code))).toBe("service_unavailable");
  });
  it("keeps relay codes, aliases and identity errors as they are", () => {
    expect(browserServiceRelayError(new BrowserRelayError("target_closed"))).toBe("target_closed");
    expect(browserServiceRelayError(daemon("permission_denied"))).toBe("permission_denied");
    expect(browserServiceRelayError(daemon("lease_expired"))).toBe("lease_revoked");
    expect(browserServiceRelayError(Error("service_auth_failed"))).toBe("service_auth_failed");
    expect(browserServiceRelayError(Error("invalid_service_ticket"))).toBe("service_unavailable");
    expect(browserServiceRelayError(Error("module_disabled"))).toBe("browser_disabled");
    expect(browserServiceRelayError(Error("host switched"))).toBe("service_unavailable");
  });
  it("a transport failure stays browser_unavailable", () => {
    expect(browserServiceRelayError(daemon("transport_error"))).toBe("browser_unavailable");
    expect(browserServiceRelayError(new BrowserRelayError("browser_unavailable"))).toBe("browser_unavailable");
  });
});

describe("bounded service lease RPC recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["transport_error", "http_502", "http_503", "http_504"])("recovers %s without replaying ticket/navigation or releasing the lease", async code => {
    const f = fixture(true, () => true); await f.session.start();
    f.request.mockRejectedValueOnce({ code });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.request.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    await vi.advanceTimersByTimeAsync(4_999); expect(f.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); expect(f.request).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000); expect(f.request).toHaveBeenCalledTimes(5);
    expect(f.request.mock.calls.filter(([, path]) => path.endsWith("view-ticket"))).toHaveLength(1);
    f.session.dispose();
  });

  it("handles the actual CutexUnreachableError from the HTTP client", async () => {
    const { CutexUnreachableError } = await import("@cutex-desktop/cutex-client");
    const f = fixture(true, () => true); await f.session.start();
    f.request.mockRejectedValueOnce(new CutexUnreachableError("http://127.0.0.1:1", new Error("connection reset")));
    await vi.advanceTimersByTimeAsync(65_000);
    expect(f.request).toHaveBeenCalledTimes(4); expect(f.onError).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it("caps consecutive retries and releases only after the final failure", async () => {
    const f = fixture(true, () => true); await f.session.start();
    f.request.mockImplementation(async (method) => { if (method === "POST") throw { code: "transport_error" }; return { leaseId: "unused" }; });
    await vi.advanceTimersByTimeAsync(60_000);
    for (const delay of [5_000, 10_000, 20_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay); expect(f.onError).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("transport_error");
    expect(f.request.mock.calls.filter(([method, path]) => method === "POST" && path.endsWith("/lease/lease-1"))).toHaveLength(6);
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/lease-1");
    expect(vi.getTimerCount()).toBe(0);
    const count = f.request.mock.calls.length; await vi.advanceTimersByTimeAsync(300_000);
    expect(f.request).toHaveBeenCalledTimes(count);
  });

  it("resets backoff after a successful renewal", async () => {
    const f = fixture(); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(65_000);
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(f.request).toHaveBeenCalledTimes(6); expect(f.onError).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it("reacquires an expired lease after retry, including a failed replacement RPC", async () => {
    const f = fixture(); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(60_000);
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.onError).not.toHaveBeenCalled();
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockResolvedValueOnce({ leaseId: "lease-2" });
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-2");
    expect(f.request.mock.calls.filter(([, path]) => path.endsWith("view-ticket"))).toHaveLength(1);
    f.session.dispose();
  });

  it.each(["permission_denied", "service_reclaimed", "service_not_found", "http_401", "http_403", "invalid_service_lease"])("stops for terminal %s even after a transient error", async code => {
    const f = fixture(); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(60_000);
    f.request.mockRejectedValueOnce({ code });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.onError).toHaveBeenCalledExactlyOnceWith(code.startsWith("http_") ? "service_unavailable" : code);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cannot retry an identity failure even when its code resembles transport", async () => {
    const f = fixture(); await f.session.start();
    f.check.mockImplementation(() => { throw { code: "transport_error" }; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.request.mock.calls.filter(([method, path]) => method === "POST" && path.endsWith("/lease/lease-1"))).toHaveLength(0);
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("transport_error");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fences a generation change during backoff", async () => {
    const f = fixture(); await f.session.start(); f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(60_000);
    f.check.mockImplementation(() => { throw { code: "stale_connection" }; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.request).toHaveBeenCalledTimes(4); // start lease, ticket, failed renew, release
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("stale_connection");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a late replacement instead of adopting it after a generation change", async () => {
    const f = fixture(); await f.session.start(); const reply = deferred<{ leaseId: string }>();
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockImplementationOnce(() => reply.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    f.check.mockImplementation(() => { throw { code: "stale_connection" }; });
    reply.resolve({ leaseId: "late-lease" }); await vi.advanceTimersByTimeAsync(0);
    expect(f.request).toHaveBeenCalledWith("DELETE", "/v2/services/docs/lease/late-lease");
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("stale_connection");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closing during backoff prevents further RPCs", async () => {
    const f = fixture(); await f.session.start(); f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(60_000); f.session.dispose();
    const count = f.request.mock.calls.length; await vi.advanceTimersByTimeAsync(300_000);
    expect(f.request).toHaveBeenCalledTimes(count); expect(f.onError).not.toHaveBeenCalled();
  });
});

describe("lease retry rejection fences", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("does not classify a post-RPC identity error as a retryable RPC failure", async () => {
    const f = fixture(); await f.session.start();
    const reply = deferred<{ leaseId: string }>(); f.request.mockImplementationOnce(() => reply.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    f.check.mockImplementationOnce(() => { throw { code: "transport_error" }; });
    reply.resolve({ leaseId: "ignored" }); await vi.advanceTimersByTimeAsync(0);
    expect(f.onError).toHaveBeenCalledExactlyOnceWith("transport_error"); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("lease recovery never retries foreground effects", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("does not replay a failed initial lease acquisition", async () => {
    const f = fixture(); f.request.mockRejectedValueOnce({ code: "transport_error" });
    await expect(f.session.start()).rejects.toMatchObject({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.request).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    f.session.dispose();
  });
  it("does not retry a failed view-ticket while maintaining the independent lease", async () => {
    const f = fixture(); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await expect(f.session.ticket(true)).rejects.toMatchObject({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(f.request.mock.calls.filter(([, path]) => path.endsWith("view-ticket"))).toHaveLength(2);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/v2/services/docs/lease/lease-1");
    f.session.dispose();
  });
  it("pauses RPC retries while health is offline and resumes only on the same identity", async () => {
    let available = true; const f = fixture(true, () => available); await f.session.start();
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(60_000); available = false;
    await vi.advanceTimersByTimeAsync(20_000); expect(f.request).toHaveBeenCalledTimes(3);
    available = true; await vi.advanceTimersByTimeAsync(5_000);
    expect(f.request).toHaveBeenCalledTimes(4); expect(f.onError).not.toHaveBeenCalled();
    f.session.dispose();
  });
});

describe("idempotent lease opens (services-lease-idempotent)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const opens = (request: ReturnType<typeof fixture>["request"]) => request.mock.calls
    .filter(([method, path]) => method === "POST" && path === "/v2/services/docs/lease")
    .map(call => (call as unknown as [string, string, { body: { holder: string; clientLeaseId?: string } }])[2].body);

  it("sends no key to a host without the capability", async () => {
    const f = fixture(true, undefined, () => false); await f.session.start();
    expect(opens(f.request)).toEqual([{ holder: "desktop-browser" }]);
    f.session.dispose();
  });

  it("reuses one key across retries of a reacquire and draws a new one after success", async () => {
    const f = fixture(true, () => true, () => true); await f.session.start();
    const [first] = opens(f.request);
    expect(first!.clientLeaseId).toMatch(/^[0-9a-f-]{36}$/);
    // Renewal finds the lease gone; the replacement open is interrupted, then retried.
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockRejectedValueOnce({ code: "transport_error" });
    await vi.advanceTimersByTimeAsync(60_000);
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockResolvedValueOnce({ leaseId: "lease-2" });
    await vi.advanceTimersByTimeAsync(5_000);
    const [, interrupted, retried] = opens(f.request);
    expect(interrupted!.clientLeaseId).toBeDefined();
    expect(interrupted!.clientLeaseId).not.toBe(first!.clientLeaseId);
    expect(retried!.clientLeaseId).toBe(interrupted!.clientLeaseId);
    // The next logical open (after another expiry) uses a fresh key.
    f.request.mockRejectedValueOnce({ code: "lease_not_found" }).mockResolvedValueOnce({ leaseId: "lease-3" });
    await vi.advanceTimersByTimeAsync(60_000);
    const next = opens(f.request)[3];
    expect(next!.clientLeaseId).not.toBe(retried!.clientLeaseId);
    expect(f.onError).not.toHaveBeenCalled();
    f.session.dispose();
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/lease-3");
  });

  it("releases the lease an interrupted start may have created when the tab closes", async () => {
    const f = fixture(true, undefined, () => true);
    f.request.mockRejectedValueOnce({ code: "transport_error" });
    await expect(f.session.start()).rejects.toMatchObject({ code: "transport_error" });
    f.request.mockResolvedValueOnce({ leaseId: "orphan-1" });
    f.session.dispose();
    await vi.advanceTimersByTimeAsync(0);
    const [attempt, replay] = opens(f.request);
    expect(replay!.clientLeaseId).toBe(attempt!.clientLeaseId);
    expect(f.request).toHaveBeenLastCalledWith("DELETE", "/v2/services/docs/lease/orphan-1");
    // A disposed session issues nothing else.
    const count = f.request.mock.calls.length; await vi.advanceTimersByTimeAsync(300_000);
    expect(f.request).toHaveBeenCalledTimes(count);
  });
});
