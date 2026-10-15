// Pure helpers for the conversation's status capsule (components/StatusCapsule): the model's own
// todo list (native `update_plan` → `turn/plan/updated` → TimelineState.plan) and its focus window.
//
// focusWindow / foldKind are adapted from ZCode (Apache-2.0), packages/ui/src/v4/
// ConversationStatusPanel.tsx (getStatusPanelTodoFocusWindow and the fold labels of
// TodoHiddenGroupPreview). Modified: standalone pure functions over our PlanStep, threshold and
// window size as parameters. Portions Copyright 2026 Z.AI Co., Ltd, licensed under the Apache License,
// Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0); see /NOTICE.
import type { PlanSnapshot, PlanStep, TimelineState } from "./timeline";
export { planSignature } from "./planState";

export type { PlanSnapshot, PlanStep };

/** The thread's kept `update_plan` snapshot (lib/planState: the last non-empty one, possibly
 *  `cleared`), or null when there is none or the owner dismissed it. */
export function latestPlan(state: TimelineState | null): PlanSnapshot | null {
  const plan = state?.plan ?? null;
  return plan && plan.steps.length > 0 && !plan.dismissed ? plan : null;
}

export function planProgress(steps: readonly PlanStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === "completed").length, total: steps.length };
}


export interface FocusWindow {
  /** False for short lists: everything is shown, nothing folded. */
  compact: boolean;
  before: PlanStep[];
  focus: PlanStep[];
  after: PlanStep[];
}

/**
 * Which steps to show, in the model's order. Lists up to `threshold` steps are shown whole. Longer
 * ones show `size` steps starting at the in-progress step (else the first unfinished one, else the
 * last `size`), pulled back from the end so the window stays full; the rest fold into "before" /
 * "after".
 */
export function focusWindow(steps: readonly PlanStep[], threshold = 6, size = 3): FocusWindow {
  if (steps.length <= threshold) return { compact: false, before: [], focus: [...steps], after: [] };
  const running = steps.findIndex((s) => s.status === "inProgress");
  const unfinished = steps.findIndex((s) => s.status !== "completed");
  const anchor = running >= 0 ? running : unfinished >= 0 ? unfinished : steps.length - size;
  const start = Math.max(0, Math.min(anchor, steps.length - size));
  const end = Math.min(steps.length, start + size);
  return { compact: true, before: steps.slice(0, start), focus: steps.slice(start, end), after: steps.slice(end) };
}

/** Label kind for a folded group: all completed / all pending, or mixed (earlier / later). */
export function foldKind(group: "before" | "after", steps: readonly PlanStep[]): "completed" | "earlier" | "pending" | "later" {
  if (group === "before") return steps.every((s) => s.status === "completed") ? "completed" : "earlier";
  return steps.every((s) => s.status === "pending") ? "pending" : "later";
}
