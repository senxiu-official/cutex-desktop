// r290 P14 yielded wait (continuationWait): what follows the status word. Pure, so tests and the views agree.
import type { ContinuationWait } from "../../../shared/ipc";
import { formatAt } from "./time";

export type ContinuationTrailing =
  | { key: "delegation.cont.inMinutes"; n: number }
  | { key: "delegation.cont.at"; time: string }
  | { key: "delegation.cont.soon" | "delegation.cont.children" | "delegation.cont.jobs" };

/**
 * A timed wait: "约 N 分钟后继续" within the hour, else the local clock "约 14:15 继续" ("11-19 14:15" on another day),
 * "即将继续" once due. Waits for its delegations / jobs say so. Nothing for ready / limited (the word says it) or a
 * timed wait without a time.
 */
export function continuationTrailing(cont: ContinuationWait, now: number): ContinuationTrailing | null {
  if (cont.state !== "waiting") return null;
  if (cont.kind === "children") return { key: "delegation.cont.children" };
  if (cont.kind === "jobs") return { key: "delegation.cont.jobs" };
  const at = cont.nextWakeAt ? Date.parse(cont.nextWakeAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const min = Math.ceil((at - now) / 60_000);
  if (min <= 0) return { key: "delegation.cont.soon" };
  if (min < 60) return { key: "delegation.cont.inMinutes", n: min };
  return { key: "delegation.cont.at", time: formatAt(at / 1000, now) };
}
