#!/usr/bin/env node
// Draws the desk pet's built-in format 2 example `reader` (docs/desktop-modules.md §29.9): an original round creature that
// reads books from a pile beside it, made here from ellipses and rounded rectangles, so the pack ships no outside art.
// Writes art/reader/*.png and pet.json, and records every image in art/manifest.json with its sha256.
//   node apps/desktop/scripts/module-packs/desk-pet-reader.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../src/renderer/src/modules/desk-pet/art");
const OUT = join(ART, "reader");
const TOOL = "procedural (apps/desktop/scripts/module-packs/desk-pet-reader.mjs)";

// ---- a tiny raster: straight-alpha RGBA, anti-aliased shapes by signed distance ----

function raster(w, h) {
  return { w, h, px: new Float64Array(w * h * 4) };
}
function over(r, x, y, colour, cov) {
  if (cov <= 0 || x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const a = cov * (colour[3] ?? 1);
  const at = (y * r.w + x) * 4;
  const below = r.px[at + 3];
  const out = a + below * (1 - a);
  if (out <= 0) return;
  for (let c = 0; c < 3; c++) r.px[at + c] = (colour[c] * a + r.px[at + c] * below * (1 - a)) / out;
  r.px[at + 3] = out;
}
/** Fills where `dist(px, py)` < 0 (signed distance in pixels), within a bounding box. */
function fill(r, box, dist, colour) {
  const [x0, y0, x1, y1] = box.map((v, i) => (i < 2 ? Math.floor(v) - 2 : Math.ceil(v) + 2));
  for (let y = Math.max(0, y0); y < Math.min(r.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(r.w, x1); x++) {
      const d = dist(x + 0.5, y + 0.5);
      over(r, x, y, colour, Math.max(0, Math.min(1, 0.5 - d)));
    }
  }
}
const ellipse = (r, cx, cy, rx, ry, colour) =>
  fill(r, [cx - rx, cy - ry, cx + rx, cy + ry], (x, y) => {
    const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return (k - 1) * Math.min(rx, ry);
  }, colour);
const rect = (r, x, y, w, h, rad, colour) =>
  fill(r, [x, y, x + w, y + h], (px, py) => {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - rad);
    const qy = Math.abs(py - (y + h / 2)) - (h / 2 - rad);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  }, colour);
/** A convex polygon, points clockwise. */
const poly = (r, pts, colour) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  fill(r, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (px, py) => {
    let d = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      d = Math.max(d, ((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / len);
    }
    return d;
  }, colour);
};

function png(r) {
  const raw = Buffer.alloc((r.w * 4 + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    raw[y * (r.w * 4 + 1)] = 0;
    for (let x = 0; x < r.w * 4; x++) raw[y * (r.w * 4 + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, x % 4 === 3 ? r.px[y * r.w * 4 + x] : r.px[y * r.w * 4 + x] / 255)) * 255);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.w, 0);
  ihdr.writeUInt32BE(r.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- the character: 256 × 256, sitting; the feet never move ----

const BODY = [244, 205, 148];
const LINE = [86, 62, 48];
const CHEEK = [238, 150, 130, 0.55];
const PAGE = [251, 247, 236];
const GREEN = [72, 150, 92];
const GREEN_DARK = [48, 112, 66];
const S = 256;

/** `breath` 0..1 raises the top of the body; `eyes`: "up", "down", "closed", "sleep". */
function body({ breath = 0, eyes = "up", paws = false }) {
  const r = raster(S, S);
  const ry = 62 + breath * 2.2;
  const cy = 228 - ry;
  const lift = (ry - 62) * 0.9;
  // Ears, then the outline, then the body.
  for (const x of [86, 170]) {
    ellipse(r, x, 120 - lift, 17, 17, LINE);
    ellipse(r, x, 120 - lift, 13, 13, BODY);
  }
  ellipse(r, 128, cy, 73, ry + 3, LINE);
  ellipse(r, 128, cy, 70, ry, BODY);
  for (const x of [98, 158]) {
    ellipse(r, x, 229, 20, 10, LINE);
    ellipse(r, x, 228, 17, 8, BODY);
  }
  const fy = (eyes === "down" || eyes === "closed" ? 156 : eyes === "sleep" ? 160 : 150) - lift;
  for (const x of [106, 150]) {
    if (eyes === "up") ellipse(r, x, fy, 5, 6, LINE);
    else if (eyes === "down") ellipse(r, x, fy, 5, 3.5, LINE);
    else rect(r, x - 7, fy - 1.5, 14, 3, 1.5, LINE);
  }
  for (const x of [92, 164]) ellipse(r, x, fy + 14, 9, 6, CHEEK);
  rect(r, 123, fy + 15, 10, 3, 1.5, LINE);
  if (paws) for (const x of [90, 166]) paw(r, x);
  return r;
}
function paw(r, x) {
  ellipse(r, x, 204, 13, 12, LINE);
  ellipse(r, x, 204, 10, 9, BODY);
}

/** The open book held in the paws; its green cover takes a cover's tint. */
function openBook() {
  const r = raster(S, S);
  rect(r, 76, 178, 104, 42, 5, GREEN_DARK);
  rect(r, 78, 180, 100, 38, 4, GREEN);
  rect(r, 84, 182, 43, 32, 2, PAGE);
  rect(r, 129, 182, 43, 32, 2, PAGE);
  rect(r, 127, 181, 2, 34, 1, LINE);
  for (let i = 0; i < 4; i++) {
    rect(r, 90, 188 + i * 6, 30, 1.6, 0.8, [170, 160, 150]);
    rect(r, 135, 188 + i * 6, 30, 1.6, 0.8, [170, 160, 150]);
  }
  // The paws hold it: part of the held book, so the paws stay over it while it is read.
  for (const x of [90, 166]) paw(r, x);
  return r;
}
function hands() {
  const r = raster(S, S);
  for (const x of [90, 166]) paw(r, x);
  return r;
}
/** A page in mid-turn: from lying right, through upright, to lying left. */
function page(step) {
  const r = raster(S, S);
  const shapes = {
    lift: [[129, 176], [168, 172], [170, 206], [129, 212]],
    upright: [[124, 158], [133, 158], [133, 212], [124, 212]],
    land: [[88, 172], [127, 176], [127, 212], [86, 206]],
  };
  const pts = shapes[step];
  poly(r, pts.map(([x, y]) => [x, y]), [120, 110, 100]);
  poly(r, pts.map(([x, y]) => [x + (x < 128 ? 1 : -1) * 0.8, y + 0.8]), PAGE);
  return r;
}
function sparkle() {
  const r = raster(10, 12);
  poly(r, [[5, 0], [6.4, 4.6], [5, 12], [3.6, 4.6]], [255, 226, 120]);
  poly(r, [[0, 6], [5, 4.8], [10, 6], [5, 7.2]], [255, 240, 170]);
  return r;
}
/** One closed book lying flat, seen from the front and a little above: 72 × 24. */
function pileBook() {
  const r = raster(72, 24);
  poly(r, [[12, 1], [71, 1], [60, 13], [1, 13]], GREEN_DARK);
  poly(r, [[13, 2], [69, 2], [59, 12], [3, 12]], GREEN);
  rect(r, 1, 12, 60, 8, 1, [236, 228, 208]);
  for (let i = 0; i < 3; i++) rect(r, 3, 14 + i * 2, 56, 0.8, 0.4, [200, 190, 172]);
  poly(r, [[60, 13], [71, 1], [71, 9], [61, 21]], GREEN_DARK);
  rect(r, 0, 19, 62, 4, 1.5, GREEN_DARK);
  return r;
}
/** A cover picture for the night book: a pale star and moon on navy. */
function starCover() {
  const r = raster(64, 64);
  rect(r, 0, 0, 64, 64, 4, [36, 44, 92]);
  rect(r, 4, 4, 56, 56, 3, [48, 60, 120]);
  const star = (cx, cy, s) => {
    poly(r, [[cx, cy - s], [cx + s * 0.28, cy - s * 0.28], [cx, cy + s], [cx - s * 0.28, cy - s * 0.28]].map(([x, y]) => [x, y]), [250, 232, 150]);
    poly(r, [[cx - s, cy], [cx, cy - s * 0.25], [cx + s, cy], [cx, cy + s * 0.25]], [250, 232, 150]);
  };
  star(24, 28, 12);
  star(44, 44, 6);
  ellipse(r, 46, 18, 8, 8, [250, 240, 200]);
  ellipse(r, 49, 16, 7, 7, [48, 60, 120]);
  return r;
}

// ---- files ----

const files = {};
const BREATH = [0, 0.5, 1, 0.5].map((b) => b);
files["up.png"] = body({});
BREATH.forEach((b, i) => (files[`up-${i}.png`] = body({ breath: b })));
files["read.png"] = body({ eyes: "down", paws: true });
BREATH.forEach((b, i) => (files[`read-${i}.png`] = body({ breath: b, eyes: "down", paws: true })));
files["read-blink.png"] = body({ eyes: "closed", paws: true });
files["sleep.png"] = body({ eyes: "sleep" });
BREATH.forEach((b, i) => (files[`sleep-${i}.png`] = body({ breath: b * 1.6, eyes: "sleep" })));
files["book-open.png"] = openBook();
files["hands.png"] = hands();
for (const step of ["lift", "upright", "land"]) files[`page-${step}.png`] = page(step);
files["sparkle.png"] = sparkle();
files["pile-book.png"] = pileBook();
files["cover-night.png"] = starCover();

const magic = (from, to) => Array.from({ length: 5 }, (_, i) => ({ body: "read", prop: "open", ms: 90, magic: from + ((to - from) * i) / 4 }));
const pet = {
  format: 2,
  name: { en: "Reader", "zh-CN": "读书团子" },
  canvas: [320, 256],
  character: [0, 0, 256, 256],
  breathMs: 3600,
  bodies: {
    up: { still: "up.png", breath: BREATH.map((_, i) => `up-${i}.png`) },
    read: { still: "read.png", breath: BREATH.map((_, i) => `read-${i}.png`) },
    "read-blink": { still: "read-blink.png" },
    sleep: { still: "sleep.png", breath: BREATH.map((_, i) => `sleep-${i}.png`) },
  },
  props: { open: { image: "book-open.png", cover: {} } },
  pages: { lift: "page-lift.png", upright: "page-upright.png", land: "page-land.png" },
  hands: "hands.png",
  sparkle: { image: "sparkle.png", size: [10, 12], at: [[82, 176], [176, 172], [128, 168], [100, 222]] },
  covers: {
    green: { kind: "book" },
    plum: { kind: "diary", tint: [1.15, 0.6, 1.25] },
    night: { kind: "book", tint: [0.55, 0.7, 1.3], image: "cover-night.png" },
  },
  pile: { image: "pile-book.png", at: [240, 226], size: [72, 24], step: 7, max: 20, cover: [[13, 2], [69, 2], [59, 12], [3, 12]], deck: [{ cover: "green" }, { cover: "green" }, { cover: "plum" }, { cover: "green" }, { cover: "night" }] },
  clips: {
    idle: [{ body: "up", ms: 2400 }],
    opening: [{ body: "up", ms: 160 }, { body: "read", ms: 180 }, ...magic(0, 1), { body: "read", prop: "open", ms: 300 }],
    reading: [
      { body: "read", prop: "open", ms: 3000 },
      { body: "read-blink", prop: "open", ms: 180 },
      { body: "read", prop: "open", ms: 1700 },
      { body: "read", prop: "open", ms: 150, page: "lift" },
      { body: "read", prop: "open", ms: 150, page: "upright" },
      { body: "read", prop: "open", ms: 150, page: "land" },
      { body: "read", prop: "open", ms: 1500 },
    ],
    closing: [{ body: "read", prop: "open", ms: 200 }, ...magic(1, 0), { body: "read", ms: 180 }, { body: "up", ms: 400 }],
    fallAsleep: [{ body: "up", ms: 900 }, { body: "sleep", ms: 1200 }],
    sleeping: [{ body: "sleep", ms: 2000 }],
    wake: [{ body: "sleep", ms: 500 }, { body: "up", ms: 600 }],
  },
};

const PROMPT = "Original placeholder, no reference image: a round peach creature with small round ears, dot eyes and pink cheeks, sitting; drawn by this script from ellipses, rounded rectangles and polygons. Bodies breathe by raising the top of the body while the feet stay; an open green book with paw overlay, three page-turn overlays, a sparkle, a closed-book pile sprite and a star-and-moon cover picture.";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifestPath = join(ART, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.images = manifest.images.filter((i) => !i.path.startsWith("reader/"));
for (const [name, r] of Object.entries(files)) {
  const bytes = png(r);
  writeFileSync(join(OUT, name), bytes);
  manifest.images.push({ path: `reader/${name}`, source: "generated", tool: TOOL, prompt: PROMPT, sha256: createHash("sha256").update(bytes).digest("hex") });
}
writeFileSync(join(OUT, "pet.json"), `${JSON.stringify(pet, null, 2)}\n`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`reader: ${Object.keys(files).length} images`);
