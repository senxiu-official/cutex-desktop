// @vitest-environment jsdom
// lib/scopedSidebarView: the keys that keep the sidebar's SidebarHostsContext value (and so every row) unchanged across
// refreshes that change nothing rows show (perf 2026-11-26).
import { describe, expect, it } from "vitest";
import type { HostLook } from "../src/renderer/src/lib/hostScope";
import { hostStatesKey, sidebarHostsKey } from "../src/renderer/src/lib/scopedSidebarView";

const look = (id: string, over: Partial<HostLook> = {}): HostLook =>
  ({ id, label: id, color: "#228be6", local: id === "local", indicator: { status: "online", problem: null, detail: null, retryAt: null }, view: { id }, build: null, ...over }) as HostLook;
const scope = (hosts: HostLook[], over: { showHostMarks?: boolean; focus?: string } = {}) => ({ showHostMarks: true, focus: "local", hosts, ...over });

describe("sidebarHostsKey", () => {
  it("ignores host details rows do not draw (a tunnel retry time, a build read, a new view object)", () => {
    const base = sidebarHostsKey(scope([look("local"), look("hostb")]));
    const retrying = look("hostb", { indicator: { status: "online", problem: null, detail: "ssh: retry", retryAt: 123 }, view: { id: "hostb", lastConnectedAt: "now" } as never, build: { commit: "abc" } as never });
    expect(sidebarHostsKey(scope([look("local"), retrying]))).toBe(base);
  });

  it("changes with marks, focus, and each host's label, colour, status and local flag", () => {
    const hosts = [look("local"), look("hostb")];
    const base = sidebarHostsKey(scope(hosts));
    expect(sidebarHostsKey(scope(hosts, { showHostMarks: false }))).not.toBe(base);
    expect(sidebarHostsKey(scope(hosts, { focus: "hostb" }))).not.toBe(base);
    expect(sidebarHostsKey(scope([look("local"), look("hostb", { label: "T" })]))).not.toBe(base);
    expect(sidebarHostsKey(scope([look("local"), look("hostb", { color: "#fa5252" })]))).not.toBe(base);
    expect(sidebarHostsKey(scope([look("local"), look("hostb", { indicator: { status: "offline" } as never })]))).not.toBe(base);
    expect(sidebarHostsKey(scope([look("local", { local: false }), look("hostb")]))).not.toBe(base);
  });
});

describe("hostStatesKey", () => {
  it("is each host's id and state, in order", () => {
    const key = hostStatesKey([{ look: { id: "local" }, state: "live" }, { look: { id: "hostb" }, state: "loading" }]);
    expect(hostStatesKey([{ look: { id: "local" }, state: "live" }, { look: { id: "hostb" }, state: "loading" }])).toBe(key);
    expect(hostStatesKey([{ look: { id: "local" }, state: "live" }, { look: { id: "hostb" }, state: "live" }])).not.toBe(key);
    expect(hostStatesKey([{ look: { id: "hostb" }, state: "loading" }, { look: { id: "local" }, state: "live" }])).not.toBe(key);
  });
});
