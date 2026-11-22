// The turn a timeline row belongs to, for Markdown inside it (教学模式 「解释这段」: a side chat forks at that turn;
// lib/selectionMenu). Every row of a turn carries it, not only the first row with the scroll anchor `data-turn-id`.
// null outside a timeline row (a side chat, a note, a preview).
import { createContext } from "react";

export const MarkdownTurn = createContext<string | null>(null);
