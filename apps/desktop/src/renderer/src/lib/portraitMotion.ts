// Portrait motion (P4; lib/portrait, components/side/SideArea's stack): when the stack rearranges on a discrete change —
// the conversation and its Shelf swapped, the band's Shelves folding / unfolding, a part appearing, the split reset by a
// double-click or a key, two workspaces going side by side or back to the strip, a maximise — its parts glide from where
// they were to where they are (docs/design/021-motion.md tokens: SHELF_MOTION_MS, the standard curve).
//
// Never animated (the rotate-back lessons of fix/unmaximize-width-jump): a drag (the divider's, the band handle's: the
// release only stores what is already shown — quietNextStackGlide), a window resize or the stack changing width, the
// first stack commit after a rotation (nothing remembered yet: what portrait remembered is forgotten when the window
// goes landscape, and every glide still running is cancelled there, in the flip's own commit), reduced motion.
//
// How: the parts' boxes are remembered after each painted stack commit (read then, they cost no layout of their own);
// a discrete change compares them with the new boxes in its layout effect, before paint. Parts trading places (a swap,
// the other workspace taking the focus) slide to their new place (translate; a size that differs, e.g. by the tray's
// room, is taken at once). Otherwise a part that changed size eases its size (its min- and max- height / width held to
// the remembered box, then to the new one — the flex places its siblings frame by frame, nothing is scaled; a part only
// pushed along needs nothing of its own). When the stack changed shape (side by side ↔ strip, a maximise), the parts
// that stay are moved and scaled from their old boxes (transform only, top-left origin). Boxes inside a part moved by a
// transform get none of their own. The Shelf panes' instances follow (lib/sideSlots slotsMotion).
// Shell code: names no feature.
import { EASE_STANDARD, motionAllowed } from "./motion";
import { SHELF_MOTION_MS } from "./shelfMotion";
import { slotsMotion } from "./sideSlots";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Noted {
  shape: string;
  boxes: Map<HTMLElement, Box>;
}

const noted = new Map<HTMLElement, Noted>();
const running = new Map<Animation, HTMLElement>();
const pendingNote = new Map<HTMLElement, number>();
let quiet = false;

/** The stack's parts that glide: its direct parts, the workspaces' columns, the band's open Shelves. */
export function stackParts(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      ':scope > [data-portrait-part], :scope > .contents > [data-pane-columns] > section.ws-col, :scope > [data-portrait-part="shelf"] > [data-side-frame="portrait"]',
    ),
  ];
}

/** The stack's shape: how its parts are laid out (a change of it moves + scales instead of easing sizes). */
export function stackShape(root: HTMLElement): string {
  return `${root.hasAttribute("data-portrait-cols") ? "cols" : root.hasAttribute("data-portrait-split") ? "split" : "one"}|${root.getAttribute("data-panel-max") ?? ""}`;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

function note(root: HTMLElement): void {
  if (!root.isConnected) {
    noted.delete(root);
    return;
  }
  noted.set(root, { shape: stackShape(root), boxes: new Map(stackParts(root).map((el) => [el, boxOf(el)])) });
}

/** Remember the parts' boxes once this commit is painted (and no glide of the stack is running). */
export function noteStackLater(root: HTMLElement | null): void {
  if (!root || pendingNote.has(root)) return;
  const win = root.ownerDocument.defaultView;
  if (!win || typeof win.requestAnimationFrame !== "function") {
    note(root);
    return;
  }
  pendingNote.set(
    root,
    win.requestAnimationFrame(() => {
      pendingNote.delete(root);
      if ([...running.values()].includes(root)) return;
      note(root);
    }),
  );
}

/** The next discrete change of the stack only stores what a drag already shows (its release): no glide for it. */
export function quietNextStackGlide(): void {
  quiet = true;
  // Only that release's own commit (rendered within its event): a later change glides again.
  setTimeout(() => (quiet = false), 100);
}

/** The window went landscape (or the stack is gone): every glide of it ends now, and nothing of portrait is remembered. */
export function stopStackGlides(root: HTMLElement | null): void {
  quiet = false;
  for (const [a, r] of [...running]) {
    if (root && r !== root) continue;
    a.cancel();
    running.delete(a);
  }
  if (!root) return;
  noted.delete(root);
  const id = pendingNote.get(root);
  if (id !== undefined) root.ownerDocument.defaultView?.cancelAnimationFrame(id);
  pendingNote.delete(root);
}

const MOVED = 2;

/**
 * The stack changed in a discrete way (its motion key, components/side/SideArea): its parts glide from the boxes
 * remembered for it. `still`: no glide (a drag's release, the stack changing width, the first commit after a rotation) —
 * running ones end, the new boxes are remembered after paint.
 */
export function glideStack(root: HTMLElement | null, still: boolean): void {
  if (!root) return;
  const wasQuiet = quiet;
  quiet = false;
  const before = noted.get(root);
  for (const [a, r] of [...running]) {
    if (r !== root) continue;
    // A glide still running is superseded: the parts take their new boxes from wherever they are now.
    a.cancel();
    running.delete(a);
  }
  if (still || wasQuiet || !before || !motionAllowed()) {
    noteStackLater(root);
    return;
  }
  const reshaped = before.shape !== stackShape(root);
  const parts = stackParts(root);
  const nowBoxes = new Map(parts.map((el) => [el, boxOf(el)]));
  // The parts kept trade places (a swap; the focused workspace changing): each slides to its new place (its size, which
  // may differ by the tray's room, is taken at once) — easing sizes would leave the move itself a jump.
  const kept = parts.filter((el) => before.boxes.has(el));
  const order = (box: (el: HTMLElement) => Box) => [...kept].sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x);
  const was = order((el) => before.boxes.get(el)!);
  const reordered = order((el) => nowBoxes.get(el)!).some((el, i) => el !== was[i]);
  const motions: Animation[] = [];
  // Parts moved by a transform (their boxes inside move with them: never a second transform of their own).
  const carried: HTMLElement[] = [];
  for (const el of parts) {
    const was = before.boxes.get(el);
    if (!was || typeof el.animate !== "function") continue;
    if ((reshaped || reordered) && carried.some((p) => p.contains(el))) continue;
    const now = nowBoxes.get(el)!;
    if (now.w <= 0 || now.h <= 0 || was.w <= 0 || was.h <= 0) continue;
    const dx = was.x - now.x;
    const dy = was.y - now.y;
    const dw = Math.abs(was.w - now.w) >= MOVED;
    const dh = Math.abs(was.h - now.h) >= MOVED;
    const moved = Math.abs(dx) >= MOVED || Math.abs(dy) >= MOVED;
    if (!dw && !dh && !moved) continue;
    const opts = { duration: SHELF_MOTION_MS, easing: EASE_STANDARD };
    if (reshaped) {
      const s = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${(was.w / now.w).toFixed(4)}, ${(was.h / now.h).toFixed(4)})`;
      motions.push(el.animate([{ transformOrigin: "0 0", transform: s }, { transformOrigin: "0 0", transform: "none" }], opts));
      carried.push(el);
    } else if (reordered) {
      if (!moved) continue;
      motions.push(el.animate([{ transform: `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` }, { transform: "none" }], opts));
      carried.push(el);
    } else if (dw || dh) {
      // (A part that only moved is pushed by a sibling easing its size: the layout carries it, no transform of its own.)
      const at = (b: Box): Keyframe => ({
        ...(dw ? { minWidth: `${Math.round(b.w)}px`, maxWidth: `${Math.round(b.w)}px` } : {}),
        ...(dh ? { minHeight: `${Math.round(b.h)}px`, maxHeight: `${Math.round(b.h)}px` } : {}),
      });
      motions.push(el.animate([at(was), at(now)], opts));
    }
  }
  if (!motions.length) {
    noteStackLater(root);
    return;
  }
  for (const m of motions) {
    running.set(m, root);
    const done = () => {
      if (!running.delete(m)) return;
      if (![...running.values()].includes(root)) noteStackLater(root);
    };
    m.addEventListener?.("finish", done);
    m.addEventListener?.("cancel", () => running.delete(m));
  }
  slotsMotion();
}

/** Tests: forget everything. */
export function resetStackMotion(): void {
  for (const a of running.keys()) a.cancel();
  running.clear();
  noted.clear();
  pendingNote.clear();
  quiet = false;
}

/** Tests: remember the parts' boxes now. */
export function noteStackNow(root: HTMLElement): void {
  note(root);
}
