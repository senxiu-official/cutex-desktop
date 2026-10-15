// Build the app icon set from the owner's logo (apps/desktop/resources/logo.png, square RGB(A) PNG):
// transparent outside the brush-drawn rounded frame, area-averaged down to each size, written as
// resources/icons/icon-<n>.png and a PNG-entry icon.ico (Windows). Pure Node, no image libraries.
//
//   node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "apps/desktop/resources");
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// The frame's outer edge in unit coordinates (measured on the 1254² logo: the black ground starts
// ~3% in, corners round with ~9% radius). Pixels outside become transparent, with a 1.5 px feather.
const INSET = 0.028;
const RADIUS = 0.095;

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, type = 0, depth = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + p) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = line[x * bpp]; px[o + 1] = line[x * bpp + 1]; px[o + 2] = line[x * bpp + 2]; px[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
}

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

/** Area-average (premultiplied) resample to size×size. */
function resize({ width, height, px }, size) {
  const out = Buffer.alloc(size * size * 4);
  const sx = width / size, sy = height / size;
  for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) {
    const x0 = ox * sx, x1 = x0 + sx, y0 = oy * sy, y1 = y0 + sy;
    let r = 0, g = 0, b = 0, a = 0, w = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const wy = Math.min(y + 1, y1) - Math.max(y, y0);
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const wx = Math.min(x + 1, x1) - Math.max(x, x0);
        const o = (y * width + x) * 4, k = wx * wy, al = px[o + 3] / 255;
        r += px[o] * al * k; g += px[o + 1] * al * k; b += px[o + 2] * al * k; a += al * k; w += k;
      }
    }
    const o = (oy * size + ox) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = Math.round((a / w) * 255);
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
function encodePng(px, size) {
  const h = Buffer.alloc(13); h.writeUInt32BE(size, 0); h.writeUInt32BE(size, 4); h[8] = 8; h[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", h), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function encodeIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

const src = masked(decodePng(readFileSync(join(res, "logo.png"))));
mkdirSync(join(res, "icons"), { recursive: true });
const pngs = new Map();
for (const size of SIZES) {
  const png = encodePng(resize(src, size), size);
  pngs.set(size, png);
  writeFileSync(join(res, "icons", `icon-${size}.png`), png);
}
writeFileSync(join(res, "icons", "icon.ico"), encodeIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
console.log(`icons: ${SIZES.join(", ")} + icon.ico → ${join(res, "icons")}`);
