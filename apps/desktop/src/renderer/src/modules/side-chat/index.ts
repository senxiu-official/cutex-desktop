// Handoff gpt-side-rework: ephemeral Codex side chats are agent-bound cards, not main pages.
import { Lightbulb, MessageCircle, MessageSquareQuote } from "lucide-react";
import { translate } from "../../i18n";
import { SIDE_CHAT_CAPABILITY } from "../../../../shared/sideChat";
import { openHostAgent } from "../../lib/hostLists";
import { sideShowsHost } from "../../lib/sideServices";
import { services } from "../app";
import { defineModule } from "../slots";
import { initSide, parseSideParams, restoreSide, type SideParams, type SideState } from "./cardState";
import { launcherParams, useFromTurnState, useSideTab } from "./hooks";
import { SideChatCard } from "./SideChatCard";
import { closeSideInstance, sideModuleActive } from "./state";
import { lazyPage } from "../../lib/lazyPage";

/**
 * A selection of another host's agent (review 2026-11-25 P2-3): the side column shows the open agent's host only, so
 * that agent is opened first and the side chat follows with the request; if its host still is not shown (out of scope,
 * failed), a notice says why instead of dropping the request silently.
 */
async function onAgentHost(hostId: string, sessionId: string, open: () => void): Promise<void> {
  if (!sideShowsHost(hostId)) {
    await openHostAgent(hostId, sessionId);
    if (!sideShowsHost(hostId)) {
      services.ui.notice(translate("side-chat.hostUnavailable"), "error");
      return;
    }
  }
  open();
}

// Loaded on first open (lib/lazyPage).
const SideChatSettings = lazyPage(() => import("./SideSettings").then((m) => m.SideChatSettings));
const SideSummarySettings = lazyPage(() => import("./SideSettings").then((m) => m.SideSummarySettings));

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
    },
    // 解释这段 (a general selection command since owner 2026-11-25): selected agent text (lib/selectionMenu)
    // asked about in a side chat; a new side chat sends it at once, an open one gets it as its draft (state.ts openSideChat).
    { id: "side-chat.explain", titleKey: "side-chat.explain", icon: Lightbulb, kinds: ["selection"], useState: useFromTurnState,
      run: ref => {
        const { sessionId, text, turnId } = ref.params;
        if (!sessionId || !text?.trim()) return;
        const quote = text.split("\n").map(line => `> ${line}`).join("\n");
        return onAgentHost(ref.hostId, sessionId, () => services.side.open("side-chat.chat", { text: translate("side-chat.explainPrompt", { quote }), ...(turnId ? { turnId } : {}) }, { focus: true, binding: { kind: "agent", hostId: ref.hostId, sessionId } }));
      },
    },
    // 批注追问 (harness survey Z4, owner 2026-11-25): selected agent text goes above the side chat's composer with a link
    // back to its turn; the owner adds a note and sends both. Nothing is sent on open. A new side chat forks at that
    // turn; an open one keeps its start (it offers to reopen there).
    { id: "side-chat.annotate", titleKey: "side-chat.annotate", icon: MessageSquareQuote, kinds: ["selection"], useState: useFromTurnState,
      run: ref => {
        const { sessionId, text, turnId } = ref.params;
        if (!sessionId || !text?.trim()) return;
        return onAgentHost(ref.hostId, sessionId, () => services.side.open("side-chat.chat", { quote: text, ...(turnId ? { turnId } : {}) }, { focus: true, binding: { kind: "agent", hostId: ref.hostId, sessionId } }));
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
