// Trusted local catalog and one-use documents. No caller-supplied HTML or filesystem paths.
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createFrameDocumentStore, type FrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { buildSandboxDocument } from "@cutex-desktop/plugin-sandbox/document";
import { isPluginAssetPath, parsePluginManifest, PLUGIN_ID_RE, type PluginCatalog, type PluginManifest } from "@cutex-desktop/plugin-sandbox/manifest";

export const PLUGIN_SCHEME = "cutex-plugin";
const MAX_MANIFEST = 64 * 1024, MAX_ASSET = 512 * 1024, MAX_PACKAGE = 1024 * 1024;
const IDENTITY = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface PluginPrepareRequest { pluginId: string; fingerprint: string; instanceId: string; channel: string }
export interface PreparedPluginDocument { id: string; url: string }

function within(root: string, path: string): boolean {
  const part = relative(root, path); return !part.startsWith(".." + sep) && part !== ".." && !isAbsolute(part);
}
function noLinks(root: string, path: string): void {
  if (!within(root, path)) throw new Error("Plugin path escapes its package");
  let current = root;
  if (lstatSync(current).isSymbolicLink()) throw new Error("Plugin directory symlinks are not allowed");
  const parts = relative(root, path).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!); const entry = lstatSync(current);
    if (entry.isSymbolicLink()) throw new Error("Plugin symlinks are not allowed");
    if (index < parts.length - 1 && !entry.isDirectory()) throw new Error("Invalid plugin directory");
  }
}
function readAsset(root: string, packageRoot: string, asset: string, max: number): string {
  if (!isPluginAssetPath(asset)) throw new Error("Invalid plugin asset path");
  const path = resolve(packageRoot, asset);
  noLinks(root, path);
  const canonical = realpathSync(path);
  if (!within(realpathSync(packageRoot), canonical)) throw new Error("Plugin asset escapes its package");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > max) throw new Error("Invalid or oversized plugin asset");
    // A package directory changed during opening must not turn into a read outside the catalog.
    noLinks(root, path);
    const current = lstatSync(path);
    if (realpathSync(path) !== canonical || current.dev !== before.dev || current.ino !== before.ino) throw new Error("Plugin asset changed while opening");
    const bytes = Buffer.alloc(Math.min(max + 1, before.size + 1));
    let offset = 0, read = 0;
    while (offset < bytes.length && (read = readSync(fd, bytes, offset, bytes.length - offset, offset)) > 0) offset += read;
    const after = fstatSync(fd);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Plugin asset changed while reading");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
  } finally { closeSync(fd); }
}
function loadPackage(root: string, id: string) {
  if (!PLUGIN_ID_RE.test(id)) throw new Error("Invalid plugin id");
  const packageRoot = join(root, id); noLinks(root, packageRoot);
  const manifest = parsePluginManifest(JSON.parse(readAsset(root, packageRoot, "manifest.json", MAX_MANIFEST)));
  if (manifest.id !== id) throw new Error("Plugin manifest id does not match its directory");
  const assets = new Map<string, string>();
  let bytes = 0;
  for (const path of [manifest.entry, ...(manifest.script ? [manifest.script] : []), ...manifest.styles]) {
    const text = readAsset(root, packageRoot, path, MAX_ASSET); bytes += Buffer.byteLength(text);
    if (bytes > MAX_PACKAGE) throw new Error("Plugin package exceeds size limit");
    assets.set(path, text);
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(manifest));
  for (const [path, content] of assets) fingerprint.update(JSON.stringify([path, content]));
  return { manifest, fingerprint: fingerprint.digest("hex"), html: assets.get(manifest.entry)!, script: manifest.script ? assets.get(manifest.script)! : "", styles: manifest.styles.map(path => assets.get(path)!) };
}

/**
 * `documents`: the window's shared one-use frame store (main/index.ts; agent pages use the same one).
 * Without it the service keeps its own (tests).
 */
export function createPluginResourceService(catalogPath: string, options: { now?: () => number; documents?: FrameDocumentStore } = {}) {
  const root = resolve(catalogPath);
  const documents = options.documents ?? createFrameDocumentStore({ scheme: PLUGIN_SCHEME, now: options.now, limitMessage: "Too many prepared plugin documents" });
  const catalog = (): PluginCatalog => {
    const result: PluginCatalog = { plugins: [], errors: [] };
    let entries;
    try {
      if (lstatSync(root).isSymbolicLink()) throw new Error("Plugin directory symlinks are not allowed");
      entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.errors.push({ id: "catalog", message: "Plugin catalog is unavailable" });
      return result;
    }
    for (const entry of entries.slice(0, 64)) {
      if (!PLUGIN_ID_RE.test(entry.name)) { result.errors.push({ id: "invalid", message: "Invalid plugin directory name" }); continue; }
      try {
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Plugin must be an ordinary directory");
        const loaded = loadPackage(root, entry.name);
        result.plugins.push({ manifest: loaded.manifest, fingerprint: loaded.fingerprint });
      } catch { result.errors.push({ id: entry.name, message: "Plugin package is invalid or unreadable" }); }
    }
    if (entries.length > 64) result.errors.push({ id: "catalog", message: "Plugin catalog exceeds 64 packages" });
    return result;
  };
  return {
    list: catalog,
    prepare(owner: number, request: PluginPrepareRequest): PreparedPluginDocument {
      if (!Number.isSafeInteger(owner) || owner < 0 || !request || typeof request !== "object"
        || Object.keys(request).sort().join() !== "channel,fingerprint,instanceId,pluginId"
        || typeof request.pluginId !== "string" || !PLUGIN_ID_RE.test(request.pluginId)
        || typeof request.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(request.fingerprint)
        || typeof request.instanceId !== "string" || !IDENTITY.test(request.instanceId)
        || typeof request.channel !== "string" || !IDENTITY.test(request.channel)) throw new Error("Invalid plugin document request");
      let loaded: ReturnType<typeof loadPackage>;
      try { loaded = loadPackage(root, request.pluginId); } catch { throw new Error("Plugin package is invalid or unreadable"); }
      if (loaded.fingerprint !== request.fingerprint) throw new Error("Plugin package changed; reload the catalog and review permissions");
      return documents.add(owner, buildSandboxDocument({ instanceId: request.instanceId, channel: request.channel, html: loaded.html, script: loaded.script, styles: loaded.styles }));
    },
    release: (owner: number, id: string): void => documents.release(owner, id),
    releaseOwner: (owner: number): void => documents.releaseOwner(owner),
    ownsUrl: (value: string, owner: number): boolean => documents.ownsUrl(value, owner),
    respond: (request: Request): Response => documents.respond(request),
  };
}
