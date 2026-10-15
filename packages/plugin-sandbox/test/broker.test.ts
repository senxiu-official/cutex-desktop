import { afterEach, describe, expect, it, vi } from "vitest";
import { createBroker, isJson, type BrokerOptions, type Operation, type Port } from "../src/broker";

class FakePort implements Port {
  listeners = new Set<(event: MessageEvent) => void>();
  messages: any[] = [];
  closed = false;
  postMessage(message: unknown) { this.messages.push(message); }
  addEventListener(_: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  start() {}
  close() { this.closed = true; }
  emit(message: unknown) { for (const listener of this.listeners) listener({ data: message } as MessageEvent); }
}
const request = (id = 1, extra = {}) => ({ version: 1, kind: "request", instanceId: "one", channel: "secret-channel", id, method: "sessions.list", params: null, ...extra });
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function fixture(overrides: Partial<BrokerOptions> = {}, operation?: Operation) {
  const port = new FakePort();
  const run = vi.fn(() => ({ sessions: ["one"] }));
  const options: BrokerOptions = { instanceId: "one", channel: "secret-channel", scope: { hostId: "host-a", sessionId: "session-a" },
    requestedPermissions: ["sessions.read"], grantedPermissions: ["sessions.read"],
    operations: { "sessions.list": operation ?? { permission: "sessions.read", validate: params => params === null, run } }, ...overrides };
  const broker = createBroker(port, options);
  cleanup.push(() => broker.dispose());
  return { port, run, broker, options };
}
describe("scoped sandbox broker", () => {
  it("requires both a requested permission and a host grant", async () => {
    for (const overrides of [{ grantedPermissions: [] }, { requestedPermissions: [] }]) {
      const { port, run } = fixture(overrides);
      port.emit(request()); await tick();
      expect(run).not.toHaveBeenCalled();
      expect(port.messages[0].error.code).toBe("permission_denied");
    }
  });
  it("supplies immutable host scope and never accepts guest scope", async () => {
    const { port, run, options } = fixture();
    (options.scope as { hostId: string }).hostId = "changed";
    port.emit(request()); await tick();
    expect(run.mock.calls[0]).toEqual([null, expect.objectContaining({ instanceId: "one", scope: { hostId: "host-a", sessionId: "session-a" } })]);
    expect(Object.isFrozen((run.mock.calls[0] as any)[1].scope)).toBe(true);
    port.emit(request(2, { scope: { hostId: "victim" } })); await tick();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong channel/instance and malformed envelopes before dispatch", async () => {
    const { port, run } = fixture();
    for (const patch of [{ channel: "wrong" }, { instanceId: "other" }, { version: 2 }, { id: -1 }, { params: new Date() }, { method: 3 }]) port.emit(request(1, patch));
    await tick(); expect(run).not.toHaveBeenCalled(); expect(port.messages).toEqual([]);
  });
  it("uses an operation allowlist and validates parameters", async () => {
    const { port, run } = fixture();
    port.emit(request(1, { method: "constructor" }));
    port.emit(request(2, { params: { sessionId: "victim" } }));
    await tick(); expect(run).not.toHaveBeenCalled();
    expect(port.messages.map(m => m.error.code)).toEqual(["permission_denied", "invalid_params"]);
  });
  it("does not replay a completed request or replace an in-flight request", async () => {
    const { port, run } = fixture();
    port.emit(request()); port.emit(request()); await tick(); port.emit(request()); await tick();
    expect(run).toHaveBeenCalledTimes(1); expect(port.messages).toHaveLength(1);
  });
  it("revokes pending work, rejects later calls and ignores late completion", async () => {
    let resolve!: (result: null) => void;
    let signal!: AbortSignal;
    const { port, broker } = fixture({}, { permission: "sessions.read", validate: () => true,
      run: (_, context) => { signal = context.signal; return new Promise<null>(done => { resolve = done; }); } });
    port.emit(request()); await tick(); broker.revoke("sessions.read");
    expect(signal.aborted).toBe(true); expect(broker.pendingCount).toBe(0);
    resolve(null); await tick(); port.emit(request(2));
    expect(port.messages.map(m => m.error.code)).toEqual(["permission_revoked", "permission_denied"]);
  });
  it("does not start queued work revoked before its microtask", async () => {
    const { port, run, broker } = fixture(); port.emit(request()); broker.revoke("sessions.read"); await tick();
    expect(run).not.toHaveBeenCalled();
  });
  it("bounds concurrency and times out unresponsive operations", async () => {
    vi.useFakeTimers();
    const { port, broker } = fixture({ maxPending: 1, timeoutMs: 10 }, { permission: "sessions.read", validate: () => true, run: () => new Promise(() => {}) });
    port.emit(request()); port.emit(request(2)); await tick(); await vi.advanceTimersByTimeAsync(10);
    expect(port.messages.map(m => m.error.code)).toEqual(["busy", "timeout"]); expect(broker.pendingCount).toBe(0);
  });
  it("disposal rejects pending, closes transport and prevents later dispatch", async () => {
    const { port, run, broker } = fixture(); port.emit(request()); broker.dispose(); await tick(); port.emit(request(2)); broker.dispose();
    expect(run).not.toHaveBeenCalled(); expect(port.closed).toBe(true); expect(port.listeners.size).toBe(0);
    expect(port.messages.map(m => m.kind)).toEqual(["response", "closed"]); expect(port.messages[0].error.code).toBe("disposed");
  });
  it("does not reveal host exception details", async () => {
    const { port } = fixture({}, { permission: "sessions.read", validate: () => true, run: () => { throw new Error("Bearer secret"); } });
    port.emit(request()); await tick(); expect(port.messages[0].error).toEqual({ code: "operation_failed" });
    expect(JSON.stringify(port.messages)).not.toContain("Bearer secret");
  });
  it("rejects oversized, deeply nested and non-JSON payloads", () => {
    expect(isJson("a".repeat(65537))).toBe(false); expect(isJson(Infinity)).toBe(false);
    expect(isJson(new Map())).toBe(false); expect(isJson(JSON.parse('{"__proto__":1}'))).toBe(false);
    const cycle: unknown[] = []; cycle.push(cycle); expect(isJson(cycle)).toBe(false);
    expect(isJson(new Array(10000))).toBe(false);
    expect(isJson(Array(100).fill("a".repeat(1000)))).toBe(false);
    expect(isJson(new Array(2))).toBe(false);
    const augmented: any[] = []; (augmented as any).extra = new Date(); expect(isJson(augmented)).toBe(false);
    const cyclicExtra: any[] = []; (cyclicExtra as any).extra = cyclicExtra; expect(isJson(cyclicExtra)).toBe(false);
    expect(isJson({ rows: [1, "ok", null, true] })).toBe(true);
  });
});
