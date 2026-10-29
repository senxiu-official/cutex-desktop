#!/usr/bin/env node
// 拟人头像包 import (docs/design/040 §3.2): the owner's avatar generator output (a zip or a folder with
// manifest.json + avatars/<theme>/<model>-vN.png + previews/…) → a pack the app reads, pictures as WebP.
//
//   node scripts/avatar-pack-import.mjs <pack.zip | folder> [--id <pack-id>] [--name <名字>]
//        [--user | --out <dir>] [--size 192] [--quality 74] [--preview-size 64] [--preview-quality 75]
//        [--ffmpeg <path>] [--jobs 6]
//
// Default output (shipped in the app; rebuild): the pictures to apps/desktop/src/renderer/public/avatars/portraits/<id>/
// (plain files, no module per picture) and the manifest to apps/desktop/src/renderer/src/assets/avatars/portraits/<id>.json.
// --out <dir>: the whole pack (manifest.json + pictures) to <dir>/<id>/.
// --user: <userData>/avatars/portraits/<id>/ (this machine only; Settings → 外观 → 拟人头像 → 重新扫描).
// The pack folder is replaced as a whole (same id = the new version of that pack; agents wearing a picture that
// is gone fall back in the app, see 040 §3.2). Needs ffmpeg with libwebp (PATH, $FFMPEG or --ffmpeg).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_FILES = join(repo, "apps/desktop/src/renderer/public/avatars/portraits");
const BUNDLED_MANIFESTS = join(repo, "apps/desktop/src/renderer/src/assets/avatars/portraits");
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;
const STEM = /^[a-z0-9][a-z0-9_-]{0,12}$/;
const IMAGE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_./-]{1,200}\.(png|jpe?g|webp)$/i;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user") out.user = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const opt = args(process.argv.slice(2));
const input = opt._[0];
if (!input || opt.help) {
  console.error("usage: node scripts/avatar-pack-import.mjs <pack.zip | folder> [--id <pack-id>] [--name <name>] [--user | --out <dir>]");
  process.exit(input ? 0 : 2);
}
const SIZE = Number(opt.size ?? 192);
const QUALITY = Number(opt.quality ?? 74);
const PREVIEW = Number(opt["preview-size"] ?? 64);
const PREVIEW_Q = Number(opt["preview-quality"] ?? 75);
const JOBS = Math.max(1, Number(opt.jobs ?? Math.min(8, cpus().length)));

function userData() {
  if (process.env.CUTEX_DESKTOP_USER_DATA) return process.env.CUTEX_DESKTOP_USER_DATA;
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Cutex");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Cutex");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Cutex");
}

function findFfmpeg() {
  for (const c of [opt.ffmpeg, process.env.FFMPEG, "ffmpeg"].filter(Boolean)) {
    const r = spawnSync(c, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (r.status === 0 && /libwebp/.test(r.stdout)) return c;
  }
  console.error("ffmpeg with libwebp not found: install it, put it on PATH, or pass --ffmpeg <path>.");
  process.exit(1);
}

/** The folder holding manifest.json (or avatars/): the input itself or one level down. */
function packRoot(dir) {
  const has = (d) => existsSync(join(d, "manifest.json")) || existsSync(join(d, "avatars"));
  if (has(dir)) return dir;
  for (const name of readdirSync(dir)) if (statSync(join(dir, name)).isDirectory() && has(join(dir, name))) return join(dir, name);
  console.error(`no manifest.json or avatars/ in ${dir}`);
  process.exit(1);
}

function extract(zip) {
  const dir = mkdtempSync(join(tmpdir(), "cutex-avatar-pack-"));
  // bsdtar (Windows 10+, macOS) reads zip and refuses absolute / `..` paths; elsewhere unzip.
  // On Windows the system tar.exe (bsdtar), not a GNU tar from Git Bash (which reads `D:` as a remote host).
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  let r = spawnSync(tar, ["-xf", zip, "-C", dir], { stdio: "inherit" });
  if (r.status !== 0) r = spawnSync("unzip", ["-q", zip, "-d", dir], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`could not extract ${zip} (needs tar with zip support, or unzip)`);
    process.exit(1);
  }
  return dir;
}

const stemOf = (p) => basename(p).replace(/\.[a-z]+$/i, "").toLowerCase();
const modelOf = (stem) => stem.replace(/[-_]v?\d+$/, "");

/** Entries from the manifest (or the avatars/ folders), checked like the app checks them. */
function readEntries(root) {
  let raw = [];
  let meta = {};
  const manifest = join(root, "manifest.json");
  if (existsSync(manifest)) {
    meta = JSON.parse(readFileSync(manifest, "utf8"));
    if (meta.schemaVersion !== 1 || !Array.isArray(meta.entries)) throw new Error("manifest.json: not schemaVersion 1");
    raw = meta.entries;
  } else {
    for (const theme of readdirSync(join(root, "avatars"))) {
      if (!statSync(join(root, "avatars", theme)).isDirectory()) continue;
      for (const f of readdirSync(join(root, "avatars", theme)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })))
        if (/\.(png|jpe?g|webp)$/i.test(f)) raw.push({ theme, themeName: theme, avatarPath: `avatars/${theme}/${f}`, previewPath: `previews/${theme}/${f}` });
    }
  }
  const seen = new Set();
  const entries = [];
  let dropped = 0;
  for (const e of raw) {
    const stem = typeof e?.avatarPath === "string" ? stemOf(e.avatarPath) : "";
    const key = `${e?.theme}/${stem}`;
    if (!THEME_ID.test(e?.theme ?? "") || !IMAGE_PATH.test(e?.avatarPath ?? "") || !STEM.test(stem) || seen.has(key) || !existsSync(join(root, e.avatarPath))) {
      dropped++;
      continue;
    }
    seen.add(key);
    const preview = typeof e.previewPath === "string" && IMAGE_PATH.test(e.previewPath) && existsSync(join(root, e.previewPath)) ? e.previewPath : null;
    entries.push({
      theme: e.theme,
      themeName: typeof e.themeName === "string" && e.themeName.trim() ? e.themeName.trim() : e.theme,
      model: typeof e.model === "string" && e.model ? e.model.toLowerCase() : modelOf(stem),
      ...(typeof e.modelName === "string" ? { modelName: e.modelName } : {}),
      ...(Number.isInteger(e.variant) ? { variant: e.variant } : {}),
      stem,
      src: e.avatarPath,
      srcPreview: preview,
    });
  }
  return { entries, dropped, meta };
}

function run(ffmpeg, argv) {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpeg, argv, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? ok() : fail(new Error(err.trim() || `ffmpeg exited ${code}`))));
  });
}

const webp = (ffmpeg, src, dst, size, quality) =>
  run(ffmpeg, ["-loglevel", "error", "-y", "-i", src, "-vf", `scale=${size}:${size}:flags=lanczos`, "-c:v", "libwebp", "-quality", String(quality), "-compression_level", "6", dst]);

async function pool(items, jobs, work) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await work(item);
        if (++done % 50 === 0 || done === items.length) process.stdout.write(`\r  ${done} / ${items.length}`);
      }
    }),
  );
  process.stdout.write("\n");
}

function sizeOf(dir) {
  let n = 0;
  for (const name of readdirSync(dir, { recursive: true })) {
    const p = join(dir, String(name));
    if (statSync(p).isFile()) n += statSync(p).size;
  }
  return n;
}

const ffmpeg = findFfmpeg();
const source = resolve(input);
const temp = statSync(source).isFile() ? extract(source) : null;
try {
  const root = packRoot(temp ?? source);
  const id = opt.id ?? basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
  if (!PACK_ID.test(id)) {
    console.error(`pack id "${id}": use --id with a–z 0–9 - (at most 20)`);
    process.exit(2);
  }
  const { entries, dropped, meta } = readEntries(root);
  if (!entries.length) {
    console.error("no usable pictures");
    process.exit(1);
  }
  const bundled = !opt.out && !opt.user;
  const base = opt.out ? resolve(opt.out) : opt.user ? join(userData(), "avatars", "portraits") : BUNDLED_FILES;
  const out = join(base, id);
  const work = `${out}.import-${process.pid}`;
  rmSync(work, { recursive: true, force: true });
  console.log(`${entries.length} pictures (${new Set(entries.map((e) => e.theme)).size} themes)${dropped ? `, ${dropped} skipped` : ""} → ${out}`);
  await pool(entries, JOBS, async (e) => {
    mkdirSync(join(work, "avatars", e.theme), { recursive: true });
    mkdirSync(join(work, "previews", e.theme), { recursive: true });
    await webp(ffmpeg, join(root, e.src), join(work, "avatars", e.theme, `${e.stem}.webp`), SIZE, QUALITY);
    await webp(ffmpeg, join(root, e.srcPreview ?? e.src), join(work, "previews", e.theme, `${e.stem}.webp`), PREVIEW, PREVIEW_Q);
  });
  const name = opt.name ?? (typeof meta.name === "string" || (meta.name && typeof meta.name === "object") ? meta.name : null);
  const manifest = {
    schemaVersion: 1,
    ...(name ? { name } : {}),
    ...(typeof meta.source === "string" ? { source: meta.source } : {}),
    importedAt: new Date().toISOString().slice(0, 10),
    total: entries.length,
    entries: entries.map(({ stem, src: _src, srcPreview: _p, ...e }) => ({ ...e, avatarPath: `avatars/${e.theme}/${stem}.webp`, previewPath: `previews/${e.theme}/${stem}.webp` })),
  };
  writeFileSync(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  if (bundled) {
    // Shipped: the manifest is imported by the renderer (src), the pictures are served as they are (public).
    mkdirSync(BUNDLED_MANIFESTS, { recursive: true });
    renameSync(join(work, "manifest.json"), join(BUNDLED_MANIFESTS, `${id}.json`));
  }
  renameSync(work, out);
  console.log(`done: ${(sizeOf(out) / 1024 / 1024).toFixed(1)} MB`);
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}
