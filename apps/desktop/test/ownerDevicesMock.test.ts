// The browser preview's owner devices (dev/mockBridge.ts + modules/users, remote-access, peers mocks;
// docs/research/owner-devices-desktop-api-20261019.md "Mock"): who this desktop is on each host, new
// owner devices and their event, scopes on tokens, owner-local refusals, an older cutex.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreloadBridge } from "../src/shared/ipc";
import { accessRefusalOf, hostUserAccessOf, ownerLocalActionsAllowed } from "../src/shared/users";

async function install(search = ""): Promise<PreloadBridge> {
  vi.resetModules();
  vi.useFakeTimers();
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return win.cutex!;
}

async function allowed(api: Pick<PreloadBridge["api"], "capabilities">) {
  const caps = await api.capabilities();
  return ownerLocalActionsAllowed(hostUserAccessOf(caps), caps?.featureList ?? []);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mock bridge owner devices", () => {
  it("HOST-A root (local), workstation over SSH (hostCli, local)", async () => {
    const bridge = await install();
    const caps = await bridge.api.capabilities();
    expect(caps?.featureList).toEqual(expect.arrayContaining(["owner-local-only", "owner-device-notice", "device-scope", "cross-host-tell-wake"]));
    expect(caps?.user).toMatchObject({ isOwner: true, token: null, scope: "full", ownerLocal: true });
    expect(await allowed(bridge.api)).toBe("yes");
    await bridge.api.connectHost("ssh-7a3f01c2", true);
    await vi.advanceTimersByTimeAsync(3000);
    const ws = bridge.apiFor!("ssh-7a3f01c2");
    expect((await ws.capabilities())?.user).toMatchObject({ token: { id: "mct-4b5c6d7e8f901a2b", issuedVia: "hostCli", scope: "full" }, ownerLocal: true });
    expect(await allowed(ws)).toBe("yes");
    expect(await ws.ownerNewDevices()).toEqual({ ok: true, value: [] });
  });

  it("?ownerdevice: HOST-A through a paired owner device — not local, root-identity actions refused", async () => {
    const bridge = await install("?ownerdevice");
    expect((await bridge.api.capabilities())?.user).toMatchObject({ isOwner: true, token: { issuedVia: "pairing" }, ownerLocal: false });
    expect(await allowed(bridge.api)).toBe("no");
    const thrown = await bridge.api.createPairingCode().catch((e: unknown) => e);
    expect(accessRefusalOf(thrown, { action: "pairingCode" })).toMatchObject({ reason: "ownerLocalOnly", action: "pairingCode" });
    expect(accessRefusalOf(await bridge.api.patchUsersSettings({ ownerRequiresApproval: false }))).toMatchObject({ reason: "ownerLocalOnly", action: "disableOwnerApproval" });
    expect(accessRefusalOf(await bridge.api.createPeerInvite({}))).toMatchObject({ reason: "ownerLocalOnly", action: "peerPair" });
    expect(accessRefusalOf(await bridge.api.patchPeersSettings({ enabled: true }))).toMatchObject({ reason: "ownerLocalOnly", action: "peersEnable" });
  });

  it("new owner devices: one unacknowledged, ack / revoke, scope narrowing drops it", async () => {
    const bridge = await install();
    const first = await bridge.api.ownerNewDevices();
    expect(first.ok && first.value?.map((d) => [d.tokenId, d.label, d.via, d.scope])).toEqual([["mct-6f7a8b9c0d1e2f30", "iPhone 16", "pairing", "full"]]);
    expect(await bridge.api.ackOwnerNewDevice("mct-6f7a8b9c0d1e2f30")).toEqual({ ok: true, value: { tokenId: "mct-6f7a8b9c0d1e2f30", acknowledged: true } });
    expect(await bridge.api.ackOwnerNewDevice("mct-6f7a8b9c0d1e2f30")).toEqual({ ok: true, value: { tokenId: "mct-6f7a8b9c0d1e2f30", acknowledged: false } });
    expect(await bridge.api.ownerNewDevices()).toEqual({ ok: true, value: [] });
    // Tokens carry scope / issuedVia; PATCH changes the scope in every list.
    const tokens = await bridge.api.clientTokens();
    expect(tokens.find((t) => t.tokenId === "mct-9f8e7d6c5b4a3f2e")).toMatchObject({ scope: "full", issuedVia: "hostCli" });
    expect(await bridge.api.updateClientToken("mct-1a2b3c4d5e6f7a8b", { scope: "chat" })).toEqual({ ok: true, value: { tokenId: "mct-1a2b3c4d5e6f7a8b", ownerName: null, scope: "chat" } });
    expect((await bridge.api.users())?.tokens.find((t) => t.tokenId === "mct-1a2b3c4d5e6f7a8b")?.scope).toBe("chat");
    expect(await bridge.api.updateClientToken("mct-1a2b3c4d5e6f7a8b", { name: "Sam 的手机", scope: "full" })).toMatchObject({ ok: true, value: { ownerName: "Sam 的手机", scope: "full" } });
    expect(accessRefusalOf(await bridge.api.updateClientToken("mct-1a2b3c4d5e6f7a8b", { scope: "root" as never }))?.reason).toBe("invalidScope");
    // Revoke reaches the users list too.
    await bridge.api.revokeClientToken("mct-1a2b3c4d5e6f7a8b");
    expect((await bridge.api.users())?.tokens.some((t) => t.tokenId === "mct-1a2b3c4d5e6f7a8b")).toBe(false);
  });

  it("pairing codes: owner codes live 5 minutes and say ownerDevice; member codes 10; scope echoed", async () => {
    const bridge = await install();
    expect(await bridge.api.createPairingCode("iPhone")).toMatchObject({ ttlSeconds: 300, ownerDevice: true, scope: "full", userId: "owner" });
    expect(await bridge.api.createPairingCode("iPad", "u-5f1c2a9e0b7d", "chat")).toMatchObject({ ttlSeconds: 600, ownerDevice: false, scope: "chat", userId: "u-5f1c2a9e0b7d" });
  });

  it("?ownerdevicedemo=1: a device pairs and cutex/access/ownerDeviceAdded arrives on HOST-A's feed", async () => {
    const bridge = await install("?ownerdevicedemo=1");
    const seen: unknown[] = [];
    bridge.on("hostEvent", ({ hostId, envelope }) => envelope.cutex?.method === "cutex/access/ownerDeviceAdded" && seen.push([hostId, envelope.cutex.params]));
    await vi.advanceTimersByTimeAsync(1500);
    expect(seen).toEqual([["local", expect.objectContaining({ tokenId: "mct-8091a2b3c4d5e6f7", label: "Galaxy S25", via: "pairing", scope: "full" })]]);
    const r = await bridge.api.ownerNewDevices();
    expect(r.ok && r.value?.map((d) => d.tokenId)).toEqual(["mct-6f7a8b9c0d1e2f30", "mct-8091a2b3c4d5e6f7"]);
  });

  it("?scope=read: narrowed connection — not allowed, ack refused with device_scope_denied", async () => {
    const bridge = await install("?scope=read");
    expect((await bridge.api.capabilities())?.user).toMatchObject({ scope: "read", ownerLocal: true });
    expect(await allowed(bridge.api)).toBe("no");
    expect(accessRefusalOf(await bridge.api.ackOwnerNewDevice("mct-6f7a8b9c0d1e2f30"))).toMatchObject({ reason: "deviceScopeDenied", scope: "read", required: "full" });
  });

  it("?noownerlocal / ?legacy: an older cutex — fields and features missing reads as unknown", async () => {
    const older = await install("?noownerlocal");
    const caps = await older.api.capabilities();
    expect(caps?.featureList).not.toContain("owner-local-only");
    expect(caps?.user).not.toHaveProperty("ownerLocal");
    expect(await allowed(older.api)).toBe("unknown");
    expect(await older.api.ownerNewDevices()).toEqual({ ok: true, value: null });
    expect((await older.api.clientTokens())[0]).not.toHaveProperty("scope");
    const legacy = await install("?legacy");
    expect(await allowed(legacy.api)).toBe("unknown");
  });
});
