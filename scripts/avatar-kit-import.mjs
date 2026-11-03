#!/usr/bin/env node
// Import the owner's reviewed interaction-kit catalog without changing the source art.
// node scripts/avatar-kit-import.mjs <kit-folder> [--ffmpeg <exe>] [--jobs 4..6] [--scratch <folder>]
// Full portraits: aspect-preserving downscale only, libwebp Q78, alpha, compression 6.
// Supplied 192px thumbnails are copied byte-for-byte. No source PNGs enter the repository.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile, rename, stat, readdir } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACK = "kit-20261029";
const COUNT = 720;
const CHARACTERS = ["gpt", "claude", "gemini", "deepseek", "kimi", "glm"];
const ENGLISH = {
  "cloud-woven-silks": "Cloud-Woven Silks", "great-ming": "Great Ming",
  "tales-of-frills": "Tales of Frills", "ad-astra": "Ad Astra",
  "mountain-city-myriad-layers": "Mountain City", "snowy-owl-post": "Snowy Owl Post",
  "girls-night-in": "Girls' Night In", "misty-city-cyberpunk": "Misty City Cyberpunk",
  "silver-snow-i": "Silver Snow", "mortal-world": "Mortal World",
  "metropolitan-muses": "Metropolitan Muses", "university-universalis": "University Life",
  "uniform-revolution": "Uniform Revolution", "sunlit-shores": "Sunlit Shores",
  "southern-cross": "Southern Cross", "beyond-spotlight": "Beyond the Spotlight",
  "little-callings": "Little Callings", "season-letters": "Season Letters",
  "lanterns-after-dark": "Lanterns After Dark", "kindred-creatures": "Kindred Creatures",
};
// Each theme's cover (the face on its card): one picture per theme, rotating claude, gpt, gemini, deepseek, kimi, glm in
// theme order so neighbouring cards differ (owner 2026-10-29), picked by eye; a theme not listed falls back to gpt/01.
const COVERS = {
  "cloud-woven-silks": "claude/02", "great-ming": "gpt/02", "tales-of-frills": "gemini/03", "ad-astra": "deepseek/05",
  "mountain-city-myriad-layers": "kimi/02", "snowy-owl-post": "glm/06", "girls-night-in": "claude/02",
  "misty-city-cyberpunk": "gpt/01", "silver-snow-i": "gemini/02", "mortal-world": "deepseek/02",
  "metropolitan-muses": "kimi/01", "university-universalis": "glm/03", "uniform-revolution": "claude/02",
  "sunlit-shores": "gpt/03", "southern-cross": "gemini/02", "beyond-spotlight": "deepseek/02",
  "little-callings": "kimi/03", "season-letters": "glm/02", "lanterns-after-dark": "claude/03", "kindred-creatures": "gpt/01",
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function need(condition, message) { if (!condition) throw new Error(message); }

/** Pure catalog adapter. Ordering is theme.order, catalog character order, then numeric variant. */
export function normalizeCatalog(catalog) {
  need(catalog && typeof catalog === "object", "Invalid catalog");
  need(catalog.schemaVersion === 1, "Expected catalog schemaVersion 1");
  need(Array.isArray(catalog.themes) && catalog.themes.length === 20, "Expected 20 catalog themes");
  need(Array.isArray(catalog.characters) && catalog.characters.length === 6, "Expected six catalog characters");
  const characters = catalog.characters.map(character => typeof character === "string" ? character : character.id);
  need(new Set(characters).size === 6 && CHARACTERS.every(id => characters.includes(id)), "Invalid character ids");
  const themes = [...catalog.themes].sort((a, b) => a.order - b.order);
  need(themes.every(theme => /^[a-z0-9][a-z0-9-]{0,31}$/.test(theme.id) && Number.isFinite(theme.order) && typeof theme.name === "string" && theme.name.trim()), "Invalid theme id/order/name");
  need(new Set(themes.map(theme => theme.id)).size === 20 && new Set(themes.map(theme => theme.order)).size === 20, "Duplicate theme id/order");
  const byTheme = new Map(themes.map((theme, index) => [theme.id, index]));
  const byCharacter = new Map(characters.map((id, index) => [id, index]));
  need(Array.isArray(catalog.avatars) && catalog.avatars.length === COUNT, "Expected 720 catalog avatars");
  const seen = new Set();
  const entries = catalog.avatars.map(entry => {
    const { themeId, characterId, variant } = entry;
    const id = `${themeId}/${characterId}/${String(variant).padStart(2, "0")}`;
    need(byTheme.has(themeId) && byCharacter.has(characterId) && Number.isInteger(variant) && variant >= 1 && variant <= 6, `Invalid catalog entry: ${entry.id}`);
    need(entry.id === id && !seen.has(id), `Invalid/duplicate catalog id: ${entry.id}`);
    seen.add(id);
    need(`portrait:${PACK}/${id}`.length <= 64, `Portrait id exceeds 64 characters: ${id}`);
    need(typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256), `Missing source SHA256: ${id}`);
    need(entry.image === `assets/${id}.png` && entry.thumbnail === `thumbnails/${id}.webp`, `Unexpected source paths: ${id}`);
    need(Number.isInteger(entry.width) && entry.width > 0 && Number.isInteger(entry.height) && entry.height > 0, `Invalid source dimensions: ${id}`);
    need(["keep", "needs-work", "unreviewed", "drop"].includes(entry.reviewStatus), `Invalid reviewStatus: ${id}`);
    return { ...entry };
  }).sort((a, b) => byTheme.get(a.themeId) - byTheme.get(b.themeId) || byCharacter.get(a.characterId) - byCharacter.get(b.characterId) || a.variant - b.variant);
  return { themes, characters, entries };
}

function run(executable, args, binary = false) {
  return new Promise((yes, no) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.on("error", no);
    child.on("close", code => code === 0 ? yes(binary ? Buffer.concat(out) : Buffer.concat(out).toString("utf8")) : no(new Error(`${basename(executable)} exit ${code}: ${Buffer.concat(err).toString("utf8").slice(-2000)}`)));
  });
}
function inside(root, path) {
  const full = resolve(root, path), rel = relative(root, full);
  need(rel && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel), `Path escapes root: ${path}`);
  return full;
}
async function imageInfo(ffprobe, path) {
  const data = JSON.parse(await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "json", path]));
  need(data.streams?.length === 1, `Invalid image: ${path}`);
  return data.streams[0];
}
async function alphaInfo(ffmpeg, path) {
  const plane = await run(ffmpeg, ["-v", "error", "-i", path, "-frames:v", "1", "-vf", "format=rgba,alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], true);
  let transparent = 0, opaque = 0;
  for (const value of plane) { if (value < 255) transparent++; if (value > 0) opaque++; }
  need(plane.length && transparent > 0 && opaque > 0, `Missing visible content or transparency: ${path}`);
  return { pixels: plane.length, transparent, visible: opaque };
}
async function concurrent(items, jobs, work) {
  let index = 0, completed = 0, failure;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (!failure && index < items.length) {
      const at = index++;
      try {
        await work(items[at], at);
        completed++;
        if (completed % 60 === 0 || completed === items.length) console.log(`${completed}/${items.length}`);
      } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}
async function treeBytes(path) {
  let bytes = 0, files = 0;
  for (const entry of await readdir(path, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) { const total = await treeBytes(child); bytes += total.bytes; files += total.files; }
    else if (entry.isFile()) { bytes += (await stat(child)).size; files++; }
  }
  return { bytes, files };
}

export async function importKit(source, options = {}) {
  source = resolve(source);
  const ffmpeg = options.ffmpeg ?? process.env.FFMPEG ?? "ffmpeg";
  const ffprobe = options.ffprobe ?? (ffmpeg === "ffmpeg" ? "ffprobe" : join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe"));
  const jobs = Number(options.jobs ?? 4);
  need(Number.isInteger(jobs) && jobs >= 4 && jobs <= 6, "--jobs must be 4, 5 or 6");
  const scratch = resolve(options.scratch ?? join(dirname(source), ".avatar-kit-import"));
  const stage = join(scratch, `converted-${PACK}-${process.pid}`);
  const destination = join(ROOT, "apps/desktop/src/renderer/public/avatars/portraits", PACK);
  const manifestPath = join(ROOT, "apps/desktop/src/renderer/src/assets/avatars/portraits", `${PACK}.json`);
  need(!(await stat(destination).catch(error => { if (error.code === "ENOENT") return null; throw error; })), `Output already exists: ${destination}`);
  need(!(await stat(manifestPath).catch(error => { if (error.code === "ENOENT") return null; throw error; })), `Manifest already exists: ${manifestPath}`);
  const catalogBytes = await readFile(join(source, "catalog.json"));
  const normalized = normalizeCatalog(JSON.parse(catalogBytes.toString("utf8")));
  // Verify every input before conversion; an incomplete copy never publishes a partial pack.
  console.log("Checking 720 source hashes and supplied thumbnails…");
  const inputs = [];
  for (const entry of normalized.entries) {
    const image = inside(source, entry.image), thumbnail = inside(source, entry.thumbnail);
    const bytes = await readFile(image), preview = await readFile(thumbnail);
    need(sha256(bytes) === entry.sha256, `Source SHA256 mismatch: ${entry.id}`);
    inputs.push({ ...entry, image, thumbnail, sourceBytes: bytes.length, previewBytes: preview.length, previewSha256: sha256(preview) });
  }
  await mkdir(scratch, { recursive: true });
  await mkdir(stage, { recursive: false });
  const audits = new Array(COUNT);
  await concurrent(inputs, jobs, async (entry, index) => {
    const full = inside(stage, `avatars/${entry.id}.webp`), preview = inside(stage, `previews/${entry.id}.webp`);
    await mkdir(dirname(full), { recursive: true });
    await mkdir(dirname(preview), { recursive: true });
    const sourceInfo = await imageInfo(ffprobe, entry.image);
    need(sourceInfo.width === entry.width && sourceInfo.height === entry.height, `Catalog dimension mismatch: ${entry.id}`);
    const sourceAlpha = await alphaInfo(ffmpeg, entry.image);
    await run(ffmpeg, ["-v", "error", "-nostdin", "-i", entry.image, "-vf", "scale=w='min(512,iw)':h='min(512,ih)':force_original_aspect_ratio=decrease:flags=lanczos", "-frames:v", "1", "-c:v", "libwebp", "-quality", "78", "-compression_level", "6", "-pix_fmt", "yuva420p", "-threads", "1", full]);
    await copyFile(entry.thumbnail, preview);
    const fullInfo = await imageInfo(ffprobe, full), previewInfo = await imageInfo(ffprobe, preview);
    const ratio = Math.min(1, 512 / entry.width, 512 / entry.height);
    need(fullInfo.width <= 512 && fullInfo.height <= 512 && fullInfo.width <= entry.width && fullInfo.height <= entry.height, `Output upscaled or exceeds cap: ${entry.id}`);
    need(Math.abs(fullInfo.width - entry.width * ratio) <= 1 && Math.abs(fullInfo.height - entry.height * ratio) <= 1, `Output aspect ratio changed: ${entry.id}`);
    need(previewInfo.width === 192 && previewInfo.height === 192, `Supplied thumbnail is not 192px: ${entry.id}`);
    const fullAlpha = await alphaInfo(ffmpeg, full), previewAlpha = await alphaInfo(ffmpeg, preview);
    const output = await readFile(full), copied = await readFile(preview);
    need(sha256(copied) === entry.previewSha256, `Thumbnail copy changed: ${entry.id}`);
    need(sha256(await readFile(entry.image)) === entry.sha256, `Source changed during conversion: ${entry.id}`);
    audits[index] = { id: entry.id, reviewStatus: entry.reviewStatus, sourceSha256: entry.sha256, sourceBytes: entry.sourceBytes,
      sourceDimensions: [entry.width, entry.height], sourceAlpha, fullBytes: output.length, fullSha256: sha256(output),
      fullDimensions: [fullInfo.width, fullInfo.height], fullAlpha, previewBytes: copied.length, previewSha256: entry.previewSha256, previewAlpha };
  });
  const manifest = {
    schemaVersion: 1, name: { "zh-CN": "头像互动套装 20261029", en: "Avatar Interaction Kit 20261029" }, total: COUNT,
    themes: normalized.themes.map(theme => ({ id: theme.id, name: { "zh-CN": theme.name, en: ENGLISH[theme.id] ?? theme.id }, cover: COVERS[theme.id] ?? "gpt/01" })),
    entries: normalized.entries.map(entry => ({ id: entry.id, theme: entry.themeId, themeName: normalized.themes.find(theme => theme.id === entry.themeId).name,
      model: entry.characterId, variant: entry.variant, avatarPath: `avatars/${entry.id}.webp`, previewPath: `previews/${entry.id}.webp`, reviewStatus: entry.reviewStatus })),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const totals = { sourceBytes: 0, fullBytes: 0, previewBytes: 0 };
  for (const entry of audits) for (const key of Object.keys(totals)) totals[key] += entry[key];
  const audit = { packId: PACK, count: COUNT, catalogSha256: sha256(catalogBytes), encoder: { quality: 78, compression: 6, maxDimension: 512, jobs },
    totals: { ...totals, assetsBytes: totals.fullBytes + totals.previewBytes, manifestBytes: Buffer.byteLength(manifestText),
      oldPack: await treeBytes(join(ROOT, "apps/desktop/src/renderer/public/avatars/portraits/overnight-test-v1")) }, entries: audits };
  const auditPath = join(scratch, `${PACK}-audit.json`);
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  // Publication happens only after all 720 source/output/preview checks succeeded.
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });
  await rename(stage, destination);
  await writeFile(manifestPath, manifestText, { flag: "wx" });
  console.log(JSON.stringify({ ...audit.totals, auditPath, destination, manifestPath }, null, 2));
  return audit;
}

async function main() {
  const args = process.argv.slice(2), source = args.shift(), options = {};
  need(source && !source.startsWith("--"), "Usage: node scripts/avatar-kit-import.mjs <kit-folder> [--ffmpeg <exe>] [--jobs 4..6] [--scratch <folder>]");
  while (args.length) {
    const key = args.shift();
    need(["--ffmpeg", "--ffprobe", "--jobs", "--scratch"].includes(key) && args.length, `Unknown/incomplete option: ${key}`);
    options[key.slice(2)] = args.shift();
  }
  await importKit(source, options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
