import { expect, it } from "vitest";
import { BackgroundWorkProjection, backgroundWorkChange } from "../src/shared/backgroundWork";

const row = (cutexSessionId: string, runtimeGeneration = 1) => ({ cutexSessionId, runtime: { runtimeGeneration, backgroundWork: null as { running: boolean } | null | undefined } });
const change = (running: boolean, runtimeGeneration = 1) => ({ cutexSessionId: "a", runtimeGeneration, backgroundWork: { running } });

it("accepts optional counters/complete, strips unknown keys, rejects malformed payloads", () => {
  expect(backgroundWorkChange({ ...change(true), backgroundWork: { running: true, shells: 0, complete: false, other: "ignored" } }))
    .toEqual({ ...change(true), backgroundWork: { running: true, shells: 0, complete: false } });
  for (const value of [null, {}, { ...change(true), runtimeGeneration: -1 }, { ...change(true), runtimeGeneration: 1.5 },
    { ...change(true), cutexSessionId: "" }, { ...change(true), backgroundWork: undefined },
    { ...change(true), backgroundWork: { running: "yes" } }, { ...change(true), backgroundWork: { running: true, shells: -1 } },
    { ...change(true), backgroundWork: { running: true, complete: 1 } }]) expect(backgroundWorkChange(value)).toBeNull();
});

it("explicit null clears running work and stays authoritative over old snapshots", () => {
  const p = new BackgroundWorkProjection();
  const snapshot = { active: [row("a"), row("b")], retired: [] };
  p.record(change(true));
  const started = p.project(snapshot);
  const cleared = backgroundWorkChange({ ...change(false), backgroundWork: null });
  expect(cleared).not.toBeNull();
  p.record(cleared!);
  const ended = p.project(started);
  expect(ended.active[0]!.runtime.backgroundWork).toBeNull();
  expect(ended.active[1]).toBe(snapshot.active[1]);
  expect(p.project(started).active[0]!.runtime.backgroundWork).toBeNull();
  expect(p.project(ended)).toBe(ended);
});

it("preserves null and unrelated identities, makes duplicates a no-op, and replaces optional counts", () => {
  const p = new BackgroundWorkProjection();
  const snapshot = { active: [row("a"), row("b")], retired: [row("c")], projects: null, hostRows: {} };
  expect(p.project(snapshot)).toBe(snapshot);
  p.record({ ...change(true), backgroundWork: { running: true, shells: 2 } });
  const started = p.project(snapshot);
  expect(started.active[1]).toBe(snapshot.active[1]);
  expect(started.retired).toBe(snapshot.retired);
  expect(started.hostRows).toBe(snapshot.hostRows);
  expect(p.project(started)).toBe(started);
  p.record(change(false));
  expect(p.project(started).active[0]!.runtime.backgroundWork).toEqual({ running: false });
});

it("a newer runtime fences late events and late snapshots without promoting runtime generations", () => {
  const p = new BackgroundWorkProjection();
  p.project({ active: [row("a", 2)], retired: [] });
  p.record(change(true, 1));
  expect(p.project({ active: [row("a", 2)], retired: [] }).active[0]!.runtime.backgroundWork).toBeNull();
  const stale = row("a", 1); stale.runtime.backgroundWork = { running: true };
  expect(p.project({ active: [stale], retired: [] }).active[0]!.runtime.backgroundWork).toBeUndefined();
  p.record(change(true, 3));
  const waiting = p.project({ active: [row("a", 2)], retired: [] }).active[0]!;
  expect(waiting.runtime.runtimeGeneration).toBe(2);
  expect(waiting.runtime.backgroundWork).toBeUndefined();
  expect(p.project({ active: [row("a", 3)], retired: [] }).active[0]!.runtime.backgroundWork?.running).toBe(true);
});
