// 图片编辑 (owner 2026-11-28): the edit model of the image editor (components/ImageEditor). An edit is a list of
// operations replayed in order over the original bitmap: annotations draw on the surface as it is at that point,
// 旋转 / 裁剪 replace the surface (so later annotations live in the rotated / cropped coordinates), 打码 pixelates
// what is under it at that point. Undo / redo / 重置 move whole operation lists (EditHistory). Coordinates and
// widths are image pixels. Pure apart from the canvas calls in `replay` / `exportEdited`, which take a surface
// factory so tests run without a canvas (test/imageEdit.test.ts).

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

export type EditTool = "crop" | "pen" | "highlight" | "arrow" | "rect" | "ellipse" | "text" | "mosaic";

export type EditOp =
  | { kind: "pen" | "highlight"; points: Point[]; color: string; width: number }
  | { kind: "arrow"; from: Point; to: Point; color: string; width: number }
  | { kind: "rect" | "ellipse"; rect: Rect; color: string; width: number }
  | { kind: "text"; at: Point; text: string; color: string; size: number }
  | { kind: "mosaic"; rect: Rect; block: number }
  | { kind: "crop"; rect: Rect }
  /** Quarter turns clockwise (1) or counter-clockwise (3). */
  | { kind: "rotate"; turns: 1 | 3 };

// ---------- history ----------

export interface EditHistory {
  ops: readonly EditOp[];
  past: readonly (readonly EditOp[])[];
  future: readonly (readonly EditOp[])[];
}

export const emptyHistory = (): EditHistory => ({ ops: [], past: [], future: [] });

/** Add an operation (one undo step); clears redo. */
export function pushOp(h: EditHistory, op: EditOp): EditHistory {
  return { ops: [...h.ops, op], past: [...h.past, h.ops], future: [] };
}

export function undoEdit(h: EditHistory): EditHistory {
  if (!h.past.length) return h;
  return { ops: h.past[h.past.length - 1]!, past: h.past.slice(0, -1), future: [h.ops, ...h.future] };
}

export function redoEdit(h: EditHistory): EditHistory {
  if (!h.future.length) return h;
  return { ops: h.future[0]!, past: [...h.past, h.ops], future: h.future.slice(1) };
}

/** 重置: back to the unedited image, itself one undo step (nothing to reset: unchanged). */
export function resetEdit(h: EditHistory): EditHistory {
  if (!h.ops.length) return h;
  return { ops: [], past: [...h.past, h.ops], future: [] };
}

export const canUndo = (h: EditHistory): boolean => h.past.length > 0;
export const canRedo = (h: EditHistory): boolean => h.future.length > 0;

// ---------- geometry ----------

/** The rectangle spanned by two points (any drag direction). */
export function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** `r` inside a surface of `size`, on whole pixels, at least 1×1; null when nothing of it is inside. */
export function clampRect(r: Rect, size: Size): Rect | null {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(size.w, Math.round(r.x + r.w));
  const y1 = Math.min(size.h, Math.round(r.y + r.h));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The crop box dragged from `anchor` to `pointer` with an aspect `ratio` (w / h; null = free), kept inside `size`:
 * the box grows from the anchor towards the pointer and is as large as the pointer allows at that ratio.
 */
export function cropDrag(anchor: Point, pointer: Point, ratio: number | null, size: Size): Rect {
  const px = Math.max(0, Math.min(size.w, pointer.x));
  const py = Math.max(0, Math.min(size.h, pointer.y));
  if (!ratio) return rectFrom(anchor, { x: px, y: py });
  const sx = px >= anchor.x ? 1 : -1;
  const sy = py >= anchor.y ? 1 : -1;
  // Room towards the pointer's side, then the largest box of this ratio that fits both the drag and the room.
  const roomW = sx > 0 ? size.w - anchor.x : anchor.x;
  const roomH = sy > 0 ? size.h - anchor.y : anchor.y;
  const w = Math.min(Math.max(Math.abs(px - anchor.x), Math.abs(py - anchor.y) * ratio), roomW, roomH * ratio);
  const h = w / ratio;
  return { x: sx > 0 ? anchor.x : anchor.x - w, y: sy > 0 ? anchor.y : anchor.y - h, w, h };
}

/** `r` moved by (dx, dy) and kept inside `size` (its size unchanged). */
export function moveRect(r: Rect, dx: number, dy: number, size: Size): Rect {
  return { ...r, x: Math.max(0, Math.min(size.w - r.w, r.x + dx)), y: Math.max(0, Math.min(size.h - r.h, r.y + dy)) };
}

/** The largest centred box of `ratio` (w / h) inside `size`: the crop box a ratio button starts with. */
export function centredRatioRect(ratio: number, size: Size): Rect {
  let w = size.w;
  let h = w / ratio;
  if (h > size.h) { h = size.h; w = h * ratio; }
  return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
}

/** The surface size after `ops` on an image of `base` size. */
export function sizeAfter(base: Size, ops: readonly EditOp[]): Size {
  let size = base;
  for (const op of ops) {
    if (op.kind === "rotate") size = { w: size.h, h: size.w };
    else if (op.kind === "crop") { const r = clampRect(op.rect, size); if (r) size = { w: r.w, h: r.h }; }
  }
  return size;
}

/** The pixel unit of an image: widths and text sizes scale with it so a mark reads alike on a small and a 4K shot. */
export function imageUnit(size: Size): number {
  return Math.max(1, Math.max(size.w, size.h) / 1000);
}

/** The three stroke widths (细 / 中 / 粗) on an image of `size`, in image pixels. */
export function strokeWidths(size: Size): [number, number, number] {
  const u = imageUnit(size);
  return [3, 5, 9].map((n) => Math.round(n * u)) as [number, number, number];
}

/** Text size for a stroke-width step (0–2). */
export function textSize(step: number, size: Size): number {
  return Math.round([18, 28, 44][Math.max(0, Math.min(2, step))]! * imageUnit(size));
}

/** The 打码 block size: coarse enough that text under it cannot be read. */
export function mosaicBlock(size: Size): number {
  return Math.max(8, Math.round(Math.max(size.w, size.h) / 80));
}

/** The highlighter is this many times the pen. */
export const HIGHLIGHT_FACTOR = 4;

/** Whether an operation is big enough to keep (a click without a drag draws nothing, except a pen dot). */
export function meaningful(op: EditOp): boolean {
  switch (op.kind) {
    case "pen": case "highlight": return op.points.length > 0;
    case "arrow": return Math.hypot(op.to.x - op.from.x, op.to.y - op.from.y) >= 4;
    case "rect": case "ellipse": case "mosaic": case "crop": return op.rect.w >= 3 && op.rect.h >= 3;
    case "text": return op.text.trim().length > 0;
    case "rotate": return true;
  }
}

// ---------- drawing ----------

/** The canvas calls the editor makes (a CanvasRenderingContext2D, or a recording fake in tests). */
export type Ctx = Pick<CanvasRenderingContext2D,
  | "save" | "restore" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "stroke" | "fill" | "strokeRect" | "ellipse"
  | "fillText" | "strokeText" | "drawImage" | "translate" | "rotate" | "clearRect" | "arc"
> & {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  font: string;
  textBaseline: CanvasTextBaseline;
  imageSmoothingEnabled: boolean;
};

/** A drawing surface: an HTMLCanvasElement / OffscreenCanvas, or a fake. */
export interface Surface { width: number; height: number; getContext(kind: "2d"): Ctx | null }
export type SurfaceFactory = (w: number, h: number) => Surface;

const ARROW_ANGLE = Math.PI / 7;

export const TEXT_FONT = "600 {size}px system-ui, -apple-system, 'Segoe UI', sans-serif";
export const textFont = (size: number): string => TEXT_FONT.replace("{size}", String(size));
export const TEXT_LINE = 1.25;

/** Relative luminance of `#rrggbb` (0 black – 1 white); 0 for anything else. */
function lum(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** The outline behind text and arrows so they read on any background: dark behind light colours, light behind dark. */
export const haloOf = (color: string): string => (lum(color) > 0.6 ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.85)");

function strokePath(ctx: Ctx, points: readonly Point[]) {
  ctx.beginPath();
  if (points.length === 1) {
    // A click: a dot of the stroke's width.
    const p = points[0]!;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y);
  } else {
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/** The arrow's head: tip, and the two barbs. */
export function arrowHead(from: Point, to: Point, width: number): { tip: Point; left: Point; right: Point; neck: Point } {
  const len = Math.max(10, width * 4.5);
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const left = { x: to.x - len * Math.cos(a - ARROW_ANGLE), y: to.y - len * Math.sin(a - ARROW_ANGLE) };
  const right = { x: to.x - len * Math.cos(a + ARROW_ANGLE), y: to.y - len * Math.sin(a + ARROW_ANGLE) };
  // The shaft stops inside the head so its square end does not poke out of the tip.
  const neck = { x: to.x - len * 0.7 * Math.cos(a), y: to.y - len * 0.7 * Math.sin(a) };
  return { tip: to, left, right, neck };
}

/** Draw one annotation on `ctx` (a surface of `surface`; 打码 reads it back). Crop / rotate are not drawn here. */
export function drawOp(ctx: Ctx, op: EditOp, surface: Surface | null, factory?: SurfaceFactory): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (op.kind) {
    case "pen":
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      strokePath(ctx, op.points);
      break;
    case "highlight":
      // Multiply: a marker over text keeps the text dark.
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.55;
      ctx.lineCap = "butt";
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width * HIGHLIGHT_FACTOR;
      strokePath(ctx, op.points);
      break;
    case "arrow": {
      const head = arrowHead(op.from, op.to, op.width);
      for (const pass of [0, 1] as const) {
        // A thin halo first, then the arrow.
        ctx.strokeStyle = pass ? op.color : haloOf(op.color);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = op.width + (pass ? 0 : Math.max(2, op.width * 0.5));
        ctx.beginPath();
        ctx.moveTo(op.from.x, op.from.y);
        ctx.lineTo(head.neck.x, head.neck.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(head.tip.x, head.tip.y);
        ctx.lineTo(head.left.x, head.left.y);
        ctx.lineTo(head.right.x, head.right.y);
        ctx.closePath();
        ctx.fill();
        if (!pass) ctx.stroke();
      }
      break;
    }
    case "rect":
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.strokeRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
      break;
    case "ellipse":
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.beginPath();
      ctx.ellipse(op.rect.x + op.rect.w / 2, op.rect.y + op.rect.h / 2, op.rect.w / 2, op.rect.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "text": {
      ctx.font = textFont(op.size);
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(2, op.size / 7);
      ctx.strokeStyle = haloOf(op.color);
      ctx.fillStyle = op.color;
      op.text.split("\n").forEach((line, i) => {
        const y = op.at.y + i * op.size * TEXT_LINE;
        ctx.strokeText(line, op.at.x, y);
        ctx.fillText(line, op.at.x, y);
      });
      break;
    }
    case "mosaic": {
      if (!surface || !factory) break;
      const r = clampRect(op.rect, { w: surface.width, h: surface.height });
      if (!r) break;
      // Average down to one pixel per block, then scale back up without smoothing.
      const sw = Math.max(1, Math.ceil(r.w / op.block));
      const sh = Math.max(1, Math.ceil(r.h / op.block));
      const small = factory(sw, sh);
      const sctx = small.getContext("2d");
      if (!sctx) break;
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(surface as unknown as CanvasImageSource, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small as unknown as CanvasImageSource, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      break;
    }
    case "crop":
    case "rotate":
      break;
  }
  ctx.restore();
}

/**
 * Replay `ops` over `image` (natural size `base`) onto a new surface: the edited image at full size. Crop and rotate
 * make a new surface; everything else draws on the current one.
 */
export function replay(image: CanvasImageSource, base: Size, ops: readonly EditOp[], factory: SurfaceFactory): Surface {
  let surface = factory(base.w, base.h);
  let ctx = surface.getContext("2d")!;
  ctx.drawImage(image, 0, 0, base.w, base.h);
  for (const op of ops) {
    if (op.kind === "rotate") {
      const next = factory(surface.height, surface.width);
      const nctx = next.getContext("2d")!;
      nctx.save();
      if (op.turns === 1) { nctx.translate(next.width, 0); nctx.rotate(Math.PI / 2); }
      else { nctx.translate(0, next.height); nctx.rotate(-Math.PI / 2); }
      nctx.drawImage(surface as unknown as CanvasImageSource, 0, 0);
      nctx.restore();
      surface = next;
      ctx = nctx;
    } else if (op.kind === "crop") {
      const r = clampRect(op.rect, { w: surface.width, h: surface.height });
      if (!r) continue;
      const next = factory(r.w, r.h);
      const nctx = next.getContext("2d")!;
      nctx.drawImage(surface as unknown as CanvasImageSource, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      surface = next;
      ctx = nctx;
    } else {
      drawOp(ctx, op, surface, factory);
    }
  }
  return surface;
}

// ---------- export ----------

/** Decoded bytes of a base64 data URL. */
export function dataUrlSize(url: string): number {
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** The scale to try next when an export of `bytes` at `scale` is over `limit`: by area, with a margin. */
export function nextExportScale(bytes: number, limit: number, scale: number): number {
  return scale * Math.min(0.9, Math.sqrt(limit / bytes) * 0.92);
}

/** Longest side of an export: larger edits are scaled down first (the composer's paste cap is the same). */
export const EXPORT_MAX_DIM = 4096;
const EXPORT_TRIES = 6;

export interface Encoder { encode(surface: Surface, type: "image/png" | "image/jpeg", quality?: number): string }

/**
 * The edited image as a data URL within `maxBytes`: a PNG, scaled down until it fits; if a PNG of a reasonable
 * size never fits (a big photo), a JPEG. null when nothing fits.
 */
export function exportEdited(edited: Surface, maxBytes: number, factory: SurfaceFactory, encoder: Encoder): { url: string; size: Size; type: "image/png" | "image/jpeg" } | null {
  const longest = Math.max(edited.width, edited.height);
  let scale = Math.min(1, EXPORT_MAX_DIM / longest);
  const at = (s: number): Surface => {
    if (s >= 1) return edited;
    const w = Math.max(1, Math.round(edited.width * s));
    const h = Math.max(1, Math.round(edited.height * s));
    const out = factory(w, h);
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(edited as unknown as CanvasImageSource, 0, 0, w, h);
    return out;
  };
  for (let i = 0; i < EXPORT_TRIES; i++) {
    const surface = at(scale);
    const url = encoder.encode(surface, "image/png");
    const bytes = dataUrlSize(url);
    if (bytes <= maxBytes) return { url, size: { w: surface.width, h: surface.height }, type: "image/png" };
    // Never below a quarter of the longest side: a JPEG keeps more of a photo than a tiny PNG.
    const next = nextExportScale(bytes, maxBytes, scale);
    if (next * longest < Math.min(1024, longest / 4)) break;
    scale = next;
  }
  for (const q of [0.92, 0.85, 0.75, 0.6]) {
    const surface = at(Math.min(scale, 1));
    const url = encoder.encode(surface, "image/jpeg", q);
    if (dataUrlSize(url) <= maxBytes) return { url, size: { w: surface.width, h: surface.height }, type: "image/jpeg" };
  }
  return null;
}

/** The edited copy's file name: 「name」 → 「name-edited.png」 (once, however often it is edited). */
export function editedName(name: string, type: "image/png" | "image/jpeg" = "image/png"): string {
  const ext = type === "image/png" ? "png" : "jpg";
  const stem = name.replace(/\.(png|jpe?g|gif|webp|bmp)$/i, "").replace(/-edited$/, "") || "image";
  return `${stem}-edited.${ext}`;
}

// ---------- composer attachments ----------

/** A composer attachment's own fields (shared/input DraftImage) without its id and keep-original slot. */
export interface DraftImageBody {
  name: string;
  preview: string | null;
  pickedLocally?: boolean;
  source: { kind: "data"; url: string } | { kind: "path"; path: string };
}

/** An attachment that may carry its pre-edit original. */
export interface EditableDraftImage extends DraftImageBody { id: string; original?: DraftImageBody }

/** The attachment after a save: the edited PNG / JPEG, keeping the first original (restore goes all the way back). */
export function applyEdit<T extends EditableDraftImage>(image: T, edited: { url: string; type: "image/png" | "image/jpeg" }): T {
  const { id: _id, original: _original, ...body } = image;
  return {
    ...image,
    name: editedName(image.name, edited.type),
    preview: edited.url,
    pickedLocally: undefined,
    source: { kind: "data", url: edited.url },
    original: image.original ?? body,
  };
}

/** The attachment as it was before any edit (unchanged when it was never edited). */
export function restoreOriginal<T extends EditableDraftImage>(image: T): T {
  if (!image.original) return image;
  const { original, ...rest } = image;
  const restored = { ...rest, ...original } as T;
  if (!original.pickedLocally) delete restored.pickedLocally;
  return restored;
}

/** The image the editor opens for an attachment: its preview, else its inline data; null for a host path only. */
export function editableSrc(image: DraftImageBody): string | null {
  if (image.preview?.startsWith("data:image/")) return image.preview;
  if (image.source.kind === "data") return image.source.url;
  return null;
}
