// @vitest-environment jsdom
// The 设置 dot for a new owner device looks at every connected host, not only the focus host: a device
// with full control on another host must not go unannounced. This desktop's own token never counts, a
// member's connection and an older cutex read nothing.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOTICE = new Set(["owner-device-notice"]);
const fx = vi.hoisted(() => ({
  lists: {} as Record<string, unknown[]>,
  calls: [] as string[],
  state: {} as Record<string, unknown>,
}));
vi.mock("../src/renderer/src/bridge", () => {
  const hostApi = (hostId: string) => ({
    ownerNewDevices: async () => {
      fx.calls.push(hostId);
      return { ok: true, value: fx.lists[hostId] ?? [] };
    },
  });
  return { api: hostApi("local"), bridge: { api: hostApi("local"), on: () => () => {} }, apiFor: hostApi };
});
vi.mock("../src/renderer/src/store", () => {
  const useApp = Object.assign((selector: (s: unknown) => unknown) => selector(fx.state), { getState: () => fx.state });
  return { useApp };
});

import { useOwnerDevicesAttention } from "../src/renderer/src/components/settings/OwnerDevices";
import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { useHostsWithNewOwnerDevices } from "../src/renderer/src/lib/ownerDevices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const owner = { id: "owner", name: "Sam", isOwner: true, pending: false, grant: null };
const device = (tokenId: string, current = false) => ({ tokenId, label: tokenId, kind: "device", createdAt: "", userId: "owner", pending: false, at: "", current });
const connected = (features: ReadonlySet<string> = NOTICE) => ({ daemon: { kind: "connected" }, features, featuresKnown: true, sidebar: null, approvals: null, services: null });
const host = (id: string) => ({ id, kind: id === "local" ? "local" : "ssh", label: id, conn: { epoch: `epoch-${id}` } });

function setup(byHost: Record<string, unknown>) {
  fx.state = {
    hosts: { active: "local", scope: { kind: "host", id: "local" }, groups: [], hosts: [host("local"), ...Object.keys(byHost).map(host)] },
    ...connected(),
    byHost,
  };
}

function mount() {
  const out: { dot: boolean; hosts: string[] } = { dot: false, hosts: [] };
  function Probe() {
    out.dot = useOwnerDevicesAttention();
    out.hosts = useHostsWithNewOwnerDevices();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(h(Probe)));
  return { out, unmount: () => act(() => root.unmount()) };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  fx.calls.length = 0;
  for (const key of Object.keys(fx.lists)) delete fx.lists[key];
});

afterEach(() => {
  fx.state = {};
});

describe("the 设置 dot for new owner devices", () => {
  it("lights for a new owner device on a host that is not the focus host", async () => {
    setup({ ws: connected() });
    fx.lists.local = [];
    fx.lists.ws = [device("mct-phone")];
    noteHostAccess("local", { user: { ...owner, token: null } });
    noteHostAccess("ws", { user: { ...owner, token: null } });
    const { out, unmount } = mount();
    await flush();
    expect(out.dot).toBe(true);
    expect(out.hosts).toEqual(["ws"]);
    unmount();
  });

  it("stays off for this desktop's own token, a member's connection and an older cutex", async () => {
    setup({ own: connected(), member: connected(), old: connected(new Set()) });
    fx.lists.own = [device("mct-self", true)];
    fx.lists.member = [device("mct-other")];
    noteHostAccess("local", { user: { ...owner, token: null } });
    noteHostAccess("own", { user: { ...owner, token: null } });
    noteHostAccess("member", { user: { id: "u-1", name: "Mia", isOwner: false, pending: false, grant: { projects: [], standaloneAgents: [], send: false } } });
    noteHostAccess("old", { user: { ...owner, token: null } });
    const { out, unmount } = mount();
    await flush();
    expect(out.dot).toBe(false);
    expect(fx.calls).not.toContain("member");
    expect(fx.calls).not.toContain("old");
    unmount();
  });
});
