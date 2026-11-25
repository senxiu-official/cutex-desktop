// cutex r296 Job list extras (docs/development/r296-desktop-jobs-spec.md), read tolerantly in main.
import type { JobListPage } from "./ipc";

/**
 * The Job Service's own running / queued grouping (cutex r296 `activeCounts`, components/job-service service.rs
 * `active_group`): running = `launchPending`, `launch_pending` / `running`, or a local process still alive (even
 * after a terminal state, e.g. 结束跟进); queued = `registered` / `queued` / `stale`; anything else is neither.
 * The 作业 tabs and the totals both follow it.
 */
export function jobActiveGroup(j: { state?: unknown; launchPending?: unknown; processAlive?: unknown }): "running" | "queued" | null {
  if (j.launchPending === true || j.state === "launch_pending" || j.state === "running" || j.processAlive === true) return "running";
  if (j.state === "registered" || j.state === "queued" || j.state === "stale") return "queued";
  return null;
}

/** r296 job-list extras, read tolerantly (a field of the wrong shape is dropped, never guessed). */
export function jobListExtras(v: { activeCounts?: unknown; waitersAvailable?: unknown; retention?: unknown } | null | undefined): Pick<JobListPage, "activeCounts" | "waitersAvailable" | "retention"> {
  const out: Pick<JobListPage, "activeCounts" | "waitersAvailable" | "retention"> = {};
  const n = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null);
  const c = v?.activeCounts as { running?: unknown; queued?: unknown } | null | undefined;
  if (c && n(c.running) !== null && n(c.queued) !== null) out.activeCounts = { running: n(c.running)!, queued: n(c.queued)! };
  if (typeof v?.waitersAvailable === "boolean") out.waitersAvailable = v.waitersAvailable;
  const r = v?.retention as { records?: unknown; limit?: unknown } | null | undefined;
  if (r && n(r.records) !== null && n(r.limit) !== null) out.retention = { records: n(r.records)!, limit: n(r.limit)! };
  return out;
}
