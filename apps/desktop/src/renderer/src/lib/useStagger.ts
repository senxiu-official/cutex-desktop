// Icons of long, non-virtualized lists mount in steps (EntityIcon cost, .claude/reports/entity-icons-perf-20261124.md):
// the first rows with the list, the rest a chunk per frame on the owner window's frame clock, so opening a list of
// hundreds of agents and the frames after it stay within budget.
import { useEffect, useState } from "react";
import { useOwnerWindow } from "./ownerContext";

/** Rows whose icon mounts with the list. */
export const EAGER_ICONS = 40;
/** Rows added per frame after that. */
export const ICON_CHUNK = 60;

/** How many of `total` rows show their icon now (all of them within a few frames); `enabled` false = stays at the first rows. */
export function useStaggeredCount(total: number, enabled = true): number {
  const win = useOwnerWindow();
  const [count, setCount] = useState(EAGER_ICONS);
  useEffect(() => {
    if (!enabled || count >= total || !win) return;
    const frame = win.requestAnimationFrame(() => setCount((n) => n + ICON_CHUNK));
    return () => win.cancelAnimationFrame(frame);
  }, [win, enabled, count, total]);
  return count;
}
