import type { DebugEntry } from "../../../shared/debug";
import { drainDebugReact, configureDebugReact } from "./debugReact";
/** Created only while enabled. Never retains DOM nodes, fibers or app state. */
export function observeDebug(win: Window, send: (entries: DebugEntry[]) => Promise<void>): { stop(): void; flush(): Promise<void>; reactReady: boolean } {
  const queue: DebugEntry[] = [], observers: PerformanceObserver[] = [];
  const push = (kind: string, data: unknown) => { queue.push({ time: Date.now(), kind, source: "renderer", data }); if (queue.length > 64) queue.shift(); };
  const main = win === window;
  const reactReady = main ? configureDebugReact(true) : false;
  const Observer = (win as Window & typeof globalThis).PerformanceObserver;
  for (const type of ["layout-shift", "long-animation-frame"]) try {
    const observer = new Observer(list => {
      for (const entry of list.getEntries()) {
        // LoAF is not yet in lib.dom in this toolchain. Its platform fields are optional.
        const e = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean; blockingDuration?: number; scripts?: { invoker: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition?: number; duration: number; forcedStyleAndLayoutDuration: number }[] };
        if (type === "layout-shift" && (e.value ?? 0) < 0.005) continue;
        push(type, { startTime: win.performance.timeOrigin + e.startTime, duration: e.duration, value: e.value, hadRecentInput: e.hadRecentInput, blockingDuration: e.blockingDuration, scripts: e.scripts?.slice(0, 16).map(s => ({ invoker: s.invoker, sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName, sourceCharPosition: s.sourceCharPosition, duration: s.duration, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })) });
      }
    });
    observer.observe({ type, buffered: false }); observers.push(observer);
  } catch { /* Unsupported entry types leave frame capture running. */ }
  const mutation = new (win as Window & typeof globalThis).MutationObserver(records => {
    let added = 0, removed = 0;
    const visibility: { attribute: string | null; previous: string | null; current: string | null }[] = [];
    const names = new Set<string>();
    for (const r of records.slice(0, 100)) {
      added += r.addedNodes.length; removed += r.removedNodes.length;
      if (r.type === "attributes") {
        const current = (r.target as Element).getAttribute(r.attributeName!);
        if (r.attributeName !== "hidden" && !/opacity|visibility|display|\bhidden\b|invisible/.test((r.oldValue ?? "") + current)) continue;
        if (visibility.length < 16) visibility.push({ attribute: r.attributeName, previous: r.oldValue?.slice(0, 500) ?? null, current: current?.slice(0, 500) ?? null });
      } else if (!r.addedNodes.length && !r.removedNodes.length) continue;
      let node = r.target as Element | null;
      for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
        const key = Object.keys(node).find(k => k.startsWith("__reactFiber$"));
        let fiber = key ? (node as unknown as Record<string, { type?: { name?: string; displayName?: string }; return?: unknown }>)[key] : undefined;
        for (let n = 0; fiber && n < 8; n++, fiber = fiber.return as typeof fiber) {
          const name = fiber.type?.displayName || fiber.type?.name;
          if (name) names.add(name);
        }
        if (key) break;
      }
    }
    if (visibility.length) push("visibility-change", { changes: visibility, components: [...names].slice(0, 16) });
    if (added || removed) push("dom-mutation", { added, removed, batch: records.length, components: [...names].slice(0, 16) });
  });
  mutation.observe(win.document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["style", "class", "hidden"] });
  const input = (e: Event) => push("input", { type: e.type });
  for (const name of ["wheel", "keydown", "pointerdown"]) win.document.addEventListener(name, input, { passive: true, capture: true });
  const flush = async () => { const entries = [...queue.splice(0), ...(main ? drainDebugReact() : [])].slice(-128); if (entries.length) await send(entries); };
  const timer = win.setInterval(flush, 1000);
  return { reactReady, flush, stop() { win.clearInterval(timer); mutation.disconnect(); for (const o of observers) o.disconnect(); for (const name of ["wheel", "keydown", "pointerdown"]) win.document.removeEventListener(name, input, true); if (main) configureDebugReact(false); queue.length = 0; } };
}
