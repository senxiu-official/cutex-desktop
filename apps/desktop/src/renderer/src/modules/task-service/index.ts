// Task Service (cutex task-service, the pre-asks delegation store; removed in cutex r219): only the
// rows of old transcripts — received task deliveries and the agent's own cutex_task_service* tool
// calls. Ungated: old transcripts stay readable on any host. No pages (the task list and task
// detail page went with the service).
import { isTaskServiceTool } from "../../lib/taskRows";
import { TaskCallRow, TaskReceivedRow } from "./TimelineRows";
import { defineModule } from "../slots";

export default defineModule({
  id: "task-service",
  titleKey: "task-service.title",
  descriptionKey: "task-service.description",
  contributes: {
    "timeline.received": [{ id: "task-service.received", order: 100, schemas: ["cutex.task-assignment.v1", "cutex.task-followup.v1"], Row: TaskReceivedRow }],
    "timeline.tool": [{ id: "task-service.tool", order: 200, match: isTaskServiceTool, Row: TaskCallRow }],
  },
});
