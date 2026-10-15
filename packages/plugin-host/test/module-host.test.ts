import { afterEach, describe, expect, it, vi } from "vitest";
import { createModuleHost, moduleSlotForAgent, type SlotItemBase } from "../src/index.js";

type Item = SlotItemBase & { label?: string; page?: string; schemas?: readonly string[]; agentFeature?: string };
type Slots = {
  "nav.primary": Item;
  "settings.page": Item;
  "settings.section": Item;
  "conversation.status": Item;
  "timeline.received": Item;
};
type Options = Parameters<typeof createModuleHost<Slots>>[0];
type Definition = Options["modules"][number];
type Context = Parameters<NonNullable<Definition["activate"]>>[0];
type Host = ReturnType<typeof createModuleHost<Slots>>;
const slots: Options["slots"] = {
  "nav.primary": { unavailable: "disable" },
  "settings.page": { unavailable: "hide" },
  "settings.section": { unavailable: "hide" },
  "conversation.status": { unavailable: "hide", placement: { values: ["bar", "capsule", "both", "off"], default: () => "capsule" } },
  "timeline.received": { unavailable: "hide" },
};
const local = (features: readonly string[] | null = []) => ({ id: "local-one", kind: "local" as const, features: features === null ? null : new Set(features) });
const hosts: Host[] = [];
const module = (id: string, extra: Partial<Definition> = {}): Definition => ({ id, titleKey: `${id}.title`, ...extra });
function fixture(modules: Definition[], extra: Partial<Options> = {}) {
  const host = createModuleHost<Slots>({ modules, slots, host: local(), ...extra });
  hosts.push(host);
  return host;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const ids = (host: Host, slot: keyof Slots) => host.snapshot(slot).map(entry => entry.item.id);
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); vi.useRealTimers(); });

describe("mainline module contract: host and capability gates", () => {
  it("starts ungated modules while capabilities load and reports waiting for gated modules", async () => {
    const basic = vi.fn(), gated = vi.fn();
    const host = fixture([module("basic", { activate: basic }), module("gated", { requires: { capabilities: ["jobs", "events"] }, activate: gated })], { host: local(null) });
    await host.ready;
    expect(host.statuses().basic?.state.kind).toBe("active");
    expect(basic).toHaveBeenCalledOnce(); expect(gated).not.toHaveBeenCalled();
    expect(host.statuses().gated?.state).toMatchObject({ kind: "unavailable", missing: { waiting: true, capabilities: ["jobs", "events"] } });
    await host.setHost(local(["jobs"]));
    expect(host.statuses().gated?.state).toMatchObject({ kind: "unavailable", missing: { waiting: false, capabilities: ["events"] } });
    await host.setHost(local(["jobs", "events"]));
    expect(host.statuses().gated?.state.kind).toBe("active"); expect(gated).toHaveBeenCalledOnce();
  });

  it("gates hostKinds and reactivates every module when host capabilities change", async () => {
    const contexts: Context[] = [];
    const localOnly = vi.fn();
    const host = fixture([module("basic", { activate: ctx => { contexts.push(ctx); } }), module("local-only", { requires: { hostKinds: ["local"] }, activate: localOnly })]);
    await host.ready;
    const first = contexts[0]!;
    const switching = host.setHost({ id: "remote", kind: "ssh", features: new Set() });
    expect(first.signal.aborted).toBe(true);
    await switching;
    expect(host.statuses()["local-only"]?.state).toMatchObject({ kind: "unavailable", missing: { hostKind: true } });
    expect(contexts[1]?.host.id).toBe("remote"); expect(contexts[1]?.generation).toBeGreaterThan(first.generation);
    const second = contexts[1]!;
    await host.setHost({ id: "remote", kind: "ssh", features: new Set(["new-feature"]) });
    expect(second.signal.aborted).toBe(true); expect(contexts).toHaveLength(3);
    expect(localOnly).toHaveBeenCalledOnce();
  });

  it("honors defaultEnabled and explicit preferences while required modules remain active", async () => {
    const host = fixture([module("core", { required: true, defaultEnabled: false }), module("default-on"), module("opt-in", { defaultEnabled: false }), module("remembered")],
      { prefs: { v: 1, enabled: { core: false, remembered: false }, place: {} } });
    await host.ready;
    expect(host.statuses().core?.state.kind).toBe("active");
    expect(host.statuses()["default-on"]?.state.kind).toBe("active");
    expect(host.statuses()["opt-in"]?.state.kind).toBe("disabled");
    expect(host.statuses().remembered?.state.kind).toBe("disabled");
    // Locked controls must not permit a caller to turn off a required module.
    try { await host.setEnabled("core", false); } catch { /* A locked control may refuse the operation. */ }
    expect(host.statuses().core?.state.kind).toBe("active");
    await host.setEnabled("opt-in", true);
    expect(host.statuses()["opt-in"]?.state.kind).toBe("active");
  });
});

describe("mainline module contract: dependency graph", () => {
  it("activates dependencies first with registry tie ordering and stops dependents before their base", async () => {
    const events: string[] = [];
    const activate = (name: string) => (ctx: Context) => { events.push(name); ctx.signal.addEventListener("abort", () => events.push(`-${name}`)); };
    const host = fixture([
      module("child", { requires: { modules: ["base"] }, activate: activate("child") }),
      module("peer", { activate: activate("peer") }),
      module("base", { activate: activate("base") }),
      module("leaf", { requires: { modules: ["child"] }, activate: activate("leaf") }),
    ]);
    await host.ready;
    expect(events.indexOf("base")).toBeLessThan(events.indexOf("child"));
    expect(events.indexOf("child")).toBeLessThan(events.indexOf("leaf"));
    expect(events.indexOf("peer")).toBeLessThan(events.indexOf("base"));
    events.length = 0;
    await host.setEnabled("base", false);
    expect(events.indexOf("-leaf")).toBeLessThan(events.indexOf("-child"));
    expect(events.indexOf("-child")).toBeLessThan(events.indexOf("-base"));
    expect(host.statuses().base?.state.kind).toBe("disabled");
    expect(host.statuses().child?.state).toMatchObject({ kind: "unavailable", missing: { modules: ["base"] } });
    expect(host.statuses().leaf?.state).toMatchObject({ kind: "unavailable", missing: { modules: ["child"] } });
    expect(host.statuses().peer?.state.kind).toBe("active");
  });

  it("fails unknown dependencies and cycles without stopping independent modules", async () => {
    const never = vi.fn();
    const host = fixture([
      module("unknown", { requires: { modules: ["absent"] }, activate: never }),
      module("a", { requires: { modules: ["b"] }, activate: never }),
      module("b", { requires: { modules: ["a"] }, activate: never }),
      module("dependent", { requires: { modules: ["a"] }, activate: never }),
      module("independent"),
    ]);
    await host.ready;
    expect(host.statuses().unknown?.state).toMatchObject({ kind: "failed", error: expect.stringMatching(/absent|unknown/i) });
    expect(host.statuses().a?.state).toMatchObject({ kind: "failed", error: expect.stringMatching(/cycl/i) });
    expect(host.statuses().b?.state.kind).toBe("failed");
    expect(host.statuses().dependent?.state.kind).toBe("unavailable");
    expect(host.statuses().independent?.state.kind).toBe("active"); expect(never).not.toHaveBeenCalled();
  });

  it("does not enable dependent static actions before their asynchronous dependency is active", async () => {
    const wait = deferred();
    const host = fixture([
      module("base", { activate: () => wait.promise }),
      module("child", { requires: { modules: ["base"] }, contributes: { "nav.primary": [{ id: "child.action" }] } }),
    ]);
    await tick();
    expect(host.statuses().base?.state.kind).toBe("activating");
    expect(host.snapshot("nav.primary")[0]).toMatchObject({ available: false, missing: { modules: ["base"] } });
    wait.resolve(); await host.ready;
    expect(host.snapshot("nav.primary")[0]?.available).toBe(true);
  });

  it("marks every member of overlapping cycles failed while noncyclic downstream modules are unavailable", async () => {
    const activate = vi.fn();
    const host = fixture([
      module("a", { requires: { modules: ["b", "c"] }, activate }),
      module("b", { requires: { modules: ["a"] }, activate }),
      module("c", { requires: { modules: ["b"] }, activate }),
      module("downstream", { requires: { modules: ["c"] }, activate }),
      module("healthy"),
    ]);
    await host.ready;
    for (const id of ["a", "b", "c"]) expect(host.statuses()[id]?.state).toMatchObject({ kind: "failed", error: expect.stringMatching(/cycl/i) });
    expect(host.statuses().downstream?.state).toMatchObject({ kind: "unavailable", missing: { modules: ["c"] } });
    expect(host.statuses().healthy?.state.kind).toBe("active"); expect(activate).not.toHaveBeenCalled();
  });

  it("aborts all affected scopes immediately but completes dependent cleanup before its dependency", async () => {
    const wait = deferred(); const events: string[] = []; const signals = new Map<string, AbortSignal>();
    const host = fixture([module("base"), module("child", { requires: { modules: ["base"] } })], {
      createServices(scope) {
        signals.set(scope.id, scope.signal);
        scope.onDispose(async () => {
          events.push(`${scope.id}:start`);
          if (scope.id === "child") await wait.promise;
          events.push(`${scope.id}:done`);
        });
        return {};
      },
    });
    await host.ready;
    const stopping = host.setEnabled("base", false);
    try {
      expect(signals.get("child")?.aborted).toBe(true); expect(signals.get("base")?.aborted).toBe(true);
      await tick(); expect(events).toEqual(["child:start"]);
    } finally { wait.resolve(); }
    await stopping;
    expect(events).toEqual(["child:start", "child:done", "base:start", "base:done"]);
  });
});

describe("mainline module contract: slot projection and ownership", () => {
  it("keeps unknown and supported agent features available without replacing the snapshot", async () => {
    const host = fixture([module("agent", { contributes: { "nav.primary": [{ id: "agent.row", agentFeature: "goals" }] } })]);
    await host.ready;
    const entries = host.snapshot("nav.primary");
    for (const features of [null, {}, { goals: undefined }, { goals: true }]) {
      expect(moduleSlotForAgent(entries, features)).toBe(entries);
      expect(moduleSlotForAgent(entries, features)[0]?.available).toBe(true);
    }
  });

  it("applies explicit agent false as hide/disable/notice without mutating host snapshots", async () => {
    const host = fixture([module("agent", { contributes: {
      "nav.primary": [{ id: "agent.row", agentFeature: "goals" }],
      "settings.section": [{ id: "agent.notice", agentFeature: "goals", unavailable: "notice" }],
      "timeline.received": [{ id: "agent.renderer", agentFeature: "goals" }],
    } })]);
    await host.ready;
    expect(moduleSlotForAgent(host.snapshot("timeline.received"), { goals: false })).toEqual([]);
    expect(moduleSlotForAgent(host.snapshot("nav.primary"), { goals: false })[0]).toMatchObject({ available: false, unavailable: "disable", missingAgentFeature: "goals" });
    expect(moduleSlotForAgent(host.snapshot("settings.section"), { goals: false })[0]).toMatchObject({ available: false, unavailable: "notice" });
    expect(host.snapshot("nav.primary")[0]?.available).toBe(true);
  });

  it("does not let supported agent features override missing host capabilities", async () => {
    const host = fixture([module("agent", { contributes: { "nav.primary": [{ id: "agent.row", agentFeature: "goals", requires: { capabilities: ["needed"] } }] } })]);
    await host.ready;
    expect(moduleSlotForAgent(host.snapshot("nav.primary"), { goals: true })[0]).toMatchObject({ available: false, missing: { capabilities: ["needed"] } });
  });

  it("keeps disabled/notice static affordances for unavailable modules but never dynamic or hidden rows", async () => {
    const activate = vi.fn();
    const host = fixture([module("jobs", { requires: { capabilities: ["job-service"] }, activate, contributes: {
      "nav.primary": [{ id: "jobs.nav" }, { id: "jobs.hidden-nav", unavailable: "hide" }],
      "settings.page": [{ id: "jobs.page" }],
      "settings.section": [{ id: "jobs.notice", unavailable: "notice" }],
    } })]);
    await host.ready;
    expect(activate).not.toHaveBeenCalled(); expect(ids(host, "nav.primary")).toEqual(["jobs.nav"]);
    expect(host.snapshot("nav.primary")[0]).toMatchObject({ moduleId: "jobs", available: false, unavailable: "disable", missing: { capabilities: ["job-service"] } });
    expect(ids(host, "settings.page")).toEqual([]);
    expect(host.snapshot("settings.section")[0]).toMatchObject({ available: false, unavailable: "notice" });
    await host.setEnabled("jobs", false);
    expect(ids(host, "nav.primary")).toEqual([]); expect(ids(host, "settings.section")).toEqual([]);
  });

  it("applies item-level capability gates without deactivating the owning module", async () => {
    const activate = vi.fn();
    const host = fixture([module("feature", { activate, contributes: {
      "nav.primary": [{ id: "feature.available" }, { id: "feature.optional", requires: { capabilities: ["optional"] } }],
      "settings.page": [{ id: "feature.hidden", requires: { capabilities: ["optional"] } }],
    } })]);
    await host.ready;
    expect(host.statuses().feature?.state.kind).toBe("active"); expect(activate).toHaveBeenCalledOnce();
    expect(host.snapshot("nav.primary").map(row => [row.item.id, row.available])).toEqual([["feature.available", true], ["feature.optional", false]]);
    expect(ids(host, "settings.page")).toEqual([]);
    await host.setHost(local(["optional"]));
    expect(host.snapshot("nav.primary").every(row => row.available)).toBe(true);
    expect(ids(host, "settings.page")).toEqual(["feature.hidden"]);
  });

  it("sorts order, then registry module order, then contribution order; dynamic dispose is idempotent", async () => {
    let remove!: () => void;
    const host = fixture([
      module("one", { contributes: { "nav.primary": [{ id: "one.static", order: 20 }] }, activate(ctx) {
        remove = ctx.contribute("nav.primary", { id: "one.dynamic", order: 20 });
        ctx.contribute("nav.primary", { id: "one.first", order: 10 });
      } }),
      module("two", { contributes: { "nav.primary": [{ id: "two.static", order: 20 }] } }),
    ]);
    await host.ready;
    expect(ids(host, "nav.primary")).toEqual(["one.first", "one.static", "one.dynamic", "two.static"]);
    remove(); remove();
    expect(ids(host, "nav.primary")).toEqual(["one.first", "one.static", "two.static"]);
    await host.setEnabled("one", false);
    expect(ids(host, "nav.primary")).toEqual(["two.static"]);
  });

  it("fails cross-owner and duplicate dynamic item ids and rolls back only that module", async () => {
    const host = fixture([
      module("good", { contributes: { "nav.primary": [{ id: "good.kept" }] } }),
      module("bad", { contributes: { "nav.primary": [{ id: "bad.partial" }] }, activate(ctx) { ctx.contribute("nav.primary", { id: "good.stolen" }); } }),
      module("duplicate", { activate(ctx) { ctx.contribute("nav.primary", { id: "duplicate.same" }); ctx.contribute("nav.primary", { id: "duplicate.same" }); } }),
    ]);
    await host.ready;
    expect(host.statuses().bad?.state.kind).toBe("failed"); expect(host.statuses().duplicate?.state.kind).toBe("failed");
    expect(ids(host, "nav.primary")).toEqual(["good.kept"]);
  });

  it("rejects a static contribution owned by another module before activate runs", async () => {
    const activate = vi.fn();
    const host = fixture([module("bad", { contributes: { "nav.primary": [{ id: "other.row" }] }, activate }), module("healthy")]);
    await host.ready;
    expect(host.statuses().bad?.state.kind).toBe("failed"); expect(activate).not.toHaveBeenCalled();
    expect(ids(host, "nav.primary")).toEqual([]); expect(host.statuses().healthy?.state.kind).toBe("active");
  });

  it("fails invalid ownership during activation even when module code catches the registration error", async () => {
    const host = fixture([
      module("bad", { contributes: { "nav.primary": [{ id: "bad.static" }] }, activate(ctx) {
        ctx.contribute("nav.primary", { id: "bad.partial" });
        try { ctx.contribute("nav.primary", { id: "other.stolen" }); } catch { /* A plugin cannot swallow host validation failure. */ }
      } }),
      module("dependent", { requires: { modules: ["bad"] } }),
      module("healthy"),
    ]);
    await host.ready;
    expect(host.statuses().bad?.state.kind).toBe("failed");
    expect(ids(host, "nav.primary")).toEqual([]);
    expect(host.statuses().dependent?.state.kind).toBe("unavailable");
    expect(host.statuses().healthy?.state.kind).toBe("active");
  });

  it("keeps static item identity across host restarts and returns stable unchanged snapshots", async () => {
    const item: Item = { id: "stable.nav" };
    const host = fixture([module("stable", { contributes: { "nav.primary": [item] } })]);
    await host.ready;
    const first = host.snapshot("nav.primary");
    expect(host.snapshot("nav.primary")).toBe(first); expect(first[0]?.item).toBe(item);
    const observed: (Item | undefined)[][] = [];
    const unsubscribe = host.subscribe(() => observed.push(host.snapshot("nav.primary").map(row => row.item)));
    await host.setHost({ id: "second", kind: "ssh", features: new Set() });
    expect(host.snapshot("nav.primary")[0]?.item).toBe(item);
    expect(observed.every(items => items.length === 1 && items[0] === item)).toBe(true);
    expect(host.snapshot("nav.primary")).toBe(host.snapshot("nav.primary"));
    unsubscribe();
  });

  it("uses declared placement defaults and persists only valid placement overrides", async () => {
    const onPrefsChange = vi.fn();
    const host = fixture([module("status", { contributes: { "conversation.status": [{ id: "status.goal" }] } })], { onPrefsChange });
    await host.ready;
    expect(host.snapshot("conversation.status")[0]?.placement).toBe("capsule");
    host.setPlacement("conversation.status", "status.goal", "bar");
    expect(host.snapshot("conversation.status")[0]?.placement).toBe("bar");
    expect(onPrefsChange).toHaveBeenLastCalledWith(expect.objectContaining({ v: 1, place: { "conversation.status:status.goal": "bar" } }));
    try { host.setPlacement("conversation.status", "status.goal", "invalid"); } catch { /* Invalid values may be rejected explicitly. */ }
    expect(host.snapshot("conversation.status")[0]?.placement).toBe("bar");
  });
});

describe("mainline module contract: failure and generation races", () => {
  it("times out activation, aborts and rolls back partial contributions while peers survive", async () => {
    vi.useFakeTimers(); let ctx!: Context;
    const host = fixture([module("hanging", { contributes: { "nav.primary": [{ id: "hanging.static" }] }, activate(context) { ctx = context; context.contribute("nav.primary", { id: "hanging.dynamic" }); return new Promise(() => {}); } }), module("peer")]);
    await tick(); expect(ctx.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10001); await host.ready;
    expect(host.statuses().hanging?.state).toMatchObject({ kind: "failed", error: expect.stringMatching(/time/i) });
    expect(ctx.signal.aborted).toBe(true); expect(ids(host, "nav.primary")).toEqual([]);
    expect(host.statuses().peer?.state.kind).toBe("active");
  });

  it("isolates rejection, makes dependents unavailable, and retries with a new generation", async () => {
    let fail = true; const contexts: Context[] = [];
    const host = fixture([module("base", { contributes: { "nav.primary": [{ id: "base.nav" }] }, async activate(ctx) { contexts.push(ctx); if (fail) throw new Error("fixture failure"); } }), module("child", { requires: { modules: ["base"] } }), module("peer")]);
    await host.ready;
    expect(host.statuses().base?.state).toMatchObject({ kind: "failed", error: expect.stringContaining("fixture failure") });
    expect(contexts[0]?.signal.aborted).toBe(true); expect(ids(host, "nav.primary")).toEqual([]);
    expect(host.statuses().child?.state.kind).toBe("unavailable"); expect(host.statuses().peer?.state.kind).toBe("active");
    fail = false; await host.retry("base");
    expect(host.statuses().base?.state.kind).toBe("active"); expect(host.statuses().child?.state.kind).toBe("active");
    expect(contexts[1]!.generation).toBeGreaterThan(contexts[0]!.generation);
  });

  it("switches hosts immediately during unresolved activation and rejects stale contributions", async () => {
    const stalled = deferred(); const contexts: Context[] = [];
    const host = fixture([module("async", { activate(ctx) { contexts.push(ctx); ctx.contribute("nav.primary", { id: "async.current", label: ctx.host.id }); if (contexts.length === 1) return stalled.promise; } })]);
    await tick(); const old = contexts[0]!;
    expect(old.signal.aborted).toBe(false);
    const switched = host.setHost({ id: "new-host", kind: "ssh", features: new Set() });
    expect(old.signal.aborted).toBe(true);
    expect(() => old.contribute("nav.primary", { id: "async.late" })).toThrowError(expect.objectContaining({ name: "AbortError" }));
    await switched;
    expect(contexts).toHaveLength(2); expect(host.statuses().async?.state.kind).toBe("active");
    expect(host.snapshot("nav.primary")[0]?.item.label).toBe("new-host");
    stalled.resolve(); await host.ready; await host.whenSettled();
    expect(host.statuses().async?.state.kind).toBe("active"); expect(ids(host, "nav.primary")).toEqual(["async.current"]);
  });

  it("coalesces rapid host changes to the latest identity without resurrecting old scopes", async () => {
    const contexts: Context[] = [];
    const host = fixture([module("observer", { activate(ctx) { contexts.push(ctx); } })]);
    await host.ready;
    const one = host.setHost({ id: "intermediate", kind: "ssh", features: new Set() });
    const two = host.setHost({ id: "latest", kind: "local", features: new Set(["new"]) });
    await Promise.all([one, two]); await host.whenSettled();
    expect(contexts.at(-1)?.host.id).toBe("latest");
    expect(contexts.slice(0, -1).every(ctx => ctx.signal.aborted)).toBe(true);
    expect(contexts.at(-1)?.signal.aborted).toBe(false);
  });

  it("reconciles a toggle queued by the final activation notification before the scheduler settles", async () => {
    const host = fixture([module("tail")]);
    let queued = false;
    host.subscribe(() => {
      if (!queued && host.statuses().tail?.state.kind === "active") {
        queued = true;
        queueMicrotask(() => { void host.setEnabled("tail", false); });
      }
    });
    await host.ready; await tick(); await host.whenSettled();
    expect(queued).toBe(true);
    expect(host.statuses().tail?.state.kind).toBe("disabled");
  });

  it("does not call service factories for an owner aborted by an activating-state observer", async () => {
    const factoryHosts: string[] = [];
    const host = fixture([module("observer")], { createServices: scope => { factoryHosts.push(scope.host.id); expect(scope.isCurrent()).toBe(true); return {}; } });
    let switched = false;
    host.subscribe(() => {
      if (!switched && host.statuses().observer?.state.kind === "activating") {
        switched = true;
        void host.setHost({ id: "replacement", kind: "ssh", features: new Set() });
      }
    });
    await host.ready; await host.whenSettled();
    expect(factoryHosts).toEqual(["replacement"]);
    expect(host.statuses().observer?.state.kind).toBe("active");
  });

  it.each(["stop", "throw"] as const)("releases an eager preference subscription when its initial callback causes %s", async behavior => {
    const unsubscribe = vi.fn();
    const host = fixture([module("prefs", { activate(ctx) {
      ctx.prefs.subscribe(() => {
        if (behavior === "throw") throw new Error("eager callback failed");
        void host.setEnabled("prefs", false);
      });
    } })], {
      createPrefs: () => ({ get: (_key, fallback) => fallback, set: () => {}, subscribe: listener => { listener(); return unsubscribe; } }),
    });
    await host.ready; await host.whenSettled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(host.statuses().prefs?.state.kind).toBe(behavior === "throw" ? "failed" : "disabled");
  });

  it("dispose interrupts uncooperative activation and invalidates all captured contexts", async () => {
    let ctx!: Context;
    const host = fixture([module("stalled", { activate(value) { ctx = value; value.contribute("nav.primary", { id: "stalled.row" }); return new Promise(() => {}); } })]);
    await tick(); const disposed = host.dispose();
    expect(ctx.signal.aborted).toBe(true); expect(ids(host, "nav.primary")).toEqual([]);
    await disposed;
    expect(() => ctx.contribute("nav.primary", { id: "stalled.late" })).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });
});
