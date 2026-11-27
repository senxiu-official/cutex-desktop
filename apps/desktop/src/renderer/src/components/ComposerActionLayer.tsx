// The `panel` place of the input box's module actions (composer.action, docs/desktop-modules.md §31): a float above
// the input box, out of its flow (owner 2026-11-28). An action's panel (输入优化's comparison) used to sit inside the
// card and grow it: the history was squeezed while it was open and, once it closed, the only-up rule
// (lib/stickToBottom keepRowsUp) kept the shrink as blank room under the rows — the history left the screen. Here
// the input box keeps its height whether a panel shows or not. Same frame as the composer's popovers
// (components/ComposerPanels), at most 60vh and never past the top of the conversation pane: the room between the
// pane's top and the input box is measured while something shows (an interaction card or 「接下来」 may sit in
// between; the float covers them, not the input). The panel lays itself out inside (a scrolling middle, fixed ends).
// Hidden while no action has put anything in it.
import { useCallback, useLayoutEffect, useRef } from "react";
import { useOwnerWindow } from "../lib/ownerContext";
import { sharedResizeObserver } from "../lib/resizeHub";
import { layerMaxHeight } from "../lib/composerActionLayer";

export function ComposerActionLayer({ layerRef }: { layerRef(el: HTMLDivElement | null): void }) {
  const win = useOwnerWindow();
  const el = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    el.current = node;
    layerRef(node);
  }, [layerRef]);
  useLayoutEffect(() => {
    const layer = el.current;
    const box = layer?.parentElement;
    if (!layer || !box) return;
    const fit = () => {
      if (!layer.firstChild) return;
      const pane = box.closest("main")?.getBoundingClientRect().top ?? 0;
      layer.style.maxHeight = layerMaxHeight(box.getBoundingClientRect().top - pane);
    };
    // When a panel arrives, and when the pane or the input box changes size while it shows.
    const added = new (win as Window & typeof globalThis).MutationObserver(fit);
    added.observe(layer, { childList: true });
    const ro = sharedResizeObserver(fit);
    ro.observe(box);
    const main = box.closest("main");
    if (main) ro.observe(main);
    fit();
    return () => {
      added.disconnect();
      ro.disconnect();
    };
  }, [win]);
  return (
    <div
      ref={setRef}
      data-composer-action-panel=""
      className="float absolute right-0 bottom-full left-0 z-[160] mb-1.5 flex max-h-[60vh] flex-col overflow-hidden empty:hidden"
    />
  );
}
