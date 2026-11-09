// The public API's host table (docs/desktop-modules.md §30): generated from the package, and all a module not built from
// this repository may read. The compile-time half is moduleApi/hostTable.generated.ts + moduleApi/compat.ts.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MODULE_API_VERSION } from "@cutex-desktop/plugin-sdk";
import { readHostTable } from "../scripts/module-packs/build.mjs";

const exportsJson = JSON.parse(readFileSync(join(__dirname, "../../../packages/module-api/exports.json"), "utf8")) as { moduleApi: string; shared: string[]; entries: Record<string, string[]> };

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, apiFor: () => ({}) }));

describe("the host table", () => {
  let packHost: typeof import("../src/renderer/src/modules/packHost");
  // The first import loads the app's module graph.
  beforeAll(async () => {
    packHost = await import("../src/renderer/src/modules/packHost");
  }, 120_000);

  it("provides every name of every public entry, and no other", async () => {
    const { PUBLIC_HOST_MODULES } = packHost;
    expect(Object.keys(PUBLIC_HOST_MODULES).sort()).toEqual([...exportsJson.shared, ...Object.keys(exportsJson.entries)].sort());
    for (const [spec, names] of Object.entries(exportsJson.entries)) expect(Object.keys(PUBLIC_HOST_MODULES[spec]!).sort(), spec).toEqual([...names].sort());
    expect(PUBLIC_HOST_MODULES["@cutex-desktop/module-api"]!.MODULE_API_VERSION).toBe(MODULE_API_VERSION);
  });

  it("refuses a public module that reads an app file; first-party packs keep them", async () => {
    const { checkHostImports, checkPublicHostImports, usesExperimentalApi } = packHost;
    const imports = { "@cutex-desktop/app/store": ["useApp"] };
    expect(checkHostImports(imports)).toEqual([]);
    expect(checkPublicHostImports(imports)).toEqual(["@cutex-desktop/app/store"]);
    expect(checkPublicHostImports({ react: ["useState"], "@cutex-desktop/module-api": ["defineModule"], "@cutex-desktop/module-api/ui": ["Page"] })).toEqual([]);
    expect(checkPublicHostImports({ "@cutex-desktop/module-api": ["nothingLikeThis"] })).toEqual(["@cutex-desktop/module-api#nothingLikeThis"]);
    expect(usesExperimentalApi({ "@cutex-desktop/module-api/experimental": ["daemonFor"] })).toBe(true);
    expect(usesExperimentalApi({ "@cutex-desktop/module-api": ["defineModule"] })).toBe(false);
  });

  it("shares the app's own instances, frozen", async () => {
    const { PUBLIC_HOST_MODULES } = packHost;
    const { services } = await import("../src/renderer/src/modules/app");
    const stable = PUBLIC_HOST_MODULES["@cutex-desktop/module-api"]!;
    const open = stable.services as { ui: unknown; agents: unknown; panes: unknown; activity: unknown };
    expect(open.ui).toBe(services.ui);
    expect(open.agents).toBe(services.agents);
    expect(Object.isFrozen(stable)).toBe(true);
  });
});

/** What a first-party pack's sources import, as written. */
function importsOf(dir: string): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...importsOf(path));
    else if (/\.tsx?$/.test(entry.name) && entry.name !== "mock.ts") {
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)[^"';]*?from\s+"([^"]+)"/gm)) out.push({ file: path, source: m[1]! });
    }
  }
  return out;
}

describe("first-party packs against the host table", () => {
  const modules = join(__dirname, "../src/renderer/src/modules");
  const renderer = resolve(modules, "..");
  const packs = readdirSync(modules).filter((m) => existsSync(join(modules, m, "pack.json")));
  it.each(packs)("%s imports only app files the table lists", (id) => {
    const table = readHostTable();
    const dir = join(modules, id);
    const missing = importsOf(dir).flatMap(({ file, source }) => {
      if (!source.startsWith(".")) return [];
      const target = resolve(dirname(file), source).replace(/\.tsx?$/, "");
      if (target === dir || target.startsWith(dir + sep) || !target.startsWith(renderer + sep)) return [];
      return table.files.has(target) ? [] : [`${file.slice(dir.length + 1)}: ${source}`];
    });
    expect(missing).toEqual([]);
  });
});
