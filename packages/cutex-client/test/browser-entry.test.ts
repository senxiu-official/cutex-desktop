import { readFileSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The main entry must run in a browser / Capacitor WebView: walk its static import graph (including
// workspace packages) and fail on any Node built-in. `./node` is the only place they may appear.

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, "../..");
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const SPECIFIER = /(?:^|[\s;])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) out.push((m[1] ?? m[2] ?? m[3])!);
  return out;
}

function resolveFile(base: string): string {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(".") && /\.tsx?$/.test(candidate)) return candidate;
  }
  throw new Error(`cannot resolve ${base}`);
}

function resolveWorkspace(spec: string): string | null {
  const m = /^@cutex-desktop\/([^/]+)(\/.*)?$/.exec(spec);
  if (!m) return null;
  const pkgDir = join(packagesDir, m[1]!);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { exports: Record<string, string> };
  const target = pkg.exports[`.${m[2] ?? ""}`];
  if (!target) throw new Error(`no export ${spec}`);
  return resolve(pkgDir, target);
}

function graph(entry: string): { files: Set<string>; external: Map<string, string> } {
  const files = new Set<string>();
  const external = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) queue.push(resolveFile(resolve(dirname(file), spec)));
      else {
        const ws = resolveWorkspace(spec);
        if (ws) queue.push(resolveFile(ws));
        else external.set(spec, file);
      }
    }
  }
  return { files, external };
}

describe("browser entry", () => {
  it("has no Node built-ins or third-party imports in its import graph", () => {
    const { files, external } = graph(resolve(here, "../src/index.ts"));
    expect(files.size).toBeGreaterThan(5);
    const offenders = [...external].filter(([spec]) => builtins.has(spec) || spec.startsWith("node:"));
    expect(offenders).toEqual([]);
    // Nothing outside the workspace either: the package is dependency-free by design.
    expect([...external.keys()]).toEqual([]);
    expect([...files].some((f) => f.endsWith("discovery.ts"))).toBe(false);
  });

  it("the node entry is where discovery lives", () => {
    const { files, external } = graph(resolve(here, "../src/node.ts"));
    expect([...files].some((f) => f.endsWith("discovery.ts"))).toBe(true);
    expect([...external.keys()].every((spec) => spec.startsWith("node:"))).toBe(true);
  });
});
