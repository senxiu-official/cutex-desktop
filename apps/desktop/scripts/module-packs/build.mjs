#!/usr/bin/env node
// Module pack builder (docs/desktop-modules.md §23.2, §23.10): one signed-pack archive per module.
//
//   node scripts/module-packs/build.mjs <id…> --out DIR [--styles]
//
// For each id: a vite library build of src/renderer/src/modules/<id>/ into ONE ES module (no lazy chunks,
// assets inlined) whose exports are { moduleApi, module, messages }. The app's React / react-dom / zustand
// and the app files listed in modules/packHost.ts are not bundled: every import of them becomes a read
// from the host object (globalThis.__CUTEX_MODULE_HOST__.get(spec), rollup syntheticNamedExports), and
// each specifier with the names read from it goes into the pack's `host` list. Anything else under
// src/renderer/src outside the module's own directory is refused (another module, registry.ts, dev/, an
// app file packHost.ts does not list); pure code outside it (src/shared, @cutex-desktop/* packages,
// lucide-react) is bundled. Optional styles (pack.json "styles": true or --styles): Tailwind over this
// module's sources only, inside `@layer cutex-pack` (fills gaps, never beats the app's utilities, §23.8).
//
// Output: DIR/<id>-<version>.tar.gz (deterministic: sorted, mtime 0, uid / gid 0, gzip mtime 0) and
// DIR/<id>-<version>.pack.json (the index entry without archive.url; index.mjs adds it).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeTarGz } from "./tar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(HERE, "../..");
const RENDERER_SRC = join(APP_DIR, "src/renderer/src");
const MODULES_DIR = join(RENDERER_SRC, "modules");
const PACK_HOST_FILE = join(MODULES_DIR, "packHost.ts");
const SDK_DIR = resolve(APP_DIR, "../../packages/plugin-sdk/src");
const HOST_GLOBAL = "__CUTEX_MODULE_HOST__";
const HOST_PREFIX = "\0cutex-pack-host:";
const ENTRY_ID = "\0cutex-pack-entry";
const NS_EXPORT = "__cutexHostNamespace";
// Shared singletons that must come from the host, never be bundled a second time.
const SINGLETON_RE = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|zustand|scheduler)[\\/]/;

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const stripExt = (p) => p.replace(/\.(?:tsx?|jsx?|mjs)$/, "").replace(/[\\/]index$/, "");

/**
 * The host table of modules/packHost.ts: bare specifiers (react, …) and app files (absolute path without
 * extension → `@cutex-desktop/app/<path>`), read from its `import * as X from "…"` lines and the
 * PACK_HOST_MODULES object, so the builder and the app can never disagree about what is provided.
 */
export function readHostTable(file = PACK_HOST_FILE) {
  const text = readFileSync(file, "utf8");
  const imports = new Map();
  for (const m of text.matchAll(/^import \* as (\w+) from "([^"]+)";$/gm)) imports.set(m[1], m[2]);
  const block = /PACK_HOST_MODULES[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(text);
  if (!block) throw new Error(`${file}: no PACK_HOST_MODULES table`);
  const bare = new Set();
  const files = new Map();
  for (const line of block[1].split("\n")) {
    const m = /^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::\s*([A-Za-z_$][\w$]*))?\s*,?\s*$/.exec(line);
    if (!m) {
      if (line.trim()) throw new Error(`${file}: cannot read host table line ${JSON.stringify(line.trim())}`);
      continue;
    }
    const spec = m[1] ?? m[2];
    const source = imports.get(m[3] ?? m[2]);
    if (!source) throw new Error(`${file}: host entry ${spec} has no import`);
    if (spec.startsWith("@cutex-desktop/app/")) {
      if (!source.startsWith(".")) throw new Error(`${file}: ${spec} must import an app file`);
      const abs = stripExt(resolve(dirname(file), source));
      if (`@cutex-desktop/app/${relative(RENDERER_SRC, abs).split(sep).join("/")}` !== spec) throw new Error(`${file}: ${spec} imports ${source}, not the file its name says`);
      files.set(abs, spec);
    } else {
      if (source !== spec) throw new Error(`${file}: ${spec} imports ${source}`);
      bare.add(spec);
    }
  }
  return { bare, files };
}

/** `"<id>.…": "…"` entries of the generated / translated catalogs (i18n/<locale>.ts other than zh-CN / en). */
function catalogMessages(id) {
  const out = {};
  const dir = join(RENDERER_SRC, "i18n");
  for (const name of readdirSync(dir).sort()) {
    const m = /^([a-z]{2}(?:-[A-Za-z]+)*)\.ts$/.exec(name);
    if (!m || m[1] === "zh-CN" || m[1] === "en") continue;
    const entries = {};
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      const e = /^\s*"([^"\\]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$/.exec(line);
      if (!e || !e[1].startsWith(`${id}.`)) continue;
      try {
        entries[e[1]] = JSON.parse(e[2]);
      } catch {
        // Not a plain JSON string literal: left to the app catalog / en at lookup time.
      }
    }
    if (Object.keys(entries).length) out[m[1]] = entries;
  }
  return out;
}

function hostPlugin({ id, moduleDir, table, cssFile, packJson, extraMessages }) {
  const where = (file) => relative(APP_DIR, file).split(sep).join("/");
  return {
    name: "cutex-module-pack",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source === ENTRY_ID) return ENTRY_ID;
      if (source.startsWith(HOST_PREFIX)) return source;
      if (table.bare.has(source)) return HOST_PREFIX + source;
      if (!importer) return null;
      if (/^(?:react|react-dom|zustand|scheduler)(?:\/|$)/.test(source)) {
        this.error(`${importer.startsWith("\0") ? "the pack entry" : where(importer)} imports ${source}: only the host's ${[...table.bare].join(" / ")} may be used (a second copy would break hooks)`);
      }
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || r.external) return r;
      const file = r.id.split("?")[0];
      const spec = table.files.get(stripExt(file));
      if (spec) return HOST_PREFIX + spec;
      const from = importer.startsWith("\0") ? "the pack entry" : where(importer);
      if (file.startsWith(RENDERER_SRC + sep) && !file.startsWith(moduleDir + sep)) {
        this.error(`${from} imports ${where(file)}: outside modules/${id}/ and not provided by modules/packHost.ts (add it there, or move the code into the module)`);
      }
      if (SINGLETON_RE.test(file)) this.error(`${from} imports ${source} (${where(file)}): only the host's react / react-dom / zustand entry points may be used (a second copy would break hooks)`);
      return r;
    },
    load(loadId) {
      if (loadId === ENTRY_ID) {
        const lines = [
          `export const moduleApi = ${JSON.stringify(packJson.moduleApi)};`,
          `export { default as module } from ${JSON.stringify(join(moduleDir, "index.ts"))};`,
        ];
        const i18n = ["i18n.ts", "i18n.tsx"].map((f) => join(moduleDir, f)).find(existsSync);
        if (i18n) {
          lines.push(`import { zhCN as __zhCN, en as __en } from ${JSON.stringify(i18n)};`);
          lines.push(`export const messages = { "zh-CN": __zhCN, en: __en, ...${JSON.stringify(extraMessages)} };`);
        } else {
          lines.push(`export const messages = ${JSON.stringify(extraMessages)};`);
        }
        if (cssFile) lines.push(`import ${JSON.stringify(cssFile)};`);
        return lines.join("\n");
      }
      if (loadId.startsWith(HOST_PREFIX)) {
        const spec = loadId.slice(HOST_PREFIX.length);
        return {
          code: [
            `const host = globalThis[${JSON.stringify(HOST_GLOBAL)}];`,
            `if (!host) throw new Error("this module pack runs only inside the Cutex app (no module host)");`,
            `export const ${NS_EXPORT} = host.get(${JSON.stringify(spec)});`,
            // Pure: read only when something imports the default (a namespace without one may be a strict proxy).
            `export default /* @__PURE__ */ (() => ${NS_EXPORT}.default)();`,
          ].join("\n"),
          syntheticNamedExports: NS_EXPORT,
          moduleSideEffects: false,
        };
      }
      return null;
    },
  };
}

/** Records which names each module reads from the host (after TS / JSX are compiled away). */
function hostUsePlugin(used) {
  const record = (spec, name) => {
    let names = used.get(spec);
    if (!names) used.set(spec, (names = new Set()));
    names.add(name);
  };
  return {
    name: "cutex-module-pack-host-use",
    enforce: "post",
    async transform(code, id) {
      if (id.startsWith("\0") || !/\.(?:[cm]?[jt]sx?)$/.test(id.split("?")[0])) return null;
      const ast = this.parse(code);
      const visit = async (source, names) => {
        const r = await this.resolve(source, id);
        if (!r || !r.id.startsWith(HOST_PREFIX)) return;
        const spec = r.id.slice(HOST_PREFIX.length);
        for (const n of names) record(spec, n);
      };
      for (const node of ast.body) {
        if (node.type === "ImportDeclaration") {
          if (node.importKind === "type") continue;
          const names = node.specifiers.map((s) => (s.type === "ImportDefaultSpecifier" ? "default" : s.type === "ImportNamespaceSpecifier" ? "*" : s.imported.name ?? s.imported.value));
          await visit(node.source.value, names.length ? names : ["*"]);
        } else if (node.type === "ExportNamedDeclaration" && node.source) {
          await visit(node.source.value, node.specifiers.map((s) => s.local.name ?? s.local.value));
        } else if (node.type === "ExportAllDeclaration") {
          await visit(node.source.value, ["*"]);
        }
      }
      return null;
    },
  };
}

async function loadSdk(vite) {
  const { module: packs } = await vite.runnerImport(join(SDK_DIR, "packs.ts"));
  const { module: sdk } = await vite.runnerImport(join(SDK_DIR, "index.ts"));
  return { moduleApiSatisfies: packs.moduleApiSatisfies, MODULE_API_VERSION: sdk.MODULE_API_VERSION };
}

/**
 * Builds one module's pack into `outDir`; returns { entry (index entry without archive.url), archivePath, files }.
 * opts: styles (force the Tailwind pass), moduleDir (tests: a module outside src/renderer/src/modules), logLevel.
 */
export async function buildPack(id, outDir, opts = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(id) || id.startsWith("external-")) throw new Error(`bad module id ${JSON.stringify(id)}`);
  const moduleDir = opts.moduleDir ? resolve(opts.moduleDir) : join(MODULES_DIR, id);
  const packJsonPath = join(moduleDir, "pack.json");
  if (!existsSync(packJsonPath)) throw new Error(`modules/${id}/pack.json is missing: only modules with a pack.json can be packs`);
  const packJson = JSON.parse(readFileSync(packJsonPath, "utf8"));
  for (const k of Object.keys(packJson)) if (!["version", "moduleApi", "styles"].includes(k)) throw new Error(`modules/${id}/pack.json: unknown field ${k}`);
  if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(packJson.version ?? "")) throw new Error(`modules/${id}/pack.json: version must be M.m.p`);
  const vite = await import("vite");
  const sdk = await loadSdk(vite);
  if (!sdk.moduleApiSatisfies(packJson.moduleApi, sdk.MODULE_API_VERSION)) {
    throw new Error(`modules/${id}/pack.json: moduleApi ${JSON.stringify(packJson.moduleApi)} does not accept this source's MODULE_API_VERSION ${sdk.MODULE_API_VERSION}`);
  }
  const withStyles = opts.styles ?? packJson.styles === true;
  const table = readHostTable();
  const used = new Map();
  const scratch = mkdtempSync(join(tmpdir(), `cutex-pack-${id}-`));
  let cssFile = null;
  try {
    const plugins = [];
    if (withStyles) {
      // Tailwind over this module's sources only, with the app's theme as a reference (emits no theme / base).
      cssFile = join(scratch, "pack.css");
      const appCss = join(RENDERER_SRC, "styles.css");
      writeFileSync(cssFile, [`@reference ${JSON.stringify(appCss)};`, `@import "tailwindcss/utilities" layer(cutex-pack) source(none);`, `@source ${JSON.stringify(moduleDir)};`, ""].join("\n"));
      plugins.push((await import("@tailwindcss/vite")).default());
    }
    plugins.unshift(hostPlugin({ id, moduleDir, table, cssFile, packJson, extraMessages: catalogMessages(id) }));
    plugins.push(hostUsePlugin(used));
    const result = await vite.build({
      configFile: false,
      root: join(APP_DIR, "src/renderer"),
      mode: "production",
      logLevel: opts.logLevel ?? "warn",
      publicDir: false,
      plugins,
      resolve: { alias: { "@": RENDERER_SRC } },
      esbuild: { jsx: "automatic", jsxDev: false, jsxImportSource: "react", legalComments: "none" },
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: {
        write: false,
        outDir: join(scratch, "out"),
        emptyOutDir: false,
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
        modulePreload: false,
        cssCodeSplit: false,
        copyPublicDir: false,
        reportCompressedSize: false,
        assetsInlineLimit: () => true,
        rollupOptions: {
          input: ENTRY_ID,
          preserveEntrySignatures: "strict",
          // "use client" directives of bundled libraries (lucide-react) mean nothing here.
          onwarn: (warning, warn) => (warning.code === "MODULE_LEVEL_DIRECTIVE" ? undefined : warn(warning)),
          treeshake: { moduleSideEffects: (mid) => !/[\\/]mock\.ts$/.test(mid) },
          output: { format: "es", entryFileNames: "index.js", assetFileNames: (a) => (a.names?.[0] ?? a.name ?? "").endsWith(".css") ? "index.css" : "[name][extname]", inlineDynamicImports: true },
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
    const chunks = outputs.filter((o) => o.type === "chunk");
    if (chunks.length !== 1 || chunks[0].fileName !== "index.js") throw new Error(`${id}: the build made ${chunks.map((c) => c.fileName).join(", ")}, not one index.js`);
    const chunk = chunks[0];
    if (chunk.imports.length || chunk.dynamicImports.length) throw new Error(`${id}: index.js still imports ${[...chunk.imports, ...chunk.dynamicImports].join(", ")}`);
    if (/\bimport\s*\(|^\s*import\s|\bfrom\s*["']/m.test(chunk.code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""'))) throw new Error(`${id}: index.js has an import statement left`);
    const assets = outputs.filter((o) => o.type === "asset");
    const files = [{ path: "index.js", data: Buffer.from(chunk.code, "utf8") }];
    const styles = [];
    for (const a of assets) {
      if (a.fileName !== "index.css") throw new Error(`${id}: unexpected build asset ${a.fileName} (assets are inlined)`);
      if (!withStyles) throw new Error(`${id}: the module imports CSS; set "styles": true in its pack.json`);
      files.push({ path: "index.css", data: Buffer.from(a.source) });
      styles.push("index.css");
    }
    const host = Object.fromEntries([...used.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([spec, names]) => [spec, [...names].sort()]));
    const manifest = { id, version: packJson.version, moduleApi: packJson.moduleApi, entry: "index.js", styles, host };
    files.push({ path: "pack.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    const archive = writeTarGz(files);
    const name = `${id}-${packJson.version}.tar.gz`;
    mkdirSync(outDir, { recursive: true });
    const archivePath = join(outDir, name);
    writeFileSync(archivePath, archive);
    const texts = (key) => {
      const out = {};
      const src = ["i18n.ts", "i18n.tsx"].map((f) => join(moduleDir, f)).find(existsSync);
      if (!src) return undefined;
      const text = readFileSync(src, "utf8");
      // zh-CN block first, then en (modules/<id>/i18n.ts: `export const zhCN = {…}` then `export const en … = {…}`).
      const enAt = text.search(/^export const en\b/m);
      for (const [locale, part] of [["zh-CN", text.slice(0, enAt < 0 ? undefined : enAt)], ["en", enAt < 0 ? "" : text.slice(enAt)]]) {
        const m = new RegExp(`^\\s*"${id.replace(/-/g, "\\-")}\\.${key}":\\s*("(?:[^"\\\\]|\\\\.)*"),?\\s*$`, "m").exec(part);
        if (m) out[locale] = JSON.parse(m[1]);
      }
      return Object.keys(out).length ? out : undefined;
    };
    const title = texts("title");
    const description = texts("description");
    const entry = {
      id,
      version: packJson.version,
      moduleApi: packJson.moduleApi,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      entry: "index.js",
      styles,
      host,
      files: files.map((f) => ({ path: f.path, size: f.data.length, sha256: sha256(f.data) })),
      archive: { name, size: archive.length, sha256: sha256(archive) },
    };
    writeFileSync(join(outDir, `${id}-${packJson.version}.pack.json`), `${JSON.stringify(entry, null, 2)}\n`);
    return { entry, archivePath, files };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Ids of every module that has a pack.json. */
export function packableModules() {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(MODULES_DIR, d.name, "pack.json")))
    .map((d) => d.name)
    .sort();
}

async function main(argv) {
  const ids = [];
  let out = null;
  let styles;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = argv[++i];
    else if (a === "--styles") styles = true;
    else if (a === "--all") ids.push(...packableModules());
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else ids.push(a);
  }
  if (!out || !ids.length) {
    console.error("usage: build.mjs <id…> | --all  --out DIR [--styles]");
    return 2;
  }
  for (const id of [...new Set(ids)]) {
    const { entry } = await buildPack(id, resolve(out), styles ? { styles } : {});
    console.log(`${entry.archive.name}  ${entry.archive.size} bytes  sha256 ${entry.archive.sha256}`);
  }
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
