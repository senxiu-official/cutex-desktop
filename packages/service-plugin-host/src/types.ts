/** Experimental controller contracts, NOT an official daemon protocol/API v1. */
export interface RestartPolicy { readonly maxRestarts: number; readonly windowMs: number; readonly backoffMs: number }
export interface ServiceManifest {
  readonly id: string;
  readonly protocol: number;
  readonly provides: readonly string[];
  readonly methods: readonly string[];
  readonly requires?: { readonly services?: readonly string[]; readonly capabilities?: readonly string[] };
  readonly restart: RestartPolicy;
}
export interface Grant { readonly capabilities: readonly string[]; readonly methods: readonly string[] }
export interface Ready { readonly occurrence: string; readonly protocol: number; readonly capabilities: readonly string[] }
export type Denial = "stale-occurrence" | "not-ready" | "method-denied" | "invalid-ready" | "async-callback-unsupported";
export type Decision = { readonly ok: true } | { readonly ok: false; readonly reason: Denial };
export type GuardResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: Denial };
/** An in-process authority handle delivered ONLY to the trusted injected supervisor.
 * An occurrence string alone is NOT authentication. A real transport must privately bind
 * an authenticated service channel to this handle, without exporting its owner controller.
 */
export interface ServiceChannel {
  readonly occurrence: string;
  ready(message: Ready): Decision;
  check(method: string): Decision;
  /** Synchronous callbacks only. Started effects cannot be undone by revocation. */
  guard<A extends readonly unknown[], R>(method: string, callback: (...args: A) => R & (R extends PromiseLike<unknown> ? never : unknown)): (...args: A) => GuardResult<R>;
  /** Abort is cooperative; a revoked result/error is suppressed after await, not rolled back. */
  guardAsync<A extends readonly unknown[], R>(method: string, callback: (signal: AbortSignal, ...args: A) => Promise<R>): (...args: A) => Promise<GuardResult<R>>;
}
export type SupervisorPhase = "starting" | "running" | "backoff" | "failed" | "stopped";
export interface SupervisorEvent {
  readonly revision: number;
  readonly runId: string;
  readonly phase: SupervisorPhase;
  readonly restartAttempt?: number;
}
export interface SupervisorObserver {
  /** Must be emitted before any messages from each new process occurrence. */
  started(input: { readonly revision: number; readonly runId: string }): ServiceChannel;
  event(input: SupervisorEvent): void;
}
export interface SupervisorLease {
  /** Serializes desired-state operations; honors revision fencing before launching.
   * This supervisor is the ONLY owner of process restart/backoff timers.
   */
  setDesired(input: { readonly running: boolean; readonly revision: number }): Promise<void>;
  /** Stops/releases exactly this lease's processes; must not affect another owner/instance. */
  close(): Promise<void>;
}
export interface Supervisor {
  /** No executable paths, environment, root credentials, or OS handles in this public API.
   * Deployment/hash/ACL/auth bootstrap is the injected driver's responsibility. */
  attach(serviceId: string, policy: RestartPolicy, observer: SupervisorObserver): SupervisorLease;
}
export type ServicePhase = "disabled" | "blocked" | "starting" | "ready" | "backoff" | "failed" | "stopped";
export interface ServiceSnapshot {
  readonly id: string;
  readonly enabled: boolean;
  readonly phase: ServicePhase;
  readonly occurrence?: string;
  readonly capabilities: readonly string[];
  readonly missing: readonly string[];
  readonly failure?: "supervisor-failed" | "supervisor-control-failed" | "invalid-ready" | "invalid-supervisor-event";
}
export interface HostSnapshot { readonly services: readonly ServiceSnapshot[]; readonly capabilities: readonly string[]; readonly disposed: boolean }
export interface ServicePluginHost {
  snapshot(): HostSnapshot;
  subscribe(listener: () => void): () => void;
  grant(id: string, grant: Grant): void;
  revoke(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  retry(id: string): void;
  whenSettled(): Promise<void>;
  dispose(): Promise<void>;
}
