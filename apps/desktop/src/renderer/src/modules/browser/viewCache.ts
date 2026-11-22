// Service view cache (owner 2026-11-18: switching agent A → B → A reloaded the service page and lost its place; study
// r290-p10 af-a2eb363e…). A service tab holds itself mounted (an uncapped hold beside the lease / media ones, media.ts)
// while it is one of the VIEW_CACHE_PAGES most recently seen service pages: its card can leave the screen — another page,
// another conversation's Shelf — and come back without a reload. A hidden page is let go VIEW_CACHE_IDLE_MS after it was
// last seen, when the cached pages' private memory passes VIEW_CACHE_BUDGET_MB (the oldest first), when the machine is
// short of memory, and when its service was stopped by the owner or unregistered. Before letting go the card asks main to
// remember the page's place (rememberView); the page loads again at its own address and main puts the place back
// (restoreView). The same guest, partition and admission as before: only how long a hidden card stays mounted changes.

export const VIEW_CACHE_PAGES = 4;
export const VIEW_CACHE_IDLE_MS = 30 * 60_000;
export const VIEW_CACHE_BUDGET_MB = 256;
export const VIEW_CACHE_TICK_MS = 60_000;

export interface ViewCacheEntry {
  key: string;
  /** On screen now (always kept; does not take a cache place). */
  visible: boolean;
  /** When it was last on screen (ms). */
  lastSeen: number;
  /** Its service is stopped by the owner or unregistered. */
  gone: boolean;
  /** Its page process (pid: a process shared by several pages counts once) and private memory, when known. */
  memory?: { pid: number | null; privateMB: number | null };
}

export interface ViewCachePlanOptions { pages: number; idleMs: number; budgetMB: number; pressure: boolean }

/** Which entries are held (pure): the visible ones, then the most recently seen hidden ones within the rules above. */
export function viewCachePlan(entries: readonly ViewCacheEntry[], now: number, opts: ViewCachePlanOptions): Set<string> {
  const held = new Set(entries.filter((e) => e.visible).map((e) => e.key));
  if (opts.pressure) return held;
  const hidden = entries.filter((e) => !e.visible && !e.gone && now - e.lastSeen <= opts.idleMs).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, opts.pages);
  const counted = new Set<number>();
  let total = 0;
  for (const e of hidden) {
    const mb = e.memory?.privateMB ?? 0, pid = e.memory?.pid ?? null;
    const add = pid !== null && counted.has(pid) ? 0 : mb;
    if (total + add > opts.budgetMB) break; // this one and every older one go
    total += add;
    if (pid !== null) counted.add(pid);
    held.add(e.key);
  }
  return held;
}

interface Registered {
  entry: ViewCacheEntry;
  held: boolean;
  /** Hold (true) or let go (false; the card remembers its place first). */
  apply(hold: boolean): void;
  /** This page's process memory and the machine's state (main's viewMemory); null: unknown. */
  measure(): Promise<{ pid: number | null; privateMB: number | null; pressure: boolean } | null>;
}

const registered = new Map<string, Registered>();
let pressure = false;
let timer: ReturnType<typeof setInterval> | undefined;
let now = () => Date.now();

function rebalance(): void {
  const plan = viewCachePlan([...registered.values()].map((r) => r.entry), now(), { pages: VIEW_CACHE_PAGES, idleMs: VIEW_CACHE_IDLE_MS, budgetMB: VIEW_CACHE_BUDGET_MB, pressure });
  for (const r of registered.values()) {
    const want = plan.has(r.entry.key);
    if (want !== r.held) { r.held = want; r.apply(want); }
  }
}

async function tick(): Promise<void> {
  const hidden = [...registered.values()].filter((r) => r.held && !r.entry.visible);
  let short = false;
  for (const r of hidden) {
    const m = await r.measure().catch(() => null);
    if (!m) continue;
    r.entry.memory = { pid: m.pid, privateMB: m.privateMB };
    short ||= m.pressure;
  }
  pressure = short;
  rebalance();
}

function ensureTimer(): void {
  if (registered.size && !timer) timer = setInterval(() => void tick(), VIEW_CACHE_TICK_MS);
  if (!registered.size && timer) { clearInterval(timer); timer = undefined; }
}

/** A service card's place in the cache. `apply` and `measure` are the card's own (BrowserBody). */
export function registerViewCache(key: string, apply: (hold: boolean) => void, measure: Registered["measure"]) {
  const r: Registered = { entry: { key, visible: false, lastSeen: now(), gone: false }, held: false, apply, measure };
  registered.get(key)?.apply(false);
  registered.set(key, r);
  ensureTimer();
  return {
    update(state: { visible: boolean; gone: boolean }): void {
      if (registered.get(key) !== r) return;
      if (state.visible || r.entry.visible) r.entry.lastSeen = now();
      r.entry.visible = state.visible;
      r.entry.gone = state.gone;
      rebalance();
    },
    dispose(): void {
      if (registered.get(key) !== r) return;
      registered.delete(key);
      ensureTimer();
      rebalance();
    },
  };
}

/** Tests only. */
export const viewCacheTesting = {
  reset(): void { registered.clear(); pressure = false; if (timer) clearInterval(timer); timer = undefined; now = () => Date.now(); },
  setNow(fn: () => number): void { now = fn; },
  tick,
  held: (): string[] => [...registered.values()].filter((r) => r.held).map((r) => r.entry.key).sort(),
};
