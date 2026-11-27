import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readTar } from "../src/main/modulePacks";
import { PortraitCollectionStore, portraitCollectionSource } from "../src/main/portraitCollections";
import { nodeTransport } from "../src/main/updateTransport";
import { parsePortraitCollectionIndex } from "../src/shared/portraitCollections";
import { signMinisig } from "../scripts/module-packs/minisign.mjs";
import { writeTarGz } from "../scripts/module-packs/tar.mjs";
import { starterManifest, portraitManifest } from "../scripts/portraitCollectionsBuild";

const root = join(import.meta.dirname, "../src/renderer");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const describe = (path: string, data: Buffer) => ({ path, size: data.length, sha256: hash(data) });

it("retains 124 starter pictures, all default families, all onboarding covers and hard-coded mock refs", async () => {
  const manifest = portraitManifest(root);
  const starter = starterManifest(manifest, await readFile(join(root, "src/dev/mockBridge.ts"), "utf8"));
  expect(starter.total).toBe(124);
  expect(starter.themes).toHaveLength(20);
  expect(starterManifest(manifest, "")).toEqual(starter);
  expect(() => starterManifest(manifest, '"portrait:kit-20261029/great-ming/gpt/06"')).toThrow(/new mock/);
});

it("verifies loopback downloads, retains two revisions, and reopens the last verified copy offline", async () => {
  const path = await mkdtemp(join(tmpdir(), "cutex-portrait-fixture-"));
  const assets = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const bytes = assets.get(req.url ?? "");
    if (!bytes) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Length": bytes.length }).end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const theme = "great-ming";
    const entry = portraitManifest(root).entries.find(e => e.id === "great-ming/gpt/02")!;
    const image = await readFile(join(root, "public/avatars/portraits/kit-20261029", entry.avatarPath));
    const files = [{ path: "manifest.json", data: Buffer.from(JSON.stringify({ schemaVersion: 1, entries: [{ ...entry, previewPath: null }] })) }, { path: entry.avatarPath, data: image }];
    const archive = writeTarGz(files) as Buffer;
    const publish = (sequence: number, version: number) => {
      const filename = `${theme}-${version}.tar.gz`;
      assets.set(`/${filename}`, archive);
      const index = { schema: 1, sequence, collections: [{ theme, version, archive: { ...describe(filename, archive), url: `${origin}/${filename}` }, files: files.map(f => describe(f.path, f.data)) }] };
      const bytes = Buffer.from(JSON.stringify(index));
      assets.set("/portraits.json", bytes);
      assets.set("/portraits.json.minisig", Buffer.from(signMinisig(bytes, "portraits.json")));
      return index;
    };
    const index = publish(2, 1);
    const options = { root: path, source: portraitCollectionSource(null, false, `${origin}/portraits.json`), transport: nodeTransport() };
    const store = new PortraitCollectionStore(options);
    expect(parsePortraitCollectionIndex(index, () => true).collections).toHaveLength(1);
    expect((await store.request({ op: "install", theme })).themes[0]?.installed).toBe(1);
    expect((await store.image("kit-20261029", theme, "gpt/02", "full"))?.startsWith("data:image/webp;")).toBe(true);
    publish(3, 2);
    await store.request({ op: "check" });
    assets.set(`/${theme}-2.tar.gz`, Buffer.alloc(archive.length));
    expect((await store.request({ op: "install", theme })).error?.code).toBe("verify_failed");
    publish(1, 1);
    expect((await store.request({ op: "check" })).error?.code).toBe("index_rollback");
    assets.clear();
    const reopened = new PortraitCollectionStore(options);
    expect((await reopened.request({ op: "state" })).themes[0]?.installed).toBe(1);
    expect(reopened.packs()[0]?.themes[0]?.entries[0]?.stem).toBe("gpt/02");
    const themeDir = join(path, theme);
    await mkdir(join(themeDir, "unrelated"));
    for (const version of [2, 3]) {
      publish(version + 2, version);
      await reopened.request({ op: "check" });
      expect((await reopened.request({ op: "install", theme })).themes[0]?.installed).toBe(version);
    }
    expect((await readdir(themeDir)).sort()).toEqual(["2", "3", "unrelated"]);
    await writeFile(join(themeDir, "3", entry.avatarPath), Buffer.alloc(image.length));
    assets.clear();
    const afterDamage = new PortraitCollectionStore(options);
    expect((await afterDamage.request({ op: "state" })).themes[0]?.installed).toBe(2);
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await rm(path, { recursive: true, force: true });
  }
});

it("rejects Windows device names and trailing dots or spaces in index paths", () => {
  const data = Buffer.from("file");
  const index = (theme: string, name: string) => ({
    schema: 1, sequence: 1, collections: [{
      theme, version: 1,
      archive: { ...describe(`${theme}-1.tar.gz`, data), url: "https://example.invalid/theme" },
      files: [describe("manifest.json", data), describe(`avatars/${theme}/${name}`, data)],
    }],
  });
  expect(parsePortraitCollectionIndex(index("great-ming", "com10/file.webp"), () => true).collections).toHaveLength(1);
  for (const name of ["CON.webp", "PrN.extra.webp", "aux/file.webp", "nul/file.webp", "COM1.webp", "com9/x.webp",
    "Lpt1.webp", "LPT9/01.webp", "folder./01.webp", "folder /01.webp", "01.webp.", "01.webp "]) {
    expect(() => parsePortraitCollectionIndex(index("great-ming", name), () => true), name).toThrow(/invalid portrait collection file/);
  }
  expect(() => parsePortraitCollectionIndex(index("con", "01.webp"), () => true)).toThrow(/invalid portrait collection/);
});

it("keeps a verified legacy copy offline, then quarantines and replaces a damaged copy", async () => {
  const temp = await mkdtemp(join(tmpdir(), "cutex-portrait-legacy-"));
  try {
    const legacy = join(temp, "previous");
    const installed = join(temp, "installed");
    const proof = join(temp, "proof.json");
    const entry = portraitManifest(root).entries.find(e => e.id === "great-ming/gpt/02")!;
    const image = await readFile(join(root, "public/avatars/portraits/kit-20261029", entry.avatarPath));
    await mkdir(join(legacy, "avatars/great-ming/gpt"), { recursive: true });
    await writeFile(join(legacy, entry.avatarPath), image);
    await writeFile(proof, JSON.stringify({ manifest: { schemaVersion: 1, entries: [{ ...entry, previewPath: null }] }, files: [describe(entry.avatarPath, image)] }));
    const logs: string[] = [];
    const options = {
      root: installed, source: portraitCollectionSource(null, false), transport: nodeTransport(), legacyProof: proof,
      legacyRoots: () => [{ dir: legacy, label: "old-releases/previous" }], log: (message: string) => logs.push(message),
    };
    const first = new PortraitCollectionStore(options);
    expect((await first.request({ op: "state" })).themes[0]?.installed).toBe(0);
    await rm(legacy, { recursive: true });
    const second = new PortraitCollectionStore(options);
    expect((await second.image("kit-20261029", "great-ming", "gpt/02", "preview"))?.startsWith("data:image/webp;")).toBe(true);
    const relative = entry.avatarPath.split("/");
    const corrupted = Buffer.alloc(image.length);
    await writeFile(join(installed, "legacy", ...relative), corrupted);
    await mkdir(join(legacy, ...relative.slice(0, -1)), { recursive: true });
    await writeFile(join(legacy, ...relative), corrupted);
    const damaged = new PortraitCollectionStore(options);
    expect((await damaged.request({ op: "state" })).themes).toEqual([]);
    expect(logs).toEqual(['skipped legacy release root "old-releases/previous": digest mismatch']);
    const [quarantine] = await readdir(installed);
    expect(quarantine).toMatch(/^\.legacy-invalid-/);
    expect(await readFile(join(installed, quarantine!, ...relative))).toEqual(corrupted);
    await writeFile(join(legacy, ...relative), image);
    const recovered = new PortraitCollectionStore(options);
    expect((await recovered.request({ op: "state" })).themes[0]?.installed).toBe(0);
    expect(await readdir(installed)).toEqual(["legacy"]);
    expect(await readFile(join(installed, "legacy", ...relative))).toEqual(image);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
