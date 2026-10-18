#!/usr/bin/env node
// Module index generator (docs/desktop-modules.md §23.3, §23.10).
//
//   node scripts/module-packs/index.mjs --packs DIR --base-url URL [--previous modules.json]
//        --out modules.json [--new-list FILE] [--test-sign] [--now UNIX_SECONDS]
//
// DIR holds build.mjs output (<id>-<version>.tar.gz + <id>-<version>.pack.json). Each archive is checked
// against its entry (size, sha256) and gets url = <base-url>/<archive name>. --previous is the published
// index (the CALLER verifies its signature first: CI runs `minisign -V` with cutex-release.pub): its
// entries are kept, so the owner can still choose an older version; an id + version that is already
// published must be byte-identical (same archive sha256, same file list), else the build stops (bump the
// version). serial = max(now, previous serial + 1). The result is checked with the app's own strict
// parser (src/shared/modulePacks.ts parseModuleIndex) before it is written.
//
// --new-list FILE: the archives the index adds (one path per line), i.e. what must be uploaded.
// --test-sign: also writes <out>.minisig signed with the module-pack TEST key (local end-to-end runs only;
// a packaged app never trusts it). Release signing is `minisign -S` in CI (.github/ci/modules-release.sh).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { signMinisig } from "./minisign.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, "../..");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function sameEntry(a, b) {
  const files = (e) => JSON.stringify([...e.files].sort((x, y) => (x.path < y.path ? -1 : 1)));
  return a.archive.sha256 === b.archive.sha256 && a.archive.size === b.archive.size && files(a) === files(b) && a.moduleApi === b.moduleApi && a.entry === b.entry;
}

function cmpVersion(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

async function strictParser() {
  const vite = await import("vite");
  const { module: shared } = await vite.runnerImport(join(APP_DIR, "src/shared/modulePacks.ts"));
  const { module: bin } = await vite.runnerImport(join(APP_DIR, "src/shared/binaryUpdate.ts"));
  return { parseModuleIndex: shared.parseModuleIndex, downloadUrlAllowed: bin.downloadUrlAllowed };
}

/**
 * Builds the index object. `packsDir` entries + `previous` (parsed JSON or null). Returns
 * { index, added: [archive paths] }; throws on any conflict.
 */
export async function makeIndex({ packsDir, baseUrl, previous = null, now = Math.floor(Date.now() / 1000) }) {
  if (!/^(?:https:\/\/[^/?#\s]+|http:\/\/127\.0\.0\.1:\d{1,5})(?:\/[A-Za-z0-9._~%-]+)*$/.test(baseUrl)) throw new Error(`bad --base-url ${baseUrl} (https, or http://127.0.0.1:<port> for a local fixture; no trailing slash)`);
  const base = new URL(baseUrl);
  const extraOrigins = base.protocol === "http:" ? [base.origin] : [];
  const { parseModuleIndex, downloadUrlAllowed } = await strictParser();
  const allowed = (href) => downloadUrlAllowed(href, extraOrigins);
  let prev = null;
  if (previous) prev = parseModuleIndex(previous, () => true);
  const byKey = new Map();
  for (const p of prev?.packs ?? []) byKey.set(`${p.id}@${p.version}`, p);
  const added = [];
  const names = readdirSync(packsDir).filter((n) => n.endsWith(".pack.json")).sort();
  if (!names.length && !prev) throw new Error(`${packsDir} has no *.pack.json`);
  for (const name of names) {
    const entry = JSON.parse(readFileSync(join(packsDir, name), "utf8"));
    if (name !== `${entry.id}-${entry.version}.pack.json`) throw new Error(`${name}: does not match its id / version`);
    const archivePath = join(packsDir, entry.archive?.name ?? "");
    if (!entry.archive?.name || !existsSync(archivePath)) throw new Error(`${name}: archive ${entry.archive?.name} is missing`);
    const archive = readFileSync(archivePath);
    if (archive.length !== entry.archive.size || sha256(archive) !== entry.archive.sha256) throw new Error(`${entry.archive.name} does not match ${name}`);
    const key = `${entry.id}@${entry.version}`;
    const published = byKey.get(key);
    if (published) {
      if (!sameEntry(published, entry)) throw new Error(`${entry.id} ${entry.version} is already published with different contents: bump modules/${entry.id}/pack.json "version"`);
      continue; // keep the published entry (and its url) as it is
    }
    byKey.set(key, { ...entry, archive: { ...entry.archive, url: `${baseUrl}/${encodeURIComponent(entry.archive.name)}` } });
    added.push(archivePath);
  }
  const packs = [...byKey.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : cmpVersion(a.version, b.version)));
  const serial = Math.max(now, (prev?.serial ?? 0) + 1);
  const index = { schema: 1, serial, generatedAt: new Date(serial * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"), packs };
  // The app's own parser over exactly what is written: new archive URLs must be GitHub download hosts
  // (or the local fixture origin); published entries keep the URL they were published with.
  const publishedUrls = new Set((prev?.packs ?? []).map((p) => p.archive.url));
  parseModuleIndex(JSON.parse(JSON.stringify(index)), (href) => allowed(href) || publishedUrls.has(href));
  return { index, added };
}

async function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--packs") opts.packs = val();
    else if (a === "--base-url") opts.baseUrl = val();
    else if (a === "--previous") opts.previous = val();
    else if (a === "--out") opts.out = val();
    else if (a === "--new-list") opts.newList = val();
    else if (a === "--now") opts.now = Number(val());
    else if (a === "--test-sign") opts.testSign = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.packs || !opts.baseUrl || !opts.out) {
    console.error("usage: index.mjs --packs DIR --base-url URL [--previous modules.json] --out modules.json [--new-list FILE] [--test-sign] [--now SECONDS]");
    return 2;
  }
  if (opts.now !== undefined && !Number.isSafeInteger(opts.now)) throw new Error("--now must be whole seconds");
  const previous = opts.previous ? JSON.parse(readFileSync(opts.previous, "utf8")) : null;
  const { index, added } = await makeIndex({ packsDir: resolve(opts.packs), baseUrl: opts.baseUrl.replace(/\/+$/, ""), previous, ...(opts.now !== undefined ? { now: opts.now } : {}) });
  const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, "utf8");
  writeFileSync(opts.out, bytes);
  if (opts.newList) writeFileSync(opts.newList, added.map((p) => `${p}\n`).join(""));
  if (opts.testSign) writeFileSync(`${opts.out}.minisig`, signMinisig(bytes, "modules.json"));
  console.log(`modules.json: serial ${index.serial}, ${index.packs.length} pack version(s), ${added.length} new`);
  for (const p of added) console.log(`  new: ${p}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
