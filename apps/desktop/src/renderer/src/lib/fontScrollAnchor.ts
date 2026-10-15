/** Capture immediately before a font publication and restore synchronously after layout. */
export function captureFontScrollAnchor(scroller: HTMLElement, atBottom: boolean): () => void {
  if (atBottom) return () => { scroller.scrollTop = scroller.scrollHeight; };
  const viewport = scroller.getBoundingClientRect();
  // Prefer a visible text block over its entire turn: this also works inside long replies.
  const candidates = scroller.querySelectorAll<HTMLElement>(".markdown p, .markdown li, .markdown pre, [data-turn-id]");
  let anchor: HTMLElement | null = null;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom || rect.height === 0) continue;
    let top = Math.max(rect.top, viewport.top), bottom = Math.min(rect.bottom, viewport.bottom);
    // Foldable clips a tall message without removing its paragraphs. Its hidden text can have
    // a rect across the viewport even when the entire folded box is above the reading position.
    for (let parent = el.parentElement; parent && parent !== scroller; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === "visible") continue;
      const box = parent.getBoundingClientRect();
      top = Math.max(top, box.top + parent.clientTop);
      bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
    }
    if (bottom <= top) continue;
    if (!anchor || anchor.contains(el)) anchor = el;
  }
  if (!anchor) return () => {};
  const offset = anchor.getBoundingClientRect().top - viewport.top;
  return () => {
    if (!anchor.isConnected || !scroller.contains(anchor)) return;
    scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
  };
}
