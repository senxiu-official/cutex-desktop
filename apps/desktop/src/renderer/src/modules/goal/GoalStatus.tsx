// The 目标 status category (DESIGN §4.20). Capsule: header = time · budget ring · ⏸/▶ (✓ when
// done), a non-running state's word after the button so it never moves; body = the objective.
// Editing and clearing live in the status row (GoalBar), which is mounted whatever the placement.
import type { ThreadGoal } from "@cutex-desktop/protocol/codex/v2";
import { CircleCheck, Pause, Play } from "lucide-react";
import { GoalBar } from "../../components/GoalBar";
import { GoalMark } from "../../components/GoalMark";
import { Ring } from "../../components/Ring";
import { ProgressLine } from "../../components/ProgressLine";
import { CAPSULE_ROW_ICON } from "../../lib/capsuleRows";
import { useI18n, type MessageKey } from "../../i18n";
import { formatGoalSeconds, formatGoalTokens } from "../../lib/goalBudget";
import { goalTone } from "../../lib/goalStatus";
import { useSessionTimeline } from "../../lib/statusItemsView";
import { useApp } from "../../store";
import type { StatusBarProps } from "../slots";

const ICON_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground";

export function GoalBudgetRing({ goal }: { goal: ThreadGoal }) {
  const { t } = useI18n();
  if (!goal.tokenBudget) return null;
  return (
    <span className="flex shrink-0" title={t("goal.budgetRing", { used: formatGoalTokens(goal.tokensUsed), budget: formatGoalTokens(goal.tokenBudget) })}>
      <Ring ratio={goal.tokensUsed / goal.tokenBudget} size={13} />
    </span>
  );
}

export function GoalMeta({ data: goal }: { sessionId: string; data: ThreadGoal }) {
  const { t } = useI18n();
  const setGoal = useApp((s) => s.setGoal);
  const active = goal.status === "active";
  return (
    <>
      {/* The budget is the bar under the objective (GoalBody). */}
      <span>{formatGoalSeconds(goal.timeUsedSeconds)}</span>
      {active ? (
        <button className={ICON_BUTTON} title={t("goal.pause")} aria-label={t("goal.pause")} onClick={() => void setGoal({ status: "paused" })}>
          <Pause size={13} />
        </button>
      ) : goal.status === "complete" ? (
        <CircleCheck size={14} className="shrink-0 text-ok" aria-label={t("goal.status.complete")} />
      ) : (
        <button className={ICON_BUTTON} title={t("goal.resume")} aria-label={t("goal.resume")} onClick={() => void setGoal({ status: "active" })}>
          <Play size={13} />
        </button>
      )}
      {!active && goal.status !== "complete" && <span className={goalTone(goal.status)}>{t(`goal.status.${goal.status}` as MessageKey)}</span>}
    </>
  );
}

/** The objective (lib/capsuleRows row, up to two lines) with the token budget as a 2px bar under it. */
export function GoalBody({ data: goal }: { sessionId: string; data: ThreadGoal }) {
  const { t } = useI18n();
  const budget = goal.tokenBudget ? goal.tokensUsed / goal.tokenBudget : null;
  return (
    <div data-capsule-row="" className="min-w-0 px-2 py-1.5" title={goal.objective}>
      <div className="flex min-w-0 items-start gap-2">
        <span className={`${CAPSULE_ROW_ICON} h-5`}>
          <GoalMark status={goal.status} />
        </span>
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-5">{goal.objective}</p>
      </div>
      {budget !== null && (
        <div className="mt-1.5 pl-5.5" title={t("goal.budgetRing", { used: formatGoalTokens(goal.tokensUsed), budget: formatGoalTokens(goal.tokenBudget!) })}>
          <ProgressLine ratio={budget} tone={budget >= 1 ? "bg-danger" : "bg-accent"} />
        </div>
      )}
    </div>
  );
}

/** Status row: the goal line (when placed there) and the card for edit / replace requests. */
export function GoalStatusBar({ sessionId, inline, reveal }: StatusBarProps) {
  const goal = useSessionTimeline(sessionId)?.goal ?? null;
  return <GoalBar goal={goal} inline={inline} reveal={reveal} />;
}
