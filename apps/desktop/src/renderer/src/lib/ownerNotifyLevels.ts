// 主人通知 in one place (owner 2026-11-11): the 通知 page's 事件分级 card had a 主人通知 band with the four
// owner_notify levels, next to the 主人通知 card with the tool's settings. The notifications module hands the
// four level rows to the 主人通知 card (module owner-notify) through this context; while that card shows them,
// 事件分级 leaves its 主人通知 band out. Without the card (older host, module off) the band stays.
import { createContext, useContext, useEffect, type ReactNode } from "react";

export interface OwnerNotifyLevelsSlot {
  /** The owner_notify level rows (null: the host has no notification levels). */
  rows: ReactNode;
  /** The 主人通知 card shows the rows (true) or stopped (false). */
  onShown(shown: boolean): void;
}

export const OwnerNotifyLevelsContext = createContext<OwnerNotifyLevelsSlot | null>(null);

/** The level rows for the 主人通知 card; while `show` and rows exist, 事件分级 leaves its band out. */
export function useOwnerNotifyLevels(show: boolean): ReactNode {
  const slot = useContext(OwnerNotifyLevelsContext);
  const rows = show ? (slot?.rows ?? null) : null;
  const onShown = slot?.onShown;
  const shown = !!rows;
  useEffect(() => {
    if (!onShown || !shown) return;
    onShown(true);
    return () => onShown(false);
  }, [onShown, shown]);
  return rows;
}
