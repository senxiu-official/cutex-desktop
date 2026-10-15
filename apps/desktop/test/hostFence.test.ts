import { describe, expect, it } from "vitest";
import { admitHostBinding, type FenceHosts } from "../src/main/hostFence";

class Daemon { generation = 1; }
function world() {
  const conns = new Map<string, { routingEpoch: string; daemon: Daemon }>([
    ["a", { routingEpoch: "ea", daemon: new Daemon() }],
    ["b", { routingEpoch: "eb", daemon: new Daemon() }],
  ]);
  let focus = "a";
  const hosts: FenceHosts<Daemon> = { connection: (id) => (id ? conns.get(id) : undefined), focus: () => focus };
  return { conns, hosts, setFocus: (id: string) => { focus = id; } };
}

describe("host / epoch fence", () => {
  it("admits a matching binding and returns that connection's daemon", () => {
    const { conns, hosts } = world();
    const fence = admitHostBinding(() => hosts, { hostId: "b", epoch: "eb" });
    expect(fence.daemon).toBe(conns.get("b")!.daemon);
    expect(() => fence.check()).not.toThrow();
  });

  it("refuses at admission: no hosts, no binding, unknown host, wrong or missing epoch, lost focus", () => {
    const { hosts } = world();
    const refused = "host binding unavailable or changed";
    expect(() => admitHostBinding(() => null, { hostId: "a", epoch: "ea" })).toThrow(refused);
    expect(() => admitHostBinding(() => hosts, null)).toThrow(refused);
    expect(() => admitHostBinding(() => hosts, { hostId: "x", epoch: "ea" })).toThrow(refused);
    expect(() => admitHostBinding(() => hosts, { hostId: "a", epoch: "eb" })).toThrow(refused);
    expect(() => admitHostBinding(() => hosts, { hostId: "a" } as never)).toThrow(refused);
    expect(() => admitHostBinding(() => hosts, { hostId: "b", epoch: "eb", focus: true })).toThrow(refused);
    expect(() => admitHostBinding(() => hosts, { hostId: "a", epoch: "ea", focus: true })).not.toThrow();
  });

  it("check() fences a reply after a daemon reconnect (generation)", () => {
    const { conns, hosts } = world();
    const fence = admitHostBinding(() => hosts, { hostId: "a", epoch: "ea" });
    conns.get("a")!.daemon.generation++;
    expect(() => fence.check()).toThrow("host switched");
  });

  it("check() fences a reply after the connection was replaced or closed", () => {
    const { conns, hosts } = world();
    const fence = admitHostBinding(() => hosts, { hostId: "a", epoch: "ea" });
    conns.set("a", { routingEpoch: "ea2", daemon: new Daemon() });
    expect(() => fence.check()).toThrow("host switched");
    const fence2 = admitHostBinding(() => hosts, { hostId: "b", epoch: "eb" });
    conns.delete("b");
    expect(() => fence2.check()).toThrow("host switched");
  });

  it("check() fences a focus call when the focus moved, but not a non-focus call", () => {
    const { hosts, setFocus } = world();
    const focusCall = admitHostBinding(() => hosts, { hostId: "a", epoch: "ea", focus: true });
    const plain = admitHostBinding(() => hosts, { hostId: "a", epoch: "ea" });
    setFocus("b");
    expect(() => focusCall.check()).toThrow("host switched");
    expect(() => plain.check()).not.toThrow();
  });

  it("re-reads the host manager at check time", () => {
    const { hosts } = world();
    let current: FenceHosts<Daemon> | null = hosts;
    const fence = admitHostBinding(() => current, { hostId: "a", epoch: "ea" });
    current = null;
    expect(() => fence.check()).toThrow("host switched");
  });
});
