// The module builder (docs/module-authoring.md, docs/desktop-modules.md §30): one project folder into one ES module that
// reads React and the public API from the running app. Nothing here needs this repository: it runs from the package.
//
// The parts shared with the first-party pack builder (apps/desktop/scripts/module-packs/build.mjs) are exported: the host
// reads, the record of what is read, the checks on the output.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { writeTarGz } from "./tar.mjs";

export const HOST_GLOBAL = "__CUTEX_MODULE_HOST__";
export const HOST_PREFIX = "\0cutex-pack-host:";
const ENTRY_ID = "\0cutex-pack-entry";
const NS_EXPORT = "__cutexHostNamespace";
const PUBLIC = JSON.parse(readFileSync(new URL("../exports.json", import.meta.url), "utf8"));
/** The languages the app has a catalog for. */
export const LOCALES = ["zh-CN", "en", "de-DE", "es-ES", "fr-FR", "it-IT", "ja-JP", "ko-KR", "pt-BR", "ru-RU", "zh-Hant-CN", "zh-Hant-TW"];
/** §23.2. */
const FILE_LIMIT = 4 * 1024 * 1024;
const SECOND_REACT_RE = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/;

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** The virtual module an import of `spec` becomes: a read from the app's host object. */
export function hostModule(spec) {
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

/** Records which names each module reads from the host (after TS / JSX are compiled away). */
export function hostUsePlugin(used) {
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

/** The vite options every pack builds with: one ES module, no lazy chunks, assets inlined. */
export function packBuildOptions({ root, logLevel, plugins, entry = ENTRY_ID, outDir, alias }) {
  return {
    configFile: false,
    root,
    mode: "production",
    logLevel: logLevel ?? "warn",
    publicDir: false,
    plugins,
    ...(alias ? { resolve: { alias } } : {}),
    esbuild: { jsx: "automatic", jsxDev: false, jsxImportSource: "react", legalComments: "none" },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      outDir,
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
        input: entry,
        preserveEntrySignatures: "strict",
        // "use client" directives of bundled libraries (lucide-react) mean nothing here.
        onwarn: (warning, warn) => (warning.code === "MODULE_LEVEL_DIRECTIVE" ? undefined : warn(warning)),
        treeshake: { moduleSideEffects: (mid) => !/[\\/]mock\.ts$/.test(mid) },
        output: { format: "es", entryFileNames: "index.js", assetFileNames: (a) => (a.names?.[0] ?? a.name ?? "").endsWith(".css") ? "index.css" : "[name][extname]", inlineDynamicImports: true },
      },
    },
  };
}

/** Checks a build's output: exactly one index.js with no import left. Returns its chunk and its assets. */
export function checkBundle(id, result) {
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  const chunks = outputs.filter((o) => o.type === "chunk");
  if (chunks.length !== 1 || chunks[0].fileName !== "index.js") throw new Error(`${id}: the build made ${chunks.map((c) => c.fileName).join(", ")}, not one index.js`);
  const chunk = chunks[0];
  if (chunk.imports.length || chunk.dynamicImports.length) throw new Error(`${id}: index.js still imports ${[...chunk.imports, ...chunk.dynamicImports].join(", ")}`);
  if (/\bimport\s*\(|^\s*import\s|\bfrom\s*["']/m.test(chunk.code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""'))) throw new Error(`${id}: index.js has an import statement left`);
  return { chunk, assets: outputs.filter((o) => o.type === "asset") };
}

export const sortedHost = (used) => Object.fromEntries([...used.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([spec, names]) => [spec, [...names].sort()]));

// ---- a module project ----

/** A range a module may declare: `^M.m`, which the app's semver rule (§23.7) reads as >= M.m < M+1. */
export function checkModuleApiRange(range, current = PUBLIC.moduleApi) {
  const m = /^\^(\d+)\.(\d+)$/.exec(range ?? "");
  if (!m) throw new Error(`pack.json: moduleApi must look like "^${current}"`);
  const [major, minor] = current.split(".").map(Number);
  if (Number(m[1]) !== major || Number(m[2]) > minor) throw new Error(`pack.json: moduleApi ${JSON.stringify(range)} does not accept this package's version ${current}; use "^${current}"`);
}

/** Reads and checks a project's pack.json. */
export function readProject(dirArg) {
  const dir = resolve(dirArg);
  const file = join(dir, "pack.json");
  if (!existsSync(file)) throw new Error(`${dir}: no pack.json here (run this in a module's folder)`);
  const pack = JSON.parse(readFileSync(file, "utf8"));
  for (const k of Object.keys(pack)) if (!["id", "version", "moduleApi", "author"].includes(k)) throw new Error(`pack.json: unknown field ${k}`);
  if (typeof pack.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(pack.id) || pack.id.startsWith("external-")) throw new Error(`pack.json: id ${JSON.stringify(pack.id)}: lower-case letters, digits and "-", starting with a letter`);
  if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(pack.version ?? "")) throw new Error("pack.json: version must be M.m.p");
  if (pack.author !== undefined && (typeof pack.author !== "string" || pack.author.length > 200)) throw new Error("pack.json: author must be a short string");
  checkModuleApiRange(pack.moduleApi);
  const entry = ["src/index.tsx", "src/index.ts"].map((p) => join(dir, p)).find(existsSync);
  if (!entry) throw new Error(`${dir}: no src/index.tsx or src/index.ts`);
  return { dir, pack, entry };
}

/** i18n/<locale>.json: flat `"<id>.<name>": "text"`, only your own keys. */
export function readMessages(dir, id) {
  const folder = join(dir, "i18n");
  const out = {};
  if (!existsSync(folder)) return out;
  for (const name of readdirSync(folder).sort()) {
    if (!name.endsWith(".json")) throw new Error(`i18n/${name}: only <locale>.json files go here`);
    const locale = name.slice(0, -".json".length);
    if (!LOCALES.includes(locale)) throw new Error(`i18n/${name}: unknown locale; the app has ${LOCALES.join(", ")}`);
    const entries = JSON.parse(readFileSync(join(folder, name), "utf8"));
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error(`i18n/${name}: must be an object of messages`);
    for (const [key, text] of Object.entries(entries)) {
      if (!key.startsWith(`${id}.`)) throw new Error(`i18n/${name}: key ${JSON.stringify(key)} must start with "${id}."`);
      if (typeof text !== "string") throw new Error(`i18n/${name}: ${key} is not a string`);
    }
    out[locale] = entries;
  }
  return out;
}

function publicPlugin({ project, messages }) {
  const { dir, pack, entry } = project;
  const shared = new Set(PUBLIC.shared);
  const entries = new Set(Object.keys(PUBLIC.entries));
  const allowed = [...entries, ...shared].join(", ");
  const where = (importer) => (importer.startsWith("\0") ? "the entry" : relative(dir, importer).split(sep).join("/"));
  return {
    name: "cutex-module",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source === ENTRY_ID) return ENTRY_ID;
      if (source.startsWith(HOST_PREFIX)) return source;
      if (shared.has(source) || entries.has(source)) return HOST_PREFIX + source;
      if (!importer) return null;
      if (source.startsWith("@cutex-desktop/")) this.error(`${where(importer)} imports ${source}: a module may import only ${allowed}, and libraries it bundles`);
      if (/^(?:react|react-dom|scheduler)(?:\/|$)/.test(source)) this.error(`${where(importer)} imports ${source}: only ${[...shared].join(", ")} are shared with the app, and a second React would break hooks`);
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || r.external || r.id.startsWith("\0")) return r;
      const file = resolve(r.id.split("?")[0]);
      if (SECOND_REACT_RE.test(file)) this.error(`${where(importer)} imports ${source}, which is a second copy of React; a module uses the app's`);
      if (!file.startsWith(dir + sep) && !file.includes(`${sep}node_modules${sep}`)) this.error(`${where(importer)} imports ${file}: outside this module's folder and not a library. A module may import only ${allowed}, its own files and libraries it bundles`);
      return r;
    },
    load(id) {
      if (id === ENTRY_ID) {
        return [
          `export const moduleApi = ${JSON.stringify(pack.moduleApi)};`,
          `export { default as module } from ${JSON.stringify(entry)};`,
          `export const messages = ${JSON.stringify(messages)};`,
        ].join("\n");
      }
      return id.startsWith(HOST_PREFIX) ? hostModule(id.slice(HOST_PREFIX.length)) : null;
    },
  };
}

// Runs the built module in a worker with every host read stubbed, only to read its definition: `contributes` is plain data
// there. Your file may need a real window at the top level; then this learns nothing, and the app still checks when it loads.
const DEFINITION_PROBE = `
const { parentPort, workerData } = require("node:worker_threads");
const stub = () => new Proxy(function () {}, {
  get: (target, key) => (key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : key === "prototype" ? target.prototype : stub()),
  apply: () => stub(),
  construct: () => stub(),
});
globalThis[workerData.global] = { get: () => new Proxy({}, { get: (_t, key) => (key === "defineModule" || key === "defineExperimentalModule" ? (def) => def : stub()) }) };
import(workerData.url).then(
  ({ module: def }) => {
    if (!def || typeof def !== "object") return parentPort.postMessage({ definition: null });
    const items = [];
    for (const [slot, list] of Object.entries(def.contributes ?? {})) for (const item of Array.isArray(list) ? list : []) items.push({ slot, id: typeof item?.id === "string" ? item.id : null });
    parentPort.postMessage({ definition: { id: def.id, items } });
  },
  () => parentPort.postMessage({ unknown: true }),
);
`;

function readDefinition(code, scratch) {
  const file = join(scratch, "probe.mjs");
  writeFileSync(file, code);
  return new Promise((done) => {
    // stdout and stderr captured: what the module prints at the top level is not for the terminal.
    const worker = new Worker(DEFINITION_PROBE, { eval: true, stdout: true, stderr: true, workerData: { url: pathToFileURL(file).href, global: HOST_GLOBAL } });
    const finish = (result) => {
      clearTimeout(timer);
      void worker.terminate();
      done(result);
    };
    const timer = setTimeout(() => finish({ unknown: true }), 5000);
    worker.once("message", finish);
    worker.once("error", () => finish({ unknown: true }));
  });
}

const defaultExportHelp = (entry, id) => `${entry} has no default export. End it with:\n  export default defineModule({ id: "${id}", titleKey: "${id}.title" });`;

/** What the app would refuse when it loads the module, said now, in the words of the guide. */
function checkDefinition(result, project) {
  const { pack, dir, entry } = project;
  if (result.unknown) return;
  const file = relative(dir, entry).split(sep).join("/");
  if (!result.definition) throw new Error(defaultExportHelp(file, pack.id));
  const { id, items } = result.definition;
  if (id !== pack.id) throw new Error(`pack.json says the id is ${JSON.stringify(pack.id)}, but defineModule in ${file} says ${JSON.stringify(id)}. They must be the same`);
  for (const item of items) {
    if (!item.id?.startsWith(`${pack.id}.`) || item.id.length <= pack.id.length + 1) throw new Error(`the item ${JSON.stringify(item.id)} in the slot ${item.slot}: every item's id must start with "${pack.id}." (the id in pack.json and a dot)`);
  }
}

/** The app's cascade layer for a pack's CSS: it fills gaps and never beats the app's own utilities (§23.8). */
const layered = (css) => `@layer cutex-pack{${css}}`;

/** Builds a project into memory: { pack, files, manifest }. */
export async function bundleModule(dirArg, opts = {}) {
  const project = readProject(dirArg);
  const { dir, pack } = project;
  const messages = readMessages(dir, pack.id);
  const used = new Map();
  const vite = await import("vite");
  const scratch = mkdtempSync(join(tmpdir(), `cutex-module-${pack.id}-`));
  try {
    let result;
    try {
      result = await vite.build(packBuildOptions({ root: dir, logLevel: opts.logLevel, outDir: join(scratch, "out"), plugins: [publicPlugin({ project, messages }), hostUsePlugin(used)] }));
    } catch (error) {
      if (/"default" is not exported by/.test(String(error?.message))) throw new Error(defaultExportHelp(relative(dir, project.entry).split(sep).join("/"), pack.id));
      throw error;
    }
    const { chunk, assets } = checkBundle(pack.id, result);
    const host = sortedHost(used);
    for (const [spec, names] of Object.entries(host)) {
      const known = PUBLIC.entries[spec];
      if (!known) continue;
      const missing = names.filter((n) => n !== "*" && !known.includes(n));
      if (missing.length) throw new Error(`${spec} has no ${missing.join(", ")}. It has: ${known.join(", ")}`);
    }
    checkDefinition(await readDefinition(chunk.code, scratch), project);
    const files = [{ path: "index.js", data: Buffer.from(chunk.code, "utf8") }];
    const styles = [];
    for (const a of assets) {
      if (a.fileName !== "index.css") throw new Error(`unexpected build asset ${a.fileName} (assets are inlined)`);
      files.push({ path: "index.css", data: Buffer.from(layered(Buffer.from(a.source).toString("utf8")), "utf8") });
      styles.push("index.css");
    }
    const text = (name) => {
      const out = {};
      for (const [locale, entries] of Object.entries(messages)) if (typeof entries[`${pack.id}.${name}`] === "string") out[locale] = entries[`${pack.id}.${name}`];
      return Object.keys(out).length ? { [name]: out } : {};
    };
    const manifest = { id: pack.id, version: pack.version, moduleApi: pack.moduleApi, ...(pack.author ? { author: pack.author } : {}), ...text("title"), ...text("description"), entry: "index.js", styles, host };
    files.push({ path: "pack.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });
    for (const f of files) if (f.data.length > FILE_LIMIT) throw new Error(`${f.path} is ${f.data.length} bytes; a pack file may be at most ${FILE_LIMIT}`);
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { project, files, manifest };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * `cutex-module build`: writes dist/. pack.json goes last and by rename: the app watching this folder takes pack.json
 * appearing as "a whole build is here".
 */
export async function buildModule(dirArg, opts = {}) {
  const { project, files, manifest } = await bundleModule(dirArg, opts);
  const dist = join(project.dir, "dist");
  mkdirSync(dist, { recursive: true });
  const put = (name, data) => {
    const tmp = join(dist, `.${name}.tmp`);
    writeFileSync(tmp, data);
    renameSync(tmp, join(dist, name));
  };
  for (const f of files) if (f.path !== "pack.json") put(f.path, f.data);
  if (!manifest.styles.length) rmSync(join(dist, "index.css"), { force: true });
  put("pack.json", files.find((f) => f.path === "pack.json").data);
  return { dist, manifest, files };
}

/** `cutex-module pack`: dist/<id>-<version>.tar.gz (§23.2, no signature), for Settings → Modules → install from a file. */
export async function packModule(dirArg, opts = {}) {
  const { dist, manifest, files } = await buildModule(dirArg, opts);
  const archive = writeTarGz(files);
  const name = `${manifest.id}-${manifest.version}.tar.gz`;
  writeFileSync(join(dist, name), archive);
  return { archivePath: join(dist, name), manifest, size: archive.length, sha256: sha256(archive) };
}
