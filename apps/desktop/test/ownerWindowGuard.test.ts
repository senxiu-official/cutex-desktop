// Multi-window P2 source guard (docs/desktop-modules.md §24.17, lib/ownerWindow): renderer code resolves the
// window / document an element lives in, never the global `window` / `document`, for the APIs that differ in a
// desk window (portals, listeners, focus, selection, rAF, viewport, media queries, observers, realm checks).
// A file may keep a direct use only through OWNER_WINDOW_ALLOW below, with the reason it is truly global, and
// with its exact count per category (a new use fails; a removed one asks to lower the count).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../src/renderer/src");

export const CATEGORIES = {
  /** document.body: a portal / append target or an ancestor walk's stop — the owner document's body in a desk. */
  body: /(?<![\w$]|[^.]\.)document\.body\b/g,
  activeElement: /(?<![\w$]|[^.]\.)document\.activeElement\b/g,
  hasFocus: /(?<![\w$]|[^.]\.)document\.hasFocus\(/g,
  docListener: /(?<![\w$]|[^.]\.)document\.(?:add|remove)EventListener\(/g,
  /** window.addEventListener, or the bare global form. */
  winListener: /(?<![\w$]|[^.]\.)(?:window\.)?(?:add|remove)EventListener\(/g,
  /** Bare or window.: this realm's frame clock (the main window's). */
  raf: /(?<![\w$]|[^.]\.)(?:window\.)?(?:requestAnimationFrame|cancelAnimationFrame)\(/g,
  selection: /(?<![\w$]|[^.]\.)(?:(?:window|document)\.)?getSelection\(/g,
  matchMedia: /(?<![\w$]|[^.]\.)(?:window\.)?matchMedia\(/g,
  viewport: /(?<![\w$]|[^.]\.)(?:window\.)?(?:innerWidth|innerHeight|outerWidth|outerHeight|devicePixelRatio|screenX|screenY|scrollX|scrollY)\b(?!\s*[:(])/g,
  query: /(?<![\w$]|[^.]\.)document\.(?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName|elementFromPoint|elementsFromPoint)(?:<[^>()]*>)?\(/g,
  observer: /\bnew (?:ResizeObserver|IntersectionObserver)\(/g,
  /** instanceof a DOM interface: false for a desk element (another realm) — isDom / isElement / isHTMLElement. */
  realm: /\binstanceof (?:Node|Element|HTMLElement|SVGElement|Text|HTML\w*Element|SVG\w*Element|\w*Event)\b/g,
} as const;
type Category = keyof typeof CATEGORIES;

interface Allowed {
  /** Why these uses mean the main window / every window by design. */
  reason: string;
  uses: Partial<Record<Category, number>>;
}

// Truly global uses. Keep the reasons concrete; components drawn in a desk never belong here.
const OS_PREFERENCE = "an OS-level preference (prefers-reduced-motion / prefers-color-scheme): the same in every window";
export const OWNER_WINDOW_ALLOW: Record<string, Allowed> = {
  "lib/appWindowSet.ts": { reason: "enumerates the app windows: this window (the main one) first, then the desks", uses: { query: 2 } },
  // P3: 「在看」 follows the active window (lib/appFocus, lib/windowScope); store.ts / ownerNotifyStore have no direct focus check left.
  "store.ts": { reason: "activity previews batch on the renderer's frame clock (the main window, kept unthrottled while a desk shows)", uses: { raf: 1 } },
  "lib/streamBatch.ts": { reason: "store-level stream batching on the renderer's frame clock (the main window, kept unthrottled while a desk shows)", uses: { raf: 3 } },
  "main.tsx": { reason: "the app root; the renderer-wide error log (a desk's handlers run in this realm, so their errors reach this window); the zoom keys (the Electron zoom factor is the main webContents')", uses: { winListener: 3, query: 1 } },
  "ownerAlert/main.ts": { reason: "the owner-alert window's own entry point (its own document, not drawn by this renderer)", uses: { query: 1 } },
  "components/DeskWindows.tsx": { reason: "the P0 desk probe measures the main window's frame clock next to the desk's, on purpose", uses: { raf: 1 } },
  "lib/deskSync.ts": { reason: "the main document's pagehide takes its desks with it (main closes them; they stay remembered)", uses: { winListener: 2 } },
  "lib/paneDb.ts": { reason: "flushes the layout journal when the main document hides / unloads (the renderer's lifetime)", uses: { docListener: 2, winListener: 2 } },
  "lib/paneStore.ts": { reason: "saves on the main document's beforeunload (the renderer's lifetime)", uses: { winListener: 2 } },
  "lib/sideLayoutStore.ts": { reason: "saves on the main document's beforeunload (the renderer's lifetime)", uses: { winListener: 2 } },
  "lib/planCache.ts": { reason: "saves on the main document's pagehide (the renderer's lifetime)", uses: { winListener: 1 } },
  "lib/introAppearance.ts": { reason: "localStorage `storage` events (written by another renderer process) are one per renderer", uses: { winListener: 1 } },
  "lib/turnErrorBanner.ts": { reason: "localStorage `storage` events (written by another renderer process) are one per renderer", uses: { winListener: 2 } },
  "lib/storedFonts.ts": { reason: "localStorage `storage` events (written by another renderer process) are one per renderer", uses: { winListener: 1 } },
  "lib/directorHeadwear.ts": { reason: "the seasonal headwear re-checks the date when the app (the main document) is shown again; one shared check for every avatar", uses: { docListener: 2 } },
  "lib/motion.ts": { reason: `start-up motion hold of the main document (two frames after its first paint); ${OS_PREFERENCE}`, uses: { raf: 2, matchMedia: 1 } },
  "lib/dropMorph.ts": { reason: OS_PREFERENCE, uses: { matchMedia: 1 } },
  "lib/theme.ts": { reason: OS_PREFERENCE, uses: { matchMedia: 2 } },
  "modules/home/Parts.tsx": { reason: OS_PREFERENCE, uses: { matchMedia: 1 } },
  "modules/home/deskEnv.ts": { reason: OS_PREFERENCE, uses: { matchMedia: 2 } },
  "modules/terminal/xtermTheme.ts": { reason: OS_PREFERENCE, uses: { matchMedia: 1 } },
  "modules/perf-log/recorder.ts": { reason: "the perf log (Settings → 性能日志) samples the main window", uses: { winListener: 2, viewport: 2, query: 1 } },
  "modules/perf-log/screen.ts": { reason: "the perf log (Settings → 性能日志) samples the main window", uses: { query: 2 } },
  "modules/packs.ts": { reason: "signed module packs load their stylesheets into the main document (desks mirror them, lib/deskDocument)", uses: { query: 1 } },
  "modules/browser/thumbnails.ts": { reason: "dev-preview-only hook (dropped from production bundles): mock.ts dispatches it on the main window", uses: { winListener: 1 } },
  "modules/browser/browserCache.ts": { reason: "dev-preview-only hook (dropped from production bundles): mock.ts (?browserChrome) dispatches a page state on the main window", uses: { winListener: 1 } },
};

/** Comments and string-free enough: block and line comments are dropped before matching. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export function countUses(text: string): Partial<Record<Category, number>> {
  const code = stripComments(text);
  const out: Partial<Record<Category, number>> = {};
  for (const [name, re] of Object.entries(CATEGORIES) as [Category, RegExp][]) {
    const n = code.match(re)?.length ?? 0;
    if (n) out[name] = n;
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "dev" || e.name === "node_modules" ? [] : sources(path);
    if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name) || /\.d\.ts$/.test(e.name)) return [];
    // Mock data of a module (preview only, dropped from production bundles).
    if (/[\\/]modules[\\/][^\\/]+[\\/]mock\.ts$/.test(path)) return [];
    return [path];
  });
}

export function scanRenderer(): Record<string, Partial<Record<Category, number>>> {
  const found: Record<string, Partial<Record<Category, number>>> = {};
  for (const file of sources(root)) {
    const uses = countUses(readFileSync(file, "utf8"));
    if (Object.keys(uses).length) found[relative(root, file).split(sep).join("/")] = uses;
  }
  return found;
}

describe("owner window guard (multi-window P2 + P3)", () => {
  it("finds no direct window / document use outside the allow-list, and the allow-list is exact", () => {
    const found = scanRenderer();
    const problems: string[] = [];
    for (const [file, uses] of Object.entries(found)) {
      const allowed = OWNER_WINDOW_ALLOW[file]?.uses ?? {};
      for (const [cat, n] of Object.entries(uses) as [Category, number][]) {
        const max = allowed[cat] ?? 0;
        if (n > max) problems.push(`${file}: ${n - max} new ${cat} use(s) — use lib/ownerWindow (ownerWindowOf / ownerDocumentOf / isDom …) or lib/ownerContext (useOwnerWindow / useOwnerDocument / useOverlayRoot), or allow-list it with a reason`);
      }
    }
    for (const [file, { uses }] of Object.entries(OWNER_WINDOW_ALLOW)) {
      for (const [cat, max] of Object.entries(uses) as [Category, number][]) {
        const n = found[file]?.[cat] ?? 0;
        if (n < max) problems.push(`${file}: allow-list says ${max} ${cat}, found ${n} — lower it`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every allow-list entry has a reason", () => {
    for (const [file, entry] of Object.entries(OWNER_WINDOW_ALLOW)) expect(entry.reason.trim().length, file).toBeGreaterThan(10);
  });

  it("catches the forms it is meant to catch", () => {
    const hits = (s: string) => Object.keys(countUses(s));
    expect(hits("createPortal(x, document.body)")).toEqual(["body"]);
    expect(hits("const a = document.activeElement;")).toEqual(["activeElement"]);
    expect(hits("document.hasFocus()")).toEqual(["hasFocus"]);
    expect(hits("document.addEventListener('keydown', f)")).toEqual(["docListener"]);
    expect(hits("window.removeEventListener('resize', f)")).toEqual(["winListener"]);
    expect(hits("requestAnimationFrame(f); window.cancelAnimationFrame(id)")).toEqual(["raf"]);
    expect(countUses("requestAnimationFrame(f); window.cancelAnimationFrame(id)").raf).toBe(2);
    expect(hits("window.getSelection()")).toEqual(["selection"]);
    expect(hits("document.getSelection()")).toEqual(["selection"]);
    expect(hits("matchMedia('(prefers-reduced-motion: reduce)')")).toEqual(["matchMedia"]);
    expect(hits("window.innerWidth - 4")).toEqual(["viewport"]);
    expect(hits("{ width: innerWidth, height: innerHeight }")).toEqual(["viewport"]);
    expect(hits("addEventListener('resize', f)")).toEqual(["winListener"]);
    expect(hits("document.querySelector('dialog[open]')")).toEqual(["query"]);
    expect(hits("document.querySelector<HTMLElement>('[data-x]')")).toEqual(["query"]);
    expect(hits("new ResizeObserver(fit)")).toEqual(["observer"]);
    expect(hits("e.target instanceof HTMLInputElement")).toEqual(["realm"]);
    // A spread is not a member access (P3.5: `[...document.querySelectorAll(…)]` slipped through before).
    expect(hits("const els = [...document.querySelectorAll(\"[data-x]\")];")).toEqual(["query"]);
    expect(hits("f(...window.getSelection())")).toEqual(["selection"]);
    expect(hits("x instanceof SVGSVGElement")).toEqual(["realm"]);
    // Not these: the owner-resolved forms, members of other objects, comments.
    for (const s of ["win.requestAnimationFrame(f)", "doc.body", "win.addEventListener('x', f)", "doc.activeElement", "el.ownerDocument.body", "win.matchMedia(q)", "win.getSelection()", "new win.ResizeObserver(f)", "x instanceof Error", "{ innerWidth: 3 }", "el.addEventListener('x', f)", "win.document.addEventListener('x', f)", "win.document.body", "// document.body here", "/* window.addEventListener */", "isDom(t, \"HTMLInputElement\")"])
      expect(hits(s), s).toEqual([]);
  });
});
