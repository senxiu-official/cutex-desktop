// Build the 「旧版墨龙」 app icon style (the ink-dragon logo, the app icon until 2026-11-28; now the last choice of
// 外观 → 应用图标, shared/appIcons.ts) from the owner's logo (apps/desktop/resources/logo.png, square RGB(A) PNG):
// transparent outside the brush-drawn rounded frame, area-averaged down to each size, written as
// resources/app-icons/ink-dragon/icon-<n>.png and a PNG-entry icon.ico (Windows). The build's own icon
// (resources/icons) is the default style's, from scripts/make-app-icons.mjs. Pure Node, no image libraries.
//
//   node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodeIco, encodePng, resize } from "./lib/pngIcon.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "apps/desktop/resources");
const SIZES = [16, 24, 32, 48, 64, 128, 256]; // no 512: a chosen style needs 256 at most (scripts/make-app-icons.mjs)
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// The frame's outer edge in unit coordinates (measured on the 1254² logo: the black ground starts
// ~3% in, corners round with ~9% radius). Pixels outside become transparent, with a 1.5 px feather.
const INSET = 0.028;
const RADIUS = 0.095;

/** Signed distance (unit coords, negative inside) to the rounded square. */
function frameDistance(x, y) {
  const half = 0.5 - INSET - RADIUS;
  const dx = Math.max(Math.abs(x - 0.5) - half, 0), dy = Math.max(Math.abs(y - 0.5) - half, 0);
  const outside = Math.hypot(dx, dy);
  const inside = Math.min(half - Math.abs(x - 0.5), half - Math.abs(y - 0.5));
  return (outside > 0 ? outside : -Math.max(inside, 0)) - RADIUS;
}

function masked({ width, height, px }) {
  const out = Buffer.from(px);
  const feather = 1.5 / width;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = frameDistance((x + 0.5) / width, (y + 0.5) / height);
    const cover = Math.min(1, Math.max(0, 0.5 - d / feather));
    const o = (y * width + x) * 4;
    out[o + 3] = Math.round(out[o + 3] * cover);
  }
  return { width, height, px: out };
}

const src = masked(decodePng(readFileSync(join(res, "logo.png"))));
const outDir = join(res, "app-icons", "ink-dragon");
mkdirSync(outDir, { recursive: true });
const pngs = new Map();
for (const size of SIZES) {
  const png = encodePng(resize(src, size), size);
  pngs.set(size, png);
  writeFileSync(join(outDir, `icon-${size}.png`), png);
}
writeFileSync(join(outDir, "icon.ico"), encodeIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
console.log(`ink-dragon: ${SIZES.join(", ")} + icon.ico → ${outDir}`);
