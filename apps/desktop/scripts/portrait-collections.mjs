#!/usr/bin/env node
// Build immutable collection archives and an index for the desktop release signer.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { writeTarGz } from "./module-packs/tar.mjs";
import { signMinisig } from "./module-packs/minisign.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scripts, "..");
const descriptor = (path, bytes) => ({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });

export async function buildPortraitCollections({ out, baseUrl, sequence, version = 1, testSign = false }) {
  const root = join(appDir, "src/renderer");
  const { module: build } = await runnerImport(join(scripts, "portraitCollectionsBuild.ts"));
  const full = build.portraitManifest(root);
  build.starterManifest(full, await readFile(join(root, "src/dev/mockBridge.ts"), "utf8"));
  const themes = [];
  const packages = new Map();
  for (const theme of full.themes) {
    const entries = full.entries.filter(e => e.theme === theme.id);
    const manifest = { ...full, total: entries.length, themes: [theme], entries };
    const files = new Map([["manifest.json", Buffer.from(JSON.stringify(manifest))]]);
    for (const file of build.portraitFiles(manifest)) files.set(file, await readFile(join(build.portraitAssets(root), file)));
    const compressed = writeTarGz([...files].map(([path, data]) => ({ path, data })));
    const name = `${theme.id}-${version}.tar.gz`;
    packages.set(name, compressed);
    themes.push({ theme: theme.id, version, archive: { ...descriptor(name, compressed), url: `${baseUrl}/${name}` }, files: [...files].map(([name, data]) => descriptor(name, data)) });
  }
  const index = { schema: 1, sequence, collections: themes };
  const { module: schema } = await runnerImport(join(appDir, "src/shared/portraitCollections.ts"));
  const { module: urls } = await runnerImport(join(appDir, "src/shared/binaryUpdate.ts"));
  const extra = testSign && new URL(baseUrl).hostname === "127.0.0.1" ? [new URL(baseUrl).origin] : [];
  schema.parsePortraitCollectionIndex(index, url => urls.downloadUrlAllowed(url, extra));
  if (out) {
    await mkdir(out, { recursive: true });
    const indexBytes = Buffer.from(JSON.stringify(index, null, 2) + "\n");
    for (const [name, bytes] of packages) await writeFile(join(out, name), bytes, { flag: "wx" });
    await writeFile(join(out, "portraits.json"), indexBytes, { flag: "wx" });
    if (testSign) await writeFile(join(out, "portraits.json.minisig"), signMinisig(indexBytes, "portraits.json"), { flag: "wx" });
  }
  return { index, packages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, baseUrl, sequence, version, ...opts] = process.argv.slice(2);
  if (!out || !baseUrl || !sequence || opts.some(v => v !== "--test-sign")) {
    throw Error("usage: node scripts/portrait-collections.mjs OUT BASE_URL SEQUENCE VERSION [--test-sign]");
  }
  await buildPortraitCollections({ out, baseUrl, sequence: Number(sequence), version: Number(version ?? 1), testSign: opts.includes("--test-sign") });
}
