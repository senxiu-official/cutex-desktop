/** UTF-16 offsets, matching DOM Range/Text offsets (not grapheme indices). */
export interface TextSelectionOffsets {
  anchor: number;
  focus: number;
}

/**
 * Keep the selected characters across one contiguous edit outside the selection. Text append
 * and a markup-only replacement are the common streaming cases. If the edit touches the
 * selected text, do not guess which new text the user meant to select.
 */
export function mapTextSelection(
  before: string,
  after: string,
  offsets: TextSelectionOffsets,
): TextSelectionOffsets | null {
  const { anchor, focus } = offsets;
  if (![anchor, focus].every((n) => Number.isInteger(n) && n >= 0 && n <= before.length) || anchor === focus) return null;
  if (before === after) return { anchor, focus };
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const start = Math.min(anchor, focus);
  const end = Math.max(anchor, focus);
  if (end <= prefix) return { anchor, focus };
  if (start >= before.length - suffix) {
    const delta = after.length - before.length;
    return { anchor: anchor + delta, focus: focus + delta };
  }
  return null;
}

export interface TextSelectionSnapshot {
  root: HTMLElement;
  text: string;
  offsets: TextSelectionOffsets;
  selectedRange: Range;
  /** A clone follows DOM mutations, but not a subsequent Selection API change. */
  trackedRange: Range;
  activeElement: Element | null;
}

function isEditable(node: Node | null): boolean {
  const element = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement;
  return !!element && (element.isContentEditable || !!element.closest("input, textarea, select"));
}

interface TextIndex {
  text: string;
  leaves: Text[];
  ignored: Array<{ start: number; end: number }>;
}

const blockTags = new Set(["P", "DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "MAIN", "NAV", "BLOCKQUOTE", "UL", "OL", "LI", "DL", "DT", "DD", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "FIGURE", "FIGCAPTION", "HR"]);

/** Only parser formatting between block siblings, never whitespace inside prose or code. */
function isStructuralWhitespace(node: Text): boolean {
  if (!/^[\t\r\n ]+$/.test(node.data) || !/[\r\n]/.test(node.data)) return false;
  const previous = node.previousSibling, next = node.nextSibling, parent = node.parentElement;
  if (!parent || previous?.nodeType !== 1 || next?.nodeType !== 1
    || !blockTags.has((previous as Element).tagName) || !blockTags.has((next as Element).tagName)) return false;
  const view = node.ownerDocument.defaultView;
  if (!view || !["normal", "nowrap"].includes(view.getComputedStyle(parent).whiteSpace)) return false;
  const isBlock = (element: Element) => {
    const display = view.getComputedStyle(element).display;
    return display !== "none" && display !== "contents" && !display.startsWith("inline");
  };
  return isBlock(previous as Element) && isBlock(next as Element);
}

function indexText(root: HTMLElement): TextIndex {
  const index: TextIndex = { text: "", leaves: [], ignored: [] };
  const parts: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let raw = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (isStructuralWhitespace(node)) index.ignored.push({ start: raw, end: raw + node.length });
    else if (node.length) { index.leaves.push(node); parts.push(node.data); }
    raw += node.length;
  }
  index.text = parts.join("");
  return index;
}

function offsetAt(root: HTMLElement, node: Node, offset: number, index: TextIndex): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  const raw = range.toString().length;
  return raw - index.ignored.reduce((total, span) => total + Math.max(0, Math.min(raw, span.end) - span.start), 0);
}

/** Capture only an ordinary, non-collapsed selection wholly owned by this boundary. */
export function captureTextSelection(root: HTMLElement): TextSelectionSnapshot | null {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!root.isConnected || !selection || selection.rangeCount !== 1 || selection.isCollapsed
    || !selection.anchorNode || !selection.focusNode
    || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)
    || isEditable(selection.anchorNode) || isEditable(selection.focusNode) || isEditable(doc.activeElement)) return null;
  const index = indexText(root);
  return {
    root,
    text: index.text,
    offsets: {
      anchor: offsetAt(root, selection.anchorNode, selection.anchorOffset, index),
      focus: offsetAt(root, selection.focusNode, selection.focusOffset, index),
    },
    selectedRange: selection.getRangeAt(0),
    trackedRange: selection.getRangeAt(0).cloneRange(),
    activeElement: doc.activeElement,
  };
}

function sameRange(a: Range, b: Range): boolean {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

function pointAt(index: TextIndex, offset: number, preferNext: boolean): { node: Text; offset: number } | null {
  let remaining = offset;
  let last: Text | null = null;
  for (const node of index.leaves) {
    last = node;
    if (remaining < node.length || (remaining === node.length && !preferNext)) return { node, offset: remaining };
    remaining -= node.length;
  }
  return last && remaining === 0 ? { node: last, offset: last.length } : null;
}

/**
 * Run synchronously immediately after the owning React commit. Never queue restoration: a
 * later user selection must win. Focus/selection changes made by child layout effects also win.
 * Cross-boundary and native input selections are intentionally outside this component's scope.
 */
export function restoreTextSelection(root: HTMLElement, snapshot: TextSelectionSnapshot): boolean {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (root !== snapshot.root || !root.isConnected || doc.activeElement !== snapshot.activeElement
    || !selection || selection.rangeCount !== 1 || selection.getRangeAt(0) !== snapshot.selectedRange
    || !sameRange(selection.getRangeAt(0), snapshot.trackedRange)
    || isEditable(doc.activeElement)) return false;
  // Streamdown static mode adds formatting LF nodes between paragraphs. They are not prose
  // characters; ignoring only those block separators gives stable offsets without fuzzy matching
  // or searching for selected text (which could jump to an identical paragraph).
  const index = indexText(root);
  const mapped = mapTextSelection(snapshot.text, index.text, snapshot.offsets);
  if (!mapped) return false;
  if (selection.anchorNode && selection.focusNode
    && root.contains(selection.anchorNode) && root.contains(selection.focusNode)
    && offsetAt(root, selection.anchorNode, selection.anchorOffset, index) === mapped.anchor
    && offsetAt(root, selection.focusNode, selection.focusOffset, index) === mapped.focus) return false;
  const forward = mapped.anchor < mapped.focus;
  const anchor = pointAt(index, mapped.anchor, forward);
  const focus = pointAt(index, mapped.focus, !forward);
  if (!anchor || !focus || isEditable(anchor.node) || isEditable(focus.node)) return false;
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  return true;
}
