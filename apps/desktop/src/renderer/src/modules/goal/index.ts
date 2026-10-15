// 目标 (thread goal, /goal): its status category. Codex agents only (Claude: features.goals false).
import { Target } from "lucide-react";
import { defineModule } from "../slots";
import { GoalBody, GoalMeta, GoalStatusBar } from "./GoalStatus";
import { useGoalStatus } from "./useGoalStatus";

export default defineModule({
  id: "goal",
  titleKey: "goal.moduleTitle",
  descriptionKey: "goal.moduleDescription",
  contributes: {
    "conversation.status": [
      {
        id: "goal.status",
        order: 100,
        agentFeature: "goals",
        titleKey: "goal.statusTitle",
        defaultPlace: "bar",
        useStatus: useGoalStatus,
        Meta: GoalMeta,
        Body: GoalBody,
        Bar: GoalStatusBar,
        barSide: "start",
        icon: Target,
      },
    ],
  },
});
