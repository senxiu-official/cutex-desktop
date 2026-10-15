import { describe, expect, it, vi } from "vitest";
import type { BrowserSnapshot } from "@cutex-desktop/browser-protocol";
import { createBrowserModelAdapter, publicBrowserServiceUrl } from "../src/main/browser/modelAdapter";
import { serviceDisplayUrl } from "../src/main/browser/services";
import { createBrowserUrlPolicy } from "../src/main/browser/network";

function fixture() {
  const tab = { guestId: "browser-opaque-id", title: "fixture", url: "http://localhost/", pageGeneration: 1 };
  const snapshot: BrowserSnapshot = { pageGeneration: 1, snapshotId: 1, url: "http://localhost/?token=dummy",
    nodes: [{ ref: "private-ref", role: "button", name: "Save" }], truncated: false };
  const provider = { hasGrant: vi.fn(() => true), controlView: vi.fn(() => ({ grantee: "Agent" as const, state: "granted" as "granted" | "paused", operating: false })), snapshot: vi.fn(async () => snapshot),
    find: vi.fn(async () => snapshot), action: vi.fn(async () => ({ status: "dispatched" as const, pageGeneration: 2 })),
    navigate: vi.fn(async () => ({ status: "dispatched" as const, pageGeneration: 2 })), screenshot: vi.fn(), release: vi.fn() };
  const tabs = vi.fn(() => [tab]);
  const adapter = createBrowserModelAdapter({ provider, tabs, decodeImage: vi.fn() });
  return { tab, snapshot, provider, tabs, adapter };
}
describe("relay internal model adapter", () => {
  it.each(["tab.snapshot", "tab.find"] as const)("%s keeps executor output generation independent from the registry fence", async kind => {
    const f = fixture(); f.snapshot.pageGeneration = 7; f.tab.pageGeneration = 11;
    const result = await f.adapter.execute(f.tab.guestId, kind === "tab.snapshot" ? { kind } : { kind, query: { text: "Save" } }, {});
    expect(result).toMatchObject({ kind, pageGeneration: 7 });
    await f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: "private-ref" } }, {});
    expect(f.provider.action).toHaveBeenCalledOnce();
    f.tab.pageGeneration = 12;
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: "private-ref" } }, {})).rejects.toMatchObject({ code: "stale_ref" });
    expect(f.provider.action).toHaveBeenCalledOnce();
  });
  it.each(["http://docs.svc.localhost:26070/__cutex/auth?ticket=dummy", "http://docs.svc.localhost:26070/%5f%5fcutex/auth",
    "http://docs.svc.localhost:26070/safe/../__cutex/auth"])("does not pass private service endpoints to the provider: %s", async url => {
    const f = fixture();
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.navigate", url }, {})).rejects.toMatchObject({ code: "permission_denied" });
    expect(f.provider.navigate).not.toHaveBeenCalled();
  });
  it("has no grant, arbitrary JavaScript, CDP or discovery operation", async () => {
    const f = fixture(); expect(Object.keys(f.adapter).sort()).toEqual(["execute", "list"]);
    for (const kind of ["evaluate", "Runtime.evaluate", "cdp", "grant", "development-mcp"])
      await expect(f.adapter.execute(f.tab.guestId, { kind, code: "not executed" } as any, {})).rejects.toMatchObject({ code: "unsupported_operation" });
    for (const method of [f.provider.snapshot, f.provider.find, f.provider.action, f.provider.navigate, f.provider.screenshot, f.provider.release])
      expect(method).not.toHaveBeenCalled();
  });
  it("lists only current admitted owner grants and never exposes routing or credentials", async () => {
    const f = fixture(); expect(await f.adapter.list({})).toEqual([f.tab]);
    f.provider.hasGrant.mockReturnValue(false); expect(await f.adapter.list({})).toEqual([]);
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {})).rejects.toMatchObject({ code: "permission_denied" });
    expect(f.provider.snapshot).not.toHaveBeenCalled();
  });
  it("uses the current sanitized display URL and preserves cancellation/deadline options", async () => {
    const f = fixture(), control = { signal: new AbortController().signal, deadline: Date.now() + 1000 };
    expect(await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, control)).toMatchObject({ kind: "tab.snapshot", url: f.tab.url });
    expect(f.provider.snapshot).toHaveBeenCalledWith(f.tab.guestId, control);
    expect(await f.adapter.execute(f.tab.guestId, { kind: "tab.find", query: { text: "fixture" } }, control)).toMatchObject({ kind: "tab.find", url: f.tab.url });
    expect(f.provider.find).toHaveBeenCalledWith(f.tab.guestId, { text: "fixture" }, control);
  });
  it("normalizes the sanitized service key once with its current policy-allowed port", async () => {
    const f = fixture(), service = { slug: "fixture", path: "/page?name=example%20value&filter=%2Ffolder" };
    const display = serviceDisplayUrl(service);
    const url = publicBrowserServiceUrl(display, 26070);
    expect(url).toBe("http://fixture.svc.localhost:26070/page?name=example%20value&filter=%2Ffolder");
    const policy = createBrowserUrlPolicy({ getHost: () => ({ kind: "dev-direct", serviceProxy: true, connectionPort: 26070 }) });
    expect(policy.isNavigationAllowed(url)).toBe(true); expect(policy.isNavigationAllowed(url.replace(":26070", ""))).toBe(false);
    f.tab.url = url;
    expect(await f.adapter.list({})).toEqual([f.tab]);
    expect(await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {})).toMatchObject({ url });
    expect(publicBrowserServiceUrl("http://127.0.0.1:1234/page", undefined)).toBe("http://127.0.0.1:1234/page");
    for (const port of [undefined, 0, 65536, 1.5]) expect(() => publicBrowserServiceUrl(display, port)).toThrow();
    expect(() => publicBrowserServiceUrl("cutex:service/fixture/__cutex/auth%3Fticket%3Ddummy", 26070)).toThrow();
    for (const path of ["/safe/../__cutex/auth", "/%5F%5Fcutex/auth"])
      expect(() => publicBrowserServiceUrl(serviceDisplayUrl({ slug: "fixture", path }), 26070)).toThrow();
    f.tab.url = display;
    await expect(f.adapter.list({})).rejects.toMatchObject({ code: "permission_denied" }); // Never invent port 80.
  });
  it("drops late read results after host identity removal or owner revoke", async () => {
    for (const cause of ["host", "grant"]) {
      const f = fixture();
      f.provider.snapshot.mockImplementationOnce(async () => {
        if (cause === "host") f.tabs.mockReturnValue([]); else f.provider.hasGrant.mockReturnValue(false);
        return { pageGeneration: 1, snapshotId: 1, url: "about:blank", nodes: [], truncated: false };
      });
      await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {})).rejects.toMatchObject({ code: "permission_denied" });
    }
  });
  it("forwards strict action objects once and never grants or resumes", async () => {
    const f = fixture(), action = { kind: "check" as const, ref: "private-ref" };
    await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {});
    expect(await f.adapter.execute(f.tab.guestId, { kind: "tab.act", action }, {})).toEqual({ kind: "tab.act", pageGeneration: 2 });
    expect(f.provider.action).toHaveBeenCalledExactlyOnceWith(f.tab.guestId, action, {});
    expect(await f.adapter.execute(f.tab.guestId, { kind: "tab.release" }, {})).toEqual({ kind: "tab.release" });
    expect(f.provider.release).toHaveBeenCalledExactlyOnceWith(f.tab.guestId);
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tabs.claim" } as any, {})).rejects.toMatchObject({ code: "unsupported_operation" });
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tabs.open", url: "http://localhost/" } as any, {})).rejects.toMatchObject({ code: "unsupported_operation" });
    expect(f.provider.action).toHaveBeenCalledTimes(1);
  });
  it("only accepts refs actually returned after the final model budget, including element screenshots", async () => {
    const f = fixture(); f.snapshot.nodes = Array.from({ length: 200 }, (_, i) => ({ ref: `r-${i}`, role: "button", name: "x".repeat(1000) }));
    const result = await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {});
    expect(result.kind).toBe("tab.snapshot"); if (result.kind !== "tab.snapshot") throw Error("unexpected result");
    expect(result.truncated).toBe(true); expect(result.nodes.length).toBeGreaterThan(0); expect(result.nodes.length).toBeLessThan(200);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(63 * 1024);
    const omitted = f.snapshot.nodes[result.nodes.length]!.ref;
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: omitted } }, {})).rejects.toMatchObject({ code: "stale_ref" });
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.screenshot", ref: omitted }, {})).rejects.toMatchObject({ code: "stale_ref" });
    expect(f.provider.action).not.toHaveBeenCalled(); expect(f.provider.screenshot).not.toHaveBeenCalled();
    await f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: result.nodes[0]!.ref } }, {});
    expect(f.provider.action).toHaveBeenCalledTimes(1);
  });
  it.each(["tab.snapshot", "tab.find"] as const)("a failed %s clears previous refs", async kind => {
    const f = fixture(); await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {});
    if (kind === "tab.snapshot") f.provider.snapshot.mockRejectedValueOnce(new Error("read failed"));
    else f.provider.find.mockRejectedValueOnce(new Error("find failed"));
    await expect(f.adapter.execute(f.tab.guestId, kind === "tab.snapshot" ? { kind } : { kind, query: { text: "Save" } }, {})).rejects.toThrow();
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: "private-ref" } }, {})).rejects.toMatchObject({ code: "stale_ref" });
    expect(f.provider.action).not.toHaveBeenCalled();
  });
  it("find replaces refs and guest ids cannot borrow another guest's whitelist", async () => {
    const f = fixture(); await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {});
    f.provider.find.mockResolvedValueOnce({ ...f.snapshot, snapshotId: 2, nodes: [{ ref: "found-ref", role: "button", name: "Save" }] });
    await f.adapter.execute(f.tab.guestId, { kind: "tab.find", query: { text: "Save" } }, {});
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: "private-ref" } }, {})).rejects.toMatchObject({ code: "stale_ref" });
    f.tabs.mockReturnValue([f.tab, { ...f.tab, guestId: "other-guest" }]);
    await expect(f.adapter.execute("other-guest", { kind: "tab.act", action: { kind: "click", ref: "found-ref" } }, {})).rejects.toMatchObject({ code: "stale_ref" });
    await f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: "found-ref" } }, {});
    expect(f.provider.action).toHaveBeenCalledTimes(1);
  });
  it.each(["guest", "grant", "pause", "generation", "release"] as const)("prunes refs after %s disappears, even if the same id is later visible", async mode => {
    const f = fixture(); await f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {});
    if (mode === "guest") f.tabs.mockReturnValue([]);
    if (mode === "grant") f.provider.hasGrant.mockReturnValue(false);
    if (mode === "pause") f.provider.controlView.mockReturnValue({ grantee: "Agent", state: "paused", operating: false });
    if (mode === "generation") f.tab.pageGeneration++;
    if (mode === "release") await f.adapter.execute(f.tab.guestId, { kind: "tab.release" }, {});
    else await f.adapter.list({});
    f.tabs.mockReturnValue([f.tab]); f.provider.hasGrant.mockReturnValue(true); f.tab.pageGeneration = 1;
    f.provider.controlView.mockReturnValue({ grantee: "Agent", state: "granted", operating: false });
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.act", action: { kind: "click", ref: "private-ref" } }, {})).rejects.toMatchObject({ code: "stale_ref" });
    expect(f.provider.action).not.toHaveBeenCalled();
  });
  it("a failed newer read cannot let an older pending read reinstall refs", async () => {
    const f = fixture(); let resolve!: (value: BrowserSnapshot) => void;
    f.provider.snapshot.mockReturnValueOnce(new Promise(value => { resolve = value; })).mockRejectedValueOnce(new Error("busy"));
    const older = f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {});
    const rejected = expect(older).rejects.toMatchObject({ code: "stale_ref" });
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.snapshot" }, {})).rejects.toThrow("busy");
    resolve(f.snapshot); await rejected;
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.screenshot", ref: "private-ref" }, {})).rejects.toMatchObject({ code: "stale_ref" });
  });
  it.each(["host", "grant", "url"] as const)("navigation success followed by invalid %s is unknown, never permission_denied", async mode => {
    const f = fixture(); f.provider.navigate.mockImplementationOnce(async () => {
      if (mode === "host") f.tabs.mockReturnValue([]);
      if (mode === "grant") f.provider.hasGrant.mockReturnValue(false);
      if (mode === "url") f.tab.url = "cutex:service/unresolved/";
      return { status: "dispatched", pageGeneration: 2 };
    });
    await expect(f.adapter.execute(f.tab.guestId, { kind: "tab.navigate", url: "http://localhost/new" }, {})).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(f.provider.navigate).toHaveBeenCalledTimes(1);
  });
});
