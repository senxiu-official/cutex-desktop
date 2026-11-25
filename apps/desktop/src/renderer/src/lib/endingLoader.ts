// Background reads of a delegation's detail for its ending (cutex r295 terminal notices) on surfaces that show only a
// line — a collapsed card, a 接下来 status row. Opening a card or its detail still reads it at once (DelegationDetailBody);
// this loader only bounds the reads nobody asked for (audit 2026-11-25 P2-4):
// - at most MAX_PER_HOST at a time per host, the rest wait in order;
// - a failed read is not retried before its backoff (30 s, doubling to 10 min), also across remounts;
// - a host that never sent terminal fields is asked once (a probe). If that detail has none, no more background reads go
//   to it until a detail read for any reason shows them (an older host never does; a newer one's old records have none).
// The caller decides visibility (components/DelegationEnding useEndingRequest: IntersectionObserver).
import { create } from "zustand";
import type { AskDetail } from "../../../shared/ipc";
import { hasTerminalFacts } from "./delegationTerminal";
import { hostKey } from "./hostKeys";

export const MAX_PER_HOST = 2;
const FIRST_BACKOFF = 30_000;
const MAX_BACKOFF = 600_000;

/** Per host: unknown (never asked: the next request is the probe), probing, yes (sends them), no (probe had none). */
export type HostEndings = "probing" | "yes" | "no";
export const useEndingHosts = create<{ hosts: Record<string, HostEndings> }>(() => ({ hosts: {} }));
const setHost = (host: string, state: HostEndings | undefined) => useEndingHosts.setState((s) => {
  const hosts = { ...s.hosts };
  if (state) hosts[host] = state; else delete hosts[host];
  return { hosts };
});

/** A detail read for any reason: a host that sends terminal fields gets background reads (again). */
export function noteDetail(host: string, detail: AskDetail | null | undefined): void {
  if (hasTerminalFacts(detail) && useEndingHosts.getState().hosts[host] !== "yes") setHost(host, "yes");
}

type Load = (host: string, askId: string) => Promise<AskDetail | null>;
interface Job { key: string; host: string; askId: string; probe: boolean; load: Load; has: () => boolean }
const active = new Map<string, number>();
const queued = new Map<string, Job[]>();
const pending = new Set<string>();
const backoff = new Map<string, { until: number; delay: number }>();
let clock = () => Date.now();

/**
 * Ask for `askId`'s detail in the background. `has`: the store already holds a current detail (nothing to read). No-op
 * while in backoff, already queued / reading, or for a host whose probe found no terminal fields.
 */
export function requestEnding(host: string, askId: string, load: Load, has: () => boolean): void {
  const key = hostKey(host, askId);
  if (pending.has(key) || has()) return;
  const off = backoff.get(key);
  if (off && clock() < off.until) return;
  const state = useEndingHosts.getState().hosts[host];
  if (state === "no" || state === "probing") return;
  const probe = state === undefined;
  if (probe) setHost(host, "probing");
  pending.add(key);
  const list = queued.get(host) ?? [];
  list.push({ key, host, askId, probe, load, has });
  queued.set(host, list);
  pump(host);
}

function pump(host: string): void {
  const list = queued.get(host) ?? [];
  while ((active.get(host) ?? 0) < MAX_PER_HOST && list.length) {
    const job = list.shift()!;
    active.set(host, (active.get(host) ?? 0) + 1);
    void run(job).finally(() => {
      active.set(host, (active.get(host) ?? 1) - 1);
      pending.delete(job.key);
      pump(host);
    });
  }
}

async function run(job: Job): Promise<void> {
  let detail: AskDetail | null = null;
  try {
    detail = await job.load(job.host, job.askId);
  } catch {
    detail = null;
  }
  const failed = !detail && !job.has();
  if (failed) {
    const prev = backoff.get(job.key);
    const delay = prev ? Math.min(prev.delay * 2, MAX_BACKOFF) : FIRST_BACKOFF;
    backoff.set(job.key, { until: clock() + delay, delay });
  } else backoff.delete(job.key);
  if (hasTerminalFacts(detail)) setHost(job.host, "yes");
  else if (job.probe) setHost(job.host, failed ? undefined : "no");
}

/** Tests: a fresh loader with a fake clock. */
export function resetEndingLoader(now: () => number = () => Date.now()): void {
  active.clear(); queued.clear(); pending.clear(); backoff.clear();
  clock = now;
  useEndingHosts.setState({ hosts: {} });
}
