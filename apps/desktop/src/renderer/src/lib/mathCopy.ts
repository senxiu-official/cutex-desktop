// Copying a selection that contains Markdown math gives the formula's source as written (`$…$`, `$$…$$`,
// `\(…\)`, `\[…\]`), not KaTeX's glyph soup. Every rendered formula carries its source in
// `data-math-source` (components/MathNode.tsx); a formula touched by the selection, even partly, copies whole.
// AgentMentionChip's copy serializer calls `replaceMathSources` too, so a selection with both keeps both.
import { stripSelectionChrome } from "./contentSelection";
import { isElement } from "./ownerWindow";

export const MATH_SOURCE_ATTR = "data-math-source";
const SELECTOR = `[${MATH_SOURCE_ATTR}]`;
const BLOCKS = new Set(["P", "DIV", "LI", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TR"]);

/** Formula elements in a cloned selection → their source text. Returns whether anything changed. */
export function replaceMathSources(fragment: DocumentFragment, range: Range): boolean {
  const doc = fragment.ownerDocument;
  // Selection inside one formula: the fragment holds only some of its glyphs.
  const inside = elementOf(range.commonAncestorContainer)?.closest(SELECTOR);
  if (inside) {
    fragment.replaceChildren(doc.createTextNode(inside.getAttribute(MATH_SOURCE_ATTR) ?? ""));
    return true;
  }
  const found = [...fragment.querySelectorAll(SELECTOR)];
  for (const element of found) {
    const source = element.getAttribute(MATH_SOURCE_ATTR) ?? "";
    if (BLOCKS.has(element.tagName)) {
      const block = doc.createElement("div");
      block.textContent = source;
      element.replaceWith(block);
    } else element.replaceWith(doc.createTextNode(source));
  }
  return found.length > 0;
}

function elementOf(node: Node | null): Element | null {
  return !node ? null : isElement(node) ? node : node.parentElement;
}

/** Text of a fragment with block boundaries as line ends (what the native copy would give). */
export function plainFragmentText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType === 1 && (node as Element).tagName === "BR") return "\n";
  const value = Array.from(node.childNodes, plainFragmentText).join("");
  return node.nodeType === 1 && BLOCKS.has((node as Element).tagName) ? `${value}\n` : value;
}

const installed = new WeakMap<Document, number>();

function onCopy(event: ClipboardEvent): void {
  if (event.defaultPrevented || !event.clipboardData) return;
  const doc = (event.currentTarget as Document | null) ?? document;
  if (isElement(event.target) && event.target.closest('input, textarea, [contenteditable="true"]')) return;
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  const inside = elementOf(range.commonAncestorContainer)?.closest(SELECTOR);
  if (!inside && ![...doc.querySelectorAll(SELECTOR)].some((element) => range.intersectsNode(element))) return;
  // Mention chips in the selection too: their serializer (AgentMentionChip) also replaces formulas.
  if (!inside && [...doc.querySelectorAll("[data-agent-mention-wire]")].some((element) => range.intersectsNode(element))) return;
  const fragment = range.cloneContents();
  if (!replaceMathSources(fragment, range)) return;
  stripSelectionChrome(fragment);
  const last = fragment.lastChild;
  const text = plainFragmentText(fragment);
  event.clipboardData.setData("text/plain", last?.nodeType === 1 && BLOCKS.has((last as Element).tagName) ? text.replace(/\n$/, "") : text);
  const html = doc.createElement("div");
  html.append(fragment);
  event.clipboardData.setData("text/html", html.innerHTML);
  event.preventDefault();
}

/** One copy listener per document while any formula is mounted in it. */
export function retainMathCopy(doc: Document): () => void {
  const count = installed.get(doc) ?? 0;
  if (count === 0) doc.addEventListener("copy", onCopy);
  installed.set(doc, count + 1);
  return () => {
    const left = (installed.get(doc) ?? 1) - 1;
    if (left > 0) installed.set(doc, left);
    else {
      installed.delete(doc);
      doc.removeEventListener("copy", onCopy);
    }
  };
}
