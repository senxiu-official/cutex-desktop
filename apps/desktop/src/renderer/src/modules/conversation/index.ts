// Core conversation module. Step 1 (settings pilot): its settings page. Step 4: the core cutex
// agent-tool line and the delegation ASK / results rows, ungated like the baseline (the 委托 card
// itself stays in modules/delegations behind agent-asks). Contract 1.4 (§19): the core reference
// component (one turn as a reference card / right-side card; the RFC's `turn.peek`).
import { Columns2, MessageSquareText, MessagesSquare } from "lucide-react";
import { projectInto } from "../../lib/workspaces";
import { StandardToolRow } from "./StandardToolRow";
import { standardToolRow } from "../../lib/standardToolRows";
import { isAgentTaskTool } from "../../lib/taskRows";
import { defineModule } from "../slots";
import { AgentToolRow, AskReceivedRow, ResultsReceivedRow } from "./TimelineRows";
import { turnPeekComponent } from "./turnPeekItem";
import { projectionComponent } from "./projectionItem";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const ConversationPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ConversationPage));

export default defineModule({
  id: "conversation",
  titleKey: "conversation.title",
  descriptionKey: "conversation.description",
  required: true,
  contributes: {
    "settings.page": [{ id: "conversation.settings", page: "conversation", group: "app", order: 300, icon: MessageSquareText, titleKey: "settings.panel.conversation", source: "local", hintKey: "settings.pageHint.conversation", Page: ConversationPage, sections: [{ anchor: "titleBar", titleKey: "shell.sidebar.titleBar", keywords: ["appearance.titleTwoLines", "appearance.runtimeButton"] }, { anchor: "display", titleKey: "conversation.display", keywords: ["conversation.reasoningView", "conversation.interactions", "conversation.agentMessages", "conversation.timelineIntro", "conversation.turnSummary", "appearance.messageImages", "notes.showTimeline", "notes.showTimelineHint"] }, { anchor: "fold", titleKey: "conversation.longSection", keywords: ["conversation.timelineTurns", "appearance.fold", "appearance.foldLong", "appearance.foldLines", "appearance.foldLong.mine", "appearance.foldLong.all"] }] }],
    // Delegation ASK / results are rendered by schema whatever the host supports (baseline, O6).
    "timeline.received": [
      { id: "conversation.delegationAsk", order: 200, schemas: ["cutex.delegation-ask.v1"], Row: AskReceivedRow },
      { id: "conversation.delegationResults", order: 300, schemas: ["cutex.delegation-results.v1"], Row: ResultsReceivedRow },
    ],
    // After delegations.tool (100): a finished delegate call is the 委托 card when that module is on.
    "timeline.tool": [{ id: "conversation.agentTools", order: 250, match: isAgentTaskTool, Row: AgentToolRow },
      // After approval/safety rows: their decisions stay visible through the ordinary fallback.
      { id: "conversation.standardTools", order: 450, match: item => standardToolRow(item) !== null, Row: StandardToolRow }],
    // The turn reference (§19.4): ungated, like the timeline it reads. v1.17 (§24.4): another agent's
    // live conversation (`conversation.agent`, v1.16) is a conversation pane now — no side component.
    // §24.13 (owner 2026-10-21): a projection — another agent's live conversation in the focused conversation's Shelf.
    "side.component": [turnPeekComponent, projectionComponent],
    // 并排打开 in every agent menu (sidebar row, title bar, 全部 agent dialog, agent links): a second workspace beside,
    // the same plan as Ctrl/⌘ + click on a sidebar row (lib/workspaceEffects; the shell's own 在旁边打开 row folded into this, 2026-11-05).
    "ref.action": [{ id: "conversation.openAgentSide", titleKey: "conversation.agent.openSide", icon: Columns2, kinds: ["agent"], run: async (ref) => {
      const sessionId = ref.params.sessionId ?? ref.key;
      if (!sessionId) return;
      const { agentEffect } = await import("../../lib/workspaceEffects");
      agentEffect({ hostId: ref.hostId, key: sessionId, title: ref.title || undefined }, "beside").run();
    } },
    // §24.13: 投影 — the agent as a live conversation pane in the focused conversation's Shelf.
    { id: "conversation.projectAgent", titleKey: "conversation.projection.menu", icon: MessagesSquare, kinds: ["agent"], run: (ref) => {
      const sessionId = ref.params.sessionId ?? ref.key;
      if (sessionId) projectInto(ref.hostId, sessionId);
    } }],
  },
});
