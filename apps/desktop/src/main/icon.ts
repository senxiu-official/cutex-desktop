// Icon helpers. The app / tray art is the owner's logo (resources/icons, built by
// scripts/make-icons.mjs); this module draws only what goes on top of it: the attention dot (with a
// transparent cut-out so it reads on any background) and the small taskbar overlay badge. PNG bytes
// are encoded here with node:zlib so nativeImage.createFromBuffer can load them.
import { deflateSync } from "node:zlib";

type Rgba = readonly [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
// Mint green after Si (Arknights: Endfield), whose ink style the logo follows (owner 2026-10-07).
const DOT: Rgba = [92, 214, 180, 255]; // #5cd6b4

const SUPERSAMPLE = 4;

/** Coverage-weighted RGBA for one pixel, sampling `shade(x, y)` on a SUPERSAMPLE² grid (unit coords). */
function render(size: number, shade: (x: number, y: number) => Rgba | null): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const c = shade((px + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size);
          if (!c) continue;
          const alpha = c[3] / 255;
          r += c[0] * alpha;
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += alpha;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return out;
}

/**
 * Put the attention dot on square straight-alpha pixels in place: clear a ring around it, then
 * blend the mint dot over. Channel order is given so it works on RGBA and BGRA (nativeImage) data.
 */
export function addAttentionDot(pixels: Uint8Array, size: number, order: "rgba" | "bgra" = "rgba"): Uint8Array {
  const dot = render(size, (x, y) => (Math.hypot(x - 0.8, y - 0.2) <= 0.19 ? DOT : null));
  const cut = render(size, (x, y) => (Math.hypot(x - 0.8, y - 0.2) <= 0.27 ? WHITE : null));
  const [ri, bi] = order === "rgba" ? [0, 2] : [2, 0];
  for (let i = 0; i < size * size * 4; i += 4) {
    const base = (pixels[i + 3]! / 255) * (1 - cut[i + 3]! / 255);
    const top = dot[i + 3]! / 255;
    const alpha = top + base * (1 - top);
    if (alpha <= 0) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
      continue;
    }
    const mix = (d: number, b: number) => Math.round((d * top + b * base * (1 - top)) / alpha);
    const [r, g, bl] = [pixels[i + ri]!, pixels[i + 1]!, pixels[i + bi]!];
    pixels[i + ri] = mix(dot[i]!, r);
    pixels[i + 1] = mix(dot[i + 1]!, g);
    pixels[i + bi] = mix(dot[i + 2]!, bl);
    pixels[i + 3] = Math.round(alpha * 255);
  }
  return pixels;
}

/** RGBA pixels of the small taskbar overlay badge (a mint dot with a white rim). */
export function overlayPixels(size: number): Uint8Array {
  return render(size, (x, y) => {
    const d = Math.hypot(x - 0.5, y - 0.5);
    return d <= 0.36 ? DOT : d <= 0.48 ? WHITE : null;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Encode square RGBA pixels as a PNG (8-bit RGBA, no filtering). */
export function encodePng(pixels: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export function overlayPng(size: number): Buffer {
  return encodePng(overlayPixels(size), size);
}
