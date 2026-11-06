// Design 040 step 15: the renderer uses the semantic classes of step 1 — text-caption/meta/ui/title/display,
// rounded-chip/ctl/inner/card/dialog, shadow-e1/e2/e3 (and ring-* for rings) — not hand values. New raw
// `text-[Npx]`, `rounded-[…]`, `shadow-[…]` classes or literal style box-shadows with a blur fail here unless
// test/visualRawValues.allow.json lists them with a reason. A size the tokens lack: `text-<token>/[inherit]` keeps the
// inherited line-height (what the sweep did, so nothing moved).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src/renderer/src");
const ALLOW = JSON.parse(readFileSync(join(process.cwd(), "test/visualRawValues.allow.json"), "utf8")) as { entries: { file: string; match: string; count: number; reason: string }[] };

const RAW = [
  /(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g,
  /(?<![\w-])rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee|x|y))?-\[[^\]\s]+\]/g,
  /(?<![\w-])shadow-\[[^\]\s]+\]/g,
];
/** A style box-shadow with offsets and a non-zero blur (a hand-written elevation; rings / cut-outs have none). */
const STYLE_SHADOW = /boxShadow:\s*["'`]([^"'`]*?-?\d+(?:\.\d+)?px\s+-?\d+(?:\.\d+)?px\s+[1-9][^"'`]*)["'`]/g;

function files(dir: string, ext = /\.tsx?$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p, ext);
    return ext.test(name) ? [p] : [];
  });
}

function found(): Map<string, number> {
  const out = new Map<string, number>();
  for (const path of files(SRC)) {
    const rel = relative(SRC, path).replace(/\\/g, "/");
    const code = readFileSync(path, "utf8");
    const hits = [...RAW.flatMap((re) => [...code.matchAll(re)].map((m) => m[0])), ...[...code.matchAll(STYLE_SHADOW)].map((m) => `boxShadow: ${m[1]}`)];
    for (const h of hits) out.set(`${rel} ${h}`, (out.get(`${rel} ${h}`) ?? 0) + 1);
  }
  return out;
}

describe("no raw text sizes / radii / shadows in the renderer (design 040 step 15)", () => {
  const hits = found();
  const allowed = new Map(ALLOW.entries.map((e) => [`${e.file} ${e.match}`, e]));

  it("every raw value is in the allowlist (with its count)", () => {
    const extra = [...hits].filter(([key, n]) => (allowed.get(key)?.count ?? 0) < n).map(([key, n]) => `${key} ×${n}`);
    expect(extra, "use the semantic classes (or allowlist with a reason)").toEqual([]);
  });

  it("the allowlist has no stale entries, and each says why", () => {
    const stale = ALLOW.entries.filter((e) => (hits.get(`${e.file} ${e.match}`) ?? 0) < e.count).map((e) => `${e.file} ${e.match}`);
    expect(stale).toEqual([]);
    for (const e of ALLOW.entries) expect(e.reason.length, `${e.file} ${e.match}`).toBeGreaterThan(10);
  });

  it("the old shadow variables are gone everywhere in the renderer's CSS and code", () => {
    const users = [...files(SRC), ...files(SRC, /\.css$/)].filter((p) => /var\(--card-shadow\)|var\(--shadow[,)]/.test(readFileSync(p, "utf8"))).map((p) => relative(SRC, p));
    expect(users).toEqual([]);
  });
  // 040 §2.1: floats (menus, popovers, pickers, toasts) are `.float` — one surface, e2 only, no hard border, 12 px.
  // A panel marked as a float (menu / listbox / tooltip role, data-popover, .float) may not carry the old border,
  // corner or Tailwind shadow; any other positioned layer (`z-…`) may not carry a Tailwind shadow. Exceptions:
  // the Shelf peek card's drag lift (a lifted card, not a float).
  it("floating panels use .float, not Tailwind shadows / borders / mixed corners", () => {
    const EXEMPT = new Set(["components/gutter/PeekCard.tsx"]);
    const FLOAT = /\bfloat\b|data-popover|role="(?:menu|listbox|tooltip)"/;
    const SHADOW = /(?<![\w-])shadow-(?:lg|xl|2xl)(?![\w-])/;
    const BAD = /(?<![\w-])(?:shadow-(?:lg|xl|2xl)|border-border|border-card-border|rounded-(?:md|lg|xl|2xl))(?![\w-])/;
    const bad: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).replace(/\\/g, "/");
      if (rel.startsWith("dev/") || EXEMPT.has(rel)) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        const cls = line.match(/className=(?:"([^"]*)"|\{`([^`]*)`)/);
        const text = cls?.[1] ?? cls?.[2] ?? "";
        if (!cls || !/(?:^|\s)(?:fixed|absolute|float)(?:\s|$)/.test(text)) return;
        const isFloat = FLOAT.test(lines.slice(Math.max(0, i - 3), i + 1).join(" "));
        const hit = isFloat ? text.match(BAD) : /(?:^|\s)z-/.test(text) ? text.match(SHADOW) : null;
        if (hit) bad.push(`${rel}:${i + 1} ${hit[0]}`);
      });
    }
    expect(bad, "use the .float class (styles.css, 040 §2.1)").toEqual([]);
  });
});
