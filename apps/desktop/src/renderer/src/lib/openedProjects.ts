// One-row projects (no agent online, 其他项目, 更早的项目) the owner opened in place with a click (design 060,
// owner 2026-11-05: no hover flyout). Kept for this run of the app only, by group key; the same click on the
// header folds it back to one row.
import { useSyncExternalStore } from "react";

let opened: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function toggleOpenedProject(key: string): void {
  const next = new Set(opened);
  if (!next.delete(key)) next.add(key);
  opened = next;
  for (const l of listeners) l();
}

export function useOpenedProject(key: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => opened.has(key),
  );
}
