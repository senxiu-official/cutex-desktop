// A block of an agent's text whose selection gets the selection menu (解释这段 / 批注追问 → side chat; lib/useSelectionMenu):
// wrap user bubbles, tool output, cards — any text that is not Markdown (Markdown has it already). Without a selection
// on the right-click the event goes on to the surface's own menu. SelectionSourceScope names whose text a subtree is
// when the conversation is not the author (a delegation's brief or result; "copy" = ambiguous, only 复制).
import { createElement, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useSelectionMenu } from "../lib/useSelectionMenu";
import { SelectionSourceOverride } from "../lib/selectionSourceScope";
import type { SelectionAttribution } from "../lib/selectionMenu";

export function SelectionActions({ as = "div", turnId, children, onContextMenu, ...rest }: HTMLAttributes<HTMLElement> & {
  /** The element drawn (a bubble's span, an output's pre). */
  as?: "div" | "span" | "pre" | "p";
  /** The turn the text belongs to, when the row knows it (else the nearest timeline row's). */
  turnId?: string | null;
  children: ReactNode;
}) {
  const menu = useSelectionMenu(turnId);
  return createElement(as, { ...rest, ref: menu.ref, "data-selection-actions": "", onContextMenu: (e: ReactMouseEvent<HTMLElement>) => { menu.onContextMenu(e); if (!e.isPropagationStopped()) onContextMenu?.(e); } }, children);
}

export function SelectionSourceScope({ source, children }: { source: SelectionAttribution; children: ReactNode }) {
  return <SelectionSourceOverride.Provider value={source}>{children}</SelectionSourceOverride.Provider>;
}
