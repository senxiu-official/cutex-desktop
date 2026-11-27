// Right-click on selected agent text (Markdown, and any block wrapped in components/SelectionActions): the modules'
// `ref.action` items for a `selection` ref (the side chat's 解释这段 and 批注追问) above Copy, instead of the native
// Copy menu (main/index.ts installEditMenu). A general feature (owner 2026-11-25), independent of any display setting.
// No agent or no module action → the event is left alone and the native menu
// shows exactly as before. Text whose agent is ambiguous (SelectionSourceScope "copy": a delegation brief the owner
// wrote, a result from another host) gets only 复制. The keyboard opens the same menu: Shift+F10 or the ContextMenu key
// with a selection inside a registered block. Shell file: no module names.
import { createElement, type MouseEvent as ReactMouseEvent } from "react";
import { Copy } from "lucide-react";
import { translate } from "../i18n";
import type { CutexRef } from "../modules/slots";
import { openMenuAt, type MenuEntry } from "./contextMenu";
import { ownerDocumentOf, selectionOf } from "./ownerWindow";
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

/** Whose text a block is: an agent, "copy" (known to be ambiguous: only 复制), or null (no agent: the native menu). */
export type SelectionAttribution = SelectionSource | "copy" | null;

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

/** The menu for `text` of `from`: the module actions + Copy; only Copy when ambiguous; null = leave it native. */
function selectionEntries(from: SelectionAttribution, text: string, doc: Document): MenuEntry[] | null {
  if (!from) return null;
  if (from === "copy") return editEntries(doc);
  const actions = refActionEntries(selectionRef(from, text));
  return actions.length ? [...actions, "separator", ...editEntries(doc)] : null;
}

/**
 * `onContextMenu` for a Markdown body. `source()` names the agent the text belongs to (null = none: native menu).
 * Returns whether it opened a menu.
 */
export function selectionContextMenu(e: ReactMouseEvent<HTMLElement>, source: () => SelectionAttribution): boolean {
  const text = selectedText(e);
  if (!text) return false;
  const doc = ownerDocumentOf(e.currentTarget);
  const entries = selectionEntries(source(), text, doc);
  if (!entries) return false;
  e.preventDefault();
  e.stopPropagation();
  openMenuAt(e.clientX, e.clientY, entries, { doc });
  return true;
}

// ---- the keyboard (Shift+F10 / ContextMenu key) ----

type Resolver = (target: HTMLElement) => SelectionAttribution;
const roots = new WeakMap<Element, Resolver>();
const keyed = new WeakSet<Document>();
/** A keyboard open just happened: the contextmenu event Chromium sends after the key is swallowed (no native menu on top). */
let keyOpenedAt = 0;

/** A block whose selection gets the menu (Markdown, SelectionActions): also reachable from the keyboard. */
export function registerSelectionRoot(el: HTMLElement, resolve: Resolver): () => void {
  roots.set(el, resolve);
  const doc = el.ownerDocument;
  if (!keyed.has(doc)) {
    keyed.add(doc);
    doc.addEventListener("keydown", (e) => {
      if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey))) return;
      if (openSelectionMenuFromKeyboard(doc)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    doc.addEventListener("contextmenu", (e) => {
      if (Date.now() - keyOpenedAt < 500) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
  return () => {
    if (roots.get(el) === resolve) roots.delete(el);
  };
}

/** The innermost registered block holding `node`. */
function rootOf(node: Node | null): HTMLElement | null {
  for (let el = node && node.nodeType === 1 ? (node as HTMLElement) : (node?.parentElement ?? null); el; el = el.parentElement) if (roots.has(el)) return el;
  return null;
}

/** Opens the selection menu under the current selection (both ends in one registered block). Returns whether it did. */
export function openSelectionMenuFromKeyboard(doc: Document = document): boolean {
  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const root = rootOf(sel.anchorNode);
  if (!root || rootOf(sel.focusNode) !== root) return false;
  const text = sel.toString();
  if (!text.trim()) return false;
  const anchor = sel.anchorNode!.nodeType === 1 ? (sel.anchorNode as HTMLElement) : sel.anchorNode!.parentElement!;
  const entries = selectionEntries(roots.get(root)!(anchor), text, doc);
  if (!entries) return false;
  // Under the selection (its last range); the block itself when the range has no box.
  const range = sel.getRangeAt(sel.rangeCount - 1);
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  const rect = box && (box.width || box.height) ? box : root.getBoundingClientRect();
  keyOpenedAt = Date.now();
  openMenuAt(rect.left, rect.bottom, entries, { doc });
  return true;
}
