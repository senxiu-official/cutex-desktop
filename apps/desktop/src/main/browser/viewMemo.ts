// Service view cache, main side (owner 2026-11-18: switching agent A → B → A reloaded a service page and lost its place).
// The renderer keeps the most recent service pages mounted across conversations (modules/browser/viewCache.ts); when it
// lets one go it first asks main to remember where the page was (rememberView), and on that tab's next load to put it back
// (restoreView). Main reads and sets only the top-level scroll position, with fixed scripts in an isolated world (never
// page or agent code, no new admission); the address stays the tab's own (main's display URL, never a ticket).
import { freemem, totalmem } from "node:os";

/** Isolated world of the fixed view scripts (apart from pause-media 1006 and owner-navigation 1012). */
export const VIEW_WORLD = 1013;
const MAX_MEMOS = 32;
const MAX_SCROLL = 10_000_000;

export interface ViewMemo { display: string; x: number; y: number }

const clampScroll = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_SCROLL, Math.max(0, Math.round(v))) : 0);

/** The read script's answer as a position (null: not one). */
export function readScroll(answer: unknown): { x: number; y: number } | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const a = answer as { x?: unknown; y?: unknown };
  if (typeof a.x !== "number" || typeof a.y !== "number") return null;
  return { x: clampScroll(a.x), y: clampScroll(a.y) };
}

export const VIEW_READ_SCRIPT = "({ x: scrollX, y: scrollY })";

/** Scrolls to (x, y) once the document is tall enough (or after ~3 s); answers the position reached. */
export function viewRestoreScript(x: number, y: number): string {
  const tx = clampScroll(x), ty = clampScroll(y);
  return `(async () => { for (let i = 0; i < 15; i++) { const h = document.documentElement ? document.documentElement.scrollHeight : 0;
    if (h >= ${ty} + innerHeight / 2 || i === 14) { scrollTo(${tx}, ${ty}); return scrollY; } await new Promise((r) => setTimeout(r, 200)); } return scrollY; })()`;
}

/** Remembered positions per host + tab (bounded; the oldest goes first). In memory, this app run only. */
export class ViewMemos {
  private memos = new Map<string, ViewMemo>();
  private key(hostId: string, tabKey: string): string { return `${hostId}\u0000${tabKey}`; }
  set(hostId: string, tabKey: string, memo: ViewMemo): void {
    const key = this.key(hostId, tabKey);
    this.memos.delete(key);
    this.memos.set(key, memo);
    while (this.memos.size > MAX_MEMOS) this.memos.delete(this.memos.keys().next().value!);
  }
  /** The memo for this tab when it still shows the same address (taken: one restore per memo). */
  take(hostId: string, tabKey: string, display: string): ViewMemo | null {
    const key = this.key(hostId, tabKey), memo = this.memos.get(key);
    if (!memo) return null;
    this.memos.delete(key);
    return memo.display === display ? memo : null;
  }
  forget(hostId: string, tabKey?: string): void {
    for (const key of [...this.memos.keys()]) if (key === this.key(hostId, tabKey ?? "") || (tabKey === undefined && key.startsWith(`${hostId}\u0000`))) this.memos.delete(key);
  }
}

/** The machine is short of memory: free memory under 1 GiB or under 8% of all. */
export function memoryPressure(free = freemem(), total = totalmem()): boolean {
  return free < 1024 ** 3 || free < total * 0.08;
}
