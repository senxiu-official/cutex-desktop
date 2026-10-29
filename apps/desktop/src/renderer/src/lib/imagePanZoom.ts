// Pan / zoom of one image inside a viewport (pure; components/PanZoom drives it): the enlarged view and the
// side-pane image preview share it. A view is the image's scale and the position of its top-left corner in the
// viewport. Zooming keeps the point under the cursor still; panning never leaves an empty edge where the image
// could cover it, and centres an axis the image is smaller than.
export interface Size {
  w: number;
  h: number;
}
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MAX_SCALE = 16;
/** Wheel delta → zoom factor (a mouse notch of 100 ≈ ×1.16). */
export const WHEEL_RATE = 0.0015;

export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * WHEEL_RATE);
}

/** The scale that shows the whole image in `box` (never above 1: a small image stays at its size). */
export function fitScale(img: Size, box: Size): number {
  if (img.w <= 0 || img.h <= 0 || box.w <= 0 || box.h <= 0) return 1;
  return Math.min(1, box.w / img.w, box.h / img.h);
}

export function clampPan(v: View, img: Size, box: Size): View {
  const axis = (pos: number, len: number, room: number) => (len <= room ? (room - len) / 2 : Math.min(0, Math.max(room - len, pos)));
  return { scale: v.scale, x: axis(v.x, img.w * v.scale, box.w), y: axis(v.y, img.h * v.scale, box.h) };
}

/** Zoom by `factor` keeping viewport point `p` still; the scale stays within [min, MAX_SCALE]. */
export function zoomAt(v: View, factor: number, p: { x: number; y: number }, img: Size, box: Size, min: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(min, v.scale * factor));
  const k = scale / v.scale;
  return clampPan({ scale, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }, img, box);
}

export function panBy(v: View, dx: number, dy: number, img: Size, box: Size): View {
  return clampPan({ ...v, x: v.x + dx, y: v.y + dy }, img, box);
}

/** 100 %, with the image point under `p` (default: the viewport centre) kept there. */
export function actualAt(v: View, img: Size, box: Size, p = { x: box.w / 2, y: box.h / 2 }): View {
  return zoomAt(v, 1 / v.scale, p, img, box, 0);
}
