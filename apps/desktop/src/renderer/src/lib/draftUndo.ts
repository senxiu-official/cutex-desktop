// Composer undo / redo keys and caret placement (the history itself lives in lib/composerDrafts).
import { useEffect, useRef, type RefObject } from "react";

interface UndoKeyEvent { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

/** Ctrl/⌘+Z = undo; Ctrl/⌘+Shift+Z and Ctrl/⌘+Y = redo; anything else (Alt held, other keys) = null. */
export function undoKeyOf(e: UndoKeyEvent): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !e.shiftKey) return "redo";
  return null;
}

/** Where the caret goes after `before` became `after`: the end of the changed part in `after`. */
export function changedEnd(before: string, after: string): number {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return after.length - suffix;
}

/**
 * The edit menu's 撤销 / 重做 on a plain textarea (main's context menu: webContents.undo / redo) arrive as beforeinput
 * historyUndo / historyRedo: they travel the draft's history instead of the textarea's own.
 */
export function useHistoryBeforeInput(ref: RefObject<HTMLElement | null>, travel: (redo: boolean) => void, enabled = true) {
  const latest = useRef(travel);
  latest.current = travel;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || el.tagName !== "TEXTAREA") return;
    const onBeforeInput = (event: InputEvent) => {
      if (event.isComposing || (event.inputType !== "historyUndo" && event.inputType !== "historyRedo")) return;
      event.preventDefault();
      latest.current(event.inputType === "historyRedo");
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [ref, enabled]);
}
