/**
 * Replace [start, end) of a textarea through the browser's own editing (`insertText`), so the change is one entry of
 * the textarea's undo history (Ctrl+Z restores the draft) and React hears it as typed input. False when the browser
 * did not do it (no execCommand, or the result is not `expected`): the caller sets the draft itself.
 * (The input box's `composer.action` replace, docs/desktop-modules.md §31.)
 */
export function insertUndoable(el: HTMLTextAreaElement, start: number, end: number, text: string, expected: string): boolean {
  try {
    el.focus();
    el.setSelectionRange(start, end);
    const done = typeof el.ownerDocument.execCommand === "function" && el.ownerDocument.execCommand("insertText", false, text);
    return done && el.value === expected;
  } catch {
    return false;
  }
}
