// The conversation's dock (UI review 2026-10-15 #1): a slot in normal flow above the composer, in the
// same stack as the queue and the interaction dock, where a `conversation.overlay` item puts a card that
// asks the owner to act (the browser-claim card) instead of floating it over the messages. The
// conversation provides the element; an item portals into it (null = no dock: render nothing).
import { createContext, useContext } from "react";

export const ConversationDockContext = createContext<HTMLElement | null>(null);

export const useConversationDock = (): HTMLElement | null => useContext(ConversationDockContext);
