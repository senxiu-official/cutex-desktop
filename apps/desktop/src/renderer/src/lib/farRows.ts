// Long conversations skip what is far off screen (#19, docs/research/perf-baseline-20261020.md §10). Each timeline row
// (`[data-tl-row]`, a direct child of `[data-timeline-root]`) more than FAR_MARGIN viewport heights above or
// below the visible part gets `data-tl-far`: styles.css then gives it `content-visibility: hidden`, so the
// browser skips its style, layout and paint and lays it out at its last real size (`contain-intrinsic-size:
// auto`, on every row so the size is remembered while it shows). Rows nearer than that render as before, so
// nothing comes into view half-drawn and nothing on screen changes height (no jumps).
// `hidden`, not `auto`: an `auto` row the browser decides to draw is still self-contained (its children's
// margins stop collapsing with the neighbours'), and its remembered size then counts them twice. What `auto`
// would have kept drawn is handled here: a row with the selection or the focus is never far, and a jump into a
// far row draws it first (drawRow). The app has no browser find-in-page.
import { useEffect, type RefObject } from "react";
import { intersectionObserverFor, isElement, isHTMLElement } from "./ownerWindow";
import { resizing } from "./columnGlide";

/** How far (in heights of the scrolling box) rows stay fully drawn, above and below what shows. */
export const FAR_MARGIN = 2;
export const ROW_ATTR = "data-tl-row";
export const FAR_ATTR = "data-tl-far";

/** The row `el` is in, drawn again now (a jump scrolls to something inside it: its real layout first). */
export function drawRow(el: Element): void {
  const row = el.closest(`[${FAR_ATTR}]`);
  if (isHTMLElement(row)) near(row);
}

/** Whether the row holds the selection (non-empty) or the focus: it stays drawn. */
function inUse(el: HTMLElement): boolean {
  const doc = el.ownerDocument;
  if (el.contains(doc.activeElement)) return true;
  const sel = doc.getSelection();
  return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.getRangeAt(0).intersectsNode(el);
}

function near(el: HTMLElement): void {
  if (!el.hasAttribute(FAR_ATTR)) return;
  el.removeAttribute(FAR_ATTR);
  el.style.marginTop = "";
  el.style.marginBottom = "";
  el.style.containIntrinsicBlockSize = "";
}

/**
 * The space above and below each row as laid out now. A skipped row contains its children's margins, which
 * otherwise collapse with the neighbour's (a message's `my-*`): the timeline would lose ~8 px per far row and
 * move whenever a row turns far or near. The far row takes those gaps as its own margins instead — they
 * collapse with the neighbour's exactly as before, so nothing moves.
 */
export function farGaps(list: HTMLElement, rows: readonly HTMLElement[]): [number, number][] {
  if (!rows.length) return [];
  let box: { top: number; bottom: number } | null = null;
  const inner = () => {
    if (!box) {
      const r = list.getBoundingClientRect();
      const cs = getComputedStyle(list);
      box = { top: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), bottom: r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) };
    }
    return box;
  };
  // A sibling without a box (`display: none`, e.g. a turn's empty attachments list under `empty:hidden`) takes
  // no part in the margin collapsing and its rect is all zeros (top 0 = the viewport's top): measuring to it
  // gave a far row a margin the size of its distance to the window top, the height jumped on every far / near
  // switch, and the scroll that followed re-armed the switch (the timeline shook every ~350 ms while idle).
  const boxed = (sib: Element | null, step: (e: Element) => Element | null): Element | null => {
    while (sib && getComputedStyle(sib).display === "none") sib = step(sib);
    return sib;
  };
  return rows.map((el) => {
    const r = el.getBoundingClientRect();
    const prev = boxed(el.previousElementSibling, (e) => e.previousElementSibling);
    const next = boxed(el.nextElementSibling, (e) => e.nextElementSibling);
    const top = prev ? r.top - prev.getBoundingClientRect().bottom : r.top - inner().top;
    const bottom = next ? next.getBoundingClientRect().top - r.bottom : inner().bottom - r.bottom;
    return [Math.max(0, Math.round(top * 100) / 100), Math.max(0, Math.round(bottom * 100) / 100)];
  });
}

/** Keep rows drawn throughout a scroll gesture: compositor scrolling can enter a hidden row
 * before IntersectionObserver gets a main-thread turn, even with its two-screen buffer. Not for the scrolls of a
 * width drag (lib/columnGlide resizing): there the history only scrolls from Conversation's observer, to stay at
 * the bottom / keep its rows up, so no far row comes into view — yet drawing them all restyled and laid out the
 * whole timeline, and kept it drawn for every step of the drag (perf/shelf-divider-drag). */
export function watchFarRowsScroll(root: HTMLElement, list: HTMLElement, recheck: () => void): { active: () => boolean; stop: () => void } {
  const win = root.ownerDocument.defaultView!;
  let active = false;
  let timer: number | undefined;
  const onScroll = () => {
    if (!active) {
      active = true;
      for (const el of list.querySelectorAll<HTMLElement>(`[${FAR_ATTR}]`)) near(el);
    }
    win.clearTimeout(timer);
    timer = win.setTimeout(() => { active = false; recheck(); }, 250);
  };
  const onKey = (e: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) onScroll();
  };
  root.addEventListener("wheel", onScroll, { capture: true, passive: true });
  root.addEventListener("touchmove", onScroll, { capture: true, passive: true });
  const onScrollEvent = () => {
    if (!resizing()) onScroll();
  };
  root.addEventListener("scroll", onScrollEvent, { passive: true });
  root.addEventListener("keydown", onKey, true);
  return {
    active: () => active,
    stop() {
      win.clearTimeout(timer);
      root.removeEventListener("wheel", onScroll, true);
      root.removeEventListener("touchmove", onScroll, true);
      root.removeEventListener("scroll", onScrollEvent);
      root.removeEventListener("keydown", onKey, true);
    },
  };
}

/** Marks far rows of `content` (inside the scrolling box `scroller`) while mounted. */
export function useFarRows(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = scroller.current;
    const list = content.current;
    if (!root || !list) return;
    // The scroller's own window (a desk window's, multi-window): its observer, its selection.
    const doc = root.ownerDocument;
    let scrolling: ReturnType<typeof watchFarRowsScroll> | undefined;
    const io = intersectionObserverFor(
      root,
      (entries) => {
        // All reads first (the layout is clean here), then the writes.
        const far = entries.filter((e) => !e.isIntersecting && !scrolling?.active() && !e.target.hasAttribute(FAR_ATTR) && !inUse(e.target as HTMLElement)).map((e) => e.target as HTMLElement);
        const gaps = farGaps(list, far);
        // Plain visible rows do not have an auto-size cache yet. Keep their real height,
        // rather than the stylesheet's 120px fallback, on the first hide too.
        const heights = far.map((el) => el.getBoundingClientRect().height);
        for (const e of entries) if (e.isIntersecting) near(e.target as HTMLElement);
        far.forEach((el, i) => {
          el.style.containIntrinsicBlockSize = `${heights[i]}px`;
          el.style.marginTop = `${gaps[i]![0]}px`;
          el.style.marginBottom = `${gaps[i]![1]}px`;
          el.setAttribute(FAR_ATTR, "");
        });
      },
      { root, rootMargin: `${FAR_MARGIN * 100}% 0px` },
    );
    if (!io) return;
    scrolling = watchFarRowsScroll(root, list, () => {
      for (const child of list.children) {
        if (!isHTMLElement(child) || !child.hasAttribute(ROW_ATTR)) continue;
        io.unobserve(child);
        io.observe(child);
      }
    });
    const watch = (node: Node) => isHTMLElement(node) && node.hasAttribute(ROW_ATTR) && io.observe(node);
    for (const child of list.children) watch(child);
    // Rows come and go (streaming, older turns, another agent in this column): only the list's own children.
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach(watch);
        r.removedNodes.forEach((n) => isElement(n) && io.unobserve(n));
      }
    });
    mo.observe(list, { childList: true });
    // A selection reaching into far rows (a long drag, Ctrl+A) draws them, so copying gets their text.
    const onSelection = () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!range.intersectsNode(list)) return;
      for (const el of list.querySelectorAll<HTMLElement>(`[${FAR_ATTR}]`)) if (range.intersectsNode(el)) near(el);
    };
    doc.addEventListener("selectionchange", onSelection);
    // Focus moving into a far row (Tab, a programmatic focus): draw it.
    const onFocus = (e: FocusEvent) => isElement(e.target) && drawRow(e.target);
    list.addEventListener("focusin", onFocus);
    return () => {
      doc.removeEventListener("selectionchange", onSelection);
      list.removeEventListener("focusin", onFocus);
      scrolling.stop();
      mo.disconnect();
      io.disconnect();
      for (const el of list.querySelectorAll<HTMLElement>(`[${FAR_ATTR}]`)) near(el);
    };
  }, [scroller, content]);
}
