// Design 040 step 1: the visual-language tokens exist in styles.css with the agreed values, nested radii are
// concentric, and the Tailwind semantic names (rounded-card, text-caption, shadow-e1, bg-selected …) compile to
// the tokens — while Tailwind's own scale (rounded-md, text-xs) keeps its values (the step changes nothing on screen).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";

const stylesPath = join(__dirname, "../src/renderer/src/styles.css");
const css = readFileSync(stylesPath, "utf8");

/** The token block: the first `:root {` after the 040 comment. */
const tokenBlock = (() => {
  const start = css.indexOf(":root {", css.indexOf("Visual language tokens (docs/design/040"));
  return css.slice(start, css.indexOf("\n}", start));
})();
const tokens = Object.fromEntries([...tokenBlock.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!.trim()])) as Record<string, string>;
const px = (name: string) => Number(/^(\d+)px$/.exec(tokens[name] ?? "")?.[1] ?? NaN);

describe("visual tokens (040 §1)", () => {
  it("spacing is a 4 px grid", () => {
    expect([1, 2, 3, 4, 5, 6, 8].map((n) => px(`space-${n}`))).toEqual([4, 8, 12, 16, 20, 24, 32]);
    expect(px("space-0-5")).toBe(2);
    expect(px("space-1-5")).toBe(6);
  });

  it("radii: 4 / 6 / 8 / 12 / 16 / 20, nested ones concentric (inner = outer − 4 px gap)", () => {
    expect(["xs", "sm", "md", "lg", "xl", "2xl"].map((k) => px(`r-${k}`))).toEqual([4, 6, 8, 12, 16, 20]);
    expect(px("r-xl") - px("space-1")).toBe(px("r-lg"));
    expect(px("r-lg") - px("space-1")).toBe(px("r-md"));
  });

  it("type: six steps, sizes ascending", () => {
    const steps = ["caption", "meta", "body", "title", "display"].map((k) => Number(/(\d+)px\//.exec(tokens[`t-${k}`] ?? "")?.[1]));
    expect(steps).toEqual([11, 12, 13, 15, 20]);
    expect(tokens["t-chat"]).toContain("var(--chat-font-size, 14px)");
  });

  it("colour roles derive from the palette variables (no per-palette copies)", () => {
    expect(tokens["accent-soft"]).toContain("var(--accent)");
    expect(tokens.selected).toBe("var(--accent-soft)");
    expect(tokens.attention).toBe("var(--warn)");
    expect(tokens["attention-soft"]).toContain("var(--attention)");
    expect(tokens["danger-soft"]).toContain("var(--danger)");
    expect(tokens["ok-soft"]).toContain("var(--ok)");
    expect(tokens.pressed).toContain("var(--fg)");
  });

  it("elevation and provider colours have light values and dark overrides (OS dark and forced dark)", () => {
    for (const k of ["e1", "e2", "e3", "hi", "prov-kimi"]) expect(tokens[k], k).toBeTruthy();
    expect(tokens["prov-gemini"]).toBe("#9b6cf0"); // owner 2026-10-23: Gemini is purple
    const darkForced = css.slice(css.indexOf(':root[data-theme="dark"] {\n  --e1:'));
    expect(darkForced).toMatch(/--hi: inset 0 1px 0/);
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\) \{\n {4}--e1:/);
  });

  it("step 15: the old card shadows are gone; shell cards are e1 (its ring draws the edge, the border is transparent)", () => {
    expect(css).not.toMatch(/--card-shadow|var\(--shadow[,)]/);
    expect(css).toMatch(/\.shell-card \{\n {2}background: var\(--bg\);\n {2}border: 1px solid transparent;\n {2}border-radius: var\(--r-xl\);\n {2}box-shadow: var\(--e1\);/);
  });
});

describe("Tailwind semantic names (040 §1.3)", () => {
  const require = createRequire(import.meta.url);
  const twDir = dirname(require.resolve("tailwindcss/package.json"));
  const build = async (candidates: string[]) => {
    const compiler = await compile(css, {
      base: dirname(stylesPath),
      loadStylesheet: async (id: string, base: string) => {
        const path = id === "tailwindcss" ? join(twDir, "index.css") : id.startsWith("tailwindcss/") ? join(twDir, `${id.slice(12)}.css`) : resolve(base, id);
        return { path, base: dirname(path), content: readFileSync(path, "utf8") };
      },
    });
    return compiler.build(candidates);
  };

  it("compile to the tokens", async () => {
    const out = await build(["rounded-chip", "rounded-ctl", "rounded-inner", "rounded-card", "rounded-dialog", "text-caption", "text-meta", "text-ui", "text-title", "text-display", "shadow-e1", "shadow-e2", "shadow-e3", "bg-selected", "bg-attention-soft", "text-attention", "bg-accent-soft"]);
    expect(out).toMatch(/\.rounded-card \{\s*border-radius: var\(--radius-card\)/);
    expect(out).toMatch(/--radius-card: var\(--r-xl\)/);
    expect(out).toMatch(/\.rounded-chip \{\s*border-radius: var\(--radius-chip\)/);
    expect(out).toMatch(/\.text-caption \{[^}]*font-size: var\(--text-caption\)[^}]*line-height: var\(--tw-leading, var\(--text-caption--line-height\)\)[^}]*font-weight: var\(--tw-font-weight, var\(--text-caption--font-weight\)\)/);
    expect(out).toMatch(/\.text-ui \{[^}]*font-size: var\(--text-ui\)/);
    expect(out).toMatch(/\.shadow-e1 \{\s*--tw-shadow: var\(--e1\)/);
    expect(out).toMatch(/\.shadow-e3 \{\s*--tw-shadow: var\(--e3\)/);
    expect(out).toMatch(/\.bg-selected \{\s*background-color: var\(--color-selected\)/);
    expect(out).toMatch(/\.bg-attention-soft \{\s*background-color: var\(--color-attention-soft\)/);
  });

  it("leave Tailwind's own scale alone", async () => {
    const out = await build(["rounded-md", "text-xs"]);
    expect(out).toMatch(/--radius-md: 0\.375rem/);
    expect(out).toMatch(/--text-xs: 0\.75rem/);
  });
});
