import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packages = fileURLToPath(new URL("../..", import.meta.url));

it("keeps SDK and lifecycle code independent of React, Electron, daemon and the renderer", () => {
  // opaque-frame (§10.2): the shared opaque frame / offline page / one-use document store; no deps.
  const allowedDep: Record<string, string> = { "plugin-host": "@cutex-desktop/plugin-sdk", "plugin-sandbox": "@cutex-desktop/opaque-frame" };
  for (const name of ["plugin-sdk", "plugin-host", "plugin-sandbox", "service-plugin-host", "opaque-frame"]) {
    const root = join(packages, name), source = join(root, "src");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.exports).toEqual(name === "plugin-sandbox"
      ? { ".": "./src/index.ts", "./manifest": "./src/manifest.ts", "./document": "./src/document.ts" }
      : name === "opaque-frame" ? { ".": "./src/index.ts", "./page": "./src/page.ts", "./documents": "./src/documents.ts" }
      : { ".": "./src/index.ts" });
    expect(manifest.private).toBe(true);
    expect(manifest.scripts?.build).toBeUndefined();
    expect(manifest.dependencies ?? {}).toEqual(allowedDep[name] ? { [allowedDep[name]]: "workspace:*" } : {});
    const visitFiles = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { visitFiles(path); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        const code = readFileSync(path, "utf8");
        const check = (specifier: string) => {
          if (specifier.startsWith(".")) {
            expect(resolve(dirname(path), specifier).startsWith(source + sep), `${path}: ${specifier}`).toBe(true);
          } else expect(allowedDep[name] === specifier, `${path}: ${specifier}`).toBe(true);
        };
        // Every static from/import specifier plus literal import()/require() calls.
        for (const match of code.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)) check(match[1]!);
        for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) check(match[1]!);
        expect(code.match(/\b(?:import|require)\s*\(\s*[^\s"']/), `${path}: computed module import`).toBeNull();
      }
    };
    visitFiles(source);
  }
});

it("limits sandbox / opaque-frame imports to their reviewed users and keeps the experimental service host out of the app", () => {
  const app = resolve(packages, "../apps/desktop"), source = join(app, "src");
  const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  expect(manifest.dependencies["@cutex-desktop/service-plugin-host"]).toBeUndefined();
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const code = readFileSync(path, "utf8");
      for (const match of code.matchAll(/(?:\b(?:from|import)\s*["']|\b(?:import|require)\s*\(\s*["'])([^"']+)["']/g)) {
        const specifier = match[1]!;
        expect(specifier.includes("service-plugin-host"), `${path}: ${specifier}`).toBe(false);
        if (specifier.includes("plugin-sandbox")) {
          expect(path === join(source, "main/plugins.ts") || path.startsWith(join(source, "renderer/src/modules/plugins") + sep), `${path}: ${specifier}`).toBe(true);
        }
        // Agent pages (§10.2): main's frame store (index.ts, plugins.ts, frames.ts) and the artifacts view only.
        if (specifier.includes("opaque-frame")) {
          expect(["main/index.ts", "main/plugins.ts", "main/frames.ts"].some((file) => path === join(source, file)) || path === join(source, "renderer/src/modules/artifacts/PageFrame.tsx"), `${path}: ${specifier}`).toBe(true);
        }
        // Source consumers use the reviewed scoped package entry; no cross-package path bypass.
        if (specifier.startsWith(".")) expect(resolve(dirname(path), specifier).startsWith(app + sep), `${path}: ${specifier}`).toBe(true);
      }
    }
  };
  visit(source);
});
