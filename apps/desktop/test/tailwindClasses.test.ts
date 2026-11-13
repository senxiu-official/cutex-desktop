// Tailwind silently drops a utility whose colour / size is not in styles.css `@theme`: `text-muted-foreground` made no
// CSS, so the composer's placeholder took the text colour (white in dark; owner 2026-11-12). This scans the renderer's
// class lists and asks Tailwind (with the app's own styles.css) for each one: every class must make CSS, be a class
// the app's CSS defines, or be a listed marker read by code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(__dirname, "../src/renderer/src");
const STYLES = join(RENDERER, "styles.css");
const require = createRequire(resolve(__dirname, "../package.json"));
/** Marker classes with no CSS of their own: code or tests find elements by them. */
const MARKERS = new Set(["math-inline", "pdf-scroller", "desk-area"]);
/** streamdown's shadcn names (registered in @theme for its markup): app code says text-muted / text-accent. */
const STREAMDOWN_ONLY = /^(?:[\w-]+-)?(muted-foreground|primary)(?:\/|$)/;
const COLOUR = /^-?(?:text|bg|border|ring|fill|stroke|outline|decoration|divide|placeholder|shadow|from|to|via|accent|caret)-/;

function* files(dir: string, re: RegExp): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, re);
    else if (re.test(name) && !/\.test\./.test(name)) yield path;
  }
}
const utility = (token: string) => token.split(":").pop()!.replace(/^!|!$/g, "");
/** Class tokens: every token of a `className` list, and colour utilities in other string literals (class constants). */
function classTokens(source: string): string[] {
  const out: string[] = [];
  // `font-run-${kind}` builds a class: drop the template and the prefix glued to it.
  const strip = (s: string) => s.replace(/[\w-]*\$\{[^}]*\}[\w-]*/g, " ");
  for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) out.push(...strip(m[1] ?? m[2]!).split(/\s+/));
  // Quoted strings and templates separately: a template's `${a ? "x" : "y"}` branches are quoted strings too.
  const literals = [...source.matchAll(/`([^`]*)`/g), ...source.matchAll(/"([^"\n]*)"/g)].map((m) => strip(m[1]!).trim());
  for (const text of literals) {
    // A class list has several classes; a lone word ("border-box", an id) is not one.
    if (/[{};<>]/.test(text) || !/\s/.test(text)) continue;
    out.push(...text.split(/\s+/).filter((token) => COLOUR.test(utility(token)) && /^[\w\-:/[\]().%,#!&>*=_@'+]+$/.test(token)));
  }
  return out.filter((token) => token && /^[\w\-:/[\]().%,#!&>*=_@'"+]+$/.test(token));
}

describe("renderer class names", () => {
  it("every class makes CSS with the app's @theme (or is the app's own CSS class / a marker)", async () => {
    const ds = await __unstable__loadDesignSystem(readFileSync(STYLES, "utf8"), {
      base: dirname(STYLES),
      loadStylesheet: async (id: string, base: string) => {
        const path = require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id);
        return { path, base, content: readFileSync(path, "utf8") };
      },
    });
    const css = [...files(RENDERER, /\.css$/)].map((f) => readFileSync(f, "utf8")).join("\n");
    const own = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const dead: string[] = [], shadcn: string[] = [];
    const seen = new Map<string, boolean>();
    for (const file of files(RENDERER, /\.tsx?$/)) {
      for (const token of new Set(classTokens(readFileSync(file, "utf8")))) {
        const base = utility(token);
        if (own.has(base) || MARKERS.has(base) || /^(group|peer)(\/|$)/.test(base)) continue;
        const where = `${relative(RENDERER, file).replace(/\\/g, "/")}: ${token}`;
        if (STREAMDOWN_ONLY.test(base)) shadcn.push(where);
        if (!seen.has(token)) seen.set(token, ds.candidatesToCss([token])[0] != null);
        if (!seen.get(token)) dead.push(where);
      }
    }
    expect(seen.size, "the scan found the renderer's classes").toBeGreaterThan(1000);
    expect(dead, "classes that make no CSS (a colour or size missing from @theme?)").toEqual([]);
    expect(shadcn, "streamdown's shadcn colour names in app code: use text-muted / text-accent").toEqual([]);
  }, 120_000);

  it("the scan catches the composer's old placeholder class and a class inside a template branch", () => {
    expect(classTokens('className="outline-none data-[empty=true]:before:text-muted-foreground"')).toContain("data-[empty=true]:before:text-muted-foreground");
    expect(classTokens('className={`${BTN} ${armed ? "x" : "text-fg hover:text-foreground"}`}')).toContain("text-fg");
    expect(classTokens('className={`font-run-${kind} pt-1`}')).toEqual(["pt-1"]);
  });
});
