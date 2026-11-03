// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
// 隐藏 / 清除 (owner 2026-10-24): rows the owner no longer wants to see in the 接下来 / 委托 panels — a finished delegation,
// a note that lingers although the agent ran turns since. Only this desktop forgets them (localStorage); cutex keeps
// everything, the 委托 page still lists them. One batch can be undone. Never used for something still pending.
import { create } from "zustand";

const KEY = "cutex-desktop.hiddenRows";
const MAX = 500;

export type HiddenKind = "ask" | "note";
export const hiddenKey = (kind: HiddenKind, host: string, id: string): string => `${kind}:${host}/${id}`;

function load(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string").slice(-MAX) : [];
  } catch {
    return [];
  }
}

function save(keys: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys.slice(-MAX)));
  } catch {
    /* storage full: this run only */
  }
}

interface HiddenState {
  keys: string[];
  /** The last hide, for 撤销 (null once undone or replaced). */
  last: { keys: string[]; scope: string } | null;
  hide(keys: readonly string[], scope: string): void;
  undo(): void;
  clearLast(): void;
}

export const useHiddenRows = create<HiddenState>((set, get) => ({
  keys: typeof localStorage === "undefined" ? [] : load(),
  last: null,
  hide(add, scope) {
    const fresh = add.filter((k) => !get().keys.includes(k));
    if (!fresh.length) return;
    const keys = [...get().keys, ...fresh].slice(-MAX);
    save(keys);
    set({ keys, last: { keys: fresh, scope } });
  },
  undo() {
    const last = get().last;
    if (!last) return;
    const keys = get().keys.filter((k) => !last.keys.includes(k));
    save(keys);
    set({ keys, last: null });
  },
  clearLast: () => set({ last: null }),
}));

/** `rows` without the hidden ones. */
export function visibleRows<T>(rows: readonly T[], keyOf: (row: T) => string, hidden: readonly string[]): T[] {
  if (!hidden.length) return [...rows];
  const set = new Set(hidden);
  return rows.filter((r) => !set.has(keyOf(r)));
}

export function resetHiddenRowsForTest(): void {
  useHiddenRows.setState({ keys: [], last: null });
}
