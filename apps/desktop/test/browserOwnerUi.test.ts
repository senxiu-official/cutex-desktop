import { describe, expect, it, vi } from "vitest";
import type { BrowserAgentView, BrowserTabView } from "../src/shared/browser";
import { DEFAULT_BROWSER_CONTROL_SETTINGS as settings } from "../src/shared/browser";
import { BrowserOwnerController, browserOwnerAgents, type BrowserOwnerSnapshot } from "../src/renderer/src/modules/browser/browserOwnerUi";
import { browserOwnerUiEn, browserOwnerUiZhCN } from "../src/renderer/src/modules/browser/ownerUiMessages";

const scope = { hostId: "host-target", epoch: "epoch-1", tabKey: "tab-1" };
const selected = { sessionId: "cutex.session-1", name: "Alpha" };
const view = (patch: Partial<BrowserTabView> = {}): BrowserTabView => ({ hostId: scope.hostId, tabKey: scope.tabKey, guestId: "guest-1",
  pageGeneration: 1, url: "about:blank", title: "Page", loading: false, canGoBack: false, canGoForward: false, status: "attached", pool: "owner", ...patch });
const lease = { leaseId: "lease-1", sessionId: selected.sessionId, agentName: selected.name, origin: "owner", state: "active" } as const;
function setup(patch: Partial<BrowserTabView> = {}) {
  let snapshot: BrowserOwnerSnapshot = { enabled: true, epoch: scope.epoch, view: view(patch) };
  const api = { agents: vi.fn(async (): Promise<BrowserAgentView[]> => [selected]), grantAgent: vi.fn(async () => {}),
    resumeLease: vi.fn(async () => {}), releaseLease: vi.fn(async () => {}), pauseLease: vi.fn(async () => {}) };
  const apiFor = vi.fn((_host: string) => api), afterHostsDelivered = vi.fn(async () => {});
  const controller = new BrowserOwnerController({ snapshot: () => snapshot, api: apiFor, afterHostsDelivered });
  return { controller, api, apiFor, afterHostsDelivered, update: (next: Partial<BrowserOwnerSnapshot>) => { snapshot = { ...snapshot, ...next }; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe("same-host owner browser control", () => {
  it("lists only through the explicit host binding, after hosts delivery, and never grants while listing", async () => {
    const f = setup(); expect(await f.controller.agents(scope)).toEqual([selected]);
    expect(f.apiFor).toHaveBeenCalledWith("host-target"); expect(f.apiFor).not.toHaveBeenCalledWith("host-focus");
    expect(f.afterHostsDelivered.mock.invocationCallOrder[0]!).toBeLessThan(f.api.agents.mock.invocationCallOrder[0]!);
    expect(f.api.grantAgent).not.toHaveBeenCalled(); expect(f.api.resumeLease).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation with login-pool warning and refreshes exact target eligibility", async () => {
    const f = setup(), confirm = vi.fn(async () => false);
    expect(await f.controller.grant(scope, selected, settings, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Alpha", "owner"); expect(f.api.grantAgent).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    expect(await f.controller.grant(scope, selected, settings, confirm)).toBe(true);
    expect(f.api.grantAgent).toHaveBeenCalledExactlyOnceWith(scope.tabKey, selected.sessionId, settings, undefined, { guestId: "guest-1", pageGeneration: 1 });
    expect(f.api.agents.mock.invocationCallOrder[0]!).toBeLessThan(f.api.grantAgent.mock.invocationCallOrder[0]!);
  });
  it("identifies the separate agent login pool without claiming owner-login reuse", async () => {
    const f = setup({ pool: "agent" }), confirm = vi.fn(async () => true);
    await f.controller.grant(scope, selected, settings, confirm);
    expect(confirm).toHaveBeenCalledWith(selected.name, "agent");
    expect(browserOwnerUiEn["browser.owner.confirmOwner"]).toContain("reuses");
    expect(browserOwnerUiEn["browser.owner.confirmAgent"]).toContain("separate");
  });
  it.each(["disabled", "epoch", "guest", "tab", "host", "pool", "closed", "lease", "page", "url", "title"])("refuses grant if %s changes during confirmation", async change => {
    const f = setup(), decision = deferred<boolean>();
    const result = f.controller.grant(scope, selected, settings, () => decision.promise);
    if (change === "disabled") f.update({ enabled: false });
    if (change === "epoch") f.update({ epoch: "epoch-2" });
    if (change === "guest") f.update({ view: view({ guestId: "replacement" }) });
    if (change === "tab") f.update({ view: view({ tabKey: "different" }) });
    if (change === "host") f.update({ view: view({ hostId: "host-focus" }) });
    if (change === "pool") f.update({ view: view({ pool: "agent" }) });
    if (change === "closed") f.update({ view: view({ status: "closed" }) });
    if (change === "lease") f.update({ view: view({ lease }) });
    if (change === "page") f.update({ view: view({ pageGeneration: 2 }) });
    if (change === "url") f.update({ view: view({ url: "http://localhost/other" }) });
    if (change === "title") f.update({ view: view({ title: "Other page" }) });
    decision.resolve(true); expect(await result).toBe(false); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("does not grant after the chosen agent is removed or renamed", async () => {
    const f = setup(); f.api.agents.mockResolvedValue([]);
    expect(await f.controller.grant(scope, selected, settings, async () => true)).toBe(false);
    f.api.agents.mockResolvedValue([{ ...selected, name: "Renamed" }]);
    expect(await f.controller.grant(scope, selected, settings, async () => true)).toBe(false);
    expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("drops a late same-host list after epoch replacement", async () => {
    const f = setup(), reply = deferred<BrowserAgentView[]>(); f.api.agents.mockReturnValue(reply.promise);
    const result = f.controller.agents(scope);
    await Promise.resolve(); f.update({ epoch: "new-epoch" }); reply.resolve([selected]);
    expect(await result).toEqual([]); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("resumes an active paused lease with one click (same agent, same lease: no second confirmation)", async () => {
    const f = setup({ lease, control: { grantee: selected.name, state: "paused", operating: false } });
    expect(await f.controller.resume(scope, settings)).toBe(true);
    expect(f.api.resumeLease).toHaveBeenCalledExactlyOnceWith(scope.tabKey, lease.leaseId, settings);
    expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("explicit pause keeps the lease and is separate from revoke", async () => {
    const f = setup({ lease, control: { grantee: selected.name, state: "granted", operating: false } });
    f.update({ enabled: false, epoch: null }); // authority-reducing: allowed off / on an old epoch
    await f.controller.pause(scope.hostId, scope.tabKey, lease.leaseId);
    expect(f.api.pauseLease).toHaveBeenCalledExactlyOnceWith(scope.tabKey, lease.leaseId);
    expect(f.api.releaseLease).not.toHaveBeenCalled();
  });
  it("never resumes pending, already-running or replaced leases", async () => {
    for (const patch of [{ lease: { ...lease, state: "pending" as const } }, { lease, control: { grantee: selected.name, state: "granted" as const, operating: false } }]) {
      const f = setup(patch); expect(await f.controller.resume(scope, settings)).toBe(false);
      expect(f.api.resumeLease).not.toHaveBeenCalled();
    }
    const f = setup({ lease, control: { grantee: selected.name, state: "paused", operating: false } }), delivered = deferred<void>();
    f.afterHostsDelivered.mockImplementationOnce(() => delivered.promise);
    const resumed = f.controller.resume(scope, settings);
    f.update({ view: view({ lease: { ...lease, leaseId: "replacement" }, control: { grantee: selected.name, state: "paused", operating: false } }) });
    delivered.resolve(); expect(await resumed).toBe(false); expect(f.api.resumeLease).not.toHaveBeenCalled();
  });
  it("revoke remains available off/old-epoch and invalidates a pending resume", async () => {
    const f = setup({ lease, control: { grantee: selected.name, state: "paused", operating: false } }), delivered = deferred<void>();
    f.afterHostsDelivered.mockImplementationOnce(() => delivered.promise);
    const resumed = f.controller.resume(scope, settings);
    f.update({ enabled: false, epoch: null });
    await f.controller.revoke(scope.hostId, scope.tabKey, lease.leaseId);
    expect(f.api.releaseLease).toHaveBeenCalledExactlyOnceWith(scope.tabKey, lease.leaseId, true);
    delivered.resolve(); expect(await resumed).toBe(false); expect(f.api.resumeLease).not.toHaveBeenCalled();
  });
  it("unmount/cancel invalidates confirmation without affecting another tab", async () => {
    const f = setup(), decision = deferred<boolean>();
    const result = f.controller.grant(scope, selected, settings, () => decision.promise);
    f.controller.cancel(scope); decision.resolve(true);
    expect(await result).toBe(false); expect(f.api.grantAgent).not.toHaveBeenCalled();
  });
  it("never retries uncertain grant delivery", async () => {
    const f = setup(); f.api.grantAgent.mockRejectedValue(new Error("outcome_unknown"));
    await expect(f.controller.grant(scope, selected, settings, async () => true)).rejects.toThrow("outcome_unknown");
    expect(f.api.grantAgent).toHaveBeenCalledOnce();
  });
  it("bounds lists, rejects duplicate/spoof-shaped names, and strips unrelated fields", () => {
    expect(browserOwnerAgents([{ ...selected, token: "secret", hostId: "ignored" }])).toEqual([selected]);
    for (const bad of [[selected, selected], [{ ...selected, sessionId: "../escape" }], [{ ...selected, name: "bad\nname" }],
      [{ ...selected, name: "x".repeat(201) }], Array(513).fill(selected), {}]) expect(browserOwnerAgents(bad)).toBeNull();
    expect(Object.keys(browserOwnerUiEn).sort()).toEqual(Object.keys(browserOwnerUiZhCN).sort());
  });
});
