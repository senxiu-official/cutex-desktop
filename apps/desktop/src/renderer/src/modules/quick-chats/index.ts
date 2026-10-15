// 新工作 (cutex human-create-session): the sidebar entry (+ ▾ profile picker) and the draft page —
// nothing exists in cutex until the first message (store.pendingChat, lib/pendingChat.ts). Step 3.
// The sidebar's 快速对话 list stays core (lib/sidebarView splits it by the same capability).
import { MessageSquarePlus } from "lucide-react";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { startQuickChat, useQuickChatLabel } from "./nav";
import { PendingChat } from "./PendingChat";
import { QuickChatMenu } from "./QuickChatMenu";

export default defineModule({
  id: "quick-chats",
  titleKey: "quick-chats.title",
  descriptionKey: "quick-chats.description",
  requires: { capabilities: ["human-create-session"] },
  contributes: {
    "nav.primary": [
      {
        id: "quick-chats.nav",
        order: 100,
        icon: MessageSquarePlus,
        titleKey: "quick-chats.nav",
        useTitleKey: useQuickChatLabel,
        target: { run: startQuickChat },
        activePages: ["quick-chats.draft"],
        Menu: QuickChatMenu,
      },
    ],
    "main.page": [{ id: "quick-chats.draft", Page: PendingChat, useTitle: pageTitle("quick-chats.title") }],
  },
});
