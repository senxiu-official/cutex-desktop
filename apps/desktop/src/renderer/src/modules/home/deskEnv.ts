// What every desktop widget gets from the surface (design 032 §4): the shared ticker (one timer per cadence for
// every widget — no widget runs its own, keeping the idle cost flat however many clocks are on the desktop), the
// colour scheme in effect and reduced motion. Timers start with the first subscriber and stop with the last.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

type Cadence = "minute" | "second";
const PERIOD: Record<Cadence, number> = { minute: 60_000, second: 1_000 };
const now: Record<Cadence, number> = { minute: Date.now(), second: Date.now() };
const subs: Record<Cadence, Set<() => void>> = { minute: new Set(), second: new Set() };
const timers: Partial<Record<Cadence, ReturnType<typeof setTimeout>>> = {};

function schedule(c: Cadence): void {
  // Aligned to the boundary (a clock turns over at :00, not some seconds later).
  const delay = PERIOD[c] - (Date.now() % PERIOD[c]) + 15;
  timers[c] = setTimeout(() => {
    now[c] = Date.now();
    for (const fn of [...subs[c]]) fn();
    schedule(c);
  }, delay);
}

function subscribe(c: Cadence, fn: () => void): () => void {
  // The first subscriber starts the timer; the snapshot is not touched here (a re-subscription must not change it).
  if (!subs[c].size) schedule(c);
  subs[c].add(fn);
  return () => {
    subs[c].delete(fn);
    if (!subs[c].size && timers[c]) {
      clearTimeout(timers[c]);
      delete timers[c];
    }
  };
}

/** The shared ticker's time for `cadence` (undefined: never ticks — the mount time). */
export function useTicker(cadence: Cadence | undefined): number {
  const [mounted] = useState(() => Date.now());
  const sub = useCallback((fn: () => void) => (cadence ? subscribe(cadence, fn) : () => {}), [cadence]);
  const value = useSyncExternalStore(
    sub,
    () => (cadence ? now[cadence] : mounted),
    () => (cadence ? now[cadence] : mounted),
  );
  // The time of a ticker that has not ticked yet is the module's start: never older than the mount.
  return Math.max(value, mounted);
}

/** How many timers run now (tests: one per cadence in use). */
export function tickerTimers(): number {
  return Object.keys(timers).length;
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener?.("change", fn);
    return () => m.removeEventListener?.("change", fn);
  }, [query]);
  return on;
}

/** The colour scheme in effect: <html data-theme> when forced, else the system's. */
export function useColorScheme(): "light" | "dark" {
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const [forced, setForced] = useState(() => (typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined));
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const mo = new MutationObserver(() => setForced(root.dataset.theme));
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return forced === "dark" || forced === "light" ? forced : systemDark ? "dark" : "light";
}

export function useReducedMotion(): boolean {
  return useMedia("(prefers-reduced-motion: reduce)");
}
