// Background ending reads (audit 2026-11-25 P2-4): at most 2 per host at a time, a failed read waits its backoff (also
// when asked again), and a host whose probe had no terminal fields gets no more background reads until a detail shows them.
import { beforeEach, describe, expect, it } from "vitest";
import type { AskDetail } from "../src/shared/ipc";
import { MAX_PER_HOST, noteDetail, requestEnding, resetEndingLoader, useEndingHosts } from "../src/renderer/src/lib/endingLoader";

let now = 0;
beforeEach(() => { now = 1_000_000; resetEndingLoader(() => now); });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const withFacts = (askId: string) => ({ askId, terminalNotices: [] }) as unknown as AskDetail;
const without = (askId: string) => ({ askId }) as unknown as AskDetail;

function deferredLoad() {
  const calls: { askId: string; resolve: (d: AskDetail | null) => void }[] = [];
  const load = (_host: string, askId: string) => new Promise<AskDetail | null>((resolve) => calls.push({ askId, resolve }));
  return { calls, load };
}

describe("ending loader", () => {
  it("one probe per host first; then at most 2 reads at a time", async () => {
    const { calls, load } = deferredLoad();
    for (const id of ["a", "b", "c"]) requestEnding("h", id, load, () => false);
    expect(calls.map((c) => c.askId)).toEqual(["a"]);
    calls[0]!.resolve(withFacts("a"));
    await flush();
    expect(useEndingHosts.getState().hosts.h).toBe("yes");
    for (const id of ["b", "c", "d", "e"]) requestEnding("h", id, load, () => false);
    expect(calls.length).toBe(1 + MAX_PER_HOST);
    calls[1]!.resolve(withFacts("b"));
    await flush();
    expect(calls.map((c) => c.askId)).toEqual(["a", "b", "c", "d"]);
  });
  it("a host whose probe had no terminal fields gets no more background reads, until a detail shows them", async () => {
    const { calls, load } = deferredLoad();
    requestEnding("old", "a", load, () => false);
    calls[0]!.resolve(without("a"));
    await flush();
    expect(useEndingHosts.getState().hosts.old).toBe("no");
    requestEnding("old", "b", load, () => false);
    expect(calls.length).toBe(1);
    noteDetail("old", withFacts("x"));
    requestEnding("old", "b", load, () => false);
    expect(calls.length).toBe(2);
  });
  it("a failed read is not retried before its backoff, also when asked again (a remount)", async () => {
    const { calls, load } = deferredLoad();
    noteDetail("h", withFacts("x"));
    requestEnding("h", "a", load, () => false);
    calls[0]!.resolve(null);
    await flush();
    requestEnding("h", "a", load, () => false);
    expect(calls.length).toBe(1);
    now += 30_000;
    requestEnding("h", "a", load, () => false);
    expect(calls.length).toBe(2);
    calls[1]!.resolve(null);
    await flush();
    now += 30_000;
    requestEnding("h", "a", load, () => false);
    expect(calls.length).toBe(2);
    now += 30_000;
    requestEnding("h", "a", load, () => false);
    expect(calls.length).toBe(3);
  });
  it("nothing to read when the store already has it", () => {
    const { calls, load } = deferredLoad();
    requestEnding("h", "a", load, () => true);
    expect(calls.length).toBe(0);
  });
});
