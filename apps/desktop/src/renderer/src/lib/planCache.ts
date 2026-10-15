// The kept 进程 snapshot per agent (lib/planState), per host, in localStorage: thread/read has no plan
// (cutex gap, see PROGRESS.md 2026-10-07), so this is what puts the status capsule's 进程 back after a
// re-bootstrap, a disconnect or a desktop restart. Small: the newest PLAN_CACHE_MAX agents (LRU).
// `fresh` marks the agents whose snapshot was updated live on the current connection (nothing
// missed since); a disconnect / host switch forgets it.
import type { PlanSnapshot, PlanStep } from "./timeline";

export const PLAN_CACHE_MAX = 200;
const KEY = "cutex-desktop.planCache";

/** Recency-ordered entries (oldest first; Map insertion order). Key = `${host}\n${agent}`. */
export type PlanEntries = Map<string, PlanSnapshot>;

export const planKey = (host: string, agent: string) => `${host}\n${agent}`;

/** `entries` with `key` set (moved to the newest end) or removed (`plan` null), capped at `max`. */
export function cachePut(entries: PlanEntries, key: string, plan: PlanSnapshot | null, max = PLAN_CACHE_MAX): PlanEntries {
  const next = new Map(entries);
  next.delete(key);
  if (plan) next.set(key, plan);
  while (next.size > max) next.delete(next.keys().next().value as string);
  return next;
}

const isStep = (s: unknown): s is PlanStep =>
  !!s && typeof (s as PlanStep).step === "string" && typeof (s as PlanStep).status === "string";

/** Stored JSON (`[[key, plan], …]`, oldest first) → entries; anything malformed is skipped. */
export function parseCache(raw: unknown, max = PLAN_CACHE_MAX): PlanEntries {
  const out: PlanEntries = new Map();
  if (!Array.isArray(raw)) return out;
  for (const item of raw.slice(-max)) {
    if (!Array.isArray(item) || typeof item[0] !== "string") continue;
    const p = item[1] as Partial<PlanSnapshot> | null;
    if (!p || typeof p.turnId !== "string" || !Array.isArray(p.steps) || !p.steps.every(isStep) || p.steps.length === 0) continue;
    out.set(item[0], {
      threadId: typeof p.threadId === "string" ? p.threadId : null,
      turnId: p.turnId,
      explanation: typeof p.explanation === "string" ? p.explanation : null,
      steps: p.steps.map((s) => ({ step: s.step, status: s.status })),
      ...(p.cleared ? { cleared: true } : {}),
      ...(p.dismissed ? { dismissed: true } : {}),
    });
  }
  return out;
}

// ---------- persisted store ----------

let entries: PlanEntries | null = null;
const fresh = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function current(): PlanEntries {
  if (!entries) {
    try {
      entries = parseCache(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    } catch {
      entries = new Map();
    }
  }
  return entries;
}

function flush(): void {
  flushTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify([...current()]));
  } catch {
    // not persisted
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 500);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flush();
    }
  });
}

export function getCachedPlan(host: string, agent: string): PlanSnapshot | null {
  return current().get(planKey(host, agent)) ?? null;
}

export function isPlanFresh(host: string, agent: string): boolean {
  return fresh.has(planKey(host, agent));
}

/** Keep `plan` for the agent (null forgets it); `live` = seen on the host feed just now. */
export function setCachedPlan(host: string, agent: string, plan: PlanSnapshot | null, live = false): void {
  const key = planKey(host, agent);
  if (live) fresh.add(key);
  const before = current().get(key);
  if (before === plan && plan) return;
  if (!before && !plan) return;
  entries = cachePut(current(), key, plan);
  scheduleFlush();
}

/** The host feed restarted (disconnect, reconnect): updates in the gap are unknown. Without a host: every host. */
export function forgetFreshPlans(host?: string): void {
  if (host === undefined) return fresh.clear();
  const prefix = planKey(host, "");
  for (const key of fresh) if (key.startsWith(prefix)) fresh.delete(key);
}
