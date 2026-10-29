// White text on a solid red fill uses --danger-solid (#dc2626 in both themes): dark --danger (#f87171) is a light
// red for text, icons and tints, and white on it measured ≈ 2.77:1. Dots, icons, borders and tints keep --danger.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../src/renderer/src");

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(name)) out.push(relative(ROOT, p).replace(/\\/g, "/"));
  }
  return out;
}

/** `bg-danger` / `hover:bg-danger` as a solid fill — not `bg-danger/10`, `bg-danger-soft` or `bg-danger-solid`. */
const SOLID_CLASS = /(?<![\w-])bg-danger(?![\w/-])/;
const WHITE_CLASS = /(?<![\w-])text-(white|on-accent)(?![\w/-])/;
const SOLID_STYLE = /background(-color)?\s*:\s*["']?var\(--danger\)/;
const WHITE_STYLE = /color\s*:\s*["']?(#fff\b|#ffffff\b|white\b|var\(--on-accent\))/i;

describe("white text on a solid red fill", () => {
  it("the solid fill stays opaque under white text (a translucent hover let the page through: 4.42:1, measured 2026-10-26)", () => {
    const hits: string[] = [];
    for (const f of files(ROOT, /\.tsx?$/)) {
      readFileSync(resolve(ROOT, f), "utf8").split("\n").forEach((line, i) => {
        if (/bg-danger-solid\/\d/.test(line) && WHITE_CLASS.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("no renderer line pairs a solid bg-danger with text-white / text-on-accent", () => {
    const hits: string[] = [];
    for (const f of files(ROOT, /\.tsx?$/)) {
      readFileSync(resolve(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if ((SOLID_CLASS.test(line) && WHITE_CLASS.test(line)) || (SOLID_STYLE.test(line) && WHITE_STYLE.test(line))) hits.push(`${f}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("no CSS rule paints white text on var(--danger)", () => {
    const hits: string[] = [];
    for (const f of files(ROOT, /\.css$/)) {
      // One rule body / keyframe step per chunk.
      for (const chunk of readFileSync(resolve(ROOT, f), "utf8").split(/[{}]/)) if (SOLID_STYLE.test(chunk) && WHITE_STYLE.test(chunk)) hits.push(`${f}: ${chunk.trim().replace(/\s+/g, " ").slice(0, 80)}`);
    }
    expect(hits).toEqual([]);
  });

  it("--danger-solid is defined next to every --danger theme value", () => {
    for (const f of ["styles.css", "ownerAlert/ownerAlert.css"]) {
      const css = readFileSync(resolve(ROOT, f), "utf8");
      expect(css.match(/^\s*--danger-solid:/gm)?.length, f).toBe(css.match(/^\s*--danger:/gm)?.length);
    }
    expect(readFileSync(resolve(ROOT, "styles.css"), "utf8")).toContain("--color-danger-solid: var(--danger-solid);");
  });
});
