// Where a floating panel opened from a small button goes (components/AnchoredPanel: the tray's 通知中心 and 后台操作
// lists, the status-row bell's list): on one side of the button, kept inside the window.

/** Which side of its button the panel opens on. */
export type PanelSide = "above" | "below" | "left" | "right";

const GAP = 6;
const MARGIN = 16;

/**
 * The panel's top-left: on `side` of the anchor, aligned with its start (above / below: right edges meet when the
 * anchor is in the right half), then kept `MARGIN` inside the viewport.
 */
export function placePanel(
  anchor: { left: number; top: number; right: number; bottom: number },
  box: { width: number; height: number },
  side: PanelSide,
  view: { width: number; height: number },
): { left: number; top: number } {
  let left: number, top: number;
  if (side === "above" || side === "below") {
    left = anchor.left + anchor.right > view.width ? anchor.right - box.width : anchor.left;
    top = side === "above" ? anchor.top - box.height - GAP : anchor.bottom + GAP;
  } else {
    left = side === "left" ? anchor.left - box.width - GAP : anchor.right + GAP;
    top = anchor.top + anchor.bottom > view.height ? anchor.bottom - box.height : anchor.top;
  }
  const clamp = (v: number, size: number, max: number) => Math.max(MARGIN, Math.min(v, max - size - MARGIN));
  return { left: clamp(left, box.width, view.width), top: clamp(top, box.height, view.height) };
}

/** A tray button's panel opens away from the tray's edge (the tray can dock to any edge). */
export function traySide(el: Element | null): PanelSide {
  const at = el?.closest("[data-tray-at]")?.getAttribute("data-tray-at");
  return at === "top" ? "below" : at === "left" ? "right" : at === "right" ? "left" : "above";
}
