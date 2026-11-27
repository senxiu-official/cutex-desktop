import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { DEFAULT_PORTRAIT_PACK, DEFAULT_PORTRAIT_THEME_IDS } from "../src/shared/portraitDefaults";

type Entry = { id: string; theme: string; model: string; avatarPath: string; previewPath: string };
type Theme = { id: string; cover: string; name: unknown };
type Manifest = { schemaVersion: 1; name: unknown; total: number; themes: Theme[]; entries: Entry[] };

export const MOCK_PORTRAIT_IDS = [
  "great-ming/gpt/02", "great-ming/gpt/04", "great-ming/gpt/01",
  "sunlit-shores/claude/02", "sunlit-shores/claude/01", "misty-city-cyberpunk/gpt/03",
];

export const portraitManifest = (root: string) => JSON.parse(readFileSync(join(root, "src/assets/avatars/portraits", `${DEFAULT_PORTRAIT_PACK}.json`), "utf8")) as Manifest;
export const portraitFiles = (manifest: Manifest) => [...new Set(manifest.entries.flatMap(e => [e.avatarPath, e.previewPath]))].sort();
export const portraitAssets = (root: string) => join(root, "public/avatars/portraits", DEFAULT_PORTRAIT_PACK);

export function starterManifest(full: Manifest, mockSource: string): Manifest {
  const covers = new Set(full.themes.map(t => `${t.id}/${t.cover}`));
  const fixtureIds = [...mockSource.matchAll(/(?:portrait:kit-20261029\/|["'])([a-z-]+\/(?:gpt|claude|deepseek|gemini|glm|kimi)\/\d\d)["']/g)].map(m => m[1]!);
  if (fixtureIds.some(id => !MOCK_PORTRAIT_IDS.includes(id))) throw Error("new mock portrait needs a starter entry");
  const mocks = new Set(MOCK_PORTRAIT_IDS);
  const picks = new Map<string, Entry>();
  for (const e of full.entries) {
    const key = `${e.theme}/${e.model}`;
    const previous = picks.get(key);
    if (!previous || covers.has(e.id) || (mocks.has(e.id) && !covers.has(previous.id))) picks.set(key, e);
  }
  for (const theme of DEFAULT_PORTRAIT_THEME_IDS) {
    for (const family of ["gpt", "claude", "gemini", "deepseek", "glm", "kimi"]) {
      if (!picks.has(`${theme}/${family}`)) throw Error(`missing starter family ${theme}/${family}`);
    }
  }
  const retained = new Set([...covers, ...mocks, ...[...picks.values()].map(e => e.id)]);
  const entries = full.entries.filter(e => retained.has(e.id));
  if (entries.length !== retained.size || entries.length !== 124) throw Error("starter portrait manifest drifted");
  return { ...full, entries, total: entries.length };
}

/** Filter only the production output. Preview and source keep the full asset tree. */
export function bundledPortraitStarter(root: string): Plugin {
  let outDir: string;
  let full: Manifest;
  let starter: Manifest;
  return {
    name: "cutex-portrait-starter",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      full = portraitManifest(root);
      starter = starterManifest(full, readFileSync(join(root, "src/dev/mockBridge.ts"), "utf8"));
    },
    transform(source, id) {
      if (id.replaceAll("\\", "/").endsWith(`/assets/avatars/portraits/${DEFAULT_PORTRAIT_PACK}.json`)) return JSON.stringify(starter);
      return null;
    },
    writeBundle() {
      const keep = new Set(portraitFiles(starter));
      const files = portraitFiles(full).map(path => {
        const bytes = readFileSync(join(portraitAssets(root), path));
        if (!keep.has(path)) unlinkSync(join(outDir, "avatars/portraits", DEFAULT_PORTRAIT_PACK, path));
        return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      });
      writeFileSync(join(outDir, "portrait-legacy.json"), JSON.stringify({ manifest: full, files }));
    },
  };
}
