// Goal status → colour, shared by every place that shows a goal (status row, capsule).
import type { ThreadGoalStatus } from "@cutex-desktop/protocol/codex/v2";

/** Running = accent, done = green, paused = amber, stopped by a limit / blocker = red. */
export function goalTone(status: ThreadGoalStatus): string {
  return status === "active" ? "text-accent" : status === "complete" ? "text-ok-text" : status === "paused" ? "text-warn" : "text-danger";
}
