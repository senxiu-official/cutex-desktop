import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import type { ProfileLinkState } from "../src/shared/profileLink";
const fake = vi.hoisted(() => ({
  state: { hosts: { active: "one", hosts: [{ id: "one", label: "One", conn: { epoch: "e1" } }, { id: "two", label: "Two", conn: { epoch: "e2" } }] } },
  access: {} as Record<string, { isOwner: boolean; pending: boolean; scope: string; token: null }>,
  accessListeners: new Set<() => void>(), reset: [] as ((id: string) => void)[], request: vi.fn(), data: new Map<string, unknown>(),
  syncListener: null as null | ((state: Pick<ProfileLinkState, "hosts">) => void),
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => null, { getState: () => fake.state }) }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (id: string) => ({ listProfiles: () => fake.request(id) }), bridge: { on: (event: string, listener: typeof fake.syncListener) => { if (event === "profileLinkState") fake.syncListener = listener; return () => {}; } } }));
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ hostAccessNow: (id: string) => fake.access[id], hostAccessStore: { get: () => fake.access, subscribe: (fn: () => void) => { fake.accessListeners.add(fn); return () => fake.accessListeners.delete(fn); } } }));
vi.mock("../src/renderer/src/lib/hostScope", () => ({ hostData: (_s: unknown, id: string) => fake.data.get(id) ?? null }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostScope: () => ({}) }));
vi.mock("../src/renderer/src/lib/hostSwitch", () => ({ onHostReset: (fn: (id: string) => void) => fake.reset.push(fn), onHostSwitch: () => () => {} }));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({ noteProfileLooks: vi.fn(), setProfileLooksApi: vi.fn(), setProfileLooksLoader: vi.fn() }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ noteCatalogNames: vi.fn(), setProfileModelNames: vi.fn(), setProfileNamesLoader: vi.fn() }));
import { accountLinkHostReady, accountLinkIdentity, accountProfilesForHost, accountProfilesSnapshot, captureAccountProfileRead, noteAccountProfiles, refreshAccountProfiles, sameProfileAccount, startProfileAccountLinks } from "../src/renderer/src/lib/profileAccountLinks";
const profile = (id: string, key = "a".repeat(22), secretId = "1f9a04c2") => ({ id, name: id, link: { accountKey: key, secretId, basis: "claude-account", source: "auto" } }) as ProfileItem;
function deferred() { let resolve!: (value: { profiles: ProfileItem[] }) => void; const promise = new Promise<{ profiles: ProfileItem[] }>((done) => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => {
  for (const reset of fake.reset) { reset("one"); reset("two"); }
  vi.clearAllMocks();
  fake.state.hosts.hosts[0]!.conn.epoch = "e1";
  fake.access = Object.fromEntries(["one", "two"].map((id) => [id, { isOwner: true, pending: false, scope: "full", token: null }]));
  for (const id of ["one", "two"]) fake.data.set(id, { daemon: { kind: "connected" }, featuresKnown: true, features: new Set(["profile-account-link"]) });
});
describe("linked profile host registry", () => {
  it("matches validated fingerprints with the same salt and never falls back to names", () => {
    expect(sameProfileAccount(profile("different name"), profile("original"))).toBe(true);
    expect(sameProfileAccount(profile("same"), profile("same", "b".repeat(22)))).toBe(false);
    expect(sameProfileAccount(profile("same"), profile("same", "a".repeat(22), "2f9a04c2"))).toBe(false);
    expect(accountLinkIdentity(profile("bad", "short"))).toBeNull();
    expect(sameProfileAccount({ name: "same" } as ProfileItem, { name: "same" } as ProfileItem)).toBe(false);
  });
  it("does not query old, read-scope or non-owner hosts", async () => {
    fake.data.set("one", { daemon: { kind: "connected" }, featuresKnown: true, features: new Set() });
    fake.access.two!.scope = "read";
    await refreshAccountProfiles();
    expect(fake.request).not.toHaveBeenCalled();
    fake.access.two!.scope = "full"; fake.access.two!.isOwner = false;
    await refreshAccountProfiles("two");
    expect(fake.request).not.toHaveBeenCalled();
  });
  it("distinguishes an empty authoritative list from an unknown host", async () => {
    fake.request.mockResolvedValue({ profiles: [] });
    expect(accountProfilesForHost("one")).toBeUndefined();
    await refreshAccountProfiles("one");
    expect(accountProfilesForHost("one")).toEqual([]);
  });
  it("drops a reset's outstanding reply even when the routing epoch has not changed", async () => {
    const reply = deferred(); fake.request.mockReturnValue(reply.promise);
    const running = refreshAccountProfiles("one");
    for (const reset of fake.reset) reset("one");
    reply.resolve({ profiles: [profile("stale")] }); await running;
    expect(accountProfilesForHost("one")).toBeUndefined();
  });
  it("drops replies from a replaced connection", async () => {
    const reply = deferred(); fake.request.mockReturnValue(reply.promise);
    const running = refreshAccountProfiles("one");
    fake.state.hosts.hosts[0]!.conn.epoch = "replacement";
    reply.resolve({ profiles: [profile("stale")] }); await running;
    expect(accountProfilesForHost("one")).toBeUndefined();
  });
  it("forgets cached link metadata on an access downgrade", () => {
    noteAccountProfiles("one", [profile("private account")]);
    expect(accountProfilesSnapshot()).toHaveLength(1);
    fake.access.one!.scope = "chat";
    for (const listener of fake.accessListeners) listener();
    expect(accountProfilesSnapshot()).toEqual([]);
    noteAccountProfiles("one", [profile("late reply")]);
    expect(accountProfilesSnapshot()[0]!.profile.link).toBeUndefined();
  });
  it("queues a fresh post-secret-reset read and rejects the old in-flight response", async () => {
    startProfileAccountLinks();
    const old = deferred(), fresh = deferred();
    fake.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const running = refreshAccountProfiles("one");
    fake.syncListener!({ hosts: { one: { state: "synced", secretId: "2f9a04c2" } } });
    expect(fake.request).toHaveBeenCalledTimes(2);
    old.resolve({ profiles: [profile("old")] }); await running;
    expect(accountProfilesForHost("one")).toBeUndefined();
    fresh.resolve({ profiles: [profile("fresh", "a".repeat(22), "2f9a04c2")] });
    await vi.waitFor(() => expect(accountProfilesForHost("one")?.[0]?.name).toBe("fresh"));
  });
  it("ordinary profile snapshot and settings-list replies cannot restore a pre-reset identity", async () => {
    const snapshots = await import("../src/renderer/src/lib/profileSnapshot");
    startProfileAccountLinks();
    const old = deferred(), fresh = deferred();
    fake.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const ordinaryRead = snapshots.loadProfileList("one");
    const settingsRead = captureAccountProfileRead("one");
    fake.syncListener!({ hosts: { one: { state: "synced", secretId: "3f9a04c2" } } });
    fresh.resolve({ profiles: [profile("freshest", "b".repeat(22), "3f9a04c2")] });
    await vi.waitFor(() => expect(accountProfilesForHost("one")?.[0]?.name).toBe("freshest"));
    old.resolve({ profiles: [profile("stale ordinary")] });
    expect((await ordinaryRead)?.profiles[0]?.name).toBe("freshest");
    snapshots.rememberProfileList({ defaultProfile: null, profiles: [profile("stale settings")] }, "one", settingsRead);
    expect(accountProfilesForHost("one")?.[0]?.name).toBe("freshest");
    expect(snapshots.cachedProfileList("one")).toBeNull();
    noteAccountProfiles("one", [profile("old salt without a read fence")]);
    expect(accountProfilesForHost("one")?.[0]?.name).toBe("freshest");
  });
  it("manual linking waits for shared settings and stays disabled for blocked or off hosts", async () => {
    startProfileAccountLinks();
    expect(accountLinkHostReady("one")).toBe(false);
    fake.syncListener!({ hosts: { one: { state: "error", secretId: null, code: "owner_local_required" } } });
    expect(accountLinkHostReady("one")).toBe(false);
    fake.syncListener!({ hosts: { one: { state: "ineligible", secretId: null, code: "host_disabled" } } });
    expect(accountLinkHostReady("one")).toBe(false);
    fake.request.mockResolvedValue({ profiles: [] });
    fake.syncListener!({ hosts: { one: { state: "synced", secretId: "4f9a04c2" } } });
    expect(accountLinkHostReady("one")).toBe(true);
    for (const reset of fake.reset) reset("one");
    expect(accountLinkHostReady("one")).toBe(false);
  });
});
