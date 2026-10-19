// @vitest-environment jsdom
// lib/ownerDevices hooks: useOwnerNewDevices(hostId) reads the target host's list once its capability is
// there, follows ownerDeviceAdded, offers ack / revoke only to a full owner connection; useOwnerLocalActions
// says yes / no / unknown per host.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  data: {} as Record<string, { daemon: { kind: string }; features: Set<string>; featuresKnown: boolean }>,
  lists: {} as Record<string, unknown[]>,
  calls: [] as string[],
  handlers: {} as Record<string, ((payload: unknown) => void)[]>,
}));
vi.mock("../src/renderer/src/bridge", () => {
  const hostApi = (hostId: string) => ({
    ownerNewDevices: async () => {
      fx.calls.push(`list ${hostId}`);
      return { ok: true, value: fx.lists[hostId] ?? [] };
    },
    ackOwnerNewDevice: async (tokenId: string) => {
      fx.calls.push(`ack ${hostId} ${tokenId}`);
      fx.lists[hostId] = (fx.lists[hostId] ?? []).filter((d) => (d as { tokenId: string }).tokenId !== tokenId);
      return { ok: true, value: { tokenId, acknowledged: true } };
    },
    revokeClientToken: async () => {},
  });
  const on = (event: string, fn: (payload: unknown) => void) => {
    (fx.handlers[event] ??= []).push(fn);
    return () => {};
  };
  return { api: hostApi("local"), bridge: { api: hostApi("local"), on }, apiFor: hostApi };
});
vi.mock("../src/renderer/src/store", () => ({ useApp: () => null }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({
  useHostLook: (hostId: string) => ({ view: { conn: { epoch: `epoch-${hostId}` } } }),
  useHostData: (hostId: string) => fx.data[hostId] ?? null,
}));

import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { useOwnerLocalActions, useOwnerNewDevices, type OwnerNewDevicesView } from "../src/renderer/src/lib/ownerDevices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FEATURES = new Set(["owner-local-only", "owner-device-notice", "device-scope"]);
const owner = { id: "owner", name: "Sam", isOwner: true, pending: false, grant: null };
const device = (tokenId: string, current = false) => ({ tokenId, label: tokenId, kind: "device", createdAt: "", userId: "owner", pending: false, at: "", via: "pairing", current, scope: "full" });

function mount(hostId: string) {
  const out: { view: OwnerNewDevicesView | null; local: string | null } = { view: null, local: null };
  function Probe() {
    out.view = useOwnerNewDevices(hostId);
    out.local = useOwnerLocalActions(hostId);
    return null;
  }
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(h(Probe)));
  return { out, unmount: () => act(() => root.unmount()) };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  fx.calls.length = 0;
});

describe("useOwnerNewDevices / useOwnerLocalActions", () => {
  it("SSH host as owner (hostCli, full): reads the list, acks, follows the event", async () => {
    fx.data.ws = { daemon: { kind: "connected" }, features: FEATURES, featuresKnown: true };
    fx.lists.ws = [device("mct-a"), device("mct-self", true)];
    noteHostAccess("ws", { user: { ...owner, token: { id: "mct-self", label: "x", scope: "full", issuedVia: "hostCli" }, scope: "full", ownerLocal: true } });
    const { out, unmount } = mount("ws");
    await flush();
    expect(out.local).toBe("yes");
    expect(out.view).toMatchObject({ available: true, supported: true, canAck: true, canRevoke: true });
    expect(out.view!.devices.map((d) => d.tokenId)).toEqual(["mct-a", "mct-self"]);
    expect(out.view!.others.map((d) => d.tokenId)).toEqual(["mct-a"]);
    await act(async () => void (await out.view!.ack("mct-a")));
    expect(out.view!.devices.map((d) => d.tokenId)).toEqual(["mct-self"]);
    // A new device pairs: the host event re-reads that host's list.
    fx.lists.ws = [device("mct-self", true), device("mct-new")];
    act(() => {
      for (const fn of fx.handlers.hostEvent ?? []) fn({ hostId: "ws", envelope: { cutexSessionId: "cutex.host", cutex: { method: "cutex/access/ownerDeviceAdded", params: { tokenId: "mct-new", label: "Galaxy S25", scope: "full", at: "2026-10-19T10:00:00Z", via: "pairing" } } } });
    });
    await flush();
    expect(out.view!.others.map((d) => d.tokenId)).toEqual(["mct-new"]);
    expect(out.view!.latest).toMatchObject({ tokenId: "mct-new", label: "Galaxy S25" });
    act(() => out.view!.clearLatest());
    expect(out.view!.latest).toBeNull();
    unmount();
  });

  it("paired owner device with scope read: not local, may read but not ack / revoke", async () => {
    fx.data.phone = { daemon: { kind: "connected" }, features: FEATURES, featuresKnown: true };
    fx.lists.phone = [device("mct-a")];
    noteHostAccess("phone", { user: { ...owner, token: { id: "mct-p", label: "p", scope: "read", issuedVia: "pairing" }, scope: "read", ownerLocal: false } });
    const { out, unmount } = mount("phone");
    await flush();
    expect(out.local).toBe("no");
    expect(out.view).toMatchObject({ available: true, canAck: false, canRevoke: false });
    expect(out.view!.devices).toHaveLength(1);
    unmount();
  });

  it("older cutex: no capability → supported false, nothing read, owner-local unknown; a member sees nothing", async () => {
    fx.data.old = { daemon: { kind: "connected" }, features: new Set(), featuresKnown: true };
    noteHostAccess("old", { user: { ...owner, token: null } });
    const old = mount("old");
    await flush();
    expect(old.out.local).toBe("unknown");
    expect(old.out.view).toMatchObject({ available: false, supported: false, devices: [], canAck: false });
    expect(fx.calls).not.toContain("list old");
    old.unmount();

    fx.data.member = { daemon: { kind: "connected" }, features: FEATURES, featuresKnown: true };
    noteHostAccess("member", { user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: [], standaloneAgents: [], send: false }, scope: "full", ownerLocal: false } });
    const member = mount("member");
    await flush();
    expect(member.out.view).toMatchObject({ available: false, devices: [] });
    expect(member.out.local).toBe("no");
    expect(fx.calls).not.toContain("list member");
    member.unmount();

    // Not connected / never read: unknown.
    const gone = mount("gone");
    await flush();
    expect(gone.out.local).toBe("unknown");
    expect(gone.out.view).toMatchObject({ available: false, supported: null });
    gone.unmount();
  });
});
