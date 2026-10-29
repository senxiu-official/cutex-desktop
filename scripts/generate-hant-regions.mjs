#!/usr/bin/env node
// Development only: cn→twp (s2twp) and cn→hk, plus reviewed technical terminology.
// node scripts/generate-hant-regions.mjs [--check]
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { TextEncoder, TextDecoder } from "node:util";
import OpenCC from "opencc-js";
import { reviewed } from "./hant-region-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const renderer = join(root, "apps/desktop/src/renderer/src");
const require = createRequire(import.meta.url);

/** Protect source tokens before either conversion or terminology review, not afterwards. */
const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|\{\{[^{}]*\}\}|\{[^{}\n]*\}|(?:https?:\/\/|wss?:\/\/|cutex(?:-[a-z]+)?:)[^\s<>「」“”‘’（），。；、]+|(?:[A-Za-z]:[\\/]|~\/|\/(?=[A-Za-z0-9_.~-]))[^\s<>「」“”‘’（），。；、]+|\b(?:Profile|Shelf|API key)\b/g;

export function protectedParts(value) {
  return [...value.matchAll(PROTECTED)].map(match => match[0]);
}

function prose(value, convert, review) {
  for (const [from, to] of review.sourcePhrases ?? []) value = value.replaceAll(from, to);
  let next = convert(value);
  for (const [from, to] of review.phrases ?? []) next = next.replaceAll(from, to);
  for (const [pattern, to] of review.patterns ?? []) next = next.replace(new RegExp(pattern, "gu"), to);
  return next;
}

export function regionalValue(key, source, convert, review) {
  const override = review.keys?.[key];
  if (override !== undefined) {
    if (JSON.stringify(protectedParts(override)) !== JSON.stringify(protectedParts(source))) throw new Error(`Reviewed override changes protected tokens: ${key}`);
    return override;
  }
  let out = "";
  let start = 0;
  for (const match of source.matchAll(PROTECTED)) {
    out += prose(source.slice(start, match.index), convert, review) + match[0];
    start = match.index + match[0].length;
  }
  return out + prose(source.slice(start), convert, review);
}

async function esbuildModule() {
  try { return await import(pathToFileURL(require.resolve("esbuild")).href); } catch {}
  // esbuild is already a development dependency of the app's Vite. Do not add it to runtime.
  const vite = require.resolve("vite", { paths: [join(root, "apps/desktop")] });
  return import(pathToFileURL(require.resolve("esbuild", { paths: [dirname(vite)] })).href);
}

/** Bundle data only, replacing Vite's eager dictionary glob with the same sorted imports. */
export async function sourceCatalog() {
  const { build } = await esbuildModule();
  const modules = join(renderer, "modules");
  const dirs = (await readdir(modules, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const dictionaries = [];
  for (const dir of dirs) {
    const path = join(modules, dir, "i18n.ts");
    try { await readFile(path); dictionaries.push(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const bundle = await build({
    entryPoints: [join(renderer, "i18n/zh-CN.ts")], bundle: true, write: false,
    format: "cjs", platform: "node", target: "node24", logLevel: "silent",
    plugins: [{ name: "merged-ui-dictionaries", setup(builder) {
      builder.onLoad({ filter: /[\\/]modules[\\/]i18nCatalog\.ts$/ }, () => ({
        contents: [
          `import { zhCN as host } from ${JSON.stringify(join(modules, "i18n.ts"))};`,
          ...dictionaries.map((path, i) => `import { zhCN as d${i} } from ${JSON.stringify(path)};`),
          `export const modulesZhCN = Object.assign({}, host, ${dictionaries.map((_, i) => `d${i}`).join(", ")});`,
        ].join("\n"), loader: "ts", resolveDir: modules,
      }));
    } }],
  });
  const module = { exports: {} };
  // Dependency modules may initialize UTF-8 helpers while loading catalog exports.
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, TextEncoder, TextDecoder }, { timeout: 5000 });
  const catalog = module.exports.zhCN;
  if (!catalog || Object.values(catalog).some(value => typeof value !== "string")) throw new Error("Invalid merged zh-CN catalog");
  return catalog;
}

export function regionalCatalogs(source) {
  const twConvert = OpenCC.Converter({ from: "cn", to: "twp" });
  const hkConvert = OpenCC.Converter({ from: "cn", to: "hk" });
  const TW = {}, HK = {}, MO = {};
  for (const key of Object.keys(source).sort()) {
    TW[key] = regionalValue(key, source[key], twConvert, reviewed.TW);
    const hk = regionalValue(key, source[key], hkConvert, reviewed.HK);
    if (hk !== TW[key]) HK[key] = hk;
    const mo = reviewed.MO.keys[key] ?? hk;
    if (JSON.stringify(protectedParts(mo)) !== JSON.stringify(protectedParts(source[key]))) throw new Error(`Macau override changes protected tokens: ${key}`);
    if (mo !== hk) MO[key] = mo;
  }
  for (const region of ["TW", "HK", "MO"]) for (const key of Object.keys(reviewed[region].keys)) if (!(key in source)) throw new Error(`Unknown reviewed ${region} key: ${key}`);
  return { TW, HK, MO };
}

function catalogText(region, catalog) {
  const type = region === "TW" ? "Record" : "Partial<Record";
  const suffix = region === "TW" ? ">" : ">>";
  return `// Generated by scripts/generate-hant-regions.mjs. Review prose in scripts/hant-region-review.mjs.\n// ${region === "TW" ? "Taiwan: complete merged zh-CN → OpenCC cn/twp, then reviewed UI terms." : region === "HK" ? "Hong Kong: overrides only; inherit all other keys from Taiwan in the lazy loader." : "Macau: overrides only; inherit all other keys from Hong Kong in the lazy loader."}\nimport type { zhCN } from "./zh-CN";\n\nexport const zhHant${region}: ${type}<keyof typeof zhCN, string${suffix} = ${JSON.stringify(catalog, null, 2)};\n`;
}

export async function generate({ check = false } = {}) {
  const catalogs = regionalCatalogs(await sourceCatalog());
  let different = false;
  for (const [region, catalog] of Object.entries(catalogs)) {
    const path = join(renderer, `i18n/zh-Hant-${region}.ts`);
    const output = catalogText(region, catalog);
    const previous = await readFile(path, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (previous !== output) {
      different = true;
      if (!check) await writeFile(path, output, "utf8");
      else console.error(`Stale regional catalog: ${path}`);
    }
    console.log(`${region}: ${Object.keys(catalog).length} ${region === "TW" ? "keys" : "overrides"}`);
  }
  return !check || !different;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--check")) throw new Error("Usage: node scripts/generate-hant-regions.mjs [--check]");
  if (!await generate({ check: args.includes("--check") })) process.exitCode = 1;
}
