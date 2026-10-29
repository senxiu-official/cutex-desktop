// 正在运行的智能体 (guide §7 no. 2): a desktop widget kind listing the agents with a turn in progress. Several
// instances allowed (e.g. one per host scope); not on a fresh desktop (the owner adds it).
import { Activity } from "lucide-react";
import { defineModule } from "../slots";
import { RunningAgentsWidget } from "./RunningAgents";

export const RUNNING_AGENTS = "running-agents.list";

export default defineModule({
  id: "running-agents",
  titleKey: "running-agents.title",
  descriptionKey: "running-agents.description",
  contributes: {
    "desktop.widget": [
      {
        id: RUNNING_AGENTS,
        titleKey: "running-agents.widget",
        descriptionKey: "running-agents.widgetHint",
        icon: Activity,
        // Grid steps (8 px): 288 × 224 by default — the side column's width, about four rows.
        size: { min: [24, 12], max: [60, 60], default: [36, 28], units: { min: [4, 2], max: [10, 10], default: [6, 4] } },
        shape: "card",
        multiple: true,
        settings: [
          { key: "maxRows", type: "number", labelKey: "running-agents.maxRows", min: 1, max: 10, step: 1 },
          {
            key: "scope",
            type: "select",
            labelKey: "running-agents.scope",
            options: [
              { value: "all", labelKey: "running-agents.scopeAll" },
              { value: "focus", labelKey: "running-agents.scopeFocus" },
            ],
          },
        ],
        defaults: { maxRows: 5, scope: "all" },
        // The duration column ("4m", "1h05") moves with the clock, not only when a row changes.
        refresh: "minute",
        Widget: RunningAgentsWidget,
      },
    ],
  },
});
