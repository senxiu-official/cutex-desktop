// 新工作 entry: starts the draft (store.newQuickChat opens `quick-chats.draft`); 正在创建工作… meanwhile.
import type { MessageKey } from "../../i18n";
import { useApp } from "../../store";

export function startQuickChat() {
  return useApp.getState().newQuickChat();
}

export function useQuickChatLabel(): MessageKey | null {
  return useApp((s) => s.creatingChat) ? "quick-chats.navCreating" : null;
}
