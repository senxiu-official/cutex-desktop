// Host ownership in the renderer (lib/hostOwnership.ts): 我的设备 / 我能访问的设备 grouping with the
// fallback for hosts without `host-owner-person`, the per-host owner store, 「是我」 and the
// desktop-local `ownedByMe` mark.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) };
  return {
    storage,
    owners: {} as Record<string, unknown>,
    calls: [] as string[],
    setResult: null as unknown,
  };
});
vi.mock("../src/renderer/src/bridge", () => {
  const hostApi = (hostId: string) => ({
    hostOwner: async () => {
      fake.calls.push(`hostOwner ${hostId}`);
      if (fake.owners[hostId] instanceof Error) throw fake.owners[hostId];
      return fake.owners[hostId] ?? null;
    },
    setOwnerPerson: async (publicKey: string) => {
      fake.calls.push(`setOwnerPerson ${hostId} ${publicKey}`);
      return fake.setResult;
    },
  });
  const api = { identityState: async () => ({ publicKey: "PUBKEY", fingerprint: "116df1968daccae0", claims: {} }), ...hostApi("local") };
  return { api, bridge: { api, on: () => () => {} }, apiFor: hostApi };
});
vi.mock("../src/renderer/src/store", () => ({ useApp: () => null }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostLook: () => null, useHostData: () => null }));

import { confirmOwnerIsMe, connectionOf, groupHosts, hostGroupOf, loadHostOwner, ownedByMeNow, setOwnedByMe, type OwnershipFacts } from "../src/renderer/src/lib/hostOwnership";
import { personPublicKeyNow } from "../src/renderer/src/lib/personIdentity";
import type { HostOwner } from "../src/shared/hosts";

const ME = "116df1968daccae0";
const OTHER = "6060078263515bfd";
const confirmed = (fingerprint: string): HostOwner => ({ displayName: "x", fingerprint, confirmed: true, source: "firstRootClaim" });
const UNCONFIRMED: HostOwner = { displayName: null, fingerprint: null, confirmed: false, source: null };
const facts = (id: string, kind: OwnershipFacts["kind"], owner: HostOwner | null, capability: boolean | null, ownedByMe = false): OwnershipFacts => ({ id, kind, owner, capability, ownedByMe });

describe("grouping", () => {
  it("with the capability: mine only when the confirmed owner person is this desktop", () => {
    expect(hostGroupOf(facts("local", "local", confirmed(ME), true), ME)).toBe("mine");
    expect(hostGroupOf(facts("ssh-a", "ssh", confirmed(ME), true), ME)).toBe("mine");
    // Owner rights over SSH into someone else's account do not make it mine; nor does the local mark.
    expect(hostGroupOf(facts("ssh-b", "ssh", confirmed(OTHER), true, true), ME)).toBe("access");
    // This machine, but someone else is its confirmed owner person.
    expect(hostGroupOf(facts("local", "local", confirmed(OTHER), true), ME)).toBe("access");
  });

  it("falls back (older cutex, unconfirmed, own key unknown, never read): this machine + hosts marked ownedByMe", () => {
    expect(hostGroupOf(facts("local", "local", null, false), ME)).toBe("mine");
    expect(hostGroupOf(facts("ssh-a", "ssh", null, false), ME)).toBe("access");
    expect(hostGroupOf(facts("ssh-a", "ssh", null, false, true), ME)).toBe("mine");
    expect(hostGroupOf(facts("ssh-a", "ssh", null, null, true), ME)).toBe("mine");
    expect(hostGroupOf(facts("local", "local", UNCONFIRMED, true), ME)).toBe("mine");
    expect(hostGroupOf(facts("ssh-c", "ssh", UNCONFIRMED, true), ME)).toBe("access");
    expect(hostGroupOf(facts("ssh-b", "ssh", confirmed(OTHER), true), null)).toBe("access");
    expect(hostGroupOf(facts("ssh-b", "ssh", confirmed(OTHER), true, true), null)).toBe("mine");
  });

  it("groupHosts keeps the order", () => {
    const hosts = [facts("local", "local", confirmed(ME), true), facts("ssh-a", "ssh", confirmed(OTHER), true), facts("ssh-b", "ssh", null, false, true), facts("ssh-c", "ssh", null, null), facts("dev-x", "dev-direct", null, false)];
    expect(groupHosts(hosts, ME)).toEqual({ mine: ["local", "ssh-b"], access: ["ssh-a", "ssh-c", "dev-x"] });
  });

  it("connectionOf", () => {
    expect(connectionOf("local")).toBe("local");
    expect(connectionOf(undefined, "local")).toBe("local");
    expect(connectionOf("ssh")).toBe("ssh");
    expect(connectionOf("dev-direct")).toBe("dev");
    expect(connectionOf(undefined, "ssh-x")).toBe("paired");
  });
});

describe("owner store and actions", () => {
  beforeEach(() => {
    fake.calls = [];
  });

  it("reads /v2/host.owner once per connection epoch and remembers it", async () => {
    fake.owners["ssh-a"] = confirmed(OTHER);
    loadHostOwner("ssh-a", "e1");
    loadHostOwner("ssh-a", "e1");
    await vi.waitFor(() => expect(JSON.parse(fake.storage.get("cutex-desktop.hostOwner") ?? "{}")["ssh-a"]).toEqual({ owner: confirmed(OTHER), capability: true }));
    loadHostOwner("ssh-a", "e1");
    expect(fake.calls).toEqual(["hostOwner ssh-a"]);
    loadHostOwner("ssh-a", "e1", true);
    loadHostOwner("ssh-a", "e2");
    await vi.waitFor(() => expect(fake.calls).toEqual(["hostOwner ssh-a", "hostOwner ssh-a", "hostOwner ssh-a"]));
  });

  it("an older cutex (no owner) is remembered without the capability; a failed read keeps what was known", async () => {
    loadHostOwner("ssh-old", "e1");
    await vi.waitFor(() => expect(JSON.parse(fake.storage.get("cutex-desktop.hostOwner") ?? "{}")["ssh-old"]).toEqual({ owner: null, capability: false }));
    fake.owners["ssh-a"] = new Error("disconnected");
    loadHostOwner("ssh-a", "e9");
    await vi.waitFor(() => expect(fake.calls).toContain("hostOwner ssh-a"));
    expect(JSON.parse(fake.storage.get("cutex-desktop.hostOwner") ?? "{}")["ssh-a"]).toEqual({ owner: confirmed(OTHER), capability: true });
  });

  it("是我 sends this desktop's public key; refusals come back as values", async () => {
    personPublicKeyNow();
    await vi.waitFor(() => expect(personPublicKeyNow()).toBe("PUBKEY"));
    fake.setResult = { ok: true, value: { ...confirmed(ME), source: "local" } };
    expect(await confirmOwnerIsMe()).toEqual({ ok: true, value: { ...confirmed(ME), source: "local" } });
    expect(fake.calls).toContain("setOwnerPerson local PUBKEY");
    expect(JSON.parse(fake.storage.get("cutex-desktop.hostOwner") ?? "{}").local.owner.fingerprint).toBe(ME);
    fake.setResult = { ok: false, error: { code: "owner_person_local_only", message: "no" } };
    expect(await confirmOwnerIsMe("ssh-a")).toMatchObject({ ok: false, error: { code: "owner_person_local_only" } });
  });

  it("ownedByMe is a desktop-local mark", () => {
    expect(ownedByMeNow("ssh-a")).toBe(false);
    setOwnedByMe("ssh-a", true);
    expect(ownedByMeNow("ssh-a")).toBe(true);
    expect(JSON.parse(fake.storage.get("cutex-desktop.hostOwnedByMe")!)).toEqual({ "ssh-a": true });
    setOwnedByMe("ssh-a", false);
    expect(ownedByMeNow("ssh-a")).toBe(false);
  });
});
