// Right-click on selected text in Markdown (教学模式 on, docs/design/teaching-mode.md P1): the modules' `ref.action`
// items for a `selection` ref (the side chat's 解释这段) above Copy, instead of the native Copy menu
// (main/index.ts installEditMenu). Teaching mode off, no agent, or no module action → the event is left alone and the
// native menu shows exactly as before. Shell file: no module names.
import { createElement, type MouseEvent as ReactMouseEvent } from "react";
import { Copy } from "lucide-react";
import { translate } from "../i18n";
import type { CutexRef } from "../modules/slots";
import { openMenuAt, type MenuEntry } from "./contextMenu";
import { ownerDocumentOf, selectionOf } from "./ownerWindow";
import { getUiPrefs } from "./prefs";
import { refActionEntries } from "./refActions";
import { REF_MAX_TITLE } from "./refs";

export const SELECTION_REF_KIND = "selection";
/** A ref param holds ≤ 8000 characters (lib/refs parseRef); longer selections are cut with an ellipsis. */
export const SELECTION_TEXT_MAX = 8000;

export interface SelectionSource {
  hostId: string;
  sessionId: string;
  /** The main timeline: the turn holding the selection (a side chat forks there). */
  turnId?: string | null;
}

/** `selection`: key `<sessionId>:<time>`; params sessionId, text, turnId?. Built when the menu opens, never stored. */
export function selectionRef(source: SelectionSource, raw: string): CutexRef {
  const trimmed = raw.trim();
  const text = trimmed.length > SELECTION_TEXT_MAX ? `${trimmed.slice(0, SELECTION_TEXT_MAX - 1)}…` : trimmed;
  return {
    hostId: source.hostId,
    kind: SELECTION_REF_KIND,
    key: `${source.sessionId}:${Date.now()}`,
    title: text.replace(/\s+/g, " ").slice(0, REF_MAX_TITLE),
    params: { sessionId: source.sessionId, text, ...(source.turnId ? { turnId: source.turnId } : {}) },
  };
}

/** The selected text when the right-click is on it (inside `root`), else null. */
function selectedText(e: ReactMouseEvent<HTMLElement>): string | null {
  const sel = selectionOf(e.currentTarget);
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  // On the selection: a range touches the clicked node (a selection inside one paragraph touches that paragraph).
  const target = e.target as Node;
  if (![...Array(sel.rangeCount).keys()].some((i) => sel.getRangeAt(i).intersectsNode(target))) return null;
  const text = sel.toString();
  return text.trim() ? text : null;
}

/** Copy through the browser's own command, so the copy hooks (lib/mathCopy, contentSelection) still run. */
function editEntries(doc: Document): MenuEntry[] {
  return [{ label: translate("menu.copy"), icon: createElement(Copy, { size: 14 }), onSelect: () => void doc.execCommand("copy") }];
}

/**
 * `onContextMenu` for a Markdown body. `source()` names the agent the text belongs to (null = none: native menu).
 * Returns whether it opened a menu.
 */
export function selectionContextMenu(e: ReactMouseEvent<HTMLElement>, source: () => SelectionSource | null): boolean {
  if (!getUiPrefs().teachingMode) return false;
  const text = selectedText(e);
  if (!text) return false;
  const from = source();
  if (!from) return false;
  const actions = refActionEntries(selectionRef(from, text));
  if (!actions.length) return false;
  e.preventDefault();
  e.stopPropagation();
  const doc = ownerDocumentOf(e.currentTarget);
  openMenuAt(e.clientX, e.clientY, [...actions, "separator", ...editEntries(doc)], { doc });
  return true;
}
