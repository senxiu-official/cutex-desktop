import { composerMentionTokens } from "./composerMentionTokens";

export interface MentionSelection { start: number; end: number }
interface Point { node: Node; offset: number }
interface Segment { text: string; before: Point; after: Point; node?: Text }
const RAW = "data-agent-mention-raw";

/** The editable DOM is flat after every committed edit. Also accept browser-created line blocks. */
function segments(root: Node): Segment[] {
  const result: Segment[] = [];
  let text = "";
  function append(segment: Segment) { result.push(segment); text += segment.text; }
  function visit(parent: Node) {
    Array.from(parent.childNodes).forEach((node, index) => {
      const before = { node: parent, offset: index };
      const after = { node: parent, offset: index + 1 };
      if (node.nodeType === 3) {
        const leaf = node as Text;
        append({ text: leaf.data, node: leaf, before: { node, offset: 0 }, after: { node, offset: leaf.length } });
      } else if (node.nodeType === 1) {
        const element = node as HTMLElement;
        if (element.hasAttribute(RAW)) {
          append({ text: element.getAttribute(RAW) ?? "", before, after });
        } else if (element.hasAttribute("data-mention-editor-tail")) {
          // A final BR gives Chromium a caret line after a trailing newline; it is not draft text.
        } else if (element.tagName === "BR") {
          const filler = parent.nodeType === 1 && /^(DIV|P)$/.test((parent as Element).tagName)
            && parent !== root && parent.childNodes.length === 1;
          if (!filler) append({ text: "\n", before, after });
        } else {
          if (/^(DIV|P)$/.test(element.tagName) && index > 0) {
            const empty = element.textContent === "";
            if (!text.endsWith("\n") || empty) append({ text: "\n", before, after: { node, offset: 0 } });
          }
          visit(element);
        }
      }
    });
  }
  visit(root);
  return result;
}

export function agentMentionEditorValue(root: Node): string {
  return segments(root).map(segment => segment.text).join("");
}

/** Expand selections through tokens; a collapsed offset inside a token snaps after it. */
export function atomicMentionSelection(value: string, start: number, end = start): MentionSelection {
  start = Math.max(0, Math.min(value.length, Number.isFinite(start) ? Math.trunc(start) : 0));
  end = Math.max(start, Math.min(value.length, Number.isFinite(end) ? Math.trunc(end) : start));
  const collapsed = start === end;
  for (const token of composerMentionTokens(value)) {
    if (collapsed && start > token.start && start < token.end) return { start: token.end, end: token.end };
    if (!collapsed && start > token.start && start < token.end) start = token.start;
    if (!collapsed && end > token.start && end < token.end) end = token.end;
  }
  return { start, end };
}

function pointOffset(root: HTMLElement, node: Node, offset: number, end: boolean): number {
  let element = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element && element !== root) {
    if (element.hasAttribute(RAW)) {
      const parent = element.parentNode!;
      const index = Array.prototype.indexOf.call(parent.childNodes, element) as number;
      return pointOffset(root, parent, index + (end ? 1 : 0), end);
    }
    element = element.parentElement;
  }
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return agentMentionEditorValue(range.cloneContents()).length;
}

export function readMentionSelection(root: HTMLElement): MentionSelection | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const value = agentMentionEditorValue(root);
  const start = pointOffset(root, range.startContainer, range.startOffset, range.collapsed);
  const end = pointOffset(root, range.endContainer, range.endOffset, true);
  return atomicMentionSelection(value, start, end);
}

export function writeMentionSelection(root: HTMLElement, start: number, end = start): MentionSelection {
  const value = agentMentionEditorValue(root);
  const snapped = atomicMentionSelection(value, start, end);
  const parts = segments(root);
  function locate(offset: number): Point {
    let cursor = 0;
    for (const part of parts) {
      const next = cursor + part.text.length;
      if (offset <= next) {
        if (part.node) return { node: part.node, offset: offset - cursor };
        return offset <= cursor ? part.before : part.after;
      }
      cursor = next;
    }
    return { node: root, offset: root.childNodes.length };
  }
  const from = locate(snapped.start), to = locate(snapped.end);
  const range = root.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return snapped;
}
