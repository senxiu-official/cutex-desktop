import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { downloadUrlAllowed, githubRepoOf, GITHUB_WEB } from "../shared/binaryUpdate";
import { DEFAULT_PORTRAIT_PACK } from "../shared/portraitDefaults";
import { isThemeId, parsePackManifest, portraitImageType, type UserPortraitPack } from "../shared/portraitPacks";
import {
  parsePortraitCollectionIndex, PORTRAIT_ARCHIVE_LIMIT, PORTRAIT_COLLECTIONS_INDEX as INDEX, PORTRAIT_COLLECTIONS_RELEASE,
  PORTRAIT_FILE_LIMIT, type PortraitCollection, type PortraitCollectionIndex, type PortraitCollectionsRequest,
  type PortraitCollectionsView, type PortraitFile,
} from "../shared/portraitCollections";
import { DEFAULT_MODULES_REPO, MODULE_PACK_TEST_PUBLIC_KEY, PACK_PATH_RE } from "../shared/modulePacks";
import { download } from "./binaryUpdate";
import { writeFileAtomic } from "./fileWrites";
import { parsePublicKey, releaseKeyring, verifyData } from "./minisign";
import { fetchCapped, readTar } from "./modulePacks";
import { isPlainDir, readFileSafe } from "./portraitPacks";
import type { Transport } from "./updateTransport";

export function portraitCollectionSource(releasePage: string | null, packaged: boolean, fixture?: string) {
  const repo = githubRepoOf(releasePage) ?? DEFAULT_MODULES_REPO;
  let url = `${GITHUB_WEB}/${repo.owner}/${repo.repo}/releases/download/${PORTRAIT_COLLECTIONS_RELEASE}/${INDEX}`;
  const keys = [...releaseKeyring()];
  const extraOrigins: string[] = [];
  if (!packaged) {
    keys.push(parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY));
    if (fixture && /^http:\/\/127\.0\.0\.1:\d{1,5}\/(?:[A-Za-z0-9_-]+\/)*portraits\.json$/.test(fixture)) {
      url = fixture;
      extraOrigins.push(new URL(url).origin);
    }
  }
  return { url, keys, extraOrigins };
}

type ErrorCode = NonNullable<PortraitCollectionsView["error"]>["code"];
class CollectionError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

class LegacyDigestMismatch extends Error {}

export interface LegacyPortraitRoot {
  dir: string;
  label: string;
}

interface Proof {
  bytes: Buffer;
  signature: string;
  index: PortraitCollectionIndex;
}
interface Installed {
  dir: string;
  pack: UserPortraitPack;
  files: Map<string, PortraitFile>;
  version: number;
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const matches = (bytes: Buffer | undefined, file: PortraitFile): bytes is Buffer =>
  !!bytes && bytes.length === file.size && sha(bytes) === file.sha256;

async function readAt(root: string, path: string, cap: number) {
  if (!PACK_PATH_RE.test(path)) return undefined;
  const parts = path.split("/");
  let dir = root;
  if (!await isPlainDir(dir)) return undefined;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    if (!await isPlainDir(dir)) return undefined;
  }
  return (await readFileSafe(join(dir, parts.at(-1)!), cap))?.bytes;
}

function payload(manifest: unknown, files: Map<string, PortraitFile>, theme?: string): UserPortraitPack {
  const pack = parsePackManifest(manifest);
  if (!pack?.themes.length || (theme && (pack.themes.length !== 1 || pack.themes[0]?.id !== theme))) throw Error("bad portrait manifest");
  const paths = pack.themes.flatMap(t => t.entries.flatMap(e => e.previewPath ? [e.avatarPath, e.previewPath] : [e.avatarPath]));
  if (paths.some(path => !files.has(path)) || paths.length !== files.size - Number(files.has("manifest.json"))) throw Error("portrait file list differs");
  return { id: DEFAULT_PORTRAIT_PACK, ...pack };
}

export class PortraitCollectionStore {
  private proof: Proof | null = null;
  private legacy: Installed | null = null;
  private readonly installed = new Map<string, Installed>();
  private loaded: Promise<void> | null = null;
  private operation: PortraitCollectionsView["operation"] = null;
  private error: PortraitCollectionsView["error"] = null;
  private active: Record<string, number[]> = {};
  private sequence = 0;

  constructor(private readonly deps: {
    root: string;
    source: ReturnType<typeof portraitCollectionSource>;
    transport: Transport;
    legacyProof?: string;
    legacyRoots?: () => readonly LegacyPortraitRoot[];
    log?: (message: string) => void;
    onChange?: (view: PortraitCollectionsView, packsChanged: boolean) => void;
  }) {}

  private verify(bytes: Buffer, signature: string): Proof {
    try { verifyData(bytes, signature, this.deps.source.keys, INDEX); }
    catch { throw new CollectionError("signature_invalid"); }
    try {
      const index = parsePortraitCollectionIndex(JSON.parse(bytes.toString("utf8")), url => downloadUrlAllowed(url, this.deps.source.extraOrigins));
      return { index, bytes, signature };
    } catch { throw new CollectionError("index_invalid"); }
  }

  private async verifyFiles(dir: string, files: readonly PortraitFile[]) {
    const expected = new Map(files.map(f => [f.path, f]));
    await batchFiles(files, async file => {
      const data = await readAt(dir, file.path, file.size);
      if (!matches(data, file) || (file.path !== "manifest.json" && !portraitImageType(data))) throw Error("invalid installed portrait file");
    });
    return expected;
  }

  private async restore() {
    const root = this.deps.root;
    await mkdir(root, { recursive: true });
    if (!await isPlainDir(root)) throw Error("invalid portrait collection directory");
    try {
      const saved = JSON.parse((await readAt(root, "state.json", 64 * 1024))!.toString("utf8"));
      if (Number.isSafeInteger(saved.sequence) && saved.sequence >= 0) this.sequence = saved.sequence;
      for (const [theme, list] of Object.entries(saved.active ?? {})) {
        if (isThemeId(theme) && Array.isArray(list)) this.active[theme] = list.filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 2);
      }
    } catch { /* Fresh profile. */ }
    try {
      const cache = JSON.parse((await readAt(root, "catalog.json", 2 * 1024 * 1024))!.toString("utf8"));
      const proof = this.verify(Buffer.from(cache.bytes, "base64"), cache.signature);
      if (proof.index.sequence >= this.sequence) this.proof = proof;
    } catch { /* Catalogue can be refreshed without touching installed packs. */ }
    await Promise.all(Object.entries(this.active).map(async ([theme, versions]) => {
      for (const version of versions) {
        try {
          if (!await isPlainDir(join(root, theme))) break;
          this.installed.set(theme, await this.readInstalled(theme, version, join(root, theme, String(version))));
          break;
        } catch { /* Try the prior verified revision. */ }
      }
    }));
    await this.restoreLegacy();
  }

  private async readInstalled(theme: string, version: number, dir: string): Promise<Installed> {
    const proof = this.verify(
      (await readAt(dir, INDEX, 1024 * 1024))!,
      (await readAt(dir, INDEX + ".minisig", 4096))!.toString("utf8"),
    );
    const row = proof.index.collections.find(r => r.theme === theme && r.version === version);
    if (!row) throw Error("portrait collection absent from proof");
    const files = await this.verifyFiles(dir, row.files);
    return { dir, version, files, pack: payload(JSON.parse((await readAt(dir, "manifest.json", 2 * 1024 * 1024))!.toString("utf8")), files, theme) };
  }

  private async restoreLegacy() {
    if (!this.deps.legacyProof) return;
    const { root } = this.deps;
    const target = join(root, "legacy");
    try {
      const { manifest, files } = JSON.parse(await readFile(this.deps.legacyProof, "utf8")) as { manifest: unknown; files: PortraitFile[] };
      const expected = new Map(files.map(file => [file.path, file]));
      const pack = payload(manifest, expected);
      if (await lstat(target).catch(() => null)) {
        try {
          await this.verifyFiles(target, files);
          this.legacy = { dir: target, version: 0, files: expected, pack };
          await this.removeQuarantinedLegacy();
          return;
        } catch {
          await rename(target, join(root, `.legacy-invalid-${randomUUID()}`));
        }
      }
      for (const { dir, label } of this.deps.legacyRoots?.() ?? []) {
        const staging = join(root, `.legacy-${randomUUID()}`);
        try {
          await mkdir(staging);
          await batchFiles(files, async file => {
            const bytes = await readAt(dir, file.path, file.size);
            if (!bytes) throw Error("legacy portrait is missing or unreadable");
            if (!matches(bytes, file)) throw new LegacyDigestMismatch();
            await put(staging, file.path, bytes);
          });
          await this.verifyFiles(staging, files);
          await rename(staging, target);
          this.legacy = { dir: target, version: 0, files: expected, pack };
          await this.removeQuarantinedLegacy();
          return;
        } catch (error) {
          if (error instanceof LegacyDigestMismatch) this.deps.log?.(`skipped legacy release root ${JSON.stringify(label)}: digest mismatch`);
        } finally {
          await rm(staging, { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch { /* Legacy source is optional on a new install. */ }
  }

  private async removeQuarantinedLegacy() {
    const { root } = this.deps;
    for (const name of await readdir(root).catch(() => [])) {
      if (/^\.legacy-invalid-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)) {
        await rm(join(root, name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  ready(): Promise<void> { return this.loaded ??= this.restore(); }

  view(): PortraitCollectionsView {
    const rows = new Map((this.proof?.index.collections ?? []).map(row => [row.theme, row]));
    const installedThemes = new Set([...(this.legacy?.pack.themes.map(t => t.id) ?? []), ...this.installed.keys()]);
    return {
      checked: !!this.proof,
      themes: [...new Set([...rows.keys(), ...installedThemes])].map(theme => ({
        theme, available: rows.get(theme)?.version ?? null, installed: this.installed.get(theme)?.version ?? (installedThemes.has(theme) ? 0 : null),
        bytes: rows.get(theme)?.archive.size ?? null,
      })),
      operation: this.operation,
      error: this.error,
    };
  }

  packs(): UserPortraitPack[] {
    const themes = new Map((this.legacy?.pack.themes ?? []).map(t => [t.id, t]));
    for (const asset of this.installed.values()) for (const theme of asset.pack.themes) themes.set(theme.id, theme);
    return themes.size ? [{ id: DEFAULT_PORTRAIT_PACK, name: this.legacy?.pack.name ?? [...this.installed.values()][0]?.pack.name ?? null, themes: [...themes.values()] }] : [];
  }

  async image(pack: string, theme: string, stem: string, kind: "full" | "preview"): Promise<string | null> {
    if (pack !== DEFAULT_PORTRAIT_PACK) return null;
    await this.ready();
    for (const asset of [this.installed.get(theme), this.legacy]) {
      const entry = asset?.pack.themes.find(t => t.id === theme)?.entries.find(e => e.stem === stem);
      if (!asset || !entry) continue;
      const path = (kind === "preview" ? entry.previewPath : null) ?? entry.avatarPath;
      const expected = asset.files.get(path);
      if (!expected) continue;
      const data = await readAt(asset.dir, path, expected.size);
      const type = matches(data, expected) ? portraitImageType(data) : null;
      if (type && data) return `data:${type};base64,${data.toString("base64")}`;
    }
    return null;
  }

  private notify(changed = false) { this.deps.onChange?.(this.view(), changed); }
  private save(active = this.active, sequence = this.sequence) {
    writeFileAtomic(join(this.deps.root, "state.json"), JSON.stringify({ active, sequence }));
    this.active = active;
    this.sequence = sequence;
  }

  async request(req: PortraitCollectionsRequest): Promise<PortraitCollectionsView> {
    await this.ready();
    if (!req || !["state", "check", "install", "retry"].includes(req.op) || (req.op === "install" && !isThemeId(req.theme))) throw Error("invalid portrait collection request");
    if (req.op === "state" || this.operation || (req.op === "retry" && !this.error)) return this.view();
    const theme = req.op === "install" ? req.theme : req.op === "retry" ? this.error?.theme ?? null : null;
    this.operation = { theme, step: theme && this.proof ? "download" : "check" };
    this.error = null;
    this.notify();
    let changed = false;
    try {
      if (!theme || !this.proof) await this.refresh();
      if (theme) changed = await this.install(theme);
    } catch (error) {
      this.error = { theme, code: error instanceof CollectionError ? error.code : "install_failed" };
    } finally {
      this.operation = null;
      this.notify(changed);
    }
    return this.view();
  }

  private async refresh() {
    const { source, transport, root } = this.deps;
    let bytes: Buffer;
    let signature: string;
    try {
      [bytes, signature] = await Promise.all([
        fetchCapped(transport, source.url, 1024 * 1024, source.extraOrigins),
        fetchCapped(transport, source.url + ".minisig", 4096, source.extraOrigins).then(b => b.toString("utf8")),
      ]);
    } catch { throw new CollectionError("index_unavailable"); }
    const proof = this.verify(bytes, signature);
    if (proof.index.sequence < Math.max(this.sequence, this.proof?.index.sequence ?? 0) || (this.proof && proof.index.sequence === this.proof.index.sequence && !bytes.equals(this.proof.bytes))) {
      throw new CollectionError("index_rollback");
    }
    writeFileAtomic(join(root, "catalog.json"), JSON.stringify({ bytes: bytes.toString("base64"), signature }));
    this.save(this.active, proof.index.sequence);
    this.proof = proof;
  }

  private async install(theme: string): Promise<boolean> {
    const proof = this.proof!;
    const row = proof.index.collections.find(e => e.theme === theme);
    if (!row || row.version < (this.installed.get(theme)?.version ?? 0)) throw new CollectionError("not_available");
    if (row.version === this.installed.get(theme)?.version) return false;
    const { root, source, transport } = this.deps;
    const id = randomUUID();
    const staging = join(root, `.stage-${id}`);
    const temp = join(root, `.download-${id}`);
    const themeDir = join(root, theme);
    const target = join(themeDir, String(row.version));
    let moved = false;
    let committed = false;
    const step = (s: NonNullable<PortraitCollectionsView["operation"]>["step"], received?: number) => {
      this.operation = { theme, step: s, total: row.archive.size, received };
      this.notify();
    };
    try {
      step("download", 0);
      try {
        await download(transport, row.archive.url, temp, {
          max: PORTRAIT_ARCHIVE_LIMIT, size: row.archive.size, extraOrigins: source.extraOrigins,
          onProgress: received => step("download", received),
        });
      } catch { throw new CollectionError("download_failed"); }
      step("verify");
      const files = await verifiedArchive(temp, row);
      step("install");
      await mkdir(staging);
      for (const [path, bytes] of files) await put(staging, path, bytes);
      await put(staging, INDEX, proof.bytes);
      await put(staging, INDEX + ".minisig", proof.signature);
      const installed = await this.readInstalled(theme, row.version, staging);
      await mkdir(themeDir, { recursive: true });
      if (!await isPlainDir(themeDir)) throw Error("invalid portrait theme directory");
      // A crash after rename but before state.json can leave an already verified version here.
      if (await isPlainDir(target)) {
        await this.readInstalled(theme, row.version, target);
      } else {
        await rename(staging, target);
        moved = true;
      }
      const versions = [row.version, this.installed.get(theme)?.version].filter((v): v is number => typeof v === "number");
      this.save({ ...this.active, [theme]: versions });
      committed = true;
      this.installed.set(theme, { ...installed, dir: target });
      for (const entry of await readdir(themeDir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !/^[1-9][0-9]*$/.test(entry.name)) continue;
        const version = Number(entry.name);
        if (version < row.version && !versions.includes(version)) {
          await rm(join(themeDir, entry.name), { recursive: true, force: true }).catch(() => {});
        }
      }
      return true;
    } finally {
      await rm(temp, { force: true }).catch(() => {});
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      if (moved && !committed) await rm(target, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// Bounded I/O. Wait for all writes in a batch before removing an incomplete staging tree.
async function batchFiles(files: readonly PortraitFile[], run: (file: PortraitFile) => Promise<void>) {
  const limit = 16;
  for (let offset = 0; offset < files.length; offset += limit) {
    const results = await Promise.allSettled(files.slice(offset, offset + limit).map(run));
    const rejected = results.find(result => result.status === "rejected");
    if (rejected) throw rejected.reason;
  }
}

async function put(dir: string, path: string, bytes: Buffer | string) {
  const parts = path.split("/");
  await mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(join(dir, ...parts), bytes, { flag: "wx" });
}

async function verifiedArchive(path: string, row: PortraitCollection) {
  try {
    const bytes = await readFile(path);
    if (!matches(bytes, row.archive)) throw Error("portrait archive hash differs");
    const files = readTar(gunzipSync(bytes, { maxOutputLength: PORTRAIT_ARCHIVE_LIMIT + 1024 * (PORTRAIT_FILE_LIMIT + 4) }), PORTRAIT_FILE_LIMIT);
    if (files.size !== row.files.length || row.files.some(f => !matches(files.get(f.path), f))) throw Error("portrait file hash differs");
    return files;
  } catch { throw new CollectionError("verify_failed"); }
}
