import { expect, it, vi } from "vitest";
import { createComposerEnterTrace } from "../src/renderer/src/lib/composerEnterTrace";

const observation = { decision: "dispatched" as const, composing: false, ctrl: false, meta: false, shift: false, alt: false, hasContent: true, eventLagMs: 3.4 };

it("records dispatch decisions asynchronously with only allowlisted fields", async () => {
  const sink = vi.fn();
  const trace = createComposerEnterTrace("cutex.00000000-0000-7000-8000-000000000003", sink);
  trace({ ...observation, text: "PRIVATE TEXT", query: "PRIVATE QUERY", path: "/private/path", length: 123 } as typeof observation);
  expect(sink).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(sink).toHaveBeenCalledExactlyOnceWith({
    source: "composer-enter", sessionId: "cutex.00000000-0000-7000-8000-000000000003", sequence: 1,
    ...observation, eventLagMs: 3,
  });
  expect(JSON.stringify(sink.mock.calls)).not.toMatch(/PRIVATE|private\/path|length/);
});

it("preserves distinct repeated decisions and limits observations to 20 per minute", async () => {
  let now = 0;
  const sink = vi.fn();
  const trace = createComposerEnterTrace("session", sink, () => now);
  for (let i = 0; i < 30; i++) trace(observation);
  await Promise.resolve();
  expect(sink).toHaveBeenCalledTimes(20);
  expect(sink.mock.calls.map(([record]) => record.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  now = 59_999;
  trace(observation);
  now = 60_000;
  trace(observation);
  await Promise.resolve();
  expect(sink).toHaveBeenCalledTimes(21);
});

it("caps the mounted composer's lifetime observations without a timer", async () => {
  let now = 0;
  const sink = vi.fn();
  const trace = createComposerEnterTrace("session", sink, () => now);
  for (let i = 0; i < 250; i++) { now += 60_000; trace(observation); }
  await Promise.resolve();
  expect(sink).toHaveBeenCalledTimes(200);
});

it("drops unsafe IDs and unknown decisions and bounds invalid lag values", async () => {
  const sink = vi.fn();
  const trace = createComposerEnterTrace("https://secret.invalid/private", sink);
  trace({ ...observation, eventLagMs: Number.NaN });
  trace({ ...observation, eventLagMs: -2, decision: "ime-confirm", composing: true });
  trace({ ...observation, eventLagMs: 100_000 });
  trace({ ...observation, decision: "private-content" } as unknown as typeof observation);
  await Promise.resolve();
  expect(sink).toHaveBeenCalledTimes(3);
  expect(sink.mock.calls.map(([record]) => record.eventLagMs)).toEqual([0, 0, 60_000]);
  expect(JSON.stringify(sink.mock.calls)).not.toMatch(/secret|private/);
});

it("contains synchronous and asynchronous sink failures", async () => {
  createComposerEnterTrace("session", () => { throw new Error("sync failure"); })(observation);
  createComposerEnterTrace("session", () => Promise.reject(new Error("async failure")))(observation);
  await Promise.resolve();
  await Promise.resolve();
});
