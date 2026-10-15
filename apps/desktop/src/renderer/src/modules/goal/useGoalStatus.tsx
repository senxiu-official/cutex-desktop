// useStatus of the 目标 category: present while the thread has a goal.
import type { ThreadGoal } from "@cutex-desktop/protocol/codex/v2";
import { GoalMark } from "../../components/GoalMark";
import { useI18n, type MessageKey } from "../../i18n";
import { useSessionTimeline } from "../../lib/statusItemsView";
import type { StatusLine } from "../slots";
import { GoalBudgetRing } from "./GoalStatus";

export function useGoalStatus(sessionId: string): { data: ThreadGoal; line: StatusLine } | null {
  const { t } = useI18n();
  const goal = useSessionTimeline(sessionId)?.goal ?? null;
  if (!goal) return null;
  return {
    data: goal,
    line: {
      icon: <GoalMark status={goal.status} />,
      text: goal.objective,
      title: `${t(`goal.status.${goal.status}` as MessageKey)} · ${goal.objective}`,
      trailing: <GoalBudgetRing goal={goal} />,
    },
  };
}
