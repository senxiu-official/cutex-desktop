// The selection menu on any surface showing an agent's text (owner 2026-11-25: select-to-ask is a general feature):
// right-click on selected text offers the modules' `selection` actions (the side chat's 解释这段 and
// 批注追问) for the agent the text belongs to. Markdown uses it itself; other text (a user bubble, tool output, a card)
// wraps in components/SelectionActions. Shift+F10 / the ContextMenu key open the same menu (lib/selectionMenu).
// Shell file: no module names.
import { useCallback, useContext, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "../store";
import { convHostOf, convSessionOf, useConvScope } from "./conversationScope";
import { MarkdownOpenSource } from "./markdownOpenSource";
import { MarkdownTurn } from "./markdownTurn";
import { registerSelectionRoot, selectionContextMenu, type SelectionAttribution } from "./selectionMenu";
import { SelectionSourceOverride } from "./selectionSourceScope";

/**
 * Who the text under `target` belongs to: an explicit SelectionSourceScope (a delegation's brief / result; "copy" when
 * ambiguous), else the scoped agent (AgentMarkdownScope: a side chat, a note; no turn), else the conversation's agent
 * and the turn of the row (`turnId` given, else the row's MarkdownTurn, else the nearest `data-turn-id`). null = no
 * agent (the native menu stays).
 */
export function useSelectionSource(turnId?: string | null): (target: HTMLElement) => SelectionAttribution {
  const override = useContext(SelectionSourceOverride);
  const openSource = useContext(MarkdownOpenSource);
  const conv = useConvScope();
  const rowTurn = useContext(MarkdownTurn);
  return useCallback((target: HTMLElement) => {
    if (override !== undefined) return override;
    if (openSource) return openSource.sessionId ? { hostId: openSource.hostId, sessionId: openSource.sessionId } : null;
    const s = useApp.getState();
    const sessionId = convSessionOf(conv, s);
    return sessionId ? { hostId: convHostOf(conv, s), sessionId, turnId: turnId ?? rowTurn ?? target.closest("[data-turn-id]")?.getAttribute("data-turn-id") ?? null } : null;
  }, [override, openSource, conv, rowTurn, turnId]);
}

/**
 * For a block of an agent's text: `onContextMenu` (the selection menu when the right-click is on selected text inside
 * it, else nothing: the event goes on to a message's own menu, or the native one) and `ref` (the block, so the keyboard
 * finds it).
 */
export function useSelectionMenu(turnId?: string | null): { onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void; ref: (el: HTMLElement | null) => void } {
  const source = useSelectionSource(turnId);
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  }, [source]);
  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>) => { selectionContextMenu(e, () => source(e.currentTarget)); }, [source]);
  const unregister = useRef<(() => void) | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    unregister.current?.();
    unregister.current = el ? registerSelectionRoot(el, (target) => latest.current(target)) : null;
  }, []);
  return { onContextMenu, ref };
}
