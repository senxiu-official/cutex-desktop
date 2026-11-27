// Build the 外观 → 应用图标 styles (apps/desktop/src/shared/appIcons.ts) from the owner's masters:
//   apps/desktop/resources/app-icons/src/<id>.png         square RGBA PNG, ≥ 1024 px, transparent background
//   apps/desktop/resources/app-icons/src/<id>-small.png   optional: hand-simplified for 16 / 24 px, square, ≥ 64 px
//   apps/desktop/resources/app-icons/src/<id>-<n>.png     optional: a hand-made n×n picture used as is at n px (pixel
//                                                          art); sizes that divide n are taken from it pixel for pixel
// into resources/app-icons/<id>/icon-<16…256>.png and icon.ico (Windows shortcuts / window). The default style
// (螺钿) is also the build's icon — cutex.exe, the .app, the tray before any choice — so its set goes to
// resources/icons instead. The masters are not in the repository or the app (see app-icons/src/README.md); every
// master found is built; add the style's entry to shared/appIcons.ts too (test/appIcons.test.ts checks both ways).
// The 「旧版墨龙」 set is built by scripts/make-icons.mjs. Pure Node.
//
//   node scripts/make-app-icons.mjs [id …]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodeIco, encodePng, resize } from "./lib/pngIcon.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "apps/desktop/resources");
const base = join(res, "app-icons");
const srcDir = join(base, "src");
// Keep in step with shared/appIcons.ts APP_ICON_SIZES / APP_ICON_ICO_SIZES / APP_ICON_SMALL_MAX / APP_ICON_ID /
// DEFAULT_APP_ICON / LEGACY_APP_ICON.
const SIZES = [16, 24, 32, 48, 64, 128, 256];
// 512 px only for the default style: the .icns and the build's own icon need it; a chosen style's largest use is
// the macOS Dock while running (256 is enough there), and 512s of all styles would add about 4 MB to the app.
const BUILD_SIZES = [...SIZES, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_MAX = 24;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT = "luodian";
const LEGACY = "ink-dragon";

function load(file, min, exact = 0) {
  const img = decodePng(readFileSync(file));
  if (img.width !== img.height) throw new Error(`${file}: not square (${img.width}×${img.height})`);
  if (exact && img.width !== exact) throw new Error(`${file}: ${img.width} px, must be exactly ${exact}`);
  if (img.width < min) throw new Error(`${file}: ${img.width} px, needs at least ${min}`);
  return img;
}

/** Every k-th pixel (k = n / size, a whole number): a hand-made pixel-art picture stays crisp at half / third size. */
function sample({ width, px }, size) {
  const k = width / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px.copy(out, (y * size + x) * 4, ((y * k) * width + x * k) * 4, ((y * k) * width + x * k) * 4 + 4);
  return out;
}

const only = process.argv.slice(2);
const names = existsSync(srcDir) ? readdirSync(srcDir) : [];
const masters = names.filter((n) => n.endsWith(".png") && !/-(small|\d+)\.png$/.test(n)).filter((n) => !only.length || only.includes(n.slice(0, -4)));
if (!masters.length) console.log(`no masters in ${srcDir}`);
for (const name of masters) {
  const id = name.slice(0, -4);
  if (!ID.test(id) || id === "default" || id === LEGACY) throw new Error(`${name}: id must match ${ID} and not be "default" or "${LEGACY}"`);
  const big = load(join(srcDir, name), 1024);
  const smallFile = join(srcDir, `${id}-small.png`);
  const small = existsSync(smallFile) ? load(smallFile, 64) : null;
  const exact = new Map();
  for (const n of names) {
    const m = n.match(/^(.+)-(\d+)\.png$/);
    if (m && m[1] === id) exact.set(Number(m[2]), load(join(srcDir, n), 1, Number(m[2])));
  }
  const out = id === DEFAULT ? join(res, "icons") : join(base, id);
  mkdirSync(out, { recursive: true });
  const pngs = new Map();
  const how = [];
  for (const size of id === DEFAULT ? BUILD_SIZES : SIZES) {
    const own = exact.get(size);
    const parent = [...exact.keys()].sort((a, b) => a - b).find((n) => n > size && n % size === 0);
    const px = own ? own.px : parent ? sample(exact.get(parent), size) : resize(small && size <= SMALL_MAX ? small : big, size);
    if (own || parent) how.push(`${size} from ${own ? "its own" : `the ${parent} px`} picture`);
    const png = encodePng(px, size);
    pngs.set(size, png);
    writeFileSync(join(out, `icon-${size}.png`), png);
  }
  writeFileSync(join(out, "icon.ico"), encodeIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
  console.log(`${id}: ${(id === DEFAULT ? BUILD_SIZES : SIZES).join(", ")} + icon.ico → ${out}${small ? " (16 / 24 from the small drawing)" : ""}${how.length ? ` (${how.join("; ")})` : ""}`);
}
