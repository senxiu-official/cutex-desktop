export type * from "./types.js";
import type { Decision, Grant, GuardResult, HostSnapshot, Ready, ServiceChannel, ServiceManifest, ServicePhase, ServicePluginHost, ServiceSnapshot, Supervisor, SupervisorEvent, SupervisorLease } from "./types.js";

const idPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const names = (value: readonly string[], label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > 128 || Array.from({ length: value.length }, (_, i) => !Object.hasOwn(value, i) || typeof value[i] !== "string" || !idPattern.test(value[i]!)).some(Boolean) || new Set(value).size !== value.length) throw new Error(`Invalid ${label}`);
  return Object.freeze([...value]);
};
interface RecordState {
  manifest: ServiceManifest;
  enabled: boolean;
  grant?: Grant;
  desired: boolean;
  revision: number;
  policyEpoch: number;
  lease?: SupervisorLease;
  runId?: string;
  seenRuns: Set<string>;
  occurrence?: string;
  abort?: AbortController;
  transport: "starting" | "running" | "backoff" | "failed" | "stopped";
  readyCaps?: readonly string[];
  missing: readonly string[];
  failure?: ServiceSnapshot["failure"];
}
const stale = Object.freeze({ ok: false, reason: "stale-occurrence" } as const);
const allowed: Decision = Object.freeze({ ok: true });

/** In-memory grant/capability controller. Never stores jobs or supervises OS processes.
 * Each construction starts ungranted and disabled: rebuilding requires fresh owner grants,
 * fresh leases and private bootstrap; previously issued closures cannot bind to the new host.
 */
export function createServicePluginHost(options: {
  readonly services: readonly ServiceManifest[];
  readonly supervisor: Supervisor;
}): ServicePluginHost {
  if (!Array.isArray(options.services) || options.services.length > 128) throw new Error("Invalid service registry");
  const records = new Map<string, RecordState>();
  const providers = new Map<string, string>();
  for (const input of options.services) {
    if (!idPattern.test(input.id) || records.has(input.id)) throw new Error("Duplicate or invalid service id");
    if (!Number.isSafeInteger(input.protocol) || input.protocol <= 0) throw new Error("Invalid protocol");
    const restart = { ...input.restart };
    if (!Number.isSafeInteger(restart.maxRestarts) || restart.maxRestarts < 0 || restart.maxRestarts > 1000
      || !Number.isSafeInteger(restart.windowMs) || restart.windowMs < 1 || restart.windowMs > 86_400_000
      || !Number.isSafeInteger(restart.backoffMs) || restart.backoffMs < 0 || restart.backoffMs > restart.windowMs) throw new Error("Invalid finite restart policy");
    const manifest: ServiceManifest = Object.freeze({ id: input.id, protocol: input.protocol,
      provides: names(input.provides, "provided capabilities"), methods: names(input.methods, "methods"),
      requires: Object.freeze({ services: names(input.requires?.services ?? [], "service dependencies"), capabilities: names(input.requires?.capabilities ?? [], "capability dependencies") }),
      restart: Object.freeze(restart) });
    for (const capability of manifest.provides) {
      if (providers.has(capability)) throw new Error("Ambiguous capability provider");
      providers.set(capability, manifest.id);
    }
    records.set(manifest.id, { manifest, enabled: false, desired: false, revision: 0, policyEpoch: 0, seenRuns: new Set(), transport: "stopped", missing: [] });
  }
  const dependencies = (r: RecordState): string[] => [...new Set([
    ...r.manifest.requires!.services!,
    ...r.manifest.requires!.capabilities!.map(cap => {
      const provider = providers.get(cap);
      if (!provider) throw new Error("Unknown capability dependency");
      return provider;
    }),
  ])];
  const order: RecordState[] = [], visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    const r = records.get(id);
    if (!r) throw new Error("Unknown service dependency");
    if (visiting.has(id)) throw new Error("Service dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id); for (const dependency of dependencies(r)) visit(dependency);
    visiting.delete(id); visited.add(id); order.push(r);
  };
  for (const id of records.keys()) visit(id);
  let disposed = false, reconciling = false, again = false;
  let disposePromise: Promise<void> | undefined;
  let snapshot: HostSnapshot = Object.freeze({ services: Object.freeze([]), capabilities: Object.freeze([]), disposed: false });
  const listeners = new Set<() => void>(), pending = new Set<Promise<void>>();
  const phase = (r: RecordState): ServicePhase => disposed ? "stopped" : !r.enabled ? "disabled" : r.failure ? "failed"
    : r.missing.length ? "blocked" : r.readyCaps && r.transport === "running" ? "ready" : r.transport === "backoff" ? "backoff" : "starting";
  const caps = (r: RecordState): readonly string[] => phase(r) === "ready" ? r.readyCaps! : [];
  const publish = () => {
    const rows = [...records.values()].map(r => Object.freeze({ id: r.manifest.id, enabled: r.enabled, phase: phase(r),
      ...(r.occurrence ? { occurrence: r.occurrence } : {}), capabilities: Object.freeze([...caps(r)]),
      missing: Object.freeze([...r.missing]), ...(r.failure ? { failure: r.failure } : {}) }));
    const next: HostSnapshot = Object.freeze({ services: Object.freeze(rows), capabilities: Object.freeze(rows.flatMap(r => r.capabilities).sort()), disposed });
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    for (const listener of [...listeners]) { try { listener(); } catch { /* Observer errors cannot break revocation. */ } }
  };
  const invalidate = (r: RecordState) => { const abort = r.abort; r.abort = undefined; r.readyCaps = undefined; r.occurrence = undefined; abort?.abort(); };
  const fault = (r: RecordState, failure: NonNullable<ServiceSnapshot["failure"]>) => {
    invalidate(r); r.failure = failure; r.transport = "failed"; reconcile();
  };
  const track = (task: Promise<void>, r: RecordState, revision: number) => {
    const observed = task.catch(() => { if (!disposed && r.revision === revision) fault(r, "supervisor-control-failed"); });
    pending.add(observed); void observed.finally(() => pending.delete(observed));
  };
  const channel = (r: RecordState, revision: number, runId: string): ServiceChannel => {
    const occurrence = crypto.randomUUID();
    // Check live upstream authority too: a provider's synchronous abort listener may
    // call a dependent before the topological reconciliation reaches that dependent.
    const dependencyReady = (source: RecordState, memo: Map<RecordState, boolean>): boolean => {
      const cached = memo.get(source); if (cached !== undefined) return cached;
      const result = !disposed && source.enabled && source.desired && !!source.grant && !source.failure
        && source.readyCaps !== undefined && source.transport === "running" && dependenciesReady(source, memo);
      memo.set(source, result); return result;
    };
    const dependenciesReady = (source: RecordState, memo = new Map<RecordState, boolean>()): boolean => source.manifest.requires!.services!.every(id => dependencyReady(records.get(id)!, memo))
      && source.manifest.requires!.capabilities!.every(cap => {
        const provider = records.get(providers.get(cap)!)!;
        return dependencyReady(provider, memo) && provider.readyCaps!.includes(cap);
      });
    const valid = () => !disposed && r.enabled && !r.failure && r.desired && r.revision === revision && r.runId === runId && r.occurrence === occurrence && !!r.grant && dependenciesReady(r);
    const check = (method: string): Decision => !valid() ? stale : !r.readyCaps || r.transport !== "running" ? { ok: false, reason: "not-ready" }
      : !r.grant!.methods.includes(method) ? { ok: false, reason: "method-denied" } : allowed;
    const abort = new AbortController(); r.abort = abort;
    r.occurrence = occurrence;
    return Object.freeze({ occurrence,
      ready(message: Ready): Decision {
        if (!valid() || message?.occurrence !== occurrence) return stale;
        const keys = message && typeof message === "object" ? Object.keys(message).sort().join(",") : "";
        if (keys !== "capabilities,occurrence,protocol" || message.protocol !== r.manifest.protocol
          || !Array.isArray(message.capabilities) || message.capabilities.length > 128
          || Array.from({ length: message.capabilities.length }, (_, i) => !Object.hasOwn(message.capabilities, i) || typeof message.capabilities[i] !== "string" || !r.manifest.provides.includes(message.capabilities[i]!) || !r.grant!.capabilities.includes(message.capabilities[i]!)).some(Boolean)
          || new Set(message.capabilities).size !== message.capabilities.length) {
          fault(r, "invalid-ready"); return { ok: false, reason: "invalid-ready" };
        }
        r.readyCaps = Object.freeze([...message.capabilities]); reconcile(); return valid() ? allowed : stale;
      },
      check,
      guard<A extends readonly unknown[], R>(method: string, callback: (...args: A) => R & (R extends PromiseLike<unknown> ? never : unknown)): (...args: A) => GuardResult<R> {
        return (...args) => {
          const decision = check(method); if (!decision.ok) return decision;
          const value = callback(...args);
          if (value !== null && (typeof value === "object" || typeof value === "function") && "then" in value && typeof value.then === "function") {
            // Reject JS/any callers that bypass the sync-only type, without unhandled rejection.
            void Promise.resolve(value).catch(() => {});
            return { ok: false, reason: "async-callback-unsupported" };
          }
          const after = check(method); return after.ok ? { ok: true, value } : after;
        };
      },
      guardAsync<A extends readonly unknown[], R>(method: string, callback: (signal: AbortSignal, ...args: A) => Promise<R>): (...args: A) => Promise<GuardResult<R>> {
        return async (...args) => {
          const decision = check(method); if (!decision.ok) return decision;
          try {
            const value = await callback(abort.signal, ...args);
            const after = check(method); return after.ok ? { ok: true, value } : after;
          } catch (error) {
            const after = check(method); if (!after.ok) return after;
            throw error;
          }
        };
      },
    });
  };
  const rejectedChannel = (): ServiceChannel => Object.freeze({ occurrence: "rejected", ready: () => stale, check: () => stale, guard: () => () => stale, guardAsync: () => async () => stale });
  const event = (r: RecordState, input: SupervisorEvent) => {
    if (disposed || !r.desired || input.revision !== r.revision || input.runId !== r.runId) return;
    if (!["starting", "running", "backoff", "failed", "stopped"].includes(input.phase)
      || (input.restartAttempt !== undefined && (!Number.isSafeInteger(input.restartAttempt) || input.restartAttempt < 0 || input.restartAttempt > r.manifest.restart.maxRestarts))) {
      fault(r, "invalid-supervisor-event"); return;
    }
    r.transport = input.phase;
    if (input.phase !== "starting" && input.phase !== "running") invalidate(r);
    if (input.phase === "failed" || input.phase === "stopped") r.failure = "supervisor-failed";
    reconcile();
  };
  function reconcile(): void {
    if (reconciling) { again = true; return; }
    reconciling = true;
    do {
      again = false;
      for (const r of order) {
        r.missing = [
          ...(!r.grant ? ["owner-grant"] : []),
          ...r.manifest.requires!.services!.filter(id => phase(records.get(id)!) !== "ready").map(id => `service:${id}`),
          ...r.manifest.requires!.capabilities!.filter(cap => !caps(records.get(providers.get(cap)!)!).includes(cap)).map(cap => `capability:${cap}`),
        ];
        const desired = !disposed && r.enabled && !!r.grant && !r.failure && r.missing.length === 0;
        if (desired === r.desired) continue;
        r.desired = desired; ++r.revision; invalidate(r);
        if (desired) {
          r.transport = "starting";
          try {
            r.lease ??= options.supervisor.attach(r.manifest.id, r.manifest.restart, {
              started(input) {
                if (disposed || !r.enabled || !r.grant || r.failure || !r.desired || input.revision !== r.revision || typeof input.runId !== "string" || !input.runId || input.runId.length > 256) return rejectedChannel();
                // A driver must never reuse a runId under one lease, even across desired revisions.
                if (r.seenRuns.has(input.runId)) { fault(r, "invalid-supervisor-event"); return rejectedChannel(); }
                r.seenRuns.add(input.runId); invalidate(r);
                if (disposed || !r.enabled || !r.grant || r.failure || !r.desired || input.revision !== r.revision) return rejectedChannel();
                r.runId = input.runId; r.transport = "starting";
                const next = channel(r, input.revision, input.runId); reconcile(); return next;
              }, event: input => event(r, input),
            });
            track(r.lease.setDesired({ running: true, revision: r.revision }), r, r.revision);
          } catch { r.failure = "supervisor-control-failed"; again = true; }
        } else if (r.lease) {
          try { track(r.lease.setDesired({ running: false, revision: r.revision }), r, r.revision); }
          catch { r.failure = "supervisor-control-failed"; }
        }
      }
    } while (again);
    reconciling = false; publish();
  }
  const get = (id: string): RecordState => {
    if (disposed) throw new Error("Service controller disposed");
    const r = records.get(id); if (!r) throw new Error("Unknown service"); return r;
  };
  reconcile();
  return {
    snapshot: () => snapshot,
    subscribe(listener) { if (disposed) throw new Error("Service controller disposed"); listeners.add(listener); return () => { listeners.delete(listener); }; },
    grant(id, input) {
      const r = get(id), capabilities = names(input.capabilities, "grant capabilities"), methods = names(input.methods, "grant methods");
      if (capabilities.some(cap => !r.manifest.provides.includes(cap)) || methods.some(method => !r.manifest.methods.includes(method))) throw new Error("Grant exceeds manifest");
      // Replacing authority retires the process channel before a new one can be bootstrapped.
      const epoch = ++r.policyEpoch;
      r.grant = undefined; reconcile();
      if (disposed || r.policyEpoch !== epoch) return;
      r.grant = Object.freeze({ capabilities, methods }); reconcile();
    },
    revoke(id) { const r = get(id); ++r.policyEpoch; r.grant = undefined; reconcile(); },
    setEnabled(id, enabled) { const r = get(id); if (typeof enabled !== "boolean") throw new Error("Invalid enabled flag"); ++r.policyEpoch; r.enabled = enabled; reconcile(); },
    retry(id) { const r = get(id); ++r.policyEpoch; r.failure = undefined; reconcile(); },
    async whenSettled() { while (pending.size) await Promise.all([...pending]); },
    dispose() {
      if (disposePromise) return disposePromise;
      let resolve!: () => void, reject!: (error: unknown) => void;
      // Publish the idempotent promise before any observer/abort callback can reenter.
      disposePromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      disposed = true; reconcile(); listeners.clear();
      void (async () => {
        while (pending.size) await Promise.all([...pending]);
        const outcomes = await Promise.allSettled([...records.values()].flatMap(r => r.lease ? [(async () => { await r.lease!.close(); })()] : []));
        if (outcomes.some(outcome => outcome.status === "rejected")) throw new Error("Supervisor lease cleanup failed");
      })().then(resolve, reject);
      return disposePromise;
    },
  };
}
