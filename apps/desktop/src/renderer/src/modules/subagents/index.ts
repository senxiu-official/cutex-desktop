// 子 agent (collab sub-agents at work): its status category, and a sub-agent's thread as a right-side card.
import { Bot } from "lucide-react";
import { CollabRow } from "./CollabRow";
import { defineModule } from "../slots";
import { SubagentsBody, SubagentsMeta, SubagentsStatusBar } from "./SubagentsStatus";
import { SubagentThreadBody } from "./SubagentThread";
import { parseThreadParams, restoreThread, useThreadTab } from "./threadState";
import { useSubagentsStatus } from "./useSubagentsStatus";

export default defineModule({
  id: "subagents",
  titleKey: "subagents.title",
  descriptionKey: "subagents.description",
  contributes: {
    "timeline.tool": [{ id: "subagents.tool", order: 300, match: (item) => item.type === "collabAgentToolCall", Row: CollabRow, activity: () => "turn.activity.subagent" }],
    "conversation.status": [
      { id: "subagents.status", order: 400, titleKey: "subagents.statusTitle", defaultPlace: "capsule", useStatus: useSubagentsStatus, Meta: SubagentsMeta, Body: SubagentsBody, Bar: SubagentsStatusBar, icon: Bot },
    ],
    "side.component": [
      {
        id: "subagents.thread",
        titleKey: "subagents.thread",
        icon: Bot,
        instances: "multi",
        defaultBinding: "agent",
        placement: { home: "workspace", order: 450 },
        parseParams: parseThreadParams,
        dedupeKey: (p) => p.threadId,
        init: (p) => ({ threadId: p.threadId }),
        restore: restoreThread,
        useTab: useThreadTab,
        Body: SubagentThreadBody,
      },
    ],
  },
});
