// 计划: the status category and its module-owned plan/checklist views. Core TimelineEntry kinds
// still reach those views through the thin PlanCard compatibility facade (v1 has no entry slot).
import { ListTodo } from "lucide-react";
import { defineModule } from "../slots";
import { PlanBody, PlanMeta, PlanStatusBar } from "./PlanStatus";
import { usePlanStatus } from "./usePlanStatus";

export default defineModule({
  id: "plan",
  titleKey: "plan.moduleTitle",
  descriptionKey: "plan.moduleDescription",
  contributes: {
    "conversation.status": [
      { id: "plan.status", order: 200, titleKey: "plan.statusTitle", defaultPlace: "capsule", useStatus: usePlanStatus, Meta: PlanMeta, Body: PlanBody, Bar: PlanStatusBar, icon: ListTodo },
    ],
  },
});
