// @vitest-environment jsdom
// Cards over the desktop background (owner 2026-10-21; docs/desktop-modules.md §25.4, lib/workSurface):
// the background is always the window's bottom layer behind every card; covered = only the desktop's content
// goes (inert); the work row never catches the pointer over the desktop (编辑主页 regression); 亚克力 classes
// and their contrast; 窗格铺满时占满整个窗口; the single column's default width, its edges and the setting.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ({ hostId: "local", sessionId: "eva", projectId: null }),
  useSideRegistry: () => ({}),
}));
const entry = {
  moduleId: "fake",
  mode: "show",
  missing: [],
  item: {
    id: "fake.desktop",
    Desktop: ({ reason }: { reason: string }) => h("div", { "data-fake-desk": reason }, reason === "covered" ? null : h("button", { "data-fake-edit": "" }, "编辑主页")),
    useShowWhenEmpty: () => true,
  },
} as never;
vi.mock("../src/renderer/src/lib/paneDesk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDesktopLayer: () => entry,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (rel: string) => readFileSync(join(__dirname, "../src/renderer/src", rel), "utf8");
const { DesktopBackground, DesktopStage } = await import("../src/renderer/src/components/ChipTray");
const ws = await import("../src/renderer/src/lib/workSurface");
const { appearanceVars, DEFAULT_APPEARANCE, parseAppearance, RANGES } = await import("../src/renderer/src/lib/appearanceModel");
const appearance = await import("../src/renderer/src/lib/appearance");
const glide = await import("../src/renderer/src/lib/columnGlide");

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const nothing = { fullWindow: false, framed: false, sessionId: null as string | null, page: false, firstRun: false, desktopShown: false };

/** The App root's shape: isolated, the background first, then the work area. */
function renderWindow(input: typeof nothing) {
  act(() =>
    root!.render(
      h("div", { className: "relative isolate flex h-full", "data-app-root": "" }, h(DesktopBackground), h(DesktopStage, { entry, input, hostId: "local", children: (reason: string | null) => h("div", { "data-side-work": "" }, h("div", { className: "shell-card", "data-focus-region": "main" }, reason ? null : h("p", { "data-fake-conv": "" })), h("div", { "data-shelf-box": "right" })) })),
    ),
  );
}

function withCss(...files: string[]) {
  for (const f of files) {
    const style = document.createElement("style");
    // jsdom's parser skips Tailwind's at-rules; the plain rules are what we check.
    style.textContent = src(f).replace(/@import[^;]+;|@source[^;]+;|@layer[^;{]+;/g, "");
    document.head.appendChild(style);
  }
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("data-edge-to-edge");
  document.documentElement.removeAttribute("data-card-material");
});

describe("the desktop background: always the window's bottom layer", () => {
  it("is drawn behind every card whatever is in front: reason covered (background only), inert, never the pointer's", () => {
    for (const input of [nothing, { ...nothing, sessionId: "eva" }, { ...nothing, desktopShown: true }, { ...nothing, fullWindow: true }]) {
      renderWindow(input);
      const bg = q("[data-window-desk]")!;
      expect(bg, JSON.stringify(input)).not.toBeNull();
      expect(bg.querySelector<HTMLElement>("[data-fake-desk]")!.dataset.fakeDesk).toBe("covered");
      expect(bg.hasAttribute("inert")).toBe(true);
      expect(bg.className).toContain("window-desk");
      // First in the App root: under the sidebar card, the conversation columns and the Shelves.
      expect(q("[data-app-root]")!.firstElementChild).toBe(bg);
    }
  });

  it("layer geometry and order: the whole window, z −1 inside the isolated App root, no pointer; App mounts it first", () => {
    withCss("components/tray.css");
    renderWindow({ ...nothing, sessionId: "eva" });
    const style = getComputedStyle(q("[data-window-desk]")!);
    expect(style.position).toBe("absolute");
    // (jsdom does not expand `inset`; the rule says it.)
    expect(src("components/tray.css")).toMatch(/\.window-desk \{[^}]*inset: 0;[^}]*\}/);
    expect(style.zIndex).toBe("-1");
    expect(style.pointerEvents).toBe("none");
    const app = src("App.tsx");
    expect(app).toMatch(/<div className="relative isolate flex h-full">\s*\{\/\*[\s\S]*?\*\/\}\s*<DesktopBackground \/>/);
    expect(app.indexOf("<DesktopBackground />")).toBeLessThan(app.indexOf("<PageAsideOutlet />"));
  });

  it("covered: only the desktop's content goes (not drawn, inert); the background stays", () => {
    renderWindow({ ...nothing, sessionId: "eva" });
    const stage = q("[data-pane-desktop]")!;
    expect(stage.dataset.paneDesktop).toBe("covered");
    expect(stage.hasAttribute("inert")).toBe(true);
    expect(stage.childElementCount).toBe(0);
    expect(q("[data-fake-edit]")).toBeNull();
    expect(q("[data-window-desk] [data-fake-desk]")!.dataset.fakeDesk).toBe("covered");
    // Nothing in front: the content over the work area, the background still behind the window.
    renderWindow(nothing);
    expect(q("[data-pane-desktop]")!.dataset.paneDesktop).toBe("empty");
    expect(q("[data-pane-desktop] [data-fake-desk]")!.dataset.fakeDesk).toBe("empty");
    expect(q("[data-window-desk] [data-fake-desk]")!.dataset.fakeDesk).toBe("covered");
    // The old rule hid the whole layer while covered; the shell no longer hides anything but the content.
    expect(src("components/tray.css")).not.toMatch(/\.window-desk[^{]*\[data-pane-desktop="covered"\]/);
  });

  it("the home module draws its content without a second background (the window's shows through)", () => {
    const desk = src("modules/home/Desktop.tsx");
    const content = desk.slice(desk.indexOf("const blocks = homeBlocks"));
    expect(content).not.toMatch(/<(Desktop)?Backdrop\b/);
    // The background (remembered across starts, cross-faded: modules/home/backdrop) only for "covered".
    expect(desk.slice(desk.indexOf('if (reason === "covered")'), desk.indexOf("const blocks = homeBlocks"))).toContain("<DesktopBackdrop");
  });
});

describe("编辑主页 does nothing and the desktop stops responding (regression 2026-10-21)", () => {
  // Root cause: with the desktop on screen the work row ([data-side-work], z 1, the whole work area) lay
  // over the desktop layer (z 0) and took every click — only the empty main card let the pointer through.
  it("over the desktop, the work row and its empty main card let the pointer through; the Shelves still take it", () => {
    withCss("components/tray.css");
    renderWindow(nothing);
    expect(q("[data-pane-desk-stage]")!.hasAttribute("data-desk-on")).toBe(true);
    const pe = (sel: string) => getComputedStyle(q(sel)!).pointerEvents;
    expect(pe("[data-side-work]")).toBe("none");
    expect(pe('[data-focus-region="main"]')).toBe("none");
    expect(pe('[data-shelf-box="right"]')).toBe("auto");
    // The desktop's own controls (编辑主页) are not under anything that takes the pointer.
    expect(pe("[data-fake-edit]")).not.toBe("none");
    let clicked = 0;
    q("[data-fake-edit]")!.addEventListener("click", () => clicked++);
    act(() => q("[data-fake-edit]")!.click());
    expect(clicked).toBe(1);
  });

  it("with a pane in front the work row is the pointer's again (the conversation is usable)", () => {
    withCss("components/tray.css");
    renderWindow({ ...nothing, sessionId: "eva" });
    expect(q("[data-pane-desk-stage]")!.hasAttribute("data-desk-on")).toBe(false);
    expect(getComputedStyle(q("[data-side-work]")!).pointerEvents).not.toBe("none");
    expect(getComputedStyle(q("[data-fake-conv]")!).pointerEvents).not.toBe("none");
  });
});

/** A card of each kind under 亚克力 with the app's CSS in the app's order (main.tsx: App → tray.css, then styles.css). */
function acrylicCards(extra = "") {
  withCss("components/tray.css", "styles.css");
  document.documentElement.setAttribute("data-card-material", "acrylic");
  document.body.insertAdjacentHTML(
    "beforeend",
    `<aside class="sidebar-card" id="sidebar"></aside><aside class="sidebar-card" data-sidebar-mode="pop" id="sidebar-pop"></aside><div class="shell-card" id="card"></div><nav class="shelf-rail-card" id="rail"></nav><nav class="shelf-rail-card" data-settings-rail="named" id="settings-rail"></nav>${extra}`,
  );
  const look = (id: string) => {
    const st = getComputedStyle(q(`#${id}`)!);
    // jsdom drops color-mix() from the computed background; the declared value is the one the rule sets.
    return { filter: st.getPropertyValue("backdrop-filter"), bg: [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r): r is CSSStyleRule => r instanceof CSSStyleRule && q(`#${id}`)!.matches(r.selectorText) && !!r.style.getPropertyValue("background")).map((r) => r.style.getPropertyValue("background")).at(-1) };
  };
  return look;
}

describe("卡片材质", () => {
  it("is a per-machine appearance field: opaque by default, 亚克力 with an opacity in range", () => {
    expect(DEFAULT_APPEARANCE.cardMaterial).toBe("opaque");
    expect(DEFAULT_APPEARANCE.cardOpacity).toBe(ws.ACRYLIC_DEFAULT);
    expect(parseAppearance({}).cardMaterial).toBe("opaque");
    expect(parseAppearance({ cardMaterial: "acrylic", cardOpacity: 10 })).toMatchObject({ cardMaterial: "acrylic", cardOpacity: RANGES.cardOpacity[0] });
    expect(parseAppearance({ cardMaterial: "glass" }).cardMaterial).toBe("opaque");
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, cardOpacity: 76 })["--card-alpha"]).toBe("76%");
  });

  it("applying it marks <html>; the acrylic rule reaches the sidebar, conversation and Shelf cards and the rails, never menus", () => {
    appearance.setAppearance({ cardMaterial: "acrylic" }, false);
    expect(document.documentElement.dataset.cardMaterial).toBe("acrylic");
    appearance.setAppearance({ cardMaterial: "opaque" }, false);
    expect(document.documentElement.dataset.cardMaterial).toBe("opaque");
    const css = src("styles.css");
    const rule = css.slice(css.indexOf(':root[data-card-material="acrylic"]:not([data-edge-to-edge]) :where('));
    const selectors = rule.slice(0, rule.indexOf("{"));
    // .sidebar-card covers its pop mode too.
    for (const card of [".shell-card", ".sidebar-card", ".shelf-rail-card"]) expect(selectors).toContain(card);
    for (const menu of ["menu", "popover", "dialog"]) expect(selectors).not.toContain(menu);
    expect(rule.slice(0, rule.indexOf("}"))).toContain("backdrop-filter: var(--acrylic-filter)");
    // The rails take the class (they used to be 55 % see-through on the flat window colour).
    expect(src("components/side/ShelfRail.tsx")).toContain("shelf-rail-card");
    expect(src("components/side/WorkspaceRail.tsx")).toContain("shelf-rail-card");
  });


  it("every rail (the popped sidebar, Shelf Rails, the Settings Shelf's categories) has the cards' very material and opacity", () => {
    const look = acrylicCards();
    const card = look("card");
    expect(card.filter).toBe("var(--acrylic-filter)");
    expect(card.bg).toBe("color-mix(in srgb, var(--bg) var(--card-alpha, 82%), transparent)");
    for (const id of ["sidebar", "sidebar-pop", "rail", "settings-rail"]) expect(look(id), id).toEqual(card);
    // The Settings Shelf's rail used to be bg-background/55 without the filter (more see-through than its card).
    expect(src("components/SettingsShelf.tsx")).not.toContain("bg-background/55");
  });

  it("the CSS filter is the one the contrast model checks, per theme", () => {
    const css = src("styles.css");
    expect(css).toContain(`--acrylic-filter: ${ws.acrylicFilterCss("light")};`);
    expect(css).toContain(`--acrylic-filter: ${ws.acrylicFilterCss("dark")};`);
  });

  // The palettes from styles.css: 素白 + the light palettes over it; 石墨 + the dark palettes over it.
  function palettes(): { name: string; theme: "light" | "dark"; bg: string; fg: string; muted: string }[] {
    const css = src("styles.css");
    const block = (head: string) => {
      const at = css.indexOf(head);
      if (at < 0) return {};
      const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
      return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!])) as Record<string, string>;
    };
    const light = block(":root {");
    const dark = block(':root[data-theme="dark"] {');
    const out: ({ name: string; theme: "light" | "dark" } & Record<string, string>)[] = [{ name: "plain", theme: "light", ...light }, { name: "graphite", theme: "dark", ...dark }];
    for (const p of css.matchAll(/:root\[data-light-palette="(\w+)"\] \{/g)) out.push({ name: p[1]!, theme: "light", ...light, ...block(p[0]) });
    for (const p of css.matchAll(/:root:not\(\[data-theme="light"\]\)\[data-dark-palette="(\w+)"\] \{/g)) out.push({ name: p[1]!, theme: "dark", ...dark, ...block(p[0]) });
    return out.map((p) => ({ name: p.name, theme: p.theme, bg: p.bg!, fg: p.fg!, muted: p["fg-muted"]! }));
  }
  // Worst cases: flat black / white / primaries / mid grey, and the sky scene's colours (home.css).
  const backdrops = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#808080", "#bcd3f5", "#f6d9c4", "#8fa9d6", "#1b2440", "#3b2a4a", "#2c3a63"].map(ws.hexRgb);

  it("text stays readable on 亚克力 in light and dark: ≥ 7:1 for text, ≥ 4.5:1 for secondary text at the default, over any backdrop", () => {
    const all = palettes();
    expect(all.length).toBeGreaterThanOrEqual(7);
    for (const p of all) {
      const at = (alpha: number, c: string) => ws.worstAcrylicContrast(ws.hexRgb(c), ws.hexRgb(p.bg), alpha, p.theme, backdrops);
      const lowest = ws.ACRYLIC_RANGE[0] / 100;
      expect(at(lowest, p.fg), `${p.name} text at ${lowest}`).toBeGreaterThanOrEqual(7);
      expect(at(ws.ACRYLIC_DEFAULT / 100, p.muted), `${p.name} secondary at the default`).toBeGreaterThanOrEqual(4.5);
      // The default palettes keep 4.5:1 for secondary text even at the lowest opacity.
      if (p.name === "plain" || p.name === "graphite") expect(at(lowest, p.muted), `${p.name} secondary at ${lowest}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the model is the CSS one: opaque cards = the card colour; a flat backdrop through the filter", () => {
    const white = ws.hexRgb("#ffffff");
    expect(ws.acrylicSurface(white, ws.hexRgb("#000000"), 1, "light")).toEqual(white);
    // contrast(0.32) brightness(1.6) on black: (0 − 0.5) · 0.32 + 0.5 = 0.34, × 1.6 = 0.544.
    expect(ws.filtered(ws.hexRgb("#000000"), "light")[0]).toBeCloseTo(0.544, 3);
    expect(ws.contrastRatio(white, ws.hexRgb("#000000"))).toBeCloseTo(21, 5);
  });
});

describe("亚克力 never reaches an empty placeholder (regression 2026-10-21)", () => {
  // Root cause: the acrylic rule listed the cards in :is(), and :is() takes its most specific argument
  // (.sidebar-card[data-sidebar-mode="rail"]): (0,5,0) — the same as tray.css's rule that clears the empty
  // main card over the desktop. styles.css comes after tray.css in the bundle (main.tsx imports App, and
  // through it tray.css, before styles.css), so the acrylic rule won and the empty middle got the frosted
  // card colour and blur. Now the cards are in :where() (0,3,0): any placeholder rule wins.
  it("the empty main card over the desktop has no material, no blur, no border; the cards beside it keep theirs", () => {
    const look = acrylicCards();
    renderWindow(nothing);
    const main = q('[data-desk-on] > [data-side-work] > .shell-card[data-focus-region="main"]')!;
    const st = getComputedStyle(main);
    expect(st.getPropertyValue("backdrop-filter")).toBe("none");
    expect(st.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(st.boxShadow).toBe("none");
    expect(look("card").filter).toBe("var(--acrylic-filter)");
    // With a conversation in it the main card is a card again.
    renderWindow({ ...nothing, sessionId: "eva" });
    expect(getComputedStyle(q('[data-side-work] > .shell-card[data-focus-region="main"]')!).getPropertyValue("backdrop-filter")).toBe("var(--acrylic-filter)");
  });

  it("the acrylic rule stays at the root's specificity (:where), so it never outranks a placeholder", () => {
    const css = src("styles.css");
    expect(css).toMatch(/:root\[data-card-material="acrylic"\]:not\(\[data-edge-to-edge\]\) :where\(\.shell-card, \.sidebar-card, \.shelf-rail-card\) \{/);
    expect(css).not.toMatch(/data-card-material="acrylic"\][^{]*:is\([^)]*shell-card/);
  });
});

describe("桌面亮度 (owner 2026-10-21)", () => {
  it("three per-machine values, 0–100 %, defaults 100 / 80 / 60", () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ deskEmpty: 100, deskOpen: 80, deskFull: 60 });
    expect(RANGES.deskOpen).toEqual([0, 100]);
    expect(parseAppearance({ deskEmpty: 140, deskOpen: -5, deskFull: "x" })).toMatchObject({ deskEmpty: 100, deskOpen: 0, deskFull: 60 });
    const v = appearanceVars({ ...DEFAULT_APPEARANCE, deskOpen: 75 });
    expect(v["--desk-veil-empty"]).toBe("0");
    expect(v["--desk-filter-empty"]).toBe("none");
    expect(v["--desk-veil-open"]).toBe("0.25");
    expect(v["--desk-filter-open"]).toBe("brightness(0.75)");
    expect(v["--desk-veil-full"]).toBe("0.4");
  });

  it("the state: nothing in front = empty, a conversation / page = open, the panes filling the screen or Settings maximised = full", () => {
    expect(ws.deskState({ covered: false, deskOn: true, filled: false })).toBe("empty");
    // 铺满窗口 with nothing open: the desktop is on screen.
    expect(ws.deskState({ covered: false, deskOn: true, filled: true })).toBe("empty");
    expect(ws.deskState({ covered: false, deskOn: false, filled: false })).toBe("open");
    expect(ws.deskState({ covered: false, deskOn: false, filled: true })).toBe("full");
    expect(ws.deskState({ covered: true, deskOn: true, filled: false })).toBe("full");
  });

  it("DesktopStage marks <html data-desk-state> per state; the background's veil and the content's filter follow it, easing", async () => {
    const { usePanes } = await import("../src/renderer/src/lib/paneStore");
    const shelf = await import("../src/renderer/src/lib/settingsShelf");
    withCss("components/tray.css");
    const vars = appearanceVars({ ...DEFAULT_APPEARANCE, deskEmpty: 90 });
    for (const [k, v] of Object.entries(vars)) if (k.startsWith("--desk-")) document.documentElement.style.setProperty(k, v);
    const state = () => document.documentElement.dataset.deskState;
    // On the background's box (not :root: a custom property changed there restyles the whole document).
    const veil = () => getComputedStyle(document.querySelector("[data-window-desk]")!).getPropertyValue("--desk-veil").replace(/\s/g, "");
    renderWindow(nothing);
    expect(state()).toBe("empty");
    expect(veil()).toBe("var(--desk-veil-empty,0)");
    renderWindow({ ...nothing, sessionId: "eva" });
    expect(state()).toBe("open");
    expect(veil()).toBe("var(--desk-veil-open,0.2)");
    const layout = usePanes.getState().layout;
    act(() => usePanes.setState({ layout: { ...layout, max: "main" } }));
    expect(state()).toBe("full");
    act(() => usePanes.setState({ layout }));
    expect(state()).toBe("open");
    act(() => {
      shelf.openSettingsShelf({ tab: "general" });
      shelf.setSettingsShelfMaximized(true);
    });
    expect(state()).toBe("full");
    act(() => {
      shelf.setSettingsShelfMaximized(false);
      shelf.closeSettingsShelf();
    });
    act(() => root!.unmount());
    root = null;
    expect(state()).toBeUndefined();
    const css = src("components/tray.css");
    // The veil over the background, the filter on the content; both ease, reduced motion: at once.
    expect(css).toMatch(/\.window-desk::after \{[^}]*background: #000;[^}]*opacity: var\(--desk-veil\);[^}]*transition: opacity var\(--motion-long\) var\(--ease-standard\);/);
    expect(css).toMatch(/\.pane-desk \{[^}]*filter: var\(--desk-filter\);[^}]*filter var\(--motion-long\) var\(--ease-standard\);/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.window-desk::after \{\s*transition: none;/);
    expect(css).toMatch(/:root\[data-desk-state="full"\] :is\(\.window-desk, \.pane-desk\) \{\s*--desk-veil: var\(--desk-veil-full, 0\.4\);\s*--desk-filter: var\(--desk-filter-full, brightness\(0\.6\)\);/);
  });

  it("Settings → 外观 → 窗口与卡片 has the three sliders", () => {
    const ui = src("components/WorkSurfaceSettings.tsx");
    expect(ui).toContain('const DESK_KEYS = ["deskEmpty", "deskOpen", "deskFull"] as const;');
    expect(ui).toContain("workSurface.desk.${k}");
  });
});

describe("窗格铺满时占满整个窗口", () => {
  it("edge to edge only while the setting is on, nothing shows the desktop and no single column is narrower than its room", () => {
    expect(ws.edgeToEdge({ setting: true, deskOn: false, narrowColumn: false })).toBe(true);
    expect(ws.edgeToEdge({ setting: false, deskOn: false, narrowColumn: false })).toBe(false);
    expect(ws.edgeToEdge({ setting: true, deskOn: true, narrowColumn: false })).toBe(false);
    expect(ws.edgeToEdge({ setting: true, deskOn: false, narrowColumn: true })).toBe(false);
    // 窗格铺满时占满整个窗口 merged into 工作区宽度 → 铺满窗口 (owner 2026-10-21): 智能 by default (was 按内容, migrated); a stored `fillWindow: true` reads as 铺满窗口.
    expect(DEFAULT_APPEARANCE.workspaceWidth).toBe("smart");
    expect(parseAppearance({ fillWindow: true }).workspaceWidth).toBe("fill");
    expect(parseAppearance({ fillWindow: false }).workspaceWidth).toBe("smart");
    expect(parseAppearance({ fillWindow: true, workspaceWidth: "content", workspaceWidthRev: 1 }).workspaceWidth).toBe("content");
    expect("fillWindow" in parseAppearance({ fillWindow: true })).toBe(false);
  });

  it("edge to edge: no margins round the cards, no outer radii, the desktop invisible", () => {
    withCss("components/tray.css", "styles.css");
    document.documentElement.setAttribute("data-edge-to-edge", "");
    document.body.insertAdjacentHTML("beforeend", `<div data-pane-host class="pr-2"><aside class="sidebar-card"></aside><div class="shell-card" id="card"></div></div><div class="window-desk" id="bg"></div>`);
    expect(getComputedStyle(q("[data-pane-host]")!).paddingRight).toBe("0px");
    expect(getComputedStyle(q("#card")!).borderRadius).toBe("0px");
    expect(getComputedStyle(q(".sidebar-card")!).marginLeft).toBe("0px");
    expect(getComputedStyle(q("#bg")!).visibility).toBe("hidden");
    document.documentElement.removeAttribute("data-edge-to-edge");
    expect(getComputedStyle(q("#bg")!).visibility).not.toBe("hidden");
    expect(getComputedStyle(q("#card")!).borderRadius).not.toBe("0px");
  });
});

describe("the single conversation column", () => {
  const base = { area: 1120, free: 1120, readingWidth: 768, mode: "reading" as const, pct: 70, dragged: 0 };
  it("defaults to the reading width + the card's border (the text fills it), centred; full width / no reading width fill the room", () => {
    expect(ws.singleColumnWidth(base)).toBe(768 + ws.CARD_CHROME);
    expect(ws.singleColumnWidth({ ...base, readingWidth: 0 })).toBeNull();
    expect(ws.singleColumnWidth({ ...base, mode: "full" })).toBeNull();
    expect(ws.singleColumnWidth({ ...base, mode: "custom", pct: 50 })).toBe(560);
    expect(DEFAULT_APPEARANCE.singleWidth).toBe("reading");
  });

  it("a dragged width wins; the room the Shelves leave caps it; near the room = fills it; never under the minimum", () => {
    expect(ws.singleColumnWidth({ ...base, dragged: 900 })).toBe(900);
    expect(ws.singleColumnWidth({ ...base, mode: "full", dragged: 900 })).toBe(900);
    expect(ws.singleColumnWidth({ ...base, free: 660 })).toBeNull();
    expect(ws.singleColumnWidth({ ...base, free: 780 })).toBeNull();
    expect(ws.singleColumnWidth({ ...base, readingWidth: 200 })).toBe(ws.SINGLE_MIN_W);
    expect(ws.singleColumnWidth({ ...base, free: 0 })).toBeNull();
  });

  it("a drag at either edge moves both (it stays centred), within the room", () => {
    expect(ws.draggedWidth(770, 50, "right", 1120)).toBe(870);
    expect(ws.draggedWidth(770, -50, "left", 1120)).toBe(870);
    expect(ws.draggedWidth(770, 50, "left", 1120)).toBe(670);
    expect(ws.draggedWidth(770, 900, "right", 1120)).toBe(1120);
    expect(ws.draggedWidth(770, -900, "right", 1120)).toBe(ws.SINGLE_MIN_W);
  });

  it("parses the stored setting and the dragged width", () => {
    expect(parseAppearance({ singleWidth: "custom", singleWidthPct: 5, singleColumnW: 0 })).toMatchObject({ singleWidth: "custom", singleWidthPct: RANGES.singleWidthPct[0], singleColumnW: 0 });
    expect(parseAppearance({ singleWidth: "wide" }).singleWidth).toBe("reading");
    expect(parseAppearance({ singleColumnW: 950.4 }).singleColumnW).toBe(950);
  });

  it("rendered: the card gets its width, centred, with two edges in the gaps; a drag stores the width; edge to edge waits", async () => {
    const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-side-work") ? 1120 : 0;
    });
    appearance.setAppearance({ workspaceWidth: "content", singleColumnW: 0, singleWidth: "reading", readingWidth: 768 }, false);
    act(() => root!.render(h(SideWorkArea, { side: false, single: "main", desk: false, children: h("p", null, "conversation") })));
    const card = q('[data-focus-region="main"]')!;
    expect(card.dataset.singleW).toBe("770");
    expect(card.style.width).toBe("770px");
    // 按内容: the row centres the column with its Shelves (no auto margins pushing the Shelves to the edges).
    expect(card.style.marginInline).toBe("");
    expect(q("[data-side-work]")!.className).toContain("justify-center");
    expect(card.dataset.glide).toBe("main");
    const [left, right] = [q('[data-single-edge="left"]')!, q('[data-single-edge="right"]')!];
    expect(left.style.left).toBe(`${(1120 - 770) / 2 - 8}px`);
    expect(right.style.left).toBe(`${(1120 - 770) / 2 + 770}px`);
    // A narrow column shows the desktop beside it: not edge to edge yet.
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
    act(() => {
      right.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 1000, button: 0 }));
      right.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 1050 }));
    });
    // docs/design/007: only the dragged edge moves (50 px); the left edge stays, the column is left off centre.
    expect(card.style.width).toBe("820px");
    act(() => right.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 1050 })));
    expect(appearance.getAppearance().singleColumnW).toBe(820);
    expect(q('[data-focus-region="main"]')!.dataset.singleW).toBe("820");
    expect(q("[data-side-work]")!.dataset.wsLead).toBe(String((1120 - 770) / 2));
    // Double-click: back to the default width.
    act(() => q('[data-single-edge="left"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(appearance.getAppearance().singleColumnW).toBe(0);
    // 全宽 by content: the column fills its room, not edge to edge (that is 铺满窗口).
    act(() => appearance.setAppearance({ singleWidth: "full" }, false));
    expect(q('[data-focus-region="main"]')!.dataset.singleW).toBeUndefined();
    // A filled column still permits an inward drag to choose a narrower width.
    expect(q('[data-single-edge="right"]')).not.toBeNull();
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
    // 铺满窗口: the column fills the window whatever its default width — widths only, the card keeps its gaps
    // and radius (owner 2026-10-21); 贴边显示 on: edge to edge; the desktop on screen: never.
    act(() => appearance.setAppearance({ singleWidth: "reading", workspaceWidth: "fill" }, false));
    expect(q('[data-focus-region="main"]')!.dataset.singleW).toBeUndefined();
    expect(q("[data-side-work]")!.className).not.toContain("justify-center");
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
    act(() => appearance.setAppearance({ edgeToEdge: true }, false));
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(true);
    // Edge to edge only while the panes fill: by content (the desktop beside the column) the switch waits.
    act(() => appearance.setAppearance({ workspaceWidth: "content" }, false));
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
    act(() => appearance.setAppearance({ workspaceWidth: "fill" }, false));
    act(() => root!.render(h(SideWorkArea, { side: false, single: null, desk: true, children: null })));
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
    width.mockRestore();
    vi.unstubAllGlobals();
    appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  });

  it("moves smoothly to its new place (a Shelf, a second workspace); still with reduced motion or while dragged", () => {
    glide.resetColumnGlide();
    const work = document.createElement("div");
    const col = document.createElement("div");
    col.dataset.glide = "main";
    work.appendChild(col);
    document.body.appendChild(work);
    let box = { left: 175, width: 770 };
    col.getBoundingClientRect = () => ({ ...box, top: 0, height: 100, right: box.left + box.width, bottom: 100, x: box.left, y: 0, toJSON() {} }) as DOMRect;
    const animate = vi.fn();
    (col as unknown as { animate: unknown }).animate = animate;
    glide.noteColumns(work);
    box = { left: 0, width: 660 };
    glide.glideColumns(work);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]![0]).toEqual([{ transform: "translateX(175px)", width: "770px" }, { transform: "none", width: "660px" }]);
    box = { left: 175, width: 770 };
    glide.glideColumns(work, true);
    expect(animate).toHaveBeenCalledTimes(1);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    box = { left: 0, width: 660 };
    glide.glideColumns(work);
    expect(animate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("Settings → 外观 → 窗口与卡片", () => {
  it("material, fill and the single width write the appearance; a new default forgets the dragged width", async () => {
    // Design 006 v1: 单个对话的默认宽度 is on 会话 → 宽度, the workspaces' Shelf Rail on {{shelf}} → Rail 与页面 — the
    // same rows, rendered here side by side.
    const { WorkSurfaceSection, ConversationWidthSection, ShelfPlacementSection } = await import("../src/renderer/src/components/WorkSurfaceSettings");
    appearance.setAppearance({ ...DEFAULT_APPEARANCE, singleColumnW: 900 }, false);
    act(() => root!.render(h("div", null, h(WorkSurfaceSection), h(ConversationWidthSection), h(ShelfPlacementSection))));
    const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
    expect(host.textContent).toContain("workSurface.dragged");
    act(() => button("workSurface.material.acrylic").click());
    expect(appearance.getAppearance().cardMaterial).toBe("acrylic");
    expect(document.documentElement.dataset.cardMaterial).toBe("acrylic");
    act(() => button("workSurface.single.full").click());
    expect(appearance.getAppearance()).toMatchObject({ singleWidth: "full", singleColumnW: 0 });
    // 工作区宽度 (窗格铺满时占满整个窗口 merged into 铺满窗口), 工作区的 Shelf Rail.
    // 智能 (the default) / 按内容 / 铺满窗口; a chosen 按内容 is kept after a reload (not migrated to 智能).
    expect(button("workSurface.width.smart").getAttribute("aria-checked")).toBe("true");
    act(() => button("workSurface.width.content").click());
    expect(appearance.getAppearance().workspaceWidth).toBe("content");
    expect(parseAppearance(JSON.parse(JSON.stringify(appearance.getAppearance()))).workspaceWidth).toBe("content");
    act(() => button("workSurface.width.smart").click());
    expect(appearance.getAppearance().workspaceWidth).toBe("smart");
    act(() => button("workSurface.width.fill").click());
    expect(appearance.getAppearance().workspaceWidth).toBe("fill");
    act(() => button("workSurface.wsRails.right").click());
    expect(appearance.getAppearance().wsRailPlacement).toBe("right");
    // 贴边显示: its own switch (default off), independent of 工作区宽度.
    expect(host.textContent).toContain("workSurface.edge");
    expect(appearance.getAppearance().edgeToEdge).toBe(false);
    act(() => host.querySelector<HTMLElement>('[data-edge-switch] [role="switch"]')!.click());
    expect(appearance.getAppearance()).toMatchObject({ edgeToEdge: true, workspaceWidth: "fill" });
    act(() => button("workSurface.width.content").click());
    expect(appearance.getAppearance()).toMatchObject({ edgeToEdge: true, workspaceWidth: "content" });
    expect(host.textContent).not.toContain("workSurface.fill");
    // Placed on 外观 (the only line the settings page needed); the moved parts on their panel pages.
    expect(src("components/settings/AppearanceSettings.tsx")).toContain("<WorkSurfaceSection />");
    expect(src("components/settings/SidesSettings.tsx")).toContain("<ShelfPlacementSection />");
    expect(src("modules/shell/index.ts")).toContain("Section: ConversationWidthSection");
    appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  });
});
