#!/usr/bin/env node
// Builds the 中文字体包 release asset (shared/fontCatalog.ts FONT_PACK_ARCHIVE): one uncompressed ustar archive with
// exactly the catalog's pack files and their license folders, byte-for-byte reproducible (sorted entries, fixed
// mtime / mode / owner), so anyone can rebuild it and compare the SHA-256 the app pins.
//
//   node apps/desktop/scripts/font-pack-archive.mjs <folder with the pack files> <out dir>
//
// The folder is searched (3 levels) for each catalog file name, as the app's import does; every file must match its
// catalog SHA-256. License texts come from this repo's LICENSES/fonts/<id>/. The WOFF2 / TTF files are already
// compressed, so the archive is not gzipped (and the app reads it without unpacking it in memory).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const ARCHIVE_NAME = "cutex-fonts-zh-1";
const MTIME = 1794268800; // 2026-11-10T00:00:00Z
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** The pack families from the generated catalog (a TS file of one JSON array). */
function packFamilies() {
  const src = readFileSync(join(repo, "apps/desktop/src/shared/fontCatalog.generated.ts"), "utf8");
  const json = src.slice(src.indexOf("= [") + 2, src.lastIndexOf("];") + 1);
  return JSON.parse(json).filter((e) => e.delivery === "pack");
}

function find(folder, names, depth = 0, found = new Map()) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isFile() && names.has(entry.name) && !found.has(entry.name)) found.set(entry.name, path);
    else if (entry.isDirectory() && depth < 3) find(path, names, depth + 1, found);
  }
  return found;
}

function header(path, size) {
  const h = Buffer.alloc(512, 0);
  if (Buffer.byteLength(path) > 100) throw new Error(`path too long for a plain ustar header: ${path}`);
  h.write(path, 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "latin1");
  h.write("0000000\0", 108, 8, "latin1");
  h.write("0000000\0", 116, 8, "latin1");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
  h.write(MTIME.toString(8).padStart(11, "0") + "\0", 136, 12, "latin1");
  h.write("        ", 148, 8, "latin1");
  h.write("0", 156, 1, "latin1");
  h.write("ustar\0", 257, 6, "latin1");
  h.write("00", 263, 2, "latin1");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
  return h;
}

function main() {
  const [folder, outDir] = process.argv.slice(2);
  if (!folder || !outDir) throw new Error("usage: font-pack-archive.mjs <folder with the pack files> <out dir>");
  const families = packFamilies();
  const faces = families.flatMap((e) => e.faces);
  const found = find(resolve(folder), new Set(faces.map((f) => f.file)));
  const entries = [];
  for (const face of faces) {
    const path = found.get(face.file);
    if (!path) throw new Error(`missing ${face.file}`);
    const data = readFileSync(path);
    if (data.length !== face.bytes || sha256(data) !== face.sha256) throw new Error(`${face.file} does not match the catalog`);
    entries.push([`${ARCHIVE_NAME}/fonts/${face.file}`, data]);
  }
  for (const family of families) {
    const dir = join(repo, "LICENSES/fonts", family.id);
    for (const name of readdirSync(dir).sort()) entries.push([`${ARCHIVE_NAME}/licenses/${family.id}/${name}`, readFileSync(join(dir, name))]);
  }
  const lines = faces.map((f) => `${f.sha256}  fonts/${f.file}`).join("\n");
  entries.push([`${ARCHIVE_NAME}/README.txt`, Buffer.from(
    "Cutex desktop: 中文字体包 (Chinese font pack), SIL Open Font License 1.1.\n" +
    "Each family's OFL text, copyright notices and pinned upstream source are under licenses/<family>/.\n" +
    "The fonts are the upstream files, unmodified apart from the WOFF2 container where noted in licenses/.\n" +
    "The desktop installs only the files below and checks each SHA-256:\n\n" + lines + "\n", "utf8")]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = [];
  for (const [path, data] of entries) {
    parts.push(header(path, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(parts);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${ARCHIVE_NAME}.tar`);
  writeFileSync(out, tar);
  const sum = sha256(tar);
  writeFileSync(`${out}.sha256`, `${sum}  ${ARCHIVE_NAME}.tar\n`);
  console.log(JSON.stringify({ file: out, name: `${ARCHIVE_NAME}.tar`, bytes: statSync(out).size, sha256: sum, entries: entries.length }, null, 2));
}

main();
