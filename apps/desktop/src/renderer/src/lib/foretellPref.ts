// 动作预告 on / off (design 006 v1 Q3, owner 2026-10-22: a switch, default on; Settings → 外观 → 窗口与卡片). Per
// machine. Off: lib/foretell shows no preview of a click (the clicks act as before). The Settings Shelf's
// 「影响这里」 outlines (lib/settingsAffects) are not a click's preview and stay.
import { useSyncExternalStore } from "react";

const KEY = "cutex-desktop.foretell";

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let on = read();
const listeners = new Set<() => void>();

/** Whether a click's preview shows (default on). */
export function foretellOn(): boolean {
  return on;
}

export function setForetellOn(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    if (next) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, "off");
  } catch {
    // storage unavailable: this session only
  }
  for (const l of [...listeners]) l();
}

export function useForetellOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => on,
  );
}
