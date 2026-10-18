// Deterministic .tar.gz for module packs (docs/desktop-modules.md §23.2): ustar, regular files only, sorted
// by path, mode 0644, uid / gid 0, mtime 0, no user / group names; gzip with mtime 0 and OS "unknown", so
// the same files always give the same bytes. main/modulePacks.ts readTar accepts exactly this shape.
import { gzipSync } from "node:zlib";

function field(buf, offset, length, text) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > length) throw new Error(`tar field too long: ${text}`);
  bytes.copy(buf, offset);
}

function octal(buf, offset, length, value) {
  field(buf, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
}

function header(path, size) {
  const h = Buffer.alloc(512);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) throw new Error(`path too long for ustar: ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  field(h, 0, 100, name);
  octal(h, 100, 8, 0o644);
  octal(h, 108, 8, 0);
  octal(h, 116, 8, 0);
  octal(h, 124, 12, size);
  octal(h, 136, 12, 0);
  h.fill(0x20, 148, 156);
  h[156] = 0x30;
  field(h, 257, 6, "ustar\0");
  field(h, 263, 2, "00");
  field(h, 345, 155, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  field(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

/** An uncompressed ustar archive of `files` ([{ path, data }]), sorted by path. */
export function writeTar(files) {
  const parts = [];
  for (const { path, data } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const bytes = Buffer.from(data);
    parts.push(header(path, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** gzip with a fixed header (mtime 0, OS byte 0xff = unknown). */
export function gzipFixed(data) {
  const out = gzipSync(data, { level: 9 });
  out[9] = 0xff;
  return out;
}

/** writeTar + gzipFixed. */
export function writeTarGz(files) {
  return gzipFixed(writeTar(files));
}
