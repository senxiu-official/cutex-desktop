// Status kinds of the status glyphs (StatusIcon) and the Services table, with their sort order
// (needs-you first).
import type { ServiceView } from "../../../shared/ipc";

export type StatusKind = "blocked" | "review" | "active" | "closed" | "error" | "starting" | "running" | "stopped";

const RANK: Record<StatusKind, number> = { blocked: 0, error: 0, review: 1, starting: 1, active: 2, running: 2, closed: 3, stopped: 3 };

export function statusRank(kind: StatusKind): number {
  return RANK[kind];
}

/** Crash-looping or unreachable is "error"; a stopped managed service is just stopped. */
export function serviceStatus(s: ServiceView): StatusKind {
  if (s.health === "reachable") return "running";
  if (s.health === "starting") return "starting";
  if (s.health === "unreachable" || (s.process?.restarts ?? 0) > 0) return "error";
  return "stopped";
}
