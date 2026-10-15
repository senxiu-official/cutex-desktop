// v1.5 (multi-host P0, docs/desktop-modules.md §4 / §6): the engine gets the focus host plus the other
// connected hosts and the scope. Modules activate when any connected host satisfies them (unless
// requires.focusHost); entries are gated by the hosts in the scope; only a focus change restarts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModuleHost, type SlotItemBase } from "../src/index.js";

type Item = SlotItemBase;
type Slots = { "nav.primary": Item; "status": Item };
type Options = Parameters<typeof createModuleHost<Slots>>[0];
type Definition = Options["modules"][number];
type Context = Parameters<NonNullable<Definition["activate"]>>[0];
type Host = ReturnType<typeof createModuleHost<Slots>>;
const slots: Options["slots"] = { "nav.primary": { unavailable: "disable" }, status: { unavailable: "hide" } };
const target = (id: string, features: readonly string[] | null = [], kind: "local" | "ssh" = id === "local" ? "local" : "ssh") => ({ id, kind, features: features === null ? null : new Set(features) });
const hosts: Host[] = [];
function fixture(modules: Definition[], input: { focus: ReturnType<typeof target>; others?: ReturnType<typeof target>[]; scope?: string[] }) {
  const host = createModuleHost<Slots>({ modules, slots, host: input.focus, hosts: { focus: input.focus, others: input.others ?? [], scope: input.scope ?? [input.focus.id] } });
  hosts.push(host);
  return host;
}
const entries = (host: Host, slot: keyof Slots) => host.snapshot(slot).map(entry => [entry.item.id, entry.available]);
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); });

describe("v1.5 multi-host module gating", () => {
  it("a module activates when any connected host satisfies it; focusHost modules only look at the focus", async () => {
    const jobs = vi.fn(), terminal = vi.fn();
    const host = fixture([
      { id: "jobs", titleKey: "jobs", requires: { capabilities: ["job-service"] }, activate: jobs },
      { id: "terminal", titleKey: "terminal", requires: { capabilities: ["job-service"], focusHost: true }, activate: terminal },
    ], { focus: target("local"), others: [target("ssh-t", ["job-service"])] });
    await host.ready;
    expect(host.statuses().jobs?.state.kind).toBe("active");
    expect(jobs).toHaveBeenCalledOnce();
    expect(host.statuses().terminal?.state).toMatchObject({ kind: "unavailable", missing: { capabilities: ["job-service"] } });
    expect(terminal).not.toHaveBeenCalled();
  });

  it("entries are gated by the hosts in the scope (module ∪ item capabilities)", async () => {
    const host = fixture([
      { id: "jobs", titleKey: "jobs", requires: { capabilities: ["job-service"] }, activate: ctx => {
        ctx.contribute("nav.primary", { id: "jobs.nav" });
        ctx.contribute("nav.primary", { id: "jobs.extra", requires: { capabilities: ["job-extra"] } });
      } },
    ], { focus: target("local"), others: [target("ssh-t", ["job-service", "job-extra"])], scope: ["local"] });
    await host.ready;
    // Active (workstation is connected) but nothing in the scope can use it: shown as unavailable.
    expect(entries(host, "nav.primary")).toEqual([["jobs.nav", false], ["jobs.extra", false]]);
    await host.setHosts({ focus: target("local"), others: [target("ssh-t", ["job-service", "job-extra"])], scope: ["local", "ssh-t"] });
    expect(entries(host, "nav.primary")).toEqual([["jobs.nav", true], ["jobs.extra", true]]);
    await host.setHosts({ focus: target("local"), others: [target("ssh-t", ["job-service"])], scope: ["local", "ssh-t"] });
    expect(entries(host, "nav.primary")).toEqual([["jobs.nav", true], ["jobs.extra", false]]);
    expect(host.snapshot("nav.primary")[1]!.missing.capabilities).toEqual(["job-service", "job-extra"]);
  });

  it("other hosts / scope changes do not restart modules; ctx.hosts tells subscribers; a focus change restarts", async () => {
    const contexts: Context[] = [];
    const heard = vi.fn();
    const host = fixture([{ id: "notes", titleKey: "notes", activate: ctx => {
      contexts.push(ctx);
      ctx.hosts.subscribe(() => heard(ctx.hosts.list().map(entry => [entry.id, entry.focus, entry.inScope, entry.featuresKnown])));
    } }], { focus: target("local", ["a"]) });
    await host.ready;
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.hosts.list().map(entry => entry.id)).toEqual(["local"]);
    await host.setHosts({ focus: target("local", ["a"]), others: [target("ssh-t", null)], scope: ["local"] });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.signal.aborted).toBe(false);
    expect(heard).toHaveBeenLastCalledWith([["local", true, true, true], ["ssh-t", false, false, false]]);
    expect(contexts[0]!.hosts.get("ssh-t")).toMatchObject({ kind: "ssh", featuresKnown: false });
    // Same input again: nothing happens.
    await host.setHosts({ focus: target("local", ["a"]), others: [target("ssh-t", null)], scope: ["local"] });
    expect(heard).toHaveBeenCalledTimes(1);
    // The focus moves: a full restart with the new ctx.host; the old ctx.hosts is closed.
    const old = contexts[0]!;
    await host.setHosts({ focus: target("ssh-t", ["a"]), others: [target("local", ["a"])], scope: ["ssh-t"] });
    expect(old.signal.aborted).toBe(true);
    expect(() => old.hosts.list()).toThrow();
    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.host.id).toBe("ssh-t");
    expect(contexts[1]!.hosts.list().map(entry => [entry.id, entry.focus])).toEqual([["ssh-t", true], ["local", false]]);
    // Only subscribers of a running activation hear changes.
    heard.mockClear();
    await host.setHosts({ focus: target("ssh-t", ["a"]), others: [], scope: ["ssh-t"] });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("a module whose only satisfying host disconnects stops; setHost keeps the single-host behaviour", async () => {
    const stop = vi.fn();
    const host = fixture([{ id: "jobs", titleKey: "jobs", requires: { capabilities: ["job-service"] }, activate: ctx => { ctx.signal.addEventListener("abort", stop); } }],
      { focus: target("local"), others: [target("ssh-t", ["job-service"])] });
    await host.ready;
    expect(host.statuses().jobs?.state.kind).toBe("active");
    await host.setHosts({ focus: target("local"), others: [], scope: ["local"] });
    expect(stop).toHaveBeenCalledOnce();
    expect(host.statuses().jobs?.state).toMatchObject({ kind: "unavailable", missing: { capabilities: ["job-service"] } });
    await host.setHost(target("local", ["job-service"]));
    expect(host.statuses().jobs?.state.kind).toBe("active");
  });
});
