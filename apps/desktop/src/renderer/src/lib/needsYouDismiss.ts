// 「需要你」 strip: the owner's × on a needs-you chip. Dismissing can't resolve the need (an approval,
// an owner message, a delegation), so it only hides the chip until the need changes: the dismissal
// remembers a fingerprint of the need (reasons, count, delegation / notification ids) and a new or
// different need shows the chip again. Device-local (localStorage, best effort); sidebar badges keep
// showing the real state. Done / failed chips are dismissed by marking the turn seen (lib/turnUnread).
// An 出错 chip of a runtime error (cutex runtime.status "error", owner 2026-10-26: members stopped normally
// kept a red 出错 that could not be closed) is remembered by member + runtimeGeneration + that lastError:
// the same error stays hidden, a later one (or a failed turn) shows the chip again.
// No age limit while the agent is anywhere (state surfaces L1, owner decision D5, 2026-11-17: a dismissed chip came
// back after 7 days with nothing changed): the 7-day age clause only collects dismissals of agents that are in no
// host snapshot any more (archived away, deleted, host removed).
import { useSyncExternalStore } from "react";
import type { SessionRuntime } from "@cutex-desktop/protocol";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { hostKey, parseHostKey } from "./hostKeys";
import { onAttentionReady } from "./hostAttention";
import type { AttentionChip, NeedsYou } from "./agentAttention";
import type { AgentRow } from "./sidebar";

export interface Dismissal {
  /** The need's fingerprint when it was dismissed. */
  fp: string;
  /** When it was dismissed (ms). */
  at: number;
}

/** By host key (`hostKey(host, agentId)`). */
export type Dismissals = Readonly<Record<string, Dismissal>>;

/** Dismissals older than this go once their agent is in no host snapshot (garbage collection; never for an agent still listed). */
export const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000;

/** What the needs-you chip stands for; any change (new approval, message, delegation…) changes it. */
export function needFingerprint(need: NeedsYou | undefined): string {
  if (!need) return "needsInput"; // the runtime waits for input, nothing more specific known
  return JSON.stringify([[...need.reasons].sort(), need.count, need.askIds, need.notificationIds ?? []]);
}

/** Which runtime error the member shows (its runtime generation and lastError); null when its runtime is not in error. */
export function runtimeErrorFingerprint(runtime: Pick<SessionRuntime, "status" | "runtimeGeneration" | "lastError"> | undefined): string | null {
  if (runtime?.status !== "error") return null;
  return JSON.stringify([runtime.runtimeGeneration, runtime.lastError ?? null]);
}

/** The dismissal key of a member's runtime error (beside its needs-you one). */
export const errorKey = (key: string): string => `error|${key}`;

/**
 * Whether a chip is hidden by a dismissal: a needs-you chip whose need is unchanged; an 出错 chip whose runtime
 * error (`runtimeError`, runtimeErrorFingerprint) is the dismissed one and no failed turn waits unseen
 * (`failedTurn`). Done chips never are: they go when seen.
 */
export function isDismissed(dismissals: Dismissals, key: string, chip: Pick<AttentionChip, "signal">, need: NeedsYou | undefined, runtimeError: string | null = null, failedTurn = false): boolean {
  if (chip.signal === "needsYou") return dismissals[key]?.fp === needFingerprint(need);
  return chip.signal === "error" && !!runtimeError && !failedTurn && dismissals[errorKey(key)]?.fp === runtimeError;
}

/**
 * The one rule for every place that lists 需要你 chips (the strip above the composer, sidebar layout B's 「现在」
 * cards): what was closed in one is gone in the other too. `key`: the host key; `row`: the agent's row (its
 * runtime error); `failedTurn`: a failed turn of it waits unseen.
 */
export function chipDismissed(dismissals: Dismissals, key: string, chip: Pick<AttentionChip, "signal">, need: NeedsYou | undefined, row: Pick<AgentRow, "session"> | undefined, failedTurn: boolean): boolean {
  return isDismissed(dismissals, key, chip, need, runtimeErrorFingerprint(row?.session.runtime), failedTurn);
}

/**
 * Which agents the hosts know: `keys` = host keys of every agent in a host's snapshot (active and archived);
 * `unsure` = hosts whose list can't say an agent is gone (configured but not read, partial, cached, loading).
 */
export interface KnownAgents {
  keys: ReadonlySet<string>;
  unsure: ReadonlySet<string>;
}

/** KnownAgents of the configured hosts (`hostIds`) from their sidebar snapshots (null: not read). */
export function knownAgents(hostIds: readonly string[], snapshotOf: (hostId: string) => SidebarSnapshot | null | undefined): KnownAgents {
  const keys = new Set<string>();
  const unsure = new Set<string>();
  for (const hostId of hostIds) {
    const snap = snapshotOf(hostId);
    if (!snap || snap.partial || snap.cached || snap.loading) unsure.add(hostId);
    for (const s of [...(snap?.active ?? []), ...(snap?.retired ?? [])]) keys.add(hostKey(hostId, s.cutexSessionId));
  }
  return { keys, unsure };
}

/** Whether the dismissal of `key` (a host key, or a legacy bare id) belongs to an agent no host lists any more. */
function agentGone(key: string, known: KnownAgents | undefined): boolean {
  if (!known || known.keys.has(key)) return false;
  const host = parseHostKey(key)?.[0];
  return !host || !known.unsure.has(host);
}

/**
 * Drop stale dismissals: those of agents in view (`current`: host key → the need's fingerprint of
 * every needs-you chip, and errorKey(host key) → the runtime error's; `inView`: host keys of all rows in
 * view) whose need or error is gone or changed, and those older than the TTL whose agent is in no host
 * snapshot (`known`; without it nothing goes by age). The same object when nothing goes.
 */
export function pruneDismissals(dismissals: Dismissals, current: ReadonlyMap<string, string>, inView: ReadonlySet<string>, now: number, known?: KnownAgents): Dismissals {
  const rowOf = (key: string) => (key.startsWith("error|") ? key.slice(6) : key);
  const stale = Object.entries(dismissals).filter(([key, d]) => {
    const row = rowOf(key);
    if (inView.has(row)) return current.get(key) !== d.fp;
    return now - d.at > DISMISS_TTL_MS && agentGone(row, known);
  });
  if (stale.length === 0) return dismissals;
  const next = { ...dismissals };
  for (const [key] of stale) delete next[key];
  return next;
}

// ---------- persisted store ----------

const KEY = "cutex-desktop.needsYouDismissed";
const listeners = new Set<() => void>();
let current: Dismissals = load();

function load(): Dismissals {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<Dismissal>>;
    const out: Record<string, Dismissal> = {};
    for (const [key, d] of Object.entries(raw)) if (d && typeof d.fp === "string" && typeof d.at === "number") out[key] = { fp: d.fp, at: d.at };
    return out;
  } catch {
    return {};
  }
}

function save(next: Dismissals): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // not persisted
  }
  for (const l of listeners) l();
}

// Design 061: a host with cross-device read state keeps the person's dismissals; this device's of it go (the one-time
// clean start — the host begins with nothing dismissed and everything before it read).
onAttentionReady((hostId) => {
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => parseHostKey(key.startsWith("error|") ? key.slice(6) : key)?.[0] !== hostId));
  if (Object.keys(next).length !== Object.keys(current).length) save(next);
});

export function getDismissals(): Dismissals {
  return current;
}

/** Hide the needs-you chip of `key` (host key) until its need changes. */
export function dismissNeed(key: string, need: NeedsYou | undefined, now = Date.now()): void {
  save({ ...current, [key]: { fp: needFingerprint(need), at: now } });
}

/** Hide the 出错 chip of `key` (host key) while its runtime error (runtimeErrorFingerprint) stays the same. */
export function dismissRuntimeError(key: string, fingerprint: string, now = Date.now()): void {
  save({ ...current, [errorKey(key)]: { fp: fingerprint, at: now } });
}

// The store is loaded lazily: this module is imported by node-side tests that have no window (the store's bridge needs one).
let store: typeof import("../store") | null = null;

/** The agents every configured host lists now (the focus host's own fields, the others' slices). */
function knownAgentsNow(app: typeof import("../store")): KnownAgents {
  const s = app.useApp.getState();
  const focus = s.hosts?.active ?? LOCAL_HOST_ID;
  const ids = s.hosts?.hosts.map((h) => h.id) ?? [focus];
  return knownAgents(ids.includes(focus) ? ids : [...ids, focus], (id) => (id === focus ? s.sidebar : s.byHost[id]?.sidebar));
}

export function pruneStoredDismissals(currentNeeds: ReadonlyMap<string, string>, inView: ReadonlySet<string>, now = Date.now()): void {
  if (store) return save(pruneDismissals(current, currentNeeds, inView, now, knownAgentsNow(store)));
  save(pruneDismissals(current, currentNeeds, inView, now)); // nothing goes by age until the hosts' lists are at hand
  void import("../store").then((app) => {
    store = app;
    save(pruneDismissals(current, currentNeeds, inView, now, knownAgentsNow(app)));
  });
}

export function useDismissals(): Dismissals {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
