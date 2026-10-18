import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { BrowserRegistry, type BrowserRegistryEvent } from "../src/main/browser/registry";

class Guest extends EventEmitter {
  dead = false;
  closes = 0;
  constructor(readonly id: number) { super(); }
  isDestroyed() { return this.dead; }
  close() { this.closes++; this.dead = true; this.emit("destroyed"); }
}
function setup() {
  const events: BrowserRegistryEvent[] = [], revoked: string[] = [];
  let id = 0;
  const registry = new BrowserRegistry<Guest>({ newGuestId: () => `opaque-browser-${String(++id).padStart(16, "0")}`,
    onEvent: e => events.push(e), onRevoke: (record, reason) => revoked.push(`${record.guestId}:${reason}`) });
  registry.registerHost("local", "epoch-a"); registry.registerHost("ssh-one", "epoch-ssh");
  return { registry, events, revoked };
}
describe("browser guest registry", () => {
  it("opaque identity is host+tabKey scoped, retaining pool and epoch", () => {
    const { registry } = setup();
    const a = registry.ensure("local", "side-1"), b = registry.ensure("ssh-one", "side-1");
    expect(a.guestId).not.toBe(b.guestId);
    expect(registry.ensure("local", "side-1")).toBe(a);
    expect(a).toMatchObject({ epoch: "epoch-a", partition: "persist:browser-local", pageGeneration: 0 });
    expect(() => registry.ensure("local", "side-1", "agent")).toThrow();
    expect(Object.isFrozen(a)).toBe(true);
  });
  it("scope-local shell ids are not used: independent state keys allocate independent guests", () => {
    const { registry } = setup();
    const scopeA = { id: "side-1", tabKey: crypto.randomUUID() }, scopeB = { id: "side-1", tabKey: crypto.randomUUID() };
    const a = registry.ensure("local", scopeA.tabKey), b = registry.ensure("local", scopeB.tabKey);
    expect(a.guestId).not.toBe(b.guestId);
    registry.close(a.guestId);
    expect(registry.getByTab("local", scopeB.tabKey)).toBe(b);
    expect(registry.getByTab("local", scopeA.id)).toBeUndefined();
  });
  it("LRU unload preserves identity and monotonically allocates across executor recreation", () => {
    const { registry, revoked } = setup();
    const first = registry.ensure("local", "side-1"), guest = new Guest(1);
    registry.attach(first.guestId, guest);
    const generation = registry.nextPageGeneration(first.guestId);
    registry.unmount(first.guestId);
    expect(guest.closes).toBe(1);
    expect(registry.ensure("local", "side-1").guestId).toBe(first.guestId);
    registry.attach(first.guestId, new Guest(2));
    expect(registry.nextPageGeneration(first.guestId)).toBeGreaterThan(generation);
    expect(revoked).toEqual([`${first.guestId}:unmounted`]);
  });
  it("closed ids are retired even if allocator attempts to reuse them", () => {
    const registry = new BrowserRegistry({ newGuestId: () => "opaque-browser-constant" });
    registry.registerHost("local", "a");
    const first = registry.ensure("local", "side"); registry.close(first.guestId);
    expect(registry.get(first.guestId)).toBeUndefined();
    expect(() => registry.nextPageGeneration(first.guestId)).toThrow();
    expect(() => registry.ensure("local", "side")).toThrow("allocator");
  });
  it("new tab with the same side id gets a new runtime identity after close", () => {
    const { registry } = setup();
    const first = registry.ensure("local", "side"); registry.close(first.guestId);
    expect(registry.ensure("local", "side").guestId).not.toBe(first.guestId);
  });
  it("guest destruction and crash revoke once, preserve side identity, and drop handle", () => {
    const { registry, events, revoked } = setup();
    const record = registry.ensure("local", "side"), guest = new Guest(1);
    registry.attach(record.guestId, guest);
    guest.emit("render-process-gone", {}, { reason: "crashed" });
    expect(registry.get(record.guestId)?.status).toBe("crashed");
    expect(registry.getWebContents(record.guestId)).toBeUndefined();
    expect(registry.getByWebContentsId(1)).toBeUndefined();
    expect(revoked).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe("crashed");
    registry.attach(record.guestId, new Guest(2));
    registry.getWebContents(record.guestId)!.emit("destroyed");
    expect(events.at(-1)?.kind).toBe("destroyed");
    expect(revoked).toHaveLength(2);
  });
  it("host replacement/removal synchronously retires only its own guests", () => {
    const { registry, events } = setup();
    const local = registry.ensure("local", "side"), ssh = registry.ensure("ssh-one", "side");
    const guest = new Guest(1); registry.attach(local.guestId, guest);
    registry.registerHost("local", "epoch-b");
    expect(guest.closes).toBe(1);
    expect(registry.get(local.guestId)).toBeUndefined();
    expect(registry.get(ssh.guestId)).toBeDefined();
    expect(events.at(-1)).toMatchObject({ kind: "host_changed", epoch: "epoch-a" });
    expect(registry.ensure("local", "side").epoch).toBe("epoch-b");
    registry.removeHost("local");
    expect(() => registry.ensure("local", "side")).toThrow();
    expect(registry.list()).toEqual([ssh]);
  });
  it("does not reassign a live webContents and ignores events from replaced handles", () => {
    const { registry } = setup();
    const a = registry.ensure("local", "a"), b = registry.ensure("local", "b"), first = new Guest(1);
    registry.attach(a.guestId, first);
    expect(() => registry.attach(b.guestId, first)).toThrow();
    const next = new Guest(2); registry.attach(a.guestId, next);
    first.emit("render-process-gone", {});
    expect(registry.getWebContents(a.guestId)).toBe(next);
  });
  it("revocation observes no public handle, but receives the old handle for debugger cleanup", () => {
    const guest = new Guest(1);
    const registry = new BrowserRegistry<Guest>({ onRevoke: (record, _reason, old) => {
      expect(registry.getWebContents(record.guestId)).toBeUndefined();
      expect(old).toBe(guest);
    } });
    registry.registerHost("local", "a");
    const record = registry.ensure("local", "side"); registry.attach(record.guestId, guest); registry.unmount(record.guestId);
  });
  it("observer exceptions cannot skip close or resurrect admission", () => {
    const registry = new BrowserRegistry<Guest>({ onEvent: () => { throw new Error(); }, onRevoke: () => { throw new Error(); } });
    registry.registerHost("local", "a");
    const record = registry.ensure("local", "side"), guest = new Guest(1); registry.attach(record.guestId, guest);
    registry.removeHost("local");
    expect(guest.dead).toBe(true); expect(registry.list()).toHaveLength(0);
  });
  it("invalid host/instance and destroyed handles fail closed", () => {
    const { registry } = setup();
    expect(() => registry.ensure("ssh-missing", "side")).toThrow();
    expect(() => registry.ensure("local", "x\0y")).toThrow();
    const record = registry.ensure("local", "side"), guest = new Guest(1); guest.close();
    expect(() => registry.attach(record.guestId, guest)).toThrow();
  });
});
describe("carrier hand-over (replace)", () => {
  it("replaces the guest under the same identity: old one closed and revoked as replaced, generation retired", () => {
    const { registry, revoked, events } = setup();
    const record = registry.ensure("local", "agent-tab", "agent"), carrier = new Guest(41), webview = new Guest(42);
    registry.attach(record.guestId, carrier);
    const before = registry.get(record.guestId)!.pageGeneration;
    registry.attach(record.guestId, webview, { replace: true });
    expect(carrier.closes).toBe(1); expect(registry.getWebContents(record.guestId)).toBe(webview);
    expect(revoked).toEqual([`${record.guestId}:replaced`]);
    expect(events.map(e => e.kind)).toContain("replaced");
    expect(registry.get(record.guestId)).toMatchObject({ status: "attached", guestId: record.guestId, partition: "persist:browser-agent-local" });
    expect(registry.get(record.guestId)!.pageGeneration).toBeGreaterThan(before);
    expect(registry.getByWebContentsId(41)).toBeUndefined(); expect(registry.getByWebContentsId(42)?.guestId).toBe(record.guestId);
    // Without replace an attach over a live guest stays an ordinary unmount.
    registry.attach(record.guestId, new Guest(43));
    expect(revoked.at(-1)).toBe(`${record.guestId}:unmounted`);
  });
});
