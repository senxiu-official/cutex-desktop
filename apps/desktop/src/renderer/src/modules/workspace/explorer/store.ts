// What the 文件 explorer remembers on this machine (docs/design/019-file-explorer.md §2, rule 2): the options
// shared by every root, and per host + root the current folder, the open folders, the selection, 隐藏文件
// and the folders whose list / gallery view the owner chose. localStorage, not the instance state: the
// open folders alone can pass the 4 KiB a side instance may store (§18.11).
import { create } from "zustand";
import { DEFAULT_OPTIONS, EMPTY_VIEW, parseOptions, parseRootView, trimRoots, type ExplorerOptions, type RootView } from "./model";

export const EXPLORER_STORAGE_KEY = "cutex-desktop.explorer";

interface ExplorerStore {
  options: ExplorerOptions;
  roots: Record<string, RootView>;
}

/** Stored state as read back (malformed parts dropped). Pure. */
export function parseExplorerStore(raw: unknown): ExplorerStore {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const roots: Record<string, RootView> = {};
  if (v.roots && typeof v.roots === "object" && !Array.isArray(v.roots))
    for (const [key, view] of Object.entries(v.roots as Record<string, unknown>)) if (key.includes("|")) roots[key] = parseRootView(view);
  return { options: parseOptions(v.options), roots: trimRoots(roots) };
}

function load(): ExplorerStore {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(EXPLORER_STORAGE_KEY);
    return parseExplorerStore(raw ? JSON.parse(raw) : null);
  } catch {
    return { options: { ...DEFAULT_OPTIONS }, roots: {} };
  }
}

export const useExplorerStore = create<ExplorerStore>(() => load());

let timer: ReturnType<typeof setTimeout> | null = null;
function saveSoon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      localStorage.setItem(EXPLORER_STORAGE_KEY, JSON.stringify(useExplorerStore.getState()));
    } catch {
      /* storage full / unavailable: this session only */
    }
  }, 300);
}

export function setExplorerOptions(patch: Partial<ExplorerOptions>): void {
  useExplorerStore.setState((s) => ({ options: parseOptions({ ...s.options, ...patch }) }));
  saveSoon();
}

export function rootView(key: string): RootView {
  return useExplorerStore.getState().roots[key] ?? EMPTY_VIEW;
}

export function patchRootView(key: string, patch: Partial<RootView> | ((view: RootView) => Partial<RootView>)): void {
  useExplorerStore.setState((s) => {
    const prev = s.roots[key] ?? EMPTY_VIEW;
    const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch), at: Date.now() };
    return { roots: trimRoots({ ...s.roots, [key]: next }) };
  });
  saveSoon();
}

/** Tests: read the stored state again / drop it. */
export function reloadExplorerStore(): void {
  useExplorerStore.setState(load(), true);
}
