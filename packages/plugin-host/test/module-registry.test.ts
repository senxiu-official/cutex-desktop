import { afterEach, describe, expect, it, vi } from "vitest";
import { createModuleHost, createModuleServiceScope } from "../src/index";
import type { ModuleContext, ModuleDefinition, ModuleScope, SlotItemBase } from "@cutex-desktop/plugin-sdk";

type Slots = { entries: SlotItemBase };
type Def = ModuleDefinition<Slots>;
type Ctx = ModuleContext<Slots>;
const target = { id: "a", kind: "local" as const, features: new Set<string>() };
const slots = { entries: { unavailable: "hide" as const, placement: { values: ["first", "last"], default: () => "first" } } };
const hosts: ReturnType<typeof createModuleHost<Slots>>[] = [];
function fixture(modules: readonly Def[]) {
  const host = createModuleHost<Slots>({ modules, slots, host: target }); hosts.push(host); return host;
}
const def = (id: string, extra: Partial<Def> = {}): Def => ({ id, titleKey: id, contributes: { entries: [{ id: `${id}.entry` }] }, ...extra });
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); });

describe("v1.1 dynamic registration", () => {
  it("appends batches in registry order, activates dependency-first, and preserves existing owners", async () => {
    let original!: Ctx;
    const host = fixture([def("existing", { activate(ctx) { original = ctx; } })]); await host.ready;
    const entry = host.snapshot("entries")[0]!, status = host.statuses().existing;
    const registry = host.modules, notify = vi.fn(), calls: string[] = []; host.subscribe(notify);
    await host.addModules([
      def("child", { requires: { modules: ["parent"] }, activate() { calls.push("child"); } }),
      def("parent", { activate() { calls.push("parent"); } }),
    ]);
    expect(calls).toEqual(["parent", "child"]);
    expect(host.modules.map(module => module.id)).toEqual(["existing", "child", "parent"]);
    expect(host.snapshot("entries").map(row => row.item.id)).toEqual(["existing.entry", "child.entry", "parent.entry"]);
    expect(host.snapshot("entries")[0]).toBe(entry); expect(host.statuses().existing).toBe(status);
    expect(original.signal.aborted).toBe(false); expect(original.generation).toBe(1);
    expect(host.modules).not.toBe(registry); expect(host.modules).toBe(host.modules); expect(notify).toHaveBeenCalled();
    const unchanged = host.modules; await host.addModules([]); await host.removeModule("absent"); expect(host.modules).toBe(unchanged);
  });

  it.each(["duplicate", "id", "cycle", "contribution"])("rejects an entire bad %s batch before any registration or activation", async kind => {
    const host = fixture([def("existing")]); await host.ready;
    const activate = vi.fn(), registry = host.modules, statuses = host.statuses(), entries = host.snapshot("entries"), notify = vi.fn();
    host.subscribe(notify);
    const invalid: Def[] = kind === "duplicate" ? [def("existing")]
      : kind === "id" ? [def("Invalid")]
      : kind === "cycle" ? [def("one", { requires: { modules: ["two"] } }), def("two", { requires: { modules: ["one"] } })]
      : [def("wrong", { contributes: { entries: [{ id: "existing.stolen" }] } })];
    await expect(host.addModules([def("valid", { activate }), ...invalid])).rejects.toThrow();
    await host.whenSettled(); expect(activate).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    expect(host.modules).toBe(registry); expect(host.statuses()).toBe(statuses); expect(host.snapshot("entries")).toBe(entries);
  });

  it("keeps unknown dependencies failed, but a removed former dependency makes consumers unavailable", async () => {
    const host = fixture([]); await host.ready;
    await host.addModules([def("child", { requires: { modules: ["parent"] } })]);
    expect(host.statuses().child?.state).toMatchObject({ kind: "failed", error: expect.stringContaining("Unknown module dependency") });
    await host.addModules([def("parent")]); expect(host.statuses().child?.state.kind).toBe("active");
    await host.removeModule("parent");
    expect(host.statuses()).not.toHaveProperty("parent");
    expect(host.statuses().child?.state).toMatchObject({ kind: "unavailable", missing: { modules: ["parent"] } });
    await host.addModules([def("parent")]); expect(host.statuses().child?.state.kind).toBe("active");
  });

  it("revokes all transitive scopes immediately and finishes dependent cleanup before its parent", async () => {
    const contexts = new Map<string, Ctx>(), scopes = new Map<string, ModuleScope>(), events: string[] = [], writes = vi.fn();
    let release!: () => void;
    const host = createModuleHost<Slots>({ host: target, slots, modules: ["parent", "child", "grandchild", "independent"].map((id, index) => def(id, {
      ...(index === 1 ? { requires: { modules: ["parent"] } } : index === 2 ? { requires: { modules: ["child"] } } : {}),
      activate(ctx) { contexts.set(id, ctx); },
    })), createServices(scope) {
      scopes.set(scope.id, scope);
      scope.onDispose(async () => { events.push(scope.id); if (scope.id === "grandchild") await new Promise<void>(done => { release = done; }); });
      return { write: createModuleServiceScope(scope).write(writes) };
    } }); hosts.push(host); await host.ready;
    const original = contexts.get("independent")!;
    const pending = host.removeModule("parent");
    for (const id of ["parent", "child", "grandchild"]) {
      expect(contexts.get(id)!.signal.aborted).toBe(true);
      createModuleServiceScope(scopes.get(id)!).write(writes)("late");
    }
    expect(writes).not.toHaveBeenCalled(); expect(original.signal.aborted).toBe(false);
    await tick(); expect(events).toEqual(["grandchild"]); release(); await pending;
    expect(events).toEqual(["grandchild", "child", "parent"]); expect(contexts.get("independent")).toBe(original);
    expect(host.statuses()).not.toHaveProperty("parent");
    expect(host.statuses().child?.state.kind).toBe("unavailable"); expect(host.statuses().grandchild?.state.kind).toBe("unavailable");
  });

  it.each(["remove", "switch", "disable", "retry"])("revokes all affected services before %s abort callbacks can call another owner", async action => {
    const writes = vi.fn(), callbacks = new Map<string, () => void>();
    const host = createModuleHost<Slots>({ host: target, slots,
      modules: [def("parent"), def("child", { requires: { modules: ["parent"] }, activate(ctx) {
        ctx.signal.addEventListener("abort", () => callbacks.get("parent")!(), { once: true });
      } })],
      createServices(scope) { callbacks.set(scope.id, createModuleServiceScope(scope).write(writes)); return {}; },
    }); hosts.push(host); await host.ready;
    if (action === "remove") await host.removeModule("parent");
    else if (action === "switch") await host.setHost({ ...target, id: "b" });
    else if (action === "disable") await host.setEnabled("parent", false);
    else await host.retry("parent");
    expect(writes).not.toHaveBeenCalled();
  });

  it("retains toggle, placement and module preferences while re-add advances generation", async () => {
    const captured: Ctx[] = [], definition = def("optional", { activate(ctx) { captured.push(ctx); } });
    const host = fixture([definition]); await host.ready;
    const old = captured[0]!; old.prefs.set("filter", "mine"); host.setPlacement("entries", "optional.entry", "last");
    await host.setEnabled("optional", false); await host.removeModule("optional"); await host.addModules([definition]);
    expect(captured).toHaveLength(1); expect(host.statuses().optional?.state.kind).toBe("disabled");
    expect(host.getPrefs()).toMatchObject({ enabled: { optional: false }, place: { "entries:optional.entry": "last" } });
    await host.setEnabled("optional", true); const current = captured[1]!;
    expect(current.generation).toBe(2); expect(current.prefs.get("filter", "")).toBe("mine");
    expect(() => old.contribute("entries", { id: "optional.late" })).toThrowError(expect.objectContaining({ name: "AbortError" }));
    old.prefs.set("filter", "stale"); expect(current.prefs.get("filter", "")).toBe("mine");
  });

  it("refuses required removal and lets a newer subscription removal win over registration", async () => {
    const host = fixture([def("core", { required: true })]); await host.ready;
    await expect(host.removeModule("core")).rejects.toThrow(/Required/); expect(host.statuses().core?.state.kind).toBe("active");
    const activation = vi.fn(); let removed = false;
    host.subscribe(() => { if (!removed && host.modules.some(module => module.id === "transient")) { removed = true; void host.removeModule("transient"); } });
    await host.addModules([def("transient", { activate: activation })]); await host.whenSettled();
    expect(activation).not.toHaveBeenCalled(); expect(host.statuses()).not.toHaveProperty("transient");
    expect(host.modules.map(module => module.id)).toEqual(["core"]);
  });

  it("allows re-add from an abort callback without reviving the removed context", async () => {
    let old!: Ctx; const current: Ctx[] = [];
    const host = fixture([def("replace", { activate(ctx) {
      old = ctx; ctx.signal.addEventListener("abort", () => { void host.addModules([def("replace", { activate(next) { current.push(next); } })]); }, { once: true });
    } })]); await host.ready;
    await host.removeModule("replace"); await host.whenSettled();
    expect(current).toHaveLength(1); expect(current[0]!.generation).toBe(old.generation + 1);
    expect(host.statuses().replace?.state.kind).toBe("active");
    expect(() => old.contribute("entries", { id: "replace.late" })).toThrow();
  });

  it("cancels unresolved activation through remove/add, host switching and final disposal", async () => {
    const captured: Ctx[] = [];
    const definition = def("pending", { activate(ctx) { captured.push(ctx); return new Promise<void>(() => {}); } });
    const host = fixture([definition]); await tick(); const first = captured[0]!;
    const removal = host.removeModule("pending"), addition = host.addModules([definition]);
    const switching = host.setHost({ ...target, id: "b" });
    const disposal = host.dispose(); await Promise.all([removal, addition, switching, disposal]);
    expect(first.signal.aborted).toBe(true); expect(host.snapshot("entries")).toEqual([]);
    expect(host.statuses().pending?.state.kind).toBe("disabled");
    await expect(host.addModules([def("after")])).rejects.toThrow(/disposed/);
  });
});
