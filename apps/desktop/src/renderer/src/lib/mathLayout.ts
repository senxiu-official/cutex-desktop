// Line boxes around Markdown math (components/MathNode.tsx). The rule:
// - Inline math keeps the paragraph's line height whenever it fits inside the line's own strut (the paragraph
//   line height around the text font): sub/superscripts, norms, hats, inline fractions at the chat sizes.
//   Nothing is added then, so a line with `\lVert x\rVert^2` sits exactly where a plain line would.
// - A taller inline form (`\sum\limits`, `\displaystyle\frac`, big delimiters, matrices) grows its line by what
//   sticks out, and the grown line is then rounded up to a whole device pixel, so a reply's line boxes stay on
//   the device-pixel grid (streaming prose, `--prose-pixel`) and the text below does not shimmer as it streams.
// - Display math is a block of its own whose height is its formula's, rounded up to a device pixel, with the
//   prose block gap above and below (styles.css `.math-display`); a wide formula scrolls inside it.
// `.katex` has line-height 0 here, so a formula's vertical extent is its KaTeX struts (one per `.katex-base`).

const ceilToPixel = (value: number, ratio: number) => Math.ceil(value * ratio - 0.02) / ratio;
const NEAR = 0.02;

/**
 * `wrapper`: the inline formula (`.math-inline`) with two empty probes aligned to the top and the bottom of its
 * (first) line box. A line taller than the line height gets the remainder to the next device pixel as a margin on
 * the formula box that makes its top or bottom edge.
 */
export function snapInlineMath(wrapper: HTMLElement): void {
  const win = wrapper.ownerDocument.defaultView;
  const top = wrapper.querySelector(":scope > .math-probe-top");
  const bottom = wrapper.querySelector(":scope > .math-probe-bottom");
  if (!win || !top || !bottom) return;
  const bases = [...wrapper.querySelectorAll<HTMLElement>(".katex-html > .katex-base")];
  for (const base of bases) if (base.style.marginTop || base.style.marginBottom) base.style.margin = "";
  const lineTop = top.getBoundingClientRect().top;
  const lineBottom = bottom.getBoundingClientRect().bottom;
  const height = lineBottom - lineTop;
  const lineHeight = parseFloat(win.getComputedStyle(wrapper).lineHeight);
  if (!height || !Number.isFinite(lineHeight) || height <= lineHeight + NEAR) return; // fits (or hidden)
  const extra = ceilToPixel(height, win.devicePixelRatio || 1) - height;
  if (extra <= NEAR / 4) return;
  const rects = bases.map((base) => base.getBoundingClientRect());
  const atBottom = rects.findIndex((rect) => Math.abs(rect.bottom - lineBottom) < NEAR);
  if (atBottom >= 0) {
    bases[atBottom]!.style.marginBottom = `${extra}px`;
    return;
  }
  const atTop = rects.findIndex((rect) => Math.abs(rect.top - lineTop) < NEAR);
  if (atTop >= 0) bases[atTop]!.style.marginTop = `${extra}px`;
}

/** `block`: the display formula (`.math-display`); its height becomes the formula's, on the pixel grid. */
export function snapDisplayMath(block: HTMLElement): void {
  const win = block.ownerDocument.defaultView;
  const katex = block.querySelector<HTMLElement>(".katex");
  if (!win || !katex) return;
  const height = katex.getBoundingClientRect().height;
  if (!height) return;
  const style = win.getComputedStyle(block);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  block.style.height = `${ceilToPixel(height + padding, win.devicePixelRatio || 1)}px`;
}
