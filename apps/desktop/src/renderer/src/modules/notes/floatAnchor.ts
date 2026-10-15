import { noteFloatPosition, noteTurnRange } from "./floating";

/** Read the existing timeline markers; do not change the shell or reserve any layout space. */
export function trackNoteFloat(origin: HTMLElement, turnId: string, update: (position: NonNullable<ReturnType<typeof noteFloatPosition>>) => void, dismiss: () => void) {
  const root = origin.closest("main")?.querySelector<HTMLElement>("[data-timeline-root]");
  const scroller = root?.parentElement;
  if (!root || !scroller) { dismiss(); return () => {}; }
  let frame = 0, stopped = false;
  const measure = (reveal = false) => {
    if (stopped) return;
    const rows = Array.from(root.children);
    const range = noteTurnRange(rows.map(row => row.getAttribute("data-turn-id")), turnId);
    if (!range) { dismiss(); return; }
    // Empty inline-attachment outlets use display:none and report a (0,0) rect.
    // They must not become the tail of a user-only or interrupted turn.
    const tail = rows.slice(range.start, range.end + 1).reverse().find(row => {
      const rect = row.getBoundingClientRect(); return rect.bottom > rect.top;
    }) ?? rows[range.start]!;
    const edge = () => Math.min(tail.getBoundingClientRect().bottom, range.next === null ? Infinity : rows[range.next]!.getBoundingClientRect().top);
    const bounds = scroller.getBoundingClientRect();
    // Only opening may reveal an offscreen tail. Later scrolling never chases the user.
    if (reveal && (edge() > bounds.bottom || edge() < bounds.top + Math.min(320, bounds.height / 2))) {
      // Leave the next message in view so the attachment point remains recognizable.
      const followingSpace = range.next === null ? 16 : Math.min(112, bounds.height / 4);
      scroller.scrollBy({ top: edge() - (bounds.bottom - followingSpace), behavior: "instant" });
    }
    const first = rows[range.start]!.getBoundingClientRect();
    const position = noteFloatPosition({ width: window.innerWidth, height: window.innerHeight }, bounds, { right: first.right, bottom: edge() });
    if (position) update(position); else dismiss();
  };
  const schedule = () => {
    if (!frame && !stopped) frame = requestAnimationFrame(() => { frame = 0; measure(); });
  };
  const resize = new ResizeObserver(schedule);
  const observeRows = () => {
    resize.disconnect(); resize.observe(root); resize.observe(scroller);
    for (const row of Array.from(root.children)) resize.observe(row);
  };
  const mutation = new MutationObserver(() => { observeRows(); schedule(); });
  observeRows();
  mutation.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-turn-id"] });
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  measure(true);
  return () => {
    stopped = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
    window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule);
  };
}
