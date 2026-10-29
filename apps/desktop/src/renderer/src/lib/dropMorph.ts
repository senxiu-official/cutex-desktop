// The live drop preview (owner 2026-10-23): while a pane / conversation is dragged over a target, the real panes the
// drop would move or shrink go there now — each one translated to its predicted box (lib/dropForecast, the drop's own
// layout function) and clipped to its new size. Transform and clip-path only: nothing is laid out again, no
// instance re-fits (a terminal, a web page keep their size underneath; only what shows is cut). Their instances in
// the fixed layer (components/side/SideInstanceLayer) take the same transform; the layer does not measure meanwhile.
// The drag's hit tests keep using the panes' resting boxes (`restRect`, `morphHit`): a pane moving under the pointer
// never changes the target. A drop ends it at once (the new layout lands where the panes already are); a cancel
// lets them glide back. prefers-reduced-motion: no morph at all (the dashed boxes show the result instead).
import { slotsMotion } from "./sideSlots";

export interface MorphBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A pane to move: its element (a tool pane `[data-side-card]` or a conversation column) and where it goes. */
export interface MorphMove {
  el: HTMLElement;
  to: MorphBox;
  /** A tool pane: its card id and Shelf (`peer`: the other workspace's), for its instances in the fixed layer. */
  card?: { id: string; peer: string | null };
}

const MS = 180;
const RADIUS = 12;

/** Each morphed pane: its box at rest (before any transform) and the instance boxes that move with it. */
const roots = new Map<HTMLElement, { rest: MorphBox; followers: HTMLElement[] }>();
/** Boxes at rest, taken the first time an element moves in this drag (one gliding back is not at rest yet). */
const restCache = new Map<HTMLElement, MorphBox>();
const restOf = (el: HTMLElement): MorphBox => {
  let b = restCache.get(el);
  if (!b) restCache.set(el, (b = boxOf(el)));
  return b;
};
let active = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

const boxOf = (el: Element): MorphBox => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** Whether panes are morphed now (or still gliding back): the instance layer does not measure. */
export const morphing = (): boolean => active;

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The transform and clip that show a pane resting at `rest` at `to` (pure; it can shrink, not grow: no scale). */
export function morphStyle(rest: MorphBox, to: MorphBox): { transform: string; clipPath: string } {
  const dx = Math.round(to.left - rest.left);
  const dy = Math.round(to.top - rest.top);
  const right = Math.max(0, Math.round(rest.width - to.width));
  const bottom = Math.max(0, Math.round(rest.height - to.height));
  return { transform: `translate(${dx}px, ${dy}px)`, clipPath: right || bottom ? `inset(0px ${right}px ${bottom}px 0px round ${RADIUS}px)` : "none" };
}

/** The instance boxes of tool pane `id` (of the other workspace's Shelf when `peer`), in `doc` (the pane's window). */
function instancesOf(doc: Document, id: string, peer: string | null): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(`[data-side-card-of="${CSS.escape(id)}"]`)].filter((el) => (el.dataset.sidePeer ?? null) === peer);
}

function setStyle(el: HTMLElement, s: { transform: string; clipPath: string } | null, animate: boolean): void {
  el.style.transition = animate ? `transform ${MS}ms var(--ease-standard), clip-path ${MS}ms var(--ease-standard)` : "none";
  el.style.transform = s ? s.transform : "";
  el.style.clipPath = s && s.clipPath !== "none" ? s.clipPath : "";
  if (s) el.dataset.dropMorph = "";
  else delete el.dataset.dropMorph;
}

/**
 * The panes in `moves` go to their boxes; panes morphed before and not in `moves` glide back. An empty list: all back
 * (the morph stays active until they are there).
 */
export function morphTo(moves: readonly MorphMove[]): void {
  if (reducedMotion()) return;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  const want = new Set(moves.map((m) => m.el));
  for (const [el, r] of roots) {
    if (want.has(el)) continue;
    setStyle(el, null, true);
    for (const f of r.followers) setStyle(f, null, true);
  }
  for (const m of moves) {
    if (!m.el.isConnected) continue;
    let r = roots.get(m.el);
    if (!r) roots.set(m.el, (r = { rest: restOf(m.el), followers: [] }));
    r.followers = m.card ? instancesOf(m.el.ownerDocument, m.card.id, m.card.peer) : [];
    const s = morphStyle(r.rest, m.to);
    active = true;
    setStyle(m.el, s, true);
    for (const f of r.followers) {
      // An instance box sits inside its pane (below the header): the same move, cut at the pane's new right / bottom edge.
      const rest = restOf(f);
      const right = Math.max(0, rest.left + rest.width - (r.rest.left + r.rest.width - Math.max(0, r.rest.width - m.to.width)));
      const bottom = Math.max(0, rest.top + rest.height - (r.rest.top + r.rest.height - Math.max(0, r.rest.height - m.to.height)));
      setStyle(f, { transform: s.transform, clipPath: right || bottom ? `inset(0px ${Math.round(right)}px ${Math.round(bottom)}px 0px)` : "none" }, true);
    }
  }
  if (!moves.length && roots.size) endMorph(false);
}

/**
 * Ends the morph. `dropped`: the new layout is being applied — the panes drop their transforms at once (they already
 * show where they land); otherwise they glide back. The instance layer measures again once they are still.
 */
export function endMorph(dropped: boolean): void {
  if (!roots.size && !active) return;
  for (const [el, r] of roots) {
    setStyle(el, null, !dropped);
    for (const f of r.followers) setStyle(f, null, !dropped);
  }
  roots.clear();
  restCache.clear();
  if (settleTimer) clearTimeout(settleTimer);
  const settle = () => {
    settleTimer = null;
    active = false;
    slotsMotion();
  };
  if (dropped) settle();
  else settleTimer = setTimeout(settle, MS + 40);
}

/** An element's box at rest: as if no pane were morphed (the drag's hit tests and drop boxes use it). */
export function restRect(el: Element): MorphBox {
  const now = boxOf(el);
  for (const [root, r] of roots) {
    if (root !== el && !root.contains(el)) continue;
    const at = boxOf(root);
    return { left: now.left - at.left + r.rest.left, top: now.top - at.top + r.rest.top, width: now.width, height: now.height };
  }
  return now;
}

/** Whether `el` is (inside) a morphed pane: the hit test skips what moved there. */
export const inMorphed = (el: Element): boolean => [...roots.keys()].some((root) => root === el || root.contains(el));

/**
 * What lies under (x, y) among the morphed panes at rest: the pane's header (`headSel`) when the point is on it there,
 * else the pane. Null: no morphed pane rests there.
 */
export function morphHit(x: number, y: number, headSel = "[data-side-card-head], [data-pane-header]"): Element | null {
  for (const [root, r] of roots) {
    const b = r.rest;
    if (x < b.left || x > b.left + b.width || y < b.top || y > b.top + b.height) continue;
    for (const head of root.querySelectorAll(headSel)) {
      const h = restRect(head);
      if (x >= h.left && x <= h.left + h.width && y >= h.top && y <= h.top + h.height) return head;
    }
    return root;
  }
  return null;
}

/** Tests. */
export function resetMorph(): void {
  roots.clear();
  restCache.clear();
  active = false;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
}
