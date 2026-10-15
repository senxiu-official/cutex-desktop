// Multi-host P1 step 2b (RFC §9.2, §10, §8.5): which hosts feed the cross-host lists and counts.
import { describe, expect, it } from "vitest";
import type { HostsState, HostView } from "../src/shared/hosts";
import type { DaemonState } from "../src/shared/ipc";
import { anyHostHas, connectedHostIds, hostsWithoutData, outOfScopeCount, staleHostIds } from "../src/renderer/src/lib/hostCounts";
import { mergeHostLists, resolveHostScope, type HostData } from "../src/renderer/src/lib/hostScope";

const connected: DaemonState = { kind: "connected", baseUrl: "mock://", hostId: "X" };
const view = (id: string, epoch: string | null): HostView =>
  ({ id, kind: id === "local" ? "local" : "ssh", label: id, target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, conn: epoch ? { epoch, tunnel: null, daemon: connected, cutexBuild: null } : undefined }) as unknown as HostView;
const state = (active: string, hosts: HostView[], scope: HostsState["scope"] = { kind: "host", id: active }): HostsState =>
  ({ scope, active, hosts, groups: [], startOn: "last", tunnel: null }) as unknown as HostsState;
const data = (hostId: string, extra: Partial<HostData> = {}): HostData => ({ hostId, focus: false, daemon: connected, features: new Set(), featuresKnown: true, sidebar: null, approvals: null, services: null, ...extra });

describe("connected hosts (counts span every connected host, RFC §10)", () => {
  it("the focus host and every host with a live connection, switcher order", () => {
    expect(connectedHostIds(state("local", [view("local", "e1"), view("t", null), view("a", "e2")]))).toEqual(["local", "a"]);
    // A focus host still connecting (no epoch yet) counts as the shown one.
    expect(connectedHostIds(state("t", [view("local", null), view("t", null)]))).toEqual(["t"]);
    expect(connectedHostIds(null)).toEqual(["local"]);
  });

  it("「其他主机 N 项」 sums only the hosts outside the scope", () => {
    const scope = resolveHostScope({ hosts: state("local", [view("local", "e1"), view("t", "e2"), view("a", "e3")]), daemon: connected, byHost: {} });
    expect(outOfScopeCount({ local: 2, t: 3, a: 1 }, scope.isInScope)).toBe(4);
    const all = resolveHostScope({ hosts: state("local", [view("local", "e1"), view("t", "e2")], { kind: "all" }), daemon: connected, byHost: {} });
    expect(outOfScopeCount({ local: 2, t: 3 }, all.isInScope)).toBe(0);
  });
});

describe("list hosts (RFC §8.5)", () => {
  it("hosts of the scope without loaded data get the notice; ones whose daemon went away are stale", () => {
    const scope = resolveHostScope({ hosts: state("local", [view("local", "e1"), view("t", "e2"), view("a", null)], { kind: "all" }), daemon: connected, byHost: {} });
    const parts = [data("local", { focus: true }), data("t", { featuresKnown: false })];
    expect(hostsWithoutData(scope.hostsInScope, parts).map((h) => h.id)).toEqual(["t", "a"]);
    const gone: DaemonState = { kind: "unreachable", baseUrl: "", message: "down" };
    expect([...staleHostIds([data("local"), data("t", { daemon: gone }), data("a", { daemon: gone, featuresKnown: false })])]).toEqual(["t"]);
  });

  it("a page is supported when any host has the capability", () => {
    expect(anyHostHas([data("local"), data("t", { features: new Set(["services"]) })], "services")).toBe(true);
    expect(anyHostHas([data("local")], "services")).toBe(false);
  });

  it("same ids on two hosts stay two entries with distinct keys", () => {
    const merged = mergeHostLists([{ hostId: "local", items: [{ slug: "docs" }] }, { hostId: "t", items: [{ slug: "docs" }] }], (s) => s.slug);
    expect(merged.map((m) => m.key)).toEqual([JSON.stringify(["local", "docs"]), JSON.stringify(["t", "docs"])]);
  });
});
