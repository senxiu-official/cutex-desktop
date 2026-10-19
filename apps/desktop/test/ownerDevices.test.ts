// Owner devices (cutex 21123b6 + c9fa3bc; docs/research/owner-devices-desktop-api-20261019.md): the
// capabilities `user` fields (scope, ownerLocal, token.scope / issuedVia) in the host access model, the
// owner-local gate (missing fields = unknown, never "not local"), refusal mapping, the new-devices wire
// readers, the client-token PATCH body, the peers wake policy, and the per-host new-devices store.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  lists: {} as Record<string, unknown>,
  calls: [] as string[],
  ackResult: null as unknown,
  revokeError: null as Error | null,
  handlers: {} as Record<string, ((payload: unknown) => void)[]>,
}));
vi.mock("../src/renderer/src/bridge", () => {
  const hostApi = (hostId: string) => ({
    ownerNewDevices: async () => {
      fake.calls.push(`list ${hostId}`);
      const v = fake.lists[hostId];
      if (v instanceof Error) throw v;
      return v ?? { ok: true, value: [] };
    },
    ackOwnerNewDevice: async (tokenId: string) => {
      fake.calls.push(`ack ${hostId} ${tokenId}`);
      return fake.ackResult ?? { ok: true, value: { tokenId, acknowledged: true } };
    },
    revokeClientToken: async (tokenId: string) => {
      fake.calls.push(`revoke ${hostId} ${tokenId}`);
      if (fake.revokeError) throw fake.revokeError;
    },
  });
  const on = (event: string, fn: (payload: unknown) => void) => {
    (fake.handlers[event] ??= []).push(fn);
    return () => {};
  };
  return { api: hostApi("local"), bridge: { api: hostApi("local"), on }, apiFor: hostApi };
});
vi.mock("../src/renderer/src/store", () => ({ useApp: () => null }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostLook: () => null, useHostData: () => null }));

import {
  accessRefusalDetailsOf,
  accessRefusalOf,
  clientTokenUpdateBody,
  deviceScopeOf,
  hostUserAccessOf,
  ownerDeviceAddedOf,
  ownerLocalActionsAllowed,
  readOwnerNewDevices,
  scopeAllows,
  selfTokenOf,
} from "../src/shared/users";
import { peerPatchBody, peerTellWakeOf, PEER_POLICY_DEFAULT } from "../src/shared/peers";
import { ackOwnerDevice, loadOwnerNewDevices, ownerDevicesNow, refusalFromError, revokeOwnerDevice } from "../src/renderer/src/lib/ownerDevices";
import type { EventEnvelope } from "@cutex-desktop/protocol";

const FEATURES = ["owner-local-only", "owner-device-notice", "device-scope"];
const owner = { id: "owner", name: "Sam", isOwner: true, pending: false, grant: null };
const caps = (user: Record<string, unknown> | undefined) => (user === undefined ? {} : { user });
const sshToken = { id: "mct-4b5c6d7e8f901a2b", label: "desktop-HOST-A-Cutex-9c1d2e", deviceName: null, ownerName: null, platform: null };

describe("capabilities user block → host access", () => {
  it("HOST-A root credential on loopback: full, local → yes", () => {
    const access = hostUserAccessOf(caps({ ...owner, token: null, scope: "full", ownerLocal: true }));
    expect(access).toMatchObject({ isOwner: true, token: null, scope: "full", ownerLocal: true });
    expect(deviceScopeOf(access)).toBe("full");
    expect(ownerLocalActionsAllowed(access, FEATURES)).toBe("yes");
    expect(ownerLocalActionsAllowed(access, new Set(FEATURES))).toBe("yes");
  });

  it("SSH host: owner token from client-token issue (hostCli) counts as local", () => {
    const access = hostUserAccessOf(caps({ ...owner, token: { ...sshToken, scope: "full", issuedVia: "hostCli" }, scope: "full", ownerLocal: true }));
    expect(access.token).toMatchObject({ id: sshToken.id, scope: "full", issuedVia: "hostCli" });
    expect(ownerLocalActionsAllowed(access, FEATURES)).toBe("yes");
  });

  it("a paired owner device is not local; a narrowed local token is not allowed either", () => {
    const paired = hostUserAccessOf(caps({ ...owner, token: { ...sshToken, scope: "full", issuedVia: "pairing" }, scope: "full", ownerLocal: false }));
    expect(paired.isOwner).toBe(true);
    expect(ownerLocalActionsAllowed(paired, FEATURES)).toBe("no");
    const chat = hostUserAccessOf(caps({ ...owner, token: { ...sshToken, scope: "chat", issuedVia: "hostCli" }, scope: "chat", ownerLocal: true }));
    expect(deviceScopeOf(chat)).toBe("chat");
    expect(ownerLocalActionsAllowed(chat, FEATURES)).toBe("no");
  });

  it("missing fields (older cutex) are unknown, never 'not local'", () => {
    // r245: user block with a C1 token but no scope / ownerLocal / issuedVia.
    const older = hostUserAccessOf(caps({ ...owner, token: sshToken }));
    expect(older).not.toHaveProperty("ownerLocal");
    expect(older).not.toHaveProperty("scope");
    expect(older.token).not.toHaveProperty("issuedVia");
    expect(ownerLocalActionsAllowed(older, FEATURES)).toBe("unknown");
    expect(deviceScopeOf(older)).toBeNull();
    // No user block at all (?legacy) reads as the owner, owner-local unknown.
    const legacy = hostUserAccessOf(caps(undefined));
    expect(legacy.isOwner).toBe(true);
    expect(ownerLocalActionsAllowed(legacy, [])).toBe("unknown");
    // Fields present but the capability missing: unknown too.
    const noCap = hostUserAccessOf(caps({ ...owner, token: null, scope: "full", ownerLocal: false }));
    expect(ownerLocalActionsAllowed(noCap, ["device-scope"])).toBe("unknown");
  });

  it("odd values: an unknown scope reads as read, an unknown issuedVia as unknown; ownerLocal must be boolean", () => {
    const access = hostUserAccessOf(caps({ ...owner, token: { ...sshToken, scope: "admin", issuedVia: "magic" }, scope: "everything", ownerLocal: "yes" }));
    expect(access.scope).toBe("read");
    expect(access.token).toMatchObject({ scope: "read", issuedVia: "unknown" });
    expect(access).not.toHaveProperty("ownerLocal");
    expect(selfTokenOf(caps({ ...owner, token: { ...sshToken } }))).toEqual(sshToken);
  });

  it("scope ranks read ⊂ chat ⊂ full", () => {
    expect(scopeAllows("full", "chat")).toBe(true);
    expect(scopeAllows("chat", "chat")).toBe(true);
    expect(scopeAllows("chat", "full")).toBe(false);
    expect(scopeAllows("read", "chat")).toBe(false);
  });
});

describe("access refusals", () => {
  it("refusal values with details (users / peers routes)", () => {
    expect(accessRefusalOf({ code: "owner_local_only", message: "x", access: { action: "disableOwnerApproval", issuedVia: "pairing" } })).toEqual({ reason: "ownerLocalOnly", code: "owner_local_only", action: "disableOwnerApproval", issuedVia: "pairing" });
    expect(accessRefusalOf({ ok: false, error: { code: "device_scope_denied", message: "", access: { scope: "read", required: "chat" } } })).toEqual({ reason: "deviceScopeDenied", code: "device_scope_denied", scope: "read", required: "chat" });
    expect(accessRefusalOf({ code: "owner_person_local_only", message: "" })).toEqual({ reason: "ownerPersonLocalOnly", code: "owner_person_local_only" });
    expect(accessRefusalOf({ code: "loopback_only", message: "" })?.reason).toBe("loopbackOnly");
    expect(accessRefusalOf({ code: "invalid_scope", message: "" })?.reason).toBe("invalidScope");
    expect(accessRefusalOf({ code: "user_in_use", message: "" })).toBeNull();
    expect(accessRefusalOf({ ok: true, value: 1 })).toBeNull();
    expect(accessRefusalOf(null)).toBeNull();
  });

  it("thrown errors keep only the code: the caller names the action", () => {
    const e = new Error("Error invoking remote method 'cutex:invoke': Error: owner_local_only: creating a pairing code is only allowed on the host itself");
    expect(accessRefusalOf(e, { action: "pairingCode" })).toEqual({ reason: "ownerLocalOnly", code: "owner_local_only", action: "pairingCode" });
    expect(accessRefusalOf("loopback_only: remote listener")).toEqual({ reason: "loopbackOnly", code: "loopback_only" });
    expect(accessRefusalOf(new Error("client_token_not_found: gone"))).toBeNull();
    // A fallback never overrides what cutex said.
    expect(accessRefusalOf({ code: "owner_local_only", message: "", access: { action: "peerPair" } }, { action: "pairingCode" })?.action).toBe("peerPair");
  });

  it("main keeps only the known details of these codes", () => {
    expect(accessRefusalDetailsOf("owner_local_only", { action: "peerEnable", clientToken: "mct-1", issuedVia: null })).toEqual({ action: "peerEnable", issuedVia: null });
    expect(accessRefusalDetailsOf("device_scope_denied", { scope: "chat", required: "full" })).toEqual({ scope: "chat", required: "full" });
    expect(accessRefusalDetailsOf("user_in_use", { action: "x" })).toBeUndefined();
    expect(accessRefusalDetailsOf("owner_local_only", null)).toBeUndefined();
    expect(accessRefusalDetailsOf("owner_local_only", { action: "bad action!" })).toBeUndefined();
  });
});

describe("wire readers and bodies", () => {
  it("new-devices list: keeps good items, normalises scope / issuedVia / current", () => {
    const list = readOwnerNewDevices({
      devices: [
        { tokenId: "mct-6f7a8b9c0d1e2f30", label: "iPhone 16", kind: "device", deviceName: "iPhone 16", platform: "ios", ownerName: null, scope: "full", issuedVia: "pairing", createdAt: "2026-10-19T10:00:00Z", lastUsedAt: null, lastAddress: null, userId: "owner", pending: false, person: null, at: "2026-10-19T10:00:01Z", via: "pairing", current: false },
        { tokenId: "mct-x", label: "cli", kind: "client", createdAt: "2026-10-19T09:00:00Z", userId: "owner", pending: false, at: "2026-10-19T09:00:00Z", via: "ssh", current: true, scope: "weird" },
        { label: "no id" },
        null,
      ],
    });
    expect(list.map((d) => [d.tokenId, d.via, d.current, d.scope])).toEqual([["mct-6f7a8b9c0d1e2f30", "pairing", false, "full"], ["mct-x", "ssh", true, "read"]]);
    expect(readOwnerNewDevices({})).toEqual([]);
    expect(readOwnerNewDevices(null)).toEqual([]);
  });

  it("ownerDeviceAdded host event", () => {
    const env = (method: string, params: unknown) => ({ cutexSessionId: "cutex.host", cutex: { method, params } }) as unknown as EventEnvelope;
    expect(ownerDeviceAddedOf(env("cutex/access/ownerDeviceAdded", { tokenId: "mct-1", label: "Galaxy S25", deviceName: "Galaxy S25", platform: "android", scope: "full", at: "2026-10-19T10:00:00Z", via: "pairing" }))).toEqual({ tokenId: "mct-1", label: "Galaxy S25", deviceName: "Galaxy S25", platform: "android", scope: "full", at: "2026-10-19T10:00:00Z", via: "pairing" });
    expect(ownerDeviceAddedOf(env("cutex/access/changed", { tokenId: "mct-1" }))).toBeNull();
    expect(ownerDeviceAddedOf(env("cutex/access/ownerDeviceAdded", {}))).toBeNull();
  });

  it("client-token PATCH body: name and / or scope, never empty", () => {
    expect(clientTokenUpdateBody({ name: "  Pixel  " })).toEqual({ name: "Pixel" });
    expect(clientTokenUpdateBody({ name: "  " })).toEqual({ name: null });
    expect(clientTokenUpdateBody({ scope: "chat" })).toEqual({ scope: "chat" });
    expect(clientTokenUpdateBody({ name: null, scope: "read" })).toEqual({ name: null, scope: "read" });
    expect(() => clientTokenUpdateBody({})).toThrow();
    expect(() => clientTokenUpdateBody({ scope: "admin" as never })).toThrow();
  });

  it("peers: tellWake / tellWakesPerHour in the policy patch, defaults for older hosts", () => {
    expect(peerPatchBody({ policy: { inbound: { tellWake: true, tellWakesPerHour: 30 } } })).toEqual({ policy: { inbound: { tellWake: true, tellWakesPerHour: 30 } } });
    expect(() => peerPatchBody({ policy: { inbound: { tellWake: "yes" } } })).toThrow();
    expect(() => peerPatchBody({ policy: { inbound: { tellWakesPerHour: 0 } } })).toThrow();
    expect(peerTellWakeOf({ inbound: { ...PEER_POLICY_DEFAULT.inbound, tellWake: undefined, tellWakesPerHour: undefined } })).toEqual({ tellWake: false, tellWakesPerHour: 60 });
    expect(peerTellWakeOf(PEER_POLICY_DEFAULT)).toEqual({ tellWake: false, tellWakesPerHour: 60 });
    expect(peerTellWakeOf(null)).toEqual({ tellWake: false, tellWakesPerHour: 60 });
  });
});

describe("new owner devices store (lib/ownerDevices)", () => {
  const device = (tokenId: string, current = false) => ({ tokenId, label: tokenId, kind: "device", createdAt: "", userId: "owner", pending: false, at: "", via: "pairing", current });
  beforeEach(() => {
    fake.calls.length = 0;
    fake.lists = {};
    fake.ackResult = null;
    fake.revokeError = null;
  });

  it("reads per host, once per epoch unless forced; null = an older cutex", async () => {
    fake.lists["host-1"] = { ok: true, value: [device("mct-a"), device("mct-b", true)] };
    fake.lists["host-2"] = { ok: true, value: null };
    await loadOwnerNewDevices("host-1", "e1");
    await loadOwnerNewDevices("host-1", "e1");
    await loadOwnerNewDevices("host-2", "e1");
    expect(fake.calls).toEqual(["list host-1", "list host-2"]);
    expect(ownerDevicesNow("host-1")).toMatchObject({ supported: true, loading: false, error: null, epoch: "e1" });
    expect(ownerDevicesNow("host-1").devices.map((d) => d.tokenId)).toEqual(["mct-a", "mct-b"]);
    expect(ownerDevicesNow("host-2")).toMatchObject({ supported: false, devices: [] });
    await loadOwnerNewDevices("host-1", "e2");
    expect(fake.calls).toEqual(["list host-1", "list host-2", "list host-1"]);
  });

  it("a refusal is kept as the entry's error; the list stays", async () => {
    fake.lists["host-3"] = { ok: true, value: [device("mct-a")] };
    await loadOwnerNewDevices("host-3", "e1");
    fake.lists["host-3"] = { ok: false, error: { code: "owner_required", message: "owner only" } };
    await loadOwnerNewDevices("host-3", "e1", true);
    expect(ownerDevicesNow("host-3")).toMatchObject({ error: { code: "owner_required" }, devices: [{ tokenId: "mct-a" }] });
  });

  it("ack and revoke drop the device; refusals come back as values", async () => {
    fake.lists["host-4"] = { ok: true, value: [device("mct-a"), device("mct-b"), device("mct-c")] };
    await loadOwnerNewDevices("host-4", "e1");
    expect(await ackOwnerDevice("host-4", "mct-a")).toEqual({ ok: true, value: { tokenId: "mct-a", acknowledged: true } });
    expect(await revokeOwnerDevice("host-4", "mct-b")).toEqual({ ok: true, value: { tokenId: "mct-b", revoked: true } });
    expect(ownerDevicesNow("host-4").devices.map((d) => d.tokenId)).toEqual(["mct-c"]);
    fake.ackResult = { ok: false, error: { code: "device_scope_denied", message: "", access: { scope: "read", required: "full" } } };
    const refused = await ackOwnerDevice("host-4", "mct-c");
    expect(accessRefusalOf(refused)).toMatchObject({ reason: "deviceScopeDenied", scope: "read" });
    fake.revokeError = new Error("Error invoking remote method 'x': Error: device_scope_denied: needs full");
    expect(await revokeOwnerDevice("host-4", "mct-c")).toEqual({ ok: false, error: { code: "device_scope_denied", message: "needs full" } });
    expect(ownerDevicesNow("host-4").devices.map((d) => d.tokenId)).toEqual(["mct-c"]);
    expect(fake.calls).toContain("ack host-4 mct-a");
    expect(fake.calls).toContain("revoke host-4 mct-b");
  });

  it("cutex/access/ownerDeviceAdded on a host: remembered as latest and the list re-read (that host only)", async () => {
    fake.lists["host-5"] = { ok: true, value: [] };
    await loadOwnerNewDevices("host-5", "e1");
    fake.lists["host-5"] = { ok: true, value: [device("mct-new")] };
    const params = { tokenId: "mct-new", label: "Galaxy S25", deviceName: "Galaxy S25", platform: "android", scope: "full", at: "2026-10-19T10:00:00Z", via: "pairing" };
    for (const fn of fake.handlers.hostEvent ?? []) fn({ hostId: "host-5", envelope: { cutexSessionId: "cutex.host", cutex: { method: "cutex/access/ownerDeviceAdded", params } } });
    await vi.waitFor(() => expect(ownerDevicesNow("host-5").devices.map((d) => d.tokenId)).toEqual(["mct-new"]));
    expect(ownerDevicesNow("host-5").latest).toMatchObject({ tokenId: "mct-new", via: "pairing" });
    expect(fake.calls.filter((c) => c === "list host-5")).toHaveLength(2);
    expect(fake.calls.some((c) => c.includes("host-1"))).toBe(false);
  });

  it("refusalFromError reads the code off an IPC message", () => {
    expect(refusalFromError(new Error("Error invoking remote method 'cutex:invoke': Error: client_token_not_found: no client token"))).toEqual({ code: "client_token_not_found", message: "no client token" });
    expect(refusalFromError("boom")).toEqual({ code: "error", message: "boom" });
  });
});
