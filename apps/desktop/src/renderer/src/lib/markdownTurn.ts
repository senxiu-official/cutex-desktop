// The turn a timeline row belongs to, for Markdown inside it (the selection menu's side chat forks at that turn;
// lib/useSelectionMenu). Every row of a turn carries it, not only the first row with the scroll anchor `data-turn-id`.
// null outside a timeline row (a side chat, a note, a preview).
import { createContext } from "react";

export const MarkdownTurn = createContext<string | null>(null);
