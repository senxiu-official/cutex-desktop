import { afterEach, describe, expect, it, vi } from "vitest";
import { readLiveDeltaFrame, type LiveDeltaFrame } from "@cutex-desktop/cutex-client";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { PreloadBridge } from "../src/shared/ipc";

type Driver = {
  stream(sessionId?: string, opts?: { gap?: "item" | "subscription"; stepMs?: number }): Promise<unknown>;
  reset(sessionId?: string): void;
};
async function install(search = "?live-deltas") {
  vi.resetModules(); vi.useFakeTimers();
  const win: { cutex?: PreloadBridge; __cutexMockLiveDeltas?: Driver } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search: `${search}&perf=quiet` });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  // The mock loads this by itself and does not wait for it. It brings in the store, which reads `window` while loading, so on a
  // busy machine it finished after afterEach had removed the stubs: an unhandled rejection that fails the run, though every test passed.
  await import("../src/renderer/src/dev/devPerf");
  return { bridge: win.cutex!, driver: win.__cutexMockLiveDeltas };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("r260 mock live delta preview", { timeout: 60_000 }, () => {
  it.each(["", "?legacy", "?legacy&live-deltas", "?live-deltas"])("opt-in capability only: %s", async search => {
    const { bridge, driver } = await install(search);
    const expected = search === "?live-deltas";
    expect((await bridge.api.capabilities())?.featureList.includes("live-text-deltas")).toBe(expected);
    expect(!!driver).toBe(expected);
  }, 30_000);

  it("legacy plus opt-in URL still uses durable perf streaming", async () => {
    const { bridge } = await install("?legacy&live-deltas");
    const events: EventEnvelope[] = [];
    const live: unknown[] = [];
    bridge.on("sessionEvent", ({ envelope }) => events.push(envelope));
    bridge.on("sessionLiveDelta", p => live.push(p));
    const perf = (window as unknown as { __cutexMockPerf: { stream(id: string, rate: number, seconds: number): Promise<unknown> } }).__cutexMockPerf;
    const run = perf.stream("scratch", 2, 1);
    await vi.advanceTimersByTimeAsync(1000); await run;
    expect(live).toEqual([]);
    expect(events.filter(e => e.native?.message.method === "item/agentMessage/delta")).toHaveLength(2);
    expect(events.at(-1)!.native!.message.method).toBe("turn/completed");
  }, 30_000);

  it("valid UTF-8 frames use exact durable identity, metadata boundaries and independent indices", async () => {
    const { bridge, driver } = await install();
    let latest = 0;
    const frames: LiveDeltaFrame[] = [];
    const durable: EventEnvelope[] = [];
    bridge.on("sessionEvent", ({ envelope }) => { latest = envelope.sequence; durable.push(envelope); });
    bridge.on("sessionLiveDelta", ({ sessionId, frame }) => {
      expect(sessionId).toBe("eva");
      expect(frame.anchor).toEqual({ streamId: "mock", sequence: latest });
      expect(readLiveDeltaFrame(frame)).toEqual(frame);
      expect(frame).not.toHaveProperty("cursor"); expect(frame).not.toHaveProperty("sequence");
      frames.push(frame);
    });
    const run = driver!.stream("eva", { stepMs: 10 });
    await vi.advanceTimersByTimeAsync(300); await run;
    expect(durable).toHaveLength(6);
    expect(durable.every((e, i) => i === 0 || e.sequence === durable[i - 1]!.sequence + 1)).toBe(true);
    expect(frames).toHaveLength(15);
    const groups = new Map<string, LiveDeltaFrame[]>();
    for (const f of frames) {
      expect(f).toMatchObject({ cutexSessionId: "eva", threadId: "thread-eva", runtimeGeneration: 3, hostId: "HOST-A" });
      expect(f.params).toMatchObject({ threadId: f.threadId, turnId: f.turnId, itemId: f.itemId });
      const key = `${f.itemId}/${f.method}/${f.params?.contentIndex ?? f.params?.summaryIndex ?? 0}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    expect(groups.size).toBe(4);
    for (const group of groups.values()) {
      let offset = 0;
      for (const f of group) {
        expect(f.startOffset).toBe(offset);
        offset += new TextEncoder().encode(String(f.params?.delta)).byteLength;
        expect(f.endOffset).toBe(offset);
      }
      expect(group.slice(0, 3).map(f => f.revision)).toEqual([1, 3, 4]);
      expect(group[2]!.params?.previewPhase).toBe("second");
    }
    expect(frames.some(f => f.endOffset - f.startOffset > String(f.params?.delta).length)).toBe(true);
    const completed = durable.filter(e => e.native?.message.method === "item/completed");
    const reasoning = completed[0]!.native!.message.params as { item: { summary: string[]; content: string[] } };
    expect(reasoning.item.summary).toHaveLength(1); expect(reasoning.item.content).toHaveLength(2);
  }, 30_000);

  it.each(["gap", "subscription-gap"])("auto-plays %s once and completes with full repair", async mode => {
    const { bridge } = await install(`?live-deltas=${mode}`);
    const frames: LiveDeltaFrame[] = [];
    const events: EventEnvelope[] = [];
    bridge.on("sessionLiveDelta", ({ frame }) => frames.push(frame));
    bridge.on("sessionEvent", ({ envelope }) => events.push(envelope));
    await bridge.api.subscribe("eva", { streamId: "mock", after: "c10" }); await vi.advanceTimersByTimeAsync(8000);
    const gap = frames.find(f => f.kind === "gap")!;
    expect(gap?.gapScope).toBe(mode === "gap" ? "item" : "subscription");
    expect(gap.params).toBeNull();
    expect(readLiveDeltaFrame(gap)).toEqual(gap);
    const answer = frames.filter(f => f.itemId === gap.itemId);
    expect(answer.slice(3).every(f => f.kind === "delta" && f.startOffset >= gap.endOffset)).toBe(true);
    const completion = events.find(e => e.native?.message.method === "item/completed" && (e.native.message.params as { item: { id: string } }).item.id === gap.itemId)!;
    const text = (completion.native!.message.params as { item: { text: string } }).item.text;
    expect(text).toContain("你好，世界 🌏！\n\n缺帧后等待完整结果修复 🧪");
    expect(text).not.toBe(answer.filter(f => f.kind === "delta").map(f => f.params?.delta).join(""));
    const count = frames.length;
    await bridge.api.subscribe("eva", { streamId: "mock", after: "c10" }); await vi.advanceTimersByTimeAsync(8000);
    expect(frames).toHaveLength(count);
  }, 30_000);

  it("routes live frames and resets to remote subscription host and epoch", async () => {
    const { bridge, driver } = await install("?live-deltas&mh=all");
    await bridge.api.connectHost("ssh-7a3f01c2", true); await vi.advanceTimersByTimeAsync(3000);
    await bridge.apiFor!("ssh-7a3f01c2").subscribe("mika", { streamId: "mock", after: "c10" }); await vi.advanceTimersByTimeAsync(100);
    const frames: { hostId: string; epoch: string; frame: LiveDeltaFrame }[] = [];
    const resets: unknown[] = [];
    bridge.on("sessionLiveDelta", p => frames.push(p)); bridge.on("sessionLiveReset", p => resets.push(p));
    driver!.reset("mika");
    const run = driver!.stream("mika", { stepMs: 1 });
    await vi.advanceTimersByTimeAsync(100); await run;
    expect(frames).toHaveLength(15);
    for (const f of frames) {
      expect(f.hostId).toBe("ssh-7a3f01c2"); expect(f.epoch).toBeTruthy();
      expect(f.frame).toMatchObject({ cutexSessionId: "mika", threadId: "thread-mika", hostId: "WORKSTATION" });
    }
    expect(resets).toEqual([{ hostId: "ssh-7a3f01c2", epoch: frames[0]!.epoch, sessionId: "mika" }]);
  }, 30_000);
});
