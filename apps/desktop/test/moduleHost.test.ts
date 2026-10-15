// Module host lifecycle (docs/desktop-modules.md §4–§6): gating, failure rollback, abort +
// generation, restart on host / capability change, prefs. Uses a fake slot map, no React.
import { describe, expect, it, vi } from "vitest";
import { createModuleHost } from "../src/renderer/src/modules/host";
import type { HostInput, KeyValueStorage, ModuleContext, ModuleDefinition, SlotItemBase } from "../src/renderer/src/modules/types";

interface Slots {
  list: SlotItemBase & { label: string };
  notes: SlotItemBase & { text: string };
}
type Def = ModuleDefinition<Slots>;
type Ctx = ModuleContext<Slots>;

const SLOTS = { list: { unavailable: "hide" as const }, notes: { unavailable: "notice" as const } };

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const LOCAL = (features: string[] | null = []): HostInput => ({ id: "local", kind: "local", features: features && new Set(features) });

function make(modules: Def[], host: HostInput = LOCAL(), storage = memoryStorage(), timeoutMs?: number) {
  return createModuleHost<Slots>({ modules, slots: SLOTS, host, storage, services: () => undefined, activateTimeoutMs: timeoutMs, log: () => {} });
}

const item = (id: `${string}.${string}`, extra: Partial<Slots["list"]> = {}): Slots["list"] => ({ id, label: id, ...extra });
const ids = (entries: readonly { item: SlotItemBase }[]) => entries.map((e) => e.item.id);

describe("module host: gating", () => {
  it("activates modules without requirements at once and waits for capabilities", async () => {
    const host = make([{ id: "a", titleKey: "a", contributes: { list: [item("a.x")] } }, { id: "b", titleKey: "b", requires: { capabilities: ["cap-b"] }, contributes: { list: [item("b.x")] } }], LOCAL(null));
    await host.idle();
    expect(host.statuses().get("a")!.state.kind).toBe("active");
    expect(host.statuses().get("b")!.state).toEqual({ kind: "unavailable", missing: { capabilities: ["cap-b"], modules: [], hostKind: false, waiting: true } });
    expect(ids(host.snapshot("list"))).toEqual(["a.x"]);
    await host.setHost(LOCAL(["cap-b"]));
    expect(host.statuses().get("b")!.state.kind).toBe("active");
    expect(ids(host.snapshot("list"))).toEqual(["a.x", "b.x"]);
  });

  it("host kinds and dependencies", async () => {
    const host = make([
      { id: "local-only", titleKey: "l", requires: { hostKinds: ["local"] } },
      { id: "dep", titleKey: "d", requires: { modules: ["local-only"] } },
    ]);
    await host.idle();
    expect(host.statuses().get("dep")!.state.kind).toBe("active");
    await host.setHost({ id: "workstation", kind: "ssh", features: new Set() });
    expect(host.statuses().get("local-only")!.state).toMatchObject({ kind: "unavailable", missing: { hostKind: true } });
    expect(host.statuses().get("dep")!.state).toMatchObject({ kind: "unavailable", missing: { modules: ["local-only"] } });
  });

  it("item-level requires: hide / disable / notice, and unavailable modules keep their non-hidden static items", async () => {
    const host = make(
      [
        { id: "m", titleKey: "m", contributes: { list: [item("m.ok"), item("m.hidden", { requires: { capabilities: ["x"] } }), item("m.grey", { requires: { capabilities: ["x"] }, unavailable: "disable" })], notes: [{ id: "m.n", text: "", requires: { capabilities: ["y"] } }] } },
        { id: "off", titleKey: "o", requires: { capabilities: ["z"] }, contributes: { list: [item("off.grey", { unavailable: "disable" }), item("off.gone")] } },
      ],
      LOCAL([]),
    );
    await host.idle();
    expect(host.snapshot("list").map((e) => [e.item.id, e.mode, e.missing.join()])).toEqual([
      ["m.ok", "show", ""],
      ["m.grey", "disable", "x"],
      ["off.grey", "disable", "z"],
    ]);
    expect(host.snapshot("notes").map((e) => [e.item.id, e.mode, e.waiting])).toEqual([["m.n", "notice", false]]);
  });

  it("orders by order, then registry, then contribution order; snapshots keep their reference", async () => {
    const host = make([
      { id: "a", titleKey: "a", contributes: { list: [item("a.2", { order: 200 }), item("a.1", { order: 100 })] } },
      { id: "b", titleKey: "b", contributes: { list: [item("b.1", { order: 100 })] } },
    ]);
    await host.idle();
    const first = host.snapshot("list");
    expect(ids(first)).toEqual(["a.1", "b.1", "a.2"]);
    await host.setHost(LOCAL(["unrelated"]));
    expect(host.snapshot("list")).toBe(first);
  });
});

describe("module host: failures", () => {
  it("activate() throwing rolls back its contributions; dependents become unavailable; others run", async () => {
    let contributed = false;
    const host = make([
      {
        id: "bad",
        titleKey: "bad",
        contributes: { list: [item("bad.static")] },
        activate(ctx: Ctx) {
          ctx.contribute("list", item("bad.dynamic"));
          contributed = true;
          throw new Error("boom");
        },
      },
      { id: "needs-bad", titleKey: "n", requires: { modules: ["bad"] }, contributes: { list: [item("needs-bad.x")] } },
      { id: "fine", titleKey: "f", contributes: { list: [item("fine.x")] } },
    ]);
    await host.idle();
    expect(contributed).toBe(true);
    expect(host.statuses().get("bad")!.state).toMatchObject({ kind: "failed", error: "boom" });
    expect(host.statuses().get("needs-bad")!.state).toMatchObject({ kind: "unavailable", missing: { modules: ["bad"] } });
    expect(ids(host.snapshot("list"))).toEqual(["fine.x"]);
  });

  it("rejects items outside the module's prefix and unknown slots", async () => {
    const host = make([
      { id: "a", titleKey: "a", contributes: { list: [item("b.x")] } },
      { id: "c", titleKey: "c", contributes: { ["nope" as "list"]: [item("c.x")] } },
      { id: "d", titleKey: "d", contributes: { list: [item("d.x"), item("d.x")] } },
    ]);
    await host.idle();
    expect(host.statuses().get("a")!.state).toMatchObject({ kind: "failed" });
    expect(host.statuses().get("c")!.state).toMatchObject({ kind: "failed" });
    expect(host.statuses().get("d")!.state).toMatchObject({ kind: "failed", error: expect.stringContaining("duplicate") });
    expect(host.snapshot("list")).toEqual([]);
  });

  it("times out a hanging activate()", async () => {
    const host = make([{ id: "slow", titleKey: "s", activate: () => new Promise<void>(() => {}) }], LOCAL(), memoryStorage(), 20);
    await host.idle();
    expect(host.statuses().get("slow")!.state).toMatchObject({ kind: "failed", error: expect.stringContaining("did not finish") });
  });

  it("retry re-activates a failed module and then its dependents", async () => {
    let fail = true;
    const host = make([
      { id: "flaky", titleKey: "f", activate: () => (fail ? Promise.reject(new Error("first")) : undefined) },
      { id: "after", titleKey: "a", requires: { modules: ["flaky"] } },
    ]);
    await host.idle();
    expect(host.statuses().get("flaky")!.state.kind).toBe("failed");
    fail = false;
    await host.retry("flaky");
    expect(host.statuses().get("flaky")!.state.kind).toBe("active");
    expect(host.statuses().get("after")!.state.kind).toBe("active");
  });

  it("render errors are recorded without stopping the module", async () => {
    const host = make([{ id: "a", titleKey: "a" }]);
    await host.idle();
    host.reportError("a", new Error("render"));
    expect(host.statuses().get("a")).toMatchObject({ state: { kind: "active" }, lastError: { message: "render" } });
  });

  it("unknown dependencies, cycles, invalid and duplicate ids fail; unrelated modules still activate", async () => {
    const host = make([
      { id: "a", titleKey: "a", requires: { modules: ["b"] } },
      { id: "b", titleKey: "b", requires: { modules: ["a"] } },
      { id: "c", titleKey: "c", requires: { modules: ["ghost"] } },
      { id: "Bad_Id", titleKey: "bad" },
      { id: "d", titleKey: "d" },
      { id: "d", titleKey: "d2" },
      { id: "e", titleKey: "e" },
    ]);
    await host.idle();
    const kinds = Object.fromEntries([...host.statuses()].map(([id, status]) => [id, status.state.kind]));
    // One status per id: the duplicate's failure is what "d" reports.
    expect(kinds).toEqual({ a: "failed", b: "failed", c: "failed", Bad_Id: "failed", d: "failed", e: "active" });
  });
});

describe("module host: lifecycle", () => {
  it("restarts every module on host change with a new generation and aborted old signal", async () => {
    const seen: { generation: number; signal: AbortSignal; host: string }[] = [];
    const disposed = vi.fn();
    const host = make([
      {
        id: "a",
        titleKey: "a",
        activate(ctx: Ctx) {
          seen.push({ generation: ctx.generation, signal: ctx.signal, host: ctx.host.id });
          ctx.signal.addEventListener("abort", disposed);
        },
      },
    ]);
    await host.idle();
    await host.setHost({ id: "workstation", kind: "ssh", features: new Set() });
    expect(seen.map((s) => [s.generation, s.host])).toEqual([
      [1, "local"],
      [2, "workstation"],
    ]);
    expect(seen[0]!.signal.aborted).toBe(true);
    expect(seen[1]!.signal.aborted).toBe(false);
    expect(disposed).toHaveBeenCalledTimes(1);
    // Same host + same features: no restart.
    await host.setHost({ id: "workstation", kind: "ssh", features: new Set() });
    expect(seen).toHaveLength(2);
    // Capability change: restart again.
    await host.setHost({ id: "workstation", kind: "ssh", features: new Set(["new"]) });
    expect(seen).toHaveLength(3);
  });

  it("a stopped module's late contribute() throws (generation fence)", async () => {
    let saved: Ctx | null = null;
    const host = make([{ id: "a", titleKey: "a", activate: (ctx: Ctx) => void (saved ??= ctx) }]);
    await host.idle();
    await host.setHost(LOCAL(["x"]));
    expect(() => saved!.contribute("list", item("a.late"))).toThrow(/stopped/);
    expect(host.snapshot("list")).toEqual([]);
  });

  it("dynamic contributions are disposed on stop; a host change aborts a hanging activation", async () => {
    let release: () => void = () => {};
    let calls = 0;
    const host = make([
      {
        id: "hang",
        titleKey: "h",
        activate(ctx: Ctx) {
          calls++;
          ctx.contribute("list", item(`hang.g${ctx.generation}`));
          if (calls === 1) return new Promise<void>((r) => (release = r));
        },
      },
    ]);
    await vi.waitFor(() => expect(calls).toBe(1));
    // First activation still pending; the host switch supersedes it.
    await host.setHost({ id: "workstation", kind: "ssh", features: new Set() });
    release();
    await host.idle();
    expect(calls).toBe(2);
    expect(host.statuses().get("hang")!.state.kind).toBe("active");
    expect(ids(host.snapshot("list"))).toEqual(["hang.g2"]);
  });

  it("turning a module off stops it and its dependents; prefs persist per device; core modules stay on", async () => {
    const storage = memoryStorage();
    const host = make(
      [
        { id: "core", titleKey: "c", required: true },
        { id: "base", titleKey: "b", contributes: { list: [item("base.x")] } },
        { id: "top", titleKey: "t", requires: { modules: ["base"] } },
        { id: "opt-in", titleKey: "o", defaultEnabled: false },
      ],
      LOCAL(),
      storage,
    );
    await host.idle();
    expect(host.statuses().get("opt-in")!.state.kind).toBe("disabled");
    await host.setEnabled("base", false);
    expect(host.statuses().get("base")!.state.kind).toBe("disabled");
    expect(host.statuses().get("top")!.state).toMatchObject({ kind: "unavailable", missing: { modules: ["base"] } });
    expect(host.snapshot("list")).toEqual([]);
    await host.setEnabled("core", false);
    expect(host.statuses().get("core")!.state.kind).toBe("active");
    expect(JSON.parse(storage.data.get("cutex-desktop.modules")!)).toEqual({ v: 1, enabled: { base: false }, place: {} });

    // A new host instance (next launch) reads the prefs.
    const again = make([{ id: "base", titleKey: "b" }], LOCAL(), storage);
    await again.idle();
    expect(again.statuses().get("base")!.state.kind).toBe("disabled");
    await again.setEnabled("base", true);
    expect(again.statuses().get("base")!.state.kind).toBe("active");
    expect(JSON.parse(storage.data.get("cutex-desktop.modules")!).enabled).toEqual({});
  });

  it("module prefs live in their own namespace; subscriptions end with the module", async () => {
    const storage = memoryStorage();
    const listener = vi.fn();
    let ctx: Ctx | null = null;
    const host = make(
      [
        {
          id: "p",
          titleKey: "p",
          activate(c: Ctx) {
            ctx = c;
            c.prefs.subscribe(listener);
          },
        },
      ],
      LOCAL(),
      storage,
    );
    await host.idle();
    ctx!.prefs.set("size", 3);
    expect(storage.data.get("cutex-desktop.module.p")).toBe('{"size":3}');
    expect(host.prefs("p").get("size", 1)).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
    await host.setHost(LOCAL(["x"]));
    host.prefs("p").set("size", 4);
    // The new generation subscribed again; the old subscription is gone.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("module prefs report failed writes like the engine's forModule: throw, keep the old value, notify nobody", async () => {
    const storage = memoryStorage();
    const host = make([{ id: "p", titleKey: "p" }], LOCAL(), storage);
    await host.idle();
    const prefs = host.prefs("p"), listener = vi.fn();
    prefs.subscribe(listener);
    prefs.set("size", 3);
    const object = prefs.get("box", { w: 1 });
    expect(prefs.get("box", { w: 1 })).toEqual(object);
    prefs.set("box", { w: 2 });
    expect(prefs.get("box", {})).toBe(prefs.get("box", {})); // reference-stable for useSyncExternalStore
    expect(() => prefs.set("size", Number.NaN)).toThrow(TypeError);
    expect(() => prefs.set("size", { at: new Date() } as never)).toThrow(TypeError);
    storage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    expect(() => prefs.set("size", 4)).toThrow("quota");
    expect(prefs.get("size", 0)).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("module host: placement (§5)", () => {
  type Placed = SlotItemBase & { home: string };
  interface PSlots {
    places: Placed;
    plain: SlotItemBase;
  }
  const P_SLOTS = {
    places: { unavailable: "hide" as const, placement: { values: ["bar", "capsule", "off"], default: (i: SlotItemBase) => (i as Placed).home } },
    plain: { unavailable: "hide" as const },
  };
  const a: Placed = { id: "m.a", home: "bar" };
  const b: Placed = { id: "m.b", home: "capsule" };
  const makeP = (storage = memoryStorage()) =>
    createModuleHost<PSlots>({ modules: [{ id: "m", titleKey: "m", contributes: { places: [a, b] } }], slots: P_SLOTS, host: LOCAL(), storage, services: () => undefined, log: () => {} });

  it("defaults per item; overrides persist per device under `${slot}:${itemId}`; the default value removes the override", async () => {
    const storage = memoryStorage();
    const host = makeP(storage);
    await host.idle();
    expect([host.placement("places", a), host.placement("places", b)]).toEqual(["bar", "capsule"]);
    const before = host.placements();
    const listener = vi.fn();
    host.subscribe(listener);
    host.setPlacement("places", a, "off");
    expect(host.placement("places", a)).toBe("off");
    expect(host.placements()).not.toBe(before);
    expect(JSON.parse(storage.data.get("cutex-desktop.modules")!)).toEqual({ v: 1, enabled: {}, place: { "places:m.a": "off" } });
    await Promise.resolve();
    expect(listener).toHaveBeenCalled();
    // A new host instance (next start) reads it back.
    expect(makeP(storage).placement("places", a)).toBe("off");
    host.setPlacement("places", a, "bar");
    expect(JSON.parse(storage.data.get("cutex-desktop.modules")!).place).toEqual({});
  });

  it("ignores values the slot does not have, stale stored values and slots without placement", async () => {
    const storage = memoryStorage({ "cutex-desktop.modules": JSON.stringify({ v: 1, enabled: { x: false }, place: { "places:m.b": "nowhere" } }) });
    const host = makeP(storage);
    await host.idle();
    expect(host.placement("places", b)).toBe("capsule");
    host.setPlacement("places", b, "sideways");
    expect(host.placement("places", b)).toBe("capsule");
    expect(host.placement("plain", { id: "m.c" })).toBe("");
    // Enabled prefs survive a placement write.
    host.setPlacement("places", b, "bar");
    expect(JSON.parse(storage.data.get("cutex-desktop.modules")!)).toEqual({ v: 1, enabled: { x: false }, place: { "places:m.b": "bar" } });
  });
});
