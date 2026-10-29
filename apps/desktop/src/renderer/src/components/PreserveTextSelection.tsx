import { Component, type ReactNode } from "react";
import { captureTextSelection, restoreTextSelection, type TextSelectionSnapshot } from "../lib/textSelection";

interface Props {
  children: ReactNode;
  /** Change for any text/markup mode update that can replace the selected DOM. */
  revision: unknown;
  /** A span for inline prose, or the default div around a whole Markdown message. */
  as?: "div" | "span";
}

// Reading the selection (getSelection / rangeCount / isCollapsed) makes the browser bring style up to
// date — a forced style recalc per streamed update of every message. Whether there is a selection at all
// is read once, then followed from `selectionchange` (fired for every change of the selection).
// Per document: a desk window has its own selection (multi-window).
const selectionSeen = new WeakMap<Document, boolean>();
const hasSelection = (doc: Document) => {
  const selection = doc.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
};
function selectionPossible(doc: Document): boolean {
  if (typeof document === "undefined") return true;
  let seen = selectionSeen.get(doc);
  if (seen === undefined) {
    seen = hasSelection(doc);
    selectionSeen.set(doc, seen);
    doc.addEventListener("selectionchange", () => void selectionSeen.set(doc, hasSelection(doc)));
  }
  return seen;
}

/**
 * getSnapshotBeforeUpdate is React's commit-before-mutation boundary. A layout effect's cleanup
 * is too late for Text.data changes, which can already have collapsed the browser selection.
 * Keep one boundary around the whole message; do not nest one per font run or paragraph.
 */
export class PreserveTextSelection extends Component<Props> {
  private root: HTMLElement | null = null;
  private setRoot = (element: HTMLElement | null): void => { this.root = element; };

  getSnapshotBeforeUpdate(previous: Props): TextSelectionSnapshot | null {
    return !Object.is(previous.revision, this.props.revision) && this.root && selectionPossible(this.root.ownerDocument)
      ? captureTextSelection(this.root) : null;
  }

  componentDidUpdate(_previous: Props, _state: unknown, snapshot: TextSelectionSnapshot | null): void {
    if (snapshot && this.root) restoreTextSelection(this.root, snapshot);
  }

  render() {
    const Tag = this.props.as ?? "div";
    return <Tag ref={this.setRoot} style={{ display: "contents" }}>{this.props.children}</Tag>;
  }
}
