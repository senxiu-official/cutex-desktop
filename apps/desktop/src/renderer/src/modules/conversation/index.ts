// Core conversation module. Step 1 (settings pilot): its settings page. Step 4: the core cutex
// agent-tool line and the delegation ASK / results rows, ungated like the baseline (the 委托 card
// itself stays in modules/delegations behind agent-asks). Contract 1.4 (§19): the core reference
// component (one turn as a reference card / right-side card; the RFC's `turn.peek`).
import { MessageSquareText, PanelRightOpen } from "lucide-react";
import { openAgentSide } from "../../lib/sideOpen";
import { ConversationPage } from "../../components/settings/AppSettings";
import { isAgentTaskTool } from "../../lib/taskRows";
import { defineModule } from "../slots";
import { AgentToolRow, AskReceivedRow, ResultsReceivedRow } from "./TimelineRows";
import { sideAgentComponent } from "./sideAgentItem";
import { turnPeekComponent } from "./turnPeekItem";

export default defineModule({
  id: "conversation",
  titleKey: "conversation.title",
  descriptionKey: "conversation.description",
  required: true,
  contributes: {
    "settings.page": [{ id: "conversation.settings", page: "conversation", group: "app", order: 300, icon: MessageSquareText, titleKey: "conversation.page", source: "local", hintKey: "conversation.pageHint", Page: ConversationPage, sections: [{ anchor: "titleBar", titleKey: "shell.sidebar.titleBar", keywords: ["appearance.titleTwoLines", "appearance.runtimeButton"] }, { anchor: "display", titleKey: "conversation.display", keywords: ["conversation.reasoningView", "conversation.interactions", "conversation.agentMessages", "conversation.timelineIntro", "conversation.turnSummary", "appearance.messageImages"] }, { anchor: "fold", titleKey: "conversation.longSection", keywords: ["conversation.timelineTurns", "appearance.fold", "appearance.foldLong", "appearance.foldLines", "appearance.foldOlderReplies"] }] }],
    // Delegation ASK / results are rendered by schema whatever the host supports (baseline, O6).
    "timeline.received": [
      { id: "conversation.delegationAsk", order: 200, schemas: ["cutex.delegation-ask.v1"], Row: AskReceivedRow },
      { id: "conversation.delegationResults", order: 300, schemas: ["cutex.delegation-results.v1"], Row: ResultsReceivedRow },
    ],
    // After delegations.tool (100): a finished delegate call is the 委托 card when that module is on.
    "timeline.tool": [{ id: "conversation.agentTools", order: 250, match: isAgentTaskTool, Row: AgentToolRow }],
    // The turn reference (§19.4): ungated, like the timeline it reads.
    // Another agent's live conversation beside the main one (docs/research/side-agent-view-20261018.md).
    "side.component": [turnPeekComponent, sideAgentComponent],
    // 在侧边打开 in every agent menu (sidebar row, title bar, 全部 agent dialog).
    "ref.action": [{ id: "conversation.openAgentSide", titleKey: "conversation.agent.openSide", icon: PanelRightOpen, kinds: ["agent"], run: (ref) => {
      const sessionId = ref.params.sessionId ?? ref.key;
      if (sessionId) openAgentSide(sessionId, ref.hostId);
    } }],
  },
});
