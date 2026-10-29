import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import type { LinkedProfileRef } from "../src/renderer/src/lib/profileAccountLinks";

const fake = vi.hoisted(() => ({ states: new Map<string, string | null>(), epochs: new Map<string, number>(), allowed: true, ready: true, fail: new Set<string>(), patch: vi.fn(), get: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (hostId: string) => ({
  getProfile: async () => { fake.get(hostId); return fake.states.has(hostId) ? { accountLink: fake.states.get(hostId) } : {}; },
  patchProfile: async (_id: string, patch: { accountLink: string | null }) => { fake.patch(hostId, patch); if (fake.fail.has(hostId)) throw new Error("offline"); fake.states.set(hostId, patch.accountLink); return {}; },
}) }));
vi.mock("../src/renderer/src/lib/profileAccountLinks", () => ({ accountLinkHostAllowed: () => fake.allowed, accountLinkHostReady: () => fake.allowed && fake.ready, captureAccountLinkAction: (id: string) => { const epoch = fake.epochs.get(id); return () => fake.allowed && fake.epochs.get(id) === epoch; }, refreshAccountProfiles: fake.refresh }));
import { changeAccountLinks, newManualAccountLink, undoAccountLinks } from "../src/renderer/src/lib/profileAccountLinkActions";

const ref = (hostId: string, family = "anthropic"): LinkedProfileRef => ({ hostId, hostName: hostId, connected: true, profile: { id: "p", name: "Profile", providerFamily: family } as ProfileItem });
beforeEach(() => { fake.states.clear(); fake.states.set("one", null); fake.states.set("two", "none"); fake.epochs.clear(); fake.allowed = true; fake.ready = true; fake.fail.clear(); vi.resetAllMocks(); fake.refresh.mockResolvedValue(undefined); });
describe("manual profile account links", () => {
  it("generates a fresh 16-byte URL-safe group marker", () => {
    const one = newManualAccountLink();
    expect(one).toMatch(/^m-[\w-]{22}$/);
    expect(newManualAccountLink()).not.toBe(one);
  });
  it("reads all previous values before writes and restores automatic/disabled states exactly", async () => {
    const marker = newManualAccountLink();
    const result = await changeAccountLinks([ref("one"), ref("two")], marker);
    expect(result.failed).toEqual([]);
    expect(fake.get).toHaveBeenCalledTimes(2);
    expect(fake.get.mock.invocationCallOrder[1]).toBeLessThan(fake.patch.mock.invocationCallOrder[0]!);
    expect(fake.states.get("one")).toBe(marker);
    const undo = await undoAccountLinks(result.changes);
    expect(undo.failed).toEqual([]);
    expect(fake.states.get("one")).toBeNull();
    expect(fake.states.get("two")).toBe("none");
  });
  it("restores an existing manual group marker rather than generating a replacement", async () => {
    const original = newManualAccountLink(); fake.states.set("one", original);
    const result = await changeAccountLinks([ref("one")], null);
    await undoAccountLinks(result.changes);
    expect(fake.states.get("one")).toBe(original);
  });
  it("reports partial writes without retrying or losing completed undo states", async () => {
    fake.fail.add("two");
    const result = await changeAccountLinks([ref("one"), ref("two")], newManualAccountLink());
    expect(result.changes.map((change) => change.ref.hostId)).toEqual(["one"]);
    expect(result.failed.map((item) => item.hostId)).toEqual(["two"]);
    expect(fake.patch).toHaveBeenCalledTimes(2);
  });
  it("will not overwrite a newer owner link during undo", async () => {
    const result = await changeAccountLinks([ref("one")], "none");
    const newer = newManualAccountLink(); fake.states.set("one", newer);
    const undo = await undoAccountLinks(result.changes);
    expect(undo.failed).toEqual([ref("one")]);
    expect(fake.states.get("one")).toBe(newer);
    expect(fake.patch).toHaveBeenCalledTimes(1);
  });
  it("rejects unavailable hosts and different families before reading or writing", async () => {
    fake.allowed = false;
    await expect(changeAccountLinks([ref("one")], "none")).rejects.toThrow("unavailable");
    fake.allowed = true;
    await expect(changeAccountLinks([ref("one"), ref("two", "openai-chatgpt")], newManualAccountLink())).rejects.toThrow("families");
    expect(fake.get).not.toHaveBeenCalled(); expect(fake.patch).not.toHaveBeenCalled();
  });
  it("refuses mutation when any host cannot provide exact undo state", async () => {
    fake.states.delete("two");
    await expect(changeAccountLinks([ref("one"), ref("two")], newManualAccountLink())).rejects.toThrow("unavailable");
    expect(fake.patch).not.toHaveBeenCalled();
  });
  it("refuses old undo state after reconnecting during the initial read", async () => {
    fake.get.mockImplementationOnce((id) => fake.epochs.set(id, 1));
    await expect(changeAccountLinks([ref("one")], "none")).rejects.toThrow("connection changed");
    expect(fake.patch).not.toHaveBeenCalled();
  });
  it("does not continue a multi-host mutation on another host's replacement connection", async () => {
    fake.patch.mockImplementationOnce(() => fake.epochs.set("two", 1));
    const result = await changeAccountLinks([ref("one"), ref("two")], newManualAccountLink());
    expect(result.changes.map((item) => item.ref.hostId)).toEqual(["one"]);
    expect(result.failed).toEqual([ref("two")]);
    expect(fake.patch).toHaveBeenCalledTimes(1);
  });
  it("will not undo on a replacement connection or after access changes during GET", async () => {
    const result = await changeAccountLinks([ref("one")], "none");
    fake.get.mockImplementationOnce(() => { fake.allowed = false; });
    expect((await undoAccountLinks(result.changes)).failed).toEqual([ref("one")]);
    expect(fake.patch).toHaveBeenCalledTimes(1);
    fake.allowed = true; fake.epochs.set("one", 1);
    expect((await undoAccountLinks(result.changes)).failed).toEqual([ref("one")]);
    expect(fake.patch).toHaveBeenCalledTimes(1);
  });
  it("does not claim a cross-host manual link before the host settings synchronise", async () => {
    fake.ready = false;
    await expect(changeAccountLinks([ref("one"), ref("two")], newManualAccountLink())).rejects.toThrow("not synchronised");
    expect(fake.get).not.toHaveBeenCalled(); expect(fake.patch).not.toHaveBeenCalled();
    await changeAccountLinks([ref("one")], "none");
    expect(fake.patch).toHaveBeenCalledTimes(1);
  });
  it("stops a manual group write when shared settings become pending during its read", async () => {
    fake.get.mockImplementationOnce(() => { fake.ready = false; });
    const result = await changeAccountLinks([ref("one")], newManualAccountLink());
    expect(result.failed).toEqual([ref("one")]);
    expect(result.changes).toEqual([]);
    expect(fake.patch).not.toHaveBeenCalled();
  });
});
