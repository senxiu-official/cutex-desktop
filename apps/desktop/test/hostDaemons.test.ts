import { describe, expect, it } from "vitest";
import { hostDaemonsOf } from "../src/renderer/src/lib/hostDaemons";
import type { DaemonState } from "../src/shared/ipc";

const connected = (hostId: string): DaemonState => ({ kind: "connected", baseUrl: "mock://", hostId });

describe("host connectivity projection", () => {
  it("ignores replacement sidebars, services, approvals and waiting records", () => {
    const daemon = connected("remote");
    const first = { remote: { daemon, sidebar: { active: ["a"] }, services: [], approvals: [], waiting: {} } };
    const initial = hostDaemonsOf(first);
    for (let i = 0; i < 100; i++) {
      const refreshed = { remote: { ...first.remote, sidebar: { active: [`a${i}`] }, services: [i], approvals: [i], waiting: { i } } };
      expect(hostDaemonsOf(refreshed)).toBe(initial);
    }
    expect(initial).toEqual({ remote: { daemon } });
  });

  it("publishes connectivity changes, additions and removals", () => {
    const daemon = connected("a"), b = connected("b");
    const first = hostDaemonsOf({ a: { daemon } });
    const next = hostDaemonsOf({ a: { daemon: { kind: "unreachable", baseUrl: "mock://", message: "gone" } } });
    expect(next).not.toBe(first);
    expect(next.a!.daemon.kind).toBe("unreachable");
    const added = hostDaemonsOf({ ...next, b: { daemon: b } });
    expect(added.b!.daemon).toBe(b);
    const removed = hostDaemonsOf({ b: { daemon: b } });
    expect(removed.a).toBeUndefined();
    expect(removed).not.toBe(added);
  });

  it("keeps an earlier input's snapshot stable when React reads it again", () => {
    const a = { a: { daemon: connected("a") } }, b = { b: { daemon: connected("b") } };
    const first = hostDaemonsOf(a);
    hostDaemonsOf(b);
    expect(hostDaemonsOf(a)).toBe(first);
    expect(hostDaemonsOf(a)).toBe(first);
  });
});
