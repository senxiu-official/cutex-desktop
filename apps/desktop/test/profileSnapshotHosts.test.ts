// Multi-host P1 step 2c: profile snapshots / lists are cached per host (Settings → Profiles of another
// host, the new-agent form), and only the focus host's list feeds the model display names.
import { beforeEach, describe, expect, it, vi } from "vitest";

const list = (names: string[], defaultProfile: string) => ({ defaultProfile, profiles: names.map((name) => ({ id: name, name, model: null, modelDisplayNames: { m: `${name}-m` } })) });
const focusApi = { listProfiles: vi.fn(async () => list(["deepseek", "gamma"], "deepseek")), getProfile: vi.fn(async (name: string) => ({ name, host: "local" })), profileModels: vi.fn(async () => null), quotaConfig: vi.fn(async () => null), profileAccount: vi.fn(async () => null) };
const workstationApi = { listProfiles: vi.fn(async () => list(["gamma"], "gamma")), getProfile: vi.fn(async (name: string) => ({ name, host: "workstation" })), profileModels: vi.fn(async () => null), quotaConfig: vi.fn(async () => null), profileAccount: vi.fn(async () => null) };
vi.mock("../src/renderer/src/bridge", () => ({ api: focusApi, apiFor: (hostId: string) => (hostId === "workstation" ? workstationApi : focusApi) }));
const setNames = vi.fn();
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ setProfileModelNames: setNames, setProfileNamesLoader: () => {} }));

const snap = await import("../src/renderer/src/lib/profileSnapshot");
const { fireHostReset } = await import("../src/renderer/src/lib/hostSwitch");

describe("profile snapshots per host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists are loaded from and cached for their own host", async () => {
    const local = await snap.loadProfileList();
    const workstation = await snap.loadProfileList("workstation");
    expect(local?.profiles.map((p) => p.name)).toEqual(["deepseek", "gamma"]);
    expect(workstation?.profiles.map((p) => p.name)).toEqual(["gamma"]);
    expect(snap.cachedProfileList()?.defaultProfile).toBe("deepseek");
    expect(snap.cachedProfileList("workstation")?.defaultProfile).toBe("gamma");
    // Model display names come from the focus host's list only.
    expect(setNames).toHaveBeenCalledTimes(1);
  });

  it("the same profile name on two hosts keeps two snapshots", async () => {
    const item = { id: "gamma", name: "gamma", model: null } as never;
    await snap.loadProfileSnapshot(item);
    await snap.loadProfileSnapshot(item, "workstation");
    expect((snap.cachedProfile("gamma")?.detail as unknown as { host: string }).host).toBe("local");
    expect((snap.cachedProfile("gamma", "workstation")?.detail as unknown as { host: string }).host).toBe("workstation");
    snap.updateCachedProfile("gamma", { models: { models: [] } as never }, "workstation");
    expect(snap.cachedProfile("gamma", "workstation")?.models).toEqual({ models: [] });
    expect(snap.cachedProfile("gamma")?.models).toBeNull();
  });

  it("a replaced connection drops that host's entries only", async () => {
    await snap.loadProfileList("workstation");
    fireHostReset("workstation");
    expect(snap.cachedProfileList("workstation")).toBeNull();
    expect(snap.cachedProfile("gamma", "workstation")).toBeNull();
    expect(snap.cachedProfileList()).not.toBeNull();
  });
});
