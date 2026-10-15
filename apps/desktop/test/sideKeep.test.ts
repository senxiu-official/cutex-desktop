// Keep-mounted holds (contract v1.9, docs/desktop-modules.md §18.13; lib/sideKeep.ts): the hold rules,
// what drops a hold, and the instance layer's mount plan (held instances are outside the LRU).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideInstance } from "../src/renderer/src/lib/sideLayout";

const app = vi.hoisted(() => ({ hosts: { active: "local", hosts: [{ id: "local", conn: { epoch: "e1" } }, { id: "ssh-a", conn: { epoch: "a1" } }] } }));
const prefs = vi.hoisted(() => ({ sideKeepHidden: 4, sideKeepMounted: 2 as unknown }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => app } }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ getUiPrefs: () => prefs }));

const keep = await import("../src/renderer/src/lib/sideKeep");
const { applyHold, clampSetting, holdKey, mountPlan, pruneHolds, setHeldState, setSideHold, clearHeldDirty, useSideKeep, resetSideHolds, keepMountedLimit, KEEP_MOUNTED_RANGE } = keep;

const inst = (kind = "probe.tab", hostId = "local", state: SideInstance["state"] = null): SideInstance =>
  ({ kind, binding: { kind: "host", hostId }, state, v: 1, pinned: false, lastActiveAt: 1 }) as unknown as SideInstance;

describe("applyHold", () => {
  const req = (id: string, keepAlive: "hidden" | "unmount" | undefined = "hidden") => ({ scope: "host:local", id, inst: inst(), keepAlive, epoch: "e1" });
  it("holds a hidden-alive instance, is idempotent, and releases", () => {
    const a = applyHold({}, req("i1"), true, 4);
    expect(a.held).toBe(true);
    expect(Object.keys(a.holds)).toEqual([holdKey("host:local", "i1")]);
    const again = applyHold(a.holds, req("i1"), true, 4);
    expect(again.held).toBe(true);
    expect(again.holds).toBe(a.holds);
    const off = applyHold(a.holds, req("i1"), false, 4);
    expect(off).toEqual({ holds: {}, held: false });
    // Releasing what is not held changes nothing.
    expect(applyHold(a.holds, req("i9"), false, 4).holds).toBe(a.holds);
  });
  it("refuses components that are not keepAlive hidden", () => {
    expect(applyHold({}, req("i1", "unmount"), true, 4).held).toBe(false);
    expect(applyHold({}, { ...req("i1"), keepAlive: undefined }, true, 4).held).toBe(false);
  });
  it("refuses beyond the window's limit; a release frees a place", () => {
    let holds = applyHold({}, req("i1"), true, 2).holds;
    holds = applyHold(holds, req("i2"), true, 2).holds;
    const full = applyHold(holds, req("i3"), true, 2);
    expect(full.held).toBe(false);
    expect(full.holds).toBe(holds);
    holds = applyHold(holds, req("i1"), false, 2).holds;
    expect(applyHold(holds, req("i3"), true, 2).held).toBe(true);
  });
  it("keys holds by scope: the same instance id in two scopes are two holds", () => {
    const a = applyHold({}, req("i1"), true, 4).holds;
    const b = applyHold(a, { ...req("i1"), scope: "host:ssh-a" }, true, 4);
    expect(b.held).toBe(true);
    expect(Object.keys(b.holds).length).toBe(2);
  });
});

describe("pruneHolds", () => {
  const base = (over: Partial<Parameters<typeof pruneHolds>[1]> = {}) => ({
    scope: "host:local",
    instances: { i1: inst() } as Record<string, SideInstance>,
    keeps: () => true,
    hostKnown: () => true,
    epochOf: () => "e1",
    ...over,
  });
  const held = (scope = "host:local", id = "i1", i = inst(), epoch: string | null = "e1") => applyHold({}, { scope, id, inst: i, keepAlive: "hidden", epoch }, true, 4).holds;

  it("keeps a live hold and returns the same object", () => {
    const h = held();
    const i1 = h[holdKey("host:local", "i1")]!.inst;
    expect(pruneHolds(h, base({ instances: { i1 } }))).toBe(h);
  });
  it("drops the hold when the tab is closed in its own scope", () => {
    expect(pruneHolds(held(), base({ instances: {} }))).toEqual({});
  });
  it("keeps the hold of another scope (its layout is not loaded): the snapshot stands in", () => {
    const h = held("host:ssh-a", "i1", inst("probe.tab", "ssh-a"), "a1");
    expect(pruneHolds(h, base({ instances: {}, epochOf: () => "a1" }))).toBe(h);
  });
  it("drops on module off / not hidden-alive, host removed, and a new epoch — not on a disconnect", () => {
    expect(pruneHolds(held(), base({ keeps: () => false }))).toEqual({});
    expect(pruneHolds(held(), base({ hostKnown: () => false }))).toEqual({});
    expect(pruneHolds(held(), base({ epochOf: () => "e2" }))).toEqual({});
    const h = held();
    expect(Object.keys(pruneHolds(h, base({ instances: { i1: h[holdKey("host:local", "i1")]!.inst }, epochOf: () => null })))).toEqual([holdKey("host:local", "i1")]);
  });
  it("adopts the first epoch of a hold taken while disconnected", () => {
    const h = held("host:local", "i1", inst(), null);
    const i1 = h[holdKey("host:local", "i1")]!.inst;
    const next = pruneHolds(h, base({ instances: { i1 }, epochOf: () => "e7" }));
    expect(next[holdKey("host:local", "i1")]!.epoch).toBe("e7");
    expect(pruneHolds(next, base({ instances: { i1 }, epochOf: () => "e8" }))).toEqual({});
  });
  it("refreshes the snapshot from the loaded layout (not while dirty)", () => {
    const h = held();
    const fresh = inst("probe.tab", "local", { url: "x" });
    expect(pruneHolds(h, base({ instances: { i1: fresh } }))[holdKey("host:local", "i1")]!.inst).toBe(fresh);
    const dirty = { [holdKey("host:local", "i1")]: { ...h[holdKey("host:local", "i1")]!, dirty: true } };
    expect(pruneHolds(dirty, base({ instances: { i1: fresh } }))).toBe(dirty);
  });
});

describe("mountPlan", () => {
  const hidden = new Set(["a", "b", "c", "d", "e", "f", "h"]);
  const run = (over: Partial<Parameters<typeof mountPlan>[0]>) =>
    mountPlan({ onScreen: [], kept: [], keepable: (id) => hidden.has(id), held: new Set(), modeKept: [], keepHidden: 2, ...over });

  it("keeps the most recent keepHidden off-screen instances (LRU)", () => {
    expect(run({ onScreen: ["x"], kept: ["a", "b", "c"] })).toEqual({ mounted: ["a", "b", "x"], kept: ["a", "b"] });
  });
  it("held instances are mounted outside the LRU and do not take its places", () => {
    const r = run({ kept: ["h", "a", "b", "c"], held: new Set(["h"]) });
    expect(r.mounted).toEqual(["a", "b", "h"]);
    expect(r.kept).toEqual(["a", "b"]);
  });
  it("a held instance stays mounted even when its binding is not visible (not keepable)", () => {
    expect(run({ keepable: () => false, held: new Set(["z"]) }).mounted).toEqual(["z"]);
  });
  it("mode-kept and on-screen ones are always mounted, sorted by id", () => {
    expect(run({ onScreen: ["q"], modeKept: ["m"], held: new Set(["h"]) }).mounted).toEqual(["h", "m", "q"]);
  });
  it("keepHidden follows the setting", () => {
    expect(run({ kept: ["a", "b", "c", "d"], keepHidden: 3 }).mounted).toEqual(["a", "b", "c"]);
  });
});

describe("store wiring", () => {
  beforeEach(() => {
    resetSideHolds();
    prefs.sideKeepMounted = 2;
  });
  it("setSideHold uses the sideKeepMounted limit and records the host epoch", () => {
    expect(setSideHold("host:local", "i1", inst(), "hidden", true)).toBe(true);
    expect(setSideHold("host:local", "i2", inst("probe.tab", "ssh-a"), "hidden", true)).toBe(true);
    expect(setSideHold("host:local", "i3", inst(), "hidden", true)).toBe(false);
    expect(useSideKeep.getState().holds[holdKey("host:local", "i2")]!.epoch).toBe("a1");
    expect(setSideHold(null, "i4", inst(), "hidden", true)).toBe(false);
    expect(setSideHold("host:local", "i1", inst(), "hidden", false)).toBe(false);
    expect(setSideHold("host:local", "i3", inst(), "hidden", true)).toBe(true);
  });
  it("limit settings are clamped", () => {
    prefs.sideKeepMounted = 99;
    expect(keepMountedLimit()).toBe(KEEP_MOUNTED_RANGE[1]);
    prefs.sideKeepMounted = "x";
    expect(keepMountedLimit()).toBe(4);
    expect(clampSetting(0, [1, 12], 4)).toBe(1);
  });
  it("setState while out of scope marks the snapshot dirty until written back", () => {
    setSideHold("host:ssh-a", "i1", inst("probe.tab", "ssh-a"), "hidden", true);
    setHeldState("host:ssh-a", "i1", { url: "y" }, 1);
    const h = useSideKeep.getState().holds[holdKey("host:ssh-a", "i1")]!;
    expect(h.dirty).toBe(true);
    expect(h.inst.state).toEqual({ url: "y" });
    clearHeldDirty("host:ssh-a", ["i1"]);
    expect(useSideKeep.getState().holds[holdKey("host:ssh-a", "i1")]!.dirty).toBe(false);
  });
});
