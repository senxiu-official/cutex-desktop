// Handoff gpt-side-rework: ephemeral Codex side chats are agent-bound cards, not main pages.
import { MessageCircle } from "lucide-react";
import { SIDE_CHAT_CAPABILITY } from "../../../../shared/sideChat";
import { openHostAgent } from "../../lib/hostLists";
import { sideShowsHost } from "../../lib/sideServices";
import { services } from "../app";
import { defineModule } from "../slots";
import { initSide, parseSideParams, restoreSide, type SideParams, type SideState } from "./cardState";
import { launcherParams, useFromTurnState, useSideTab } from "./hooks";
import { SideChatCard } from "./SideChatCard";
import { SideChatSettings, SideSummarySettings } from "./SideSettings";
import { closeSideInstance, sideModuleActive } from "./state";

export default defineModule({
  id: "side-chat", titleKey: "side-chat.title", descriptionKey: "side-chat.description",
  requires: { capabilities: [SIDE_CHAT_CAPABILITY] },
  contributes: {
    "side.component": [{
      id: "side-chat.chat", titleKey: "side-chat.title", icon: MessageCircle, agentFeature: "sideChat",
      instances: "singleton", defaultBinding: "agent", placement: { home: "chat" },
      parseParams: parseSideParams, init: (params: SideParams, previous: SideState | null) => initSide(params, previous), restore: restoreSide,
      useTab: useSideTab, Body: SideChatCard,
      onClose: instance => instance.binding.kind !== "agent" || closeSideInstance(instance.id, instance.binding.hostId, instance.binding.sessionId, instance.state.chatId),
      launcher: { order: 200, pin: "default", params: launcherParams },
    }],
    "ref.action": [{ id: "side-chat.fromTurn", titleKey: "side-chat.open", icon: MessageCircle, kinds: ["turn"], useState: useFromTurnState,
      // The side column shows the open agent's host only: a turn of another host opens its agent instead
      // of an invisible card.
      run: ref => {
        if (!ref.params.sessionId || !ref.params.turnId) return;
        if (!sideShowsHost(ref.hostId)) return openHostAgent(ref.hostId, ref.params.sessionId);
        services.side.open("side-chat.chat", { turnId: ref.params.turnId }, { focus: true, binding: { kind: "agent", hostId: ref.hostId, sessionId: ref.params.sessionId } });
      },
    }],
    // Two cards on 对话 after 长对话和长消息 (owner 2026-10-19): the side chat itself, then saving it as a note.
    "settings.section": [
      { id: "side-chat.settings", page: "conversation", titleKey: "side-chat.title", order: 400,
        keywords: ["side-chat.settingsHint", "side-chat.scopeSetting", "side-chat.scopeAll", "side-chat.scopeThrough", "side-chat.scopeHint"], Section: SideChatSettings },
      { id: "side-chat.summarySettings", page: "conversation", titleKey: "side-chat.summary", order: 410,
        keywords: ["side-chat.summarySettingsHint", "side-chat.summaryPrompt", "side-chat.editPrompt", "side-chat.anchorSetting", "side-chat.anchorStart", "side-chat.anchorLatest"], Section: SideSummarySettings },
    ],
  },
  activate: ctx => { sideModuleActive(true); ctx.signal.addEventListener("abort", () => sideModuleActive(false), { once: true }); },
});
