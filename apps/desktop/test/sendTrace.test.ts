import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceSendStage, type SendTraceContext, type SendTraceRecord } from "../src/shared/sendTrace";

const context: SendTraceContext = { stage: "daemon-submit", hostId: "local", sessionId: "cutex.77a529e3-71d3-49fa-8994-905aad187052", clientUserMessageId: "message-456" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("send latency diagnostics", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => vi.useRealTimers());

  it("leaves quick success silent and clears its pending timer", async () => {
    const sink = vi.fn();
    const result = { disposition: "queued" };
    await expect(traceSendStage(context, sink, async () => result)).resolves.toBe(result);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(sink).not.toHaveBeenCalled();
  });

  it("logs slow success with correlation but no operation result", async () => {
    const sink = vi.fn(), pending = deferred<object>();
    const result = { text: "private body", token: "secret token" };
    const run = traceSendStage(context, sink, () => pending.promise);
    // No extra async wrapper: host-switch checks must retain their existing dispatch timing.
    expect(run).toBe(pending.promise);
    await vi.advanceTimersByTimeAsync(1250);
    pending.resolve(result);
    await expect(run).resolves.toBe(result);
    expect(sink).toHaveBeenCalledExactlyOnceWith({
      source: "send-latency", method: "daemon-submit", message: "send-latency daemon-submit succeeded message-456",
      hostId: "local", sessionId: context.sessionId, clientUserMessageId: "message-456", outcome: "succeeded", elapsedMs: 1250,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(sink.mock.calls)).not.toContain("private body");
    expect(JSON.stringify(sink.mock.calls)).not.toContain("secret token");
  });

  it("reports pending once while preserving the unresolved operation, then its outcome", async () => {
    const sink = vi.fn(), pending = deferred<string>();
    const run = traceSendStage(context, sink, () => pending.promise);
    await vi.advanceTimersByTimeAsync(4999);
    expect(sink).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ outcome: "pending", elapsedMs: 5000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sink).toHaveBeenCalledTimes(1);
    pending.resolve("original result");
    await expect(run).resolves.toBe("original result");
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1]![0]).toMatchObject({ outcome: "succeeded", elapsedMs: 65000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves rejection identity and clears timers without logging the error", async () => {
    const sink = vi.fn(), pending = deferred<void>();
    const error = new Error("https://private-host/token=secret /private/attachment user message");
    const run = traceSendStage(context, sink, () => pending.promise);
    const rejected = expect(run).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(1200);
    pending.reject(error);
    await rejected;
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ outcome: "failed", elapsedMs: 1200 });
    expect(JSON.stringify(sink.mock.calls)).not.toContain(error.message);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up synchronous failure, and ignores synchronous/asynchronous logging failures", async () => {
    const error = new Error("private exception");
    await expect(traceSendStage(context, vi.fn(), () => { throw error; })).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
    for (const sink of [() => { throw error; }, () => Promise.reject(error)]) {
      const pending = deferred<number>();
      const run = traceSendStage(context, sink, () => pending.promise);
      await vi.advanceTimersByTimeAsync(5000);
      pending.resolve(42);
      await expect(run).resolves.toBe(42);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("allows only identifier fields, dropping malformed IDs and unrecognized context data", async () => {
    const sink = vi.fn();
    const input = { ...context, hostId: "https://private", sessionId: "user message\nsecret", clientUserMessageId: "x".repeat(129), text: "private payload", extra: [{ path: "/private/path" }] };
    const pending = deferred<void>();
    const run = traceSendStage(input, sink, () => pending.promise);
    await vi.advanceTimersByTimeAsync(1000);
    pending.resolve();
    await run;
    expect(sink).toHaveBeenCalledTimes(1);
    const record: SendTraceRecord = sink.mock.calls[0]![0];
    expect(record).toMatchObject({ hostId: undefined, sessionId: undefined, clientUserMessageId: undefined });
    const serialized = JSON.stringify(record);
    for (const privateValue of ["https://private", "user message", "private payload", "/private/path", "x".repeat(129)]) expect(serialized).not.toContain(privateValue);
  });

  it("measures chain wait separately and retains FIFO after a failed earlier submission", async () => {
    const sink = vi.fn(), first = deferred<void>(), second = deferred<void>();
    const order: string[] = [];
    const firstRun = traceSendStage({ ...context, stage: "ipc-submit" }, sink, () => { order.push("first"); return first.promise; });
    const tail = firstRun.then(() => {}, () => {});
    const next = traceSendStage({ ...context, stage: "chain-wait", clientUserMessageId: "second" }, sink, () => tail)
      .then(() => traceSendStage({ ...context, stage: "ipc-submit", clientUserMessageId: "second" }, sink, () => { order.push("second"); return second.promise; }));
    await vi.advanceTimersByTimeAsync(6000);
    expect(order).toEqual(["first"]);
    first.reject(new Error("private"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(order).toEqual(["first", "second"]);
    second.resolve();
    await next;
    expect(sink.mock.calls.map(([r]) => [r.method, r.clientUserMessageId, r.outcome, r.elapsedMs])).toContainEqual(["chain-wait", "second", "succeeded", 6000]);
    expect(sink.mock.calls.map(([r]) => [r.method, r.clientUserMessageId, r.outcome, r.elapsedMs])).toContainEqual(["ipc-submit", "second", "succeeded", 2000]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
