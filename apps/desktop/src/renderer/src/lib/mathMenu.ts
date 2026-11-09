// 「复制源码」 on a Markdown math formula (components/MathNode.tsx). Right-clicking a formula puts the item above the
// menu of the view it is in (lib/menuTargets, used by every `contextMenu()` menu); a view without a
// menu of its own gets a menu with just that item. It copies the TeX without its delimiters (`$…$` → `…`), inline
// and display alike: the form an equation editor or a .tex file takes. Selection copy keeps the delimiters (lib/mathCopy).
import { createElement } from "react";
import { Sigma } from "lucide-react";
import { openMenuAt, type MenuEntry } from "./contextMenu";
import { registerTargetMenuEntries, targetMenuEntries } from "./menuTargets";
import { copyText } from "./menus";
import { translate } from "../i18n";
import { splitMathSource } from "./markdownMath";
import { MATH_SOURCE_ATTR } from "./mathCopy";
import { isElement, selectionOf } from "./ownerWindow";

const SELECTOR = `[${MATH_SOURCE_ATTR}]`;

/** The TeX of the formula `target` is in (delimiters and surrounding whitespace removed), or null. */
export function mathSourceAt(target: Element): string | null {
  const source = target.closest(SELECTOR)?.getAttribute(MATH_SOURCE_ATTR);
  return source ? splitMathSource(source).tex.trim() || null : null;
}

export function mathMenuEntries(target: Element): MenuEntry[] {
  const tex = mathSourceAt(target);
  return tex ? [{ label: translate("menu.copyMathSource"), icon: createElement(Sigma, { size: 14 }), onSelect: () => copyText(tex) }] : [];
}
registerTargetMenuEntries(mathMenuEntries);

/** After the views' own handlers: a right-click on a formula no menu took opens 「复制源码」 alone. */
function onContextMenu(event: MouseEvent): void {
  if (event.defaultPrevented || !isElement(event.target) || !event.target.closest(SELECTOR)) return;
  // Selected text there: the native Copy menu (main/index.ts), as lib/contextMenu does.
  const selection = selectionOf(event.target);
  if (selection && !selection.isCollapsed && selection.toString().trim() && selection.containsNode(event.target, true)) return;
  const entries = targetMenuEntries(event.target);
  if (!entries.length) return;
  event.preventDefault();
  openMenuAt(event.clientX, event.clientY, entries, { doc: event.target.ownerDocument });
}

const installed = new WeakMap<Document, number>();

/** One context-menu listener per document while any formula is mounted in it. */
export function retainMathMenu(doc: Document): () => void {
  const count = installed.get(doc) ?? 0;
  if (count === 0) doc.addEventListener("contextmenu", onContextMenu);
  installed.set(doc, count + 1);
  return () => {
    const left = (installed.get(doc) ?? 1) - 1;
    if (left > 0) installed.set(doc, left);
    else {
      installed.delete(doc);
      doc.removeEventListener("contextmenu", onContextMenu);
    }
  };
}
