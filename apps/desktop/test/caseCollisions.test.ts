// Windows / macOS file systems ignore case: `Dock.tsx` and `dock.ts` in one folder make "./Dock"
// resolve to the wrong module there (the 2026-10-21 update failed at build on host02). Two source
// files in one folder must not share a module name that differs only by case or extension.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [join(__dirname, "../src"), join(__dirname, "../../../packages")];
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|css)$/;

function collisions(dir: string, out: string[]): void {
  const names = new Map<string, string[]>();
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collisions(path, out);
      continue;
    }
    if (!SOURCE.test(name)) continue;
    const key = name.replace(SOURCE, "").toLowerCase();
    names.set(key, [...(names.get(key) ?? []), name]);
  }
  for (const list of names.values()) {
    const stems = new Set(list.map((n) => n.replace(SOURCE, "")));
    if (stems.size > 1) out.push(`${dir}: ${list.join(", ")}`);
  }
}

describe("source file names", () => {
  it("no two files in a folder differ only by case", () => {
    const out: string[] = [];
    for (const root of ROOTS) collisions(root, out);
    expect(out).toEqual([]);
  });
});
