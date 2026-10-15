import { describe, expect, it, vi } from "vitest";
import { createServicePluginHost } from "../src/index.js";
import type { ServiceChannel, ServiceManifest, Supervisor, SupervisorLease, SupervisorObserver } from "../src/index.js";

const manifest = (id = "jobs", extra: Partial<ServiceManifest> = {}): ServiceManifest => ({ id, protocol: 1, provides: [`${id}.read`], methods: ["observe", "heartbeat"], restart: { maxRestarts: 2, windowMs: 1000, backoffMs: 10 }, ...extra });
class Fake implements Supervisor {
  observers = new Map<string, SupervisorObserver>();
  desired = new Map<string, { running: boolean; revision: number }>();
  requests: string[] = [];
  closes: string[] = [];
  count = 0;
  attach(id: string, _policy: unknown, observer: SupervisorObserver): SupervisorLease {
    this.observers.set(id, observer);
    return { setDesired: async input => { this.desired.set(id, input); this.requests.push(`${id}:${input.running}`); }, close: async () => { this.closes.push(id); } };
  }
  start(id = "jobs", runId = `run-${++this.count}`) {
    const revision = this.desired.get(id)!.revision;
    const observer = this.observers.get(id)!;
    const channel = observer.started({ revision, runId });
    return { channel, revision, runId, event: (phase: "running" | "backoff" | "failed" | "stopped", restartAttempt?: number) => observer.event({ revision, runId, phase, restartAttempt }) };
  }
}
const grant = (m: ServiceManifest) => ({ capabilities: m.provides, methods: m.methods });
function setup(services = [manifest()]) {
  const supervisor = new Fake();
  const host = createServicePluginHost({ services, supervisor });
  for (const m of services) { host.grant(m.id, grant(m)); host.setEnabled(m.id, true); }
  return { host, supervisor };
}
function ready(channel: ServiceChannel, capabilities = ["jobs.read"]) { return channel.ready({ occurrence: channel.occurrence, protocol: 1, capabilities }); }

describe("experimental service capability controller", () => {
  it("does not attach or launch without both explicit owner grant and enable", async () => {
    const supervisor = new Fake(), host = createServicePluginHost({ services: [manifest()], supervisor });
    expect(host.snapshot().services[0]?.phase).toBe("disabled");
    host.setEnabled("jobs", true);
    expect(host.snapshot().services[0]?.phase).toBe("blocked");
    expect(supervisor.requests).toEqual([]);
    host.grant("jobs", grant(manifest()));
    expect(supervisor.requests).toEqual(["jobs:true"]);
    await host.dispose();
  });
  it("rejects cycles through capability edges, unknown dependencies, duplicate capabilities and invalid finite policies before attach", () => {
    const supervisor = new Fake();
    expect(() => createServicePluginHost({ services: [manifest("a", { requires: { capabilities: ["b.read"] } }), manifest("b", { requires: { services: ["a"] } })], supervisor })).toThrow("cycle");
    expect(() => createServicePluginHost({ services: [manifest("a", { requires: { capabilities: ["unknown"] } })], supervisor })).toThrow("Unknown");
    expect(() => createServicePluginHost({ services: [manifest(), manifest("other", { provides: ["jobs.read"] })], supervisor })).toThrow("Ambiguous");
    expect(() => createServicePluginHost({ services: [manifest("a", { restart: { maxRestarts: Infinity, windowMs: 100, backoffMs: 1 } })], supervisor })).toThrow("finite");
    expect(supervisor.requests).toEqual([]);
  });
  it("publishes only the approved readiness subset after transport is running", async () => {
    const m = manifest("jobs", { provides: ["jobs.read", "jobs.write"] });
    const { host, supervisor } = setup([m]);
    const run = supervisor.start();
    expect(ready(run.channel)).toEqual({ ok: true });
    expect(host.snapshot().capabilities).toEqual([]);
    expect(run.channel.check("observe")).toMatchObject({ ok: false, reason: "not-ready" });
    run.event("running");
    expect(host.snapshot().capabilities).toEqual(["jobs.read"]);
    expect(run.channel.check("observe")).toEqual({ ok: true });
    expect(run.channel.check("root.control")).toMatchObject({ ok: false, reason: "method-denied" });
    await host.dispose();
  });
  it.each(["undeclared", "unapproved", "protocol", "unknown-field", "duplicate"])("invalid %s ready withdraws authority and stops the owned lease", async variant => {
    const { host, supervisor } = setup([manifest("jobs", { provides: ["jobs.read", "jobs.extra"] })]);
    host.grant("jobs", { capabilities: ["jobs.read"], methods: ["observe"] });
    const run = supervisor.start(); run.event("running");
    const input = { occurrence: run.channel.occurrence, protocol: variant === "protocol" ? 2 : 1,
      capabilities: variant === "undeclared" ? ["other.read"] : variant === "unapproved" ? ["jobs.extra"] : variant === "duplicate" ? ["jobs.read", "jobs.read"] : ["jobs.read"],
      ...(variant === "unknown-field" ? { rootToken: "not-an-actual-token" } : {}) };
    expect(run.channel.ready(input)).toMatchObject({ ok: false, reason: "invalid-ready" });
    expect(host.snapshot().capabilities).toEqual([]);
    expect(host.snapshot().services[0]?.phase).toBe("failed");
    expect(supervisor.desired.get("jobs")?.running).toBe(false);
    await host.dispose();
  });
  it("revoke invalidates already-created callbacks immediately and never executes denied calls", async () => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("running"); ready(run.channel);
    const callback = vi.fn((value: number) => value + 1), guarded = run.channel.guard("observe", callback);
    expect(guarded(2)).toEqual({ ok: true, value: 3 });
    host.revoke("jobs");
    expect(host.snapshot().capabilities).toEqual([]);
    expect(guarded(4)).toMatchObject({ ok: false, reason: "stale-occurrence" });
    expect(callback).toHaveBeenCalledTimes(1);
    await host.dispose();
  });
  it("rejects late ready/events after disable and a new desired revision", async () => {
    const { host, supervisor } = setup(); const old = supervisor.start();
    host.setEnabled("jobs", false); host.setEnabled("jobs", true);
    const current = supervisor.start(); current.event("running"); ready(current.channel);
    expect(ready(old.channel)).toMatchObject({ ok: false, reason: "stale-occurrence" });
    old.event("failed");
    expect(host.snapshot().services[0]?.phase).toBe("ready");
    expect(old.channel.ready({ occurrence: current.channel.occurrence, protocol: 1, capabilities: ["jobs.read"] })).toMatchObject({ ok: false });
    await host.dispose();
  });
  it("projects dependency withdrawal synchronously, even before async stop completes", async () => {
    const { host, supervisor } = setup([manifest(), manifest("observer", { requires: { capabilities: ["jobs.read"] } })]);
    expect(supervisor.desired.has("observer")).toBe(false);
    const jobs = supervisor.start(); jobs.event("running"); ready(jobs.channel);
    const observer = supervisor.start("observer"); observer.event("running"); ready(observer.channel, ["observer.read"]);
    expect(host.snapshot().capabilities).toEqual(["jobs.read", "observer.read"]);
    jobs.event("backoff", 1);
    expect(host.snapshot().capabilities).toEqual([]);
    expect(observer.channel.check("observe")).toMatchObject({ ok: false, reason: "stale-occurrence" });
    expect(supervisor.desired.get("observer")?.running).toBe(false);
    const restarted = supervisor.start(); restarted.event("running"); ready(restarted.channel);
    expect(supervisor.desired.get("observer")?.running).toBe(true);
    await host.dispose();
  });
  it("does not start a second restart timer; only a supervisor occurrence revives backoff", async () => {
    vi.useFakeTimers();
    try {
      const { host, supervisor } = setup(); const first = supervisor.start(); first.event("running"); ready(first.channel);
      const requests = supervisor.requests.length;
      first.event("backoff", 1); await vi.advanceTimersByTimeAsync(5000);
      expect(supervisor.requests).toHaveLength(requests);
      expect(host.snapshot().services[0]?.phase).toBe("backoff");
      expect(first.channel.check("observe")).toMatchObject({ ok: false });
      const next = supervisor.start(); next.event("running"); ready(next.channel);
      expect(host.snapshot().services[0]?.phase).toBe("ready");
      await host.dispose();
    } finally { vi.useRealTimers(); }
  });
  it("rejects supervisor reports beyond the finite restart budget and requires explicit retry after failure", async () => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("backoff", 3);
    expect(host.snapshot().services[0]?.failure).toBe("invalid-supervisor-event");
    host.setEnabled("jobs", true);
    expect(supervisor.desired.get("jobs")?.running).toBe(false);
    host.retry("jobs"); expect(supervisor.desired.get("jobs")?.running).toBe(true);
    await host.dispose();
  });
  it("controller reconstruction starts with no grants and old channels cannot authorize the new host", async () => {
    const one = setup(); const run = one.supervisor.start(); run.event("running"); ready(run.channel);
    const firstDispose = one.host.dispose(); expect(one.host.dispose()).toBe(firstDispose);
    expect(run.channel.check("observe")).toMatchObject({ ok: false }); await firstDispose;
    const supervisor = new Fake(), two = createServicePluginHost({ services: [manifest()], supervisor });
    expect(two.snapshot().capabilities).toEqual([]); expect(supervisor.requests).toEqual([]);
    expect(ready(run.channel)).toMatchObject({ ok: false });
    expect(() => one.host.grant("jobs", grant(manifest()))).toThrow("disposed");
    await two.dispose();
  });
  it("keeps immutable snapshots stable and isolates observer failures", async () => {
    const { host, supervisor } = setup(); const before = host.snapshot();
    expect(host.snapshot()).toBe(before); expect(Object.isFrozen(before.services)).toBe(true);
    host.subscribe(() => { throw Error("observer"); });
    const run = supervisor.start(); run.event("running"); ready(run.channel);
    expect(host.snapshot().capabilities).toEqual(["jobs.read"]);
    await host.dispose();
  });
});

describe("revocation and reentrancy", () => {
  it("aborts async callbacks and suppresses late values or errors after revoke", async () => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("running"); ready(run.channel);
    let resolve!: (value: string) => void, reject!: (reason: unknown) => void, signal!: AbortSignal;
    const operation = run.channel.guardAsync("observe", async observed => { signal = observed; return new Promise<string>((yes, no) => { resolve = yes; reject = no; }); });
    const result = operation(); expect(signal.aborted).toBe(false);
    let abortDecision: unknown;
    signal.addEventListener("abort", () => { abortDecision = run.channel.check("observe"); });
    host.revoke("jobs"); expect(signal.aborted).toBe(true);
    expect(abortDecision).toMatchObject({ ok: false, reason: "stale-occurrence" });
    resolve("private late value"); expect(await result).toMatchObject({ ok: false, reason: "stale-occurrence" });
    host.grant("jobs", grant(manifest())); const next = supervisor.start(); next.event("running"); ready(next.channel);
    const failure = next.channel.guardAsync("observe", async () => new Promise<string>((_yes, no) => { reject = no; }))();
    host.setEnabled("jobs", false); reject(Error("private late error"));
    expect(await failure).toMatchObject({ ok: false, reason: "stale-occurrence" });
    await host.dispose();
  });
  it("rejects async callbacks passed to sync guard at runtime and does not expose reentrant revoked results", async () => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("running"); ready(run.channel);
    // JS callers cannot rely on the TypeScript sync-only restriction.
    const asyncCallback = (() => Promise.resolve("value")) as unknown as () => string;
    expect(run.channel.guard("observe", asyncCallback)()).toMatchObject({ ok: false, reason: "async-callback-unsupported" });
    expect(run.channel.guard("observe", () => { host.revoke("jobs"); return "late"; })()).toMatchObject({ ok: false, reason: "stale-occurrence" });
    await host.dispose();
  });
  it("a subscriber may synchronously disable a newly ready service without an authority leak", async () => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("running");
    host.subscribe(() => { if (host.snapshot().capabilities.length) host.setEnabled("jobs", false); });
    ready(run.channel);
    expect(host.snapshot().capabilities).toEqual([]);
    expect(run.channel.check("observe")).toMatchObject({ ok: false, reason: "stale-occurrence" });
    await host.dispose();
  });
  it("an ancient duplicate runId cannot regain authority after a different run", async () => {
    const { host, supervisor } = setup(); const first = supervisor.start("jobs", "first"); first.event("backoff", 1);
    const second = supervisor.start("jobs", "second"); second.event("backoff", 2);
    const ancient = supervisor.start("jobs", "first");
    expect(ready(ancient.channel)).toMatchObject({ ok: false });
    expect(host.snapshot().services[0]?.failure).toBe("invalid-supervisor-event");
    await host.dispose();
  });
});

describe("hostile shapes and synchronous supervisor callbacks", () => {
  it("rejects sparse manifest/grant/ready arrays instead of accepting holes", async () => {
    const supervisor = new Fake();
    expect(() => createServicePluginHost({ services: [manifest("a", { provides: new Array(1) })], supervisor })).toThrow();
    const { host, supervisor: fake } = setup();
    expect(() => host.grant("jobs", { capabilities: new Array(1), methods: ["observe"] })).toThrow();
    const run = fake.start(); run.event("running");
    expect(ready(run.channel, new Array(1))).toMatchObject({ ok: false, reason: "invalid-ready" });
    expect(host.snapshot().capabilities).toEqual([]);
    await host.dispose();
  });
  it("dispose reentrancy from subscriber and abort callback closes each lease once", async () => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("running"); ready(run.channel);
    const nested: Promise<void>[] = [];
    host.subscribe(() => { if (host.snapshot().disposed) nested.push(host.dispose()); });
    let finish!: () => void;
    const task = run.channel.guardAsync("observe", async signal => {
      signal.addEventListener("abort", () => nested.push(host.dispose()));
      await new Promise<void>(resolve => { finish = resolve; });
    })();
    const disposed = host.dispose();
    expect(nested.length).toBe(2); for (const p of nested) expect(p).toBe(disposed);
    finish(); await task; await disposed;
    expect(supervisor.closes).toEqual(["jobs"]);
  });
  it("processes synchronous started/running/ready callbacks without a lost dependency transition", async () => {
    let run = 0; const seen: string[] = [];
    const supervisor: Supervisor = { attach(id, _policy, observer) { return {
      async setDesired({ running, revision }) {
        seen.push(`${id}:${running}`); if (!running) return;
        const runId = String(++run), channel = observer.started({ revision, runId });
        observer.event({ revision, runId, phase: "running" });
        ready(channel, [`${id}.read`]);
      }, async close() {},
    }; } };
    const manifests = [manifest(), manifest("observer", { requires: { services: ["jobs"] } })];
    const host = createServicePluginHost({ services: manifests, supervisor });
    for (const m of manifests) { host.grant(m.id, grant(m)); host.setEnabled(m.id, true); }
    expect(host.snapshot().capabilities).toEqual(["jobs.read", "observer.read"]);
    host.revoke("jobs"); expect(host.snapshot().capabilities).toEqual([]);
    expect(seen).toContain("observer:false"); await host.dispose();
  });
});

describe("dependency authority during abort reentrancy", () => {
  it("denies dependent calls from the provider abort callback before downstream stop iteration", async () => {
    const { host, supervisor } = setup([manifest(), manifest("observer", { requires: { capabilities: ["jobs.read"] } })]);
    const jobs = supervisor.start(); jobs.event("running"); ready(jobs.channel);
    const observer = supervisor.start("observer"); observer.event("running"); ready(observer.channel, ["observer.read"]);
    let insideAbort: unknown, finish!: () => void;
    const task = jobs.channel.guardAsync("observe", async signal => {
      signal.addEventListener("abort", () => { insideAbort = observer.channel.check("observe"); });
      await new Promise<void>(resolve => { finish = resolve; });
    })();
    host.revoke("jobs");
    expect(insideAbort).toMatchObject({ ok: false, reason: "stale-occurrence" });
    finish(); await task; await host.dispose();
  });
});

describe("newer owner intents win over reentrant transitions", () => {
  it.each(["revoke", "dispose"])("grant replacement cannot overwrite a subscriber %s", async action => {
    const { host, supervisor } = setup(); const run = supervisor.start(); run.event("running"); ready(run.channel);
    let fired = false;
    host.subscribe(() => {
      if (!fired && !host.snapshot().capabilities.length) {
        fired = true;
        if (action === "revoke") host.revoke("jobs"); else void host.dispose();
      }
    });
    host.grant("jobs", grant(manifest()));
    expect(fired).toBe(true); expect(host.snapshot().capabilities).toEqual([]);
    expect(supervisor.desired.get("jobs")?.running).toBe(false);
    expect(run.channel.check("observe")).toMatchObject({ ok: false });
    await host.dispose();
  });
  it.each(["disable", "dispose"])("new occurrence cannot bootstrap after old abort callback %s", async action => {
    const { host, supervisor } = setup(); const old = supervisor.start(); old.event("running"); ready(old.channel);
    let finish!: () => void;
    const task = old.channel.guardAsync("observe", async signal => {
      signal.addEventListener("abort", () => { if (action === "disable") host.setEnabled("jobs", false); else void host.dispose(); });
      await new Promise<void>(resolve => { finish = resolve; });
    })();
    const next = supervisor.start();
    expect(next.channel.occurrence).toBe("rejected"); expect(ready(next.channel).ok).toBe(false);
    expect(host.snapshot().capabilities).toEqual([]);
    finish(); await task; await host.dispose();
  });
});
