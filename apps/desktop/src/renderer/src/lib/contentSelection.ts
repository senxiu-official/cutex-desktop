// App chrome is nonselectable. Mod+A outside an editor is scoped to the content block the owner
// last pointed at/focused, never the document (including when no such block is active).
import { matchesEditingCommand } from "./keybindings";
import { isElement, isNode } from "./ownerWindow";

export const SELECTABLE_CONTENT = ".selectable, .select-text, .markdown, .textLayer, pre, code, [data-copy-value]";
const SELECTION_CHROME = 'button, [role="button"], [role="menuitem"], [data-chrome], [data-avatar], [data-avatar-status], [data-mention-avatar], .select-none, [data-streamdown="code-block-header"], [data-streamdown="code-block-actions"]';
/** Custom clipboard serializers must preserve the same chrome boundary as native selection. */
export function stripSelectionChrome(fragment: ParentNode): void {
  for (const element of fragment.querySelectorAll(SELECTION_CHROME)) element.remove();
}
function elementOf(target: EventTarget | null): Element | null {
  return isElement(target) ? target : isNode(target) ? target.parentElement : null;
}
export function isSelectionEditor(target: EventTarget | null): boolean {
  const el = elementOf(target);
  if (el?.closest('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
  const input = el?.closest("input");
  return !!input && !["button", "checkbox", "radio", "range", "file", "color", "submit", "reset", "image", "hidden"].includes(input.type);
}
export function installContentSelection(doc: Document): () => void {
  let active: Element | null = null;
  const blockOf = (target: EventTarget | null) => {
    const el = elementOf(target), block = el?.closest(SELECTABLE_CONTENT) ?? null;
    const chrome = el?.closest(SELECTION_CHROME);
    // A copy button inside Markdown is still chrome. A whitelisted path inside a navigation
    // button remains a copyable value because its content boundary is inside that button.
    return block && chrome && block.contains(chrome) ? null : block;
  };
  const pointer = (event: Event) => { active = blockOf(event.target); };
  const focus = (event: Event) => {
    const el = elementOf(event.target);
    if (isSelectionEditor(el)) active = null;
    else if (!el?.contains(active)) active = blockOf(el);
  };
  const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !matchesEditingCommand("selectAll", event) || isSelectionEditor(event.target) || isSelectionEditor(doc.activeElement)) return;
    event.preventDefault();
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    const block = blockOf(event.target) ?? (active?.isConnected ? active : null);
    if (!block || !selection) return;
    const range = doc.createRange();
    range.selectNodeContents(block);
    selection.addRange(range);
  };
  doc.addEventListener("pointerdown", pointer, true);
  doc.addEventListener("focusin", focus, true);
  // Bubble: let text/code editors and existing page-level select-all commands handle it first.
  doc.addEventListener("keydown", key);
  return () => { doc.removeEventListener("pointerdown", pointer, true); doc.removeEventListener("focusin", focus, true); doc.removeEventListener("keydown", key); };
}
