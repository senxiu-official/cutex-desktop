// @vitest-environment jsdom
// 拖放落点预览 (外观 → 工作区: 只要框线 / 框线+底色; owner 2026-10-25/26: 只要框线 seemed never to take effect). One
// switch for every drop preview's tint (lib/dropTint): the preview carries DROP_TINT and names its tint in
// --drop-tint; styles.css paints it only under :root[data-drop-preview="fill"]. No component reads the setting.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { setAppearance } = await import("../src/renderer/src/lib/appearance");
const { DROP_TINT, dropTint } = await import("../src/renderer/src/lib/dropTint");
const { useSideDnd } = await import("../src/renderer/src/lib/sideDnd");
const { useWorkspaceDrag } = await import("../src/renderer/src/lib/workspaces");
const { SideDndLayer } = await import("../src/renderer/src/components/side/SideDndLayer");
const { WorkspaceDndLayer } = await import("../src/renderer/src/components/WorkspaceDndLayer");
const { LaunchComposer } = await import("../src/renderer/src/components/LaunchPage");
const { ForetellLayer } = await import("../src/renderer/src/components/ForetellLayer");
const { clearForetell, setForetell } = await import("../src/renderer/src/lib/foretell");

const ROOT = resolve(__dirname, "../src/renderer/src");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MODES = ["outline", "fill"] as const;

/** Every drop preview, and how it is drawn. */
const PREVIEWS = [
  "components/side/SideDndLayer.tsx", // Shelf / pane / tab zones
  "components/WorkspaceDndLayer.tsx", // conversation (sidebar row) drags
  "components/side/ShelfRail.tsx", // the rail's pages / ＋ under a dragged pane
  "components/Sidebar.tsx", // project sections under a dragged project
  "components/ChipTray.tsx", // the tray's dock edges
  "modules/home/trayReorder.tsx", // pinned-entry reorder boxes
  "modules/home/DeskSurface.tsx", // desk ghosts / 放到桌面
  "modules/services/ServiceCards.tsx", // services page groups
  "components/Composer.tsx", // the input box under a dragged file / workspace path
  "components/LaunchPage.tsx", // the launch composer (new chat / new agent) under a dragged file
  "components/TurnQueue.tsx", // the queue's 接下来 insert target (armed / refused)
  // Not drops but the same "where will it go" boxes (owner 2026-10-27: 只要框线 leaked here):
  "components/ForetellLayer.tsx", // hover / Ctrl / replace / open-beside / menu / tray / ⌘K previews (lib/foretell)
  "components/ColumnPickLayer.tsx", // Ctrl+click with every column taken: 「换掉 X」 on each column
];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(relative(ROOT, p).replace(/\\/g, "/"));
  }
  return out;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useSideDnd.setState({ drag: null, feedback: { zone: null, label: null } });
  useWorkspaceDrag.setState({ ref: null, zone: null, tone: null });
  clearForetell();
  setAppearance({ dropPreview: "outline" }, false);
});

describe("dropTint", () => {
  it("names the tint in --drop-tint (accent at 13% by default)", () => {
    expect(DROP_TINT).toBe("drop-tint");
    expect(dropTint()).toEqual({ "--drop-tint": "color-mix(in srgb, var(--accent) 13%, transparent)" });
    expect(dropTint("var(--ok)", 11)).toEqual({ "--drop-tint": "color-mix(in srgb, var(--ok) 11%, transparent)" });
    // An opaque box names its own background.
    expect(dropTint("var(--accent)", 13, "var(--surface)")).toEqual({ "--drop-tint": "color-mix(in srgb, var(--accent) 13%, var(--surface))" });
  });

  it("the setting reaches <html>; styles.css paints .drop-tint only under 框线+底色 — the one rule that does", () => {
    for (const mode of MODES) {
      setAppearance({ dropPreview: mode }, false);
      expect(document.documentElement.dataset.dropPreview).toBe(mode);
    }
    expect(src("styles.css")).toMatch(/:root\[data-drop-preview="fill"\] \.drop-tint \{\s*background: var\(--drop-tint,/);
    const readers = files(ROOT).filter((f) => f.endsWith(".css") && /\[data-drop-preview[=\]]|\.drop-tint\s*\{/.test(src(f)));
    expect(readers).toEqual(["styles.css"]);
  });
});

describe("拖放落点预览 reaches every drop preview through DROP_TINT", () => {
  it.each(MODES)("Shelf / pane / tab zones (SideDndLayer): outline + DROP_TINT, the same under %s", (mode) => {
    setAppearance({ dropPreview: mode }, false);
    for (const tone of ["accent", "warn"] as const) {
      useSideDnd.setState({ drag: { kind: "pane" } as never, feedback: { zone: { left: 10, top: 10, width: 200, height: 100, text: "here", tone, round: 8 }, label: null } });
      act(() => root.render(h(SideDndLayer)));
      const zone = host.querySelector<HTMLElement>("[data-pane-drop-tone]")!;
      expect(zone.className).toMatch(/border-2/);
      expect(zone.classList.contains(DROP_TINT)).toBe(true);
      expect(zone.className).not.toMatch(/\bbg-/);
      expect(zone.style.background).toBe("");
      expect(zone.style.getPropertyValue("--drop-tint")).toBe(tone === "warn" ? "color-mix(in srgb, var(--warn,#d97706) 12%, transparent)" : "color-mix(in srgb, var(--accent) 13%, transparent)");
    }
  });

  it.each(MODES)("conversation / workspace drags (WorkspaceDndLayer): dashed outline + DROP_TINT, the same under %s", (mode) => {
    setAppearance({ dropPreview: mode }, false);
    useWorkspaceDrag.setState({ ref: { kind: "agent", hostId: "local", key: "a", title: "A" }, title: "A", outcome: { kind: "project" } as never, zone: { left: 10, top: 10, width: 300, height: 200 }, tone: "project", label: "x", action: "x" });
    act(() => root.render(h(WorkspaceDndLayer)));
    const zone = host.querySelector<HTMLElement>("[data-ws-zone]")!;
    expect(zone.className).toMatch(/border-dashed/);
    expect(zone.classList.contains(DROP_TINT)).toBe(true);
    expect(zone.style.borderColor).not.toBe("");
    expect(zone.style.background).toBe("");
    expect(zone.style.getPropertyValue("--drop-tint")).toBe("color-mix(in srgb, var(--accent) 11%, transparent)");
  });

  it.each(MODES)("the refusing tab strip (允许混排 off): its underline always, its stripes only as --drop-tint, the same under %s", (mode) => {
    setAppearance({ dropPreview: mode }, false);
    useSideDnd.setState({ drag: { kind: "pane" } as never, feedback: { zone: null, label: null, nope: { left: 0, top: 0, width: 200, height: 28 } } as never });
    act(() => root.render(h(SideDndLayer)));
    const strip = host.querySelector<HTMLElement>("[data-pane-drop-nope]")!;
    expect(strip.className).toMatch(/shadow-\[inset_0_-2px_0/);
    expect(strip.classList.contains(DROP_TINT)).toBe(true);
    expect(strip.style.background).toBe("");
    expect(strip.style.getPropertyValue("--drop-tint")).toMatch(/^repeating-linear-gradient\(-45deg, color-mix\(in srgb, var\(--danger\) 9%/);
  });

  it.each(MODES)("the composer under a dragged file (LaunchComposer): accent border, tint only through DROP_TINT, the same under %s", (mode) => {
    setAppearance({ dropPreview: mode }, false);
    const render = (dragOver: boolean) => {
      act(() => root.render(h(LaunchComposer, { textarea: { value: "" }, label: "send", disabled: true, onSubmit() {}, dragOver, dragEvents: {} })));
      return host.querySelector<HTMLElement>(".launch-composer")!;
    };
    const idle = render(false);
    expect(idle.className).toMatch(/border-border/);
    expect(idle.classList.contains(DROP_TINT)).toBe(false);
    expect(idle.style.getPropertyValue("--drop-tint")).toBe("");
    const over = render(true);
    expect(over.className).toMatch(/\bborder-accent\b/);
    expect(over.classList.contains(DROP_TINT)).toBe(true);
    // Only bg-surface: no tint of its own whatever the setting (styles.css paints --drop-tint under 框线+底色).
    expect(over.className.match(/\bbg-[\w-]+/g)).toEqual(["bg-surface"]);
    expect(over.style.background).toBe("");
    expect(over.style.getPropertyValue("--drop-tint")).toBe("color-mix(in srgb, var(--accent) 13%, var(--surface))");
  });

  it.each(MODES)("the foretell outline (hover / Ctrl / replace / beside): dashed + DROP_TINT, no fill of its own, the same under %s", (mode) => {
    setAppearance({ dropPreview: mode }, false);
    const owner = {};
    act(() => setForetell(owner, { tone: "beside", text: "beside", marks: [{ box: { left: 10, top: 10, width: 300, height: 200 } }] }));
    act(() => root.render(h(ForetellLayer)));
    const mark = host.querySelector<HTMLElement>("[data-foretell-mark]")!;
    expect(mark.dataset.foretellMark).toBe("beside");
    expect(mark.classList.contains(DROP_TINT)).toBe(true);
    expect(mark.className).not.toMatch(/\bbg-/);
    expect(mark.style.background).toBe("");
  });

  it("the column pick (Ctrl+click, every column taken): dashed red + DROP_TINT, tint only as --drop-tint (deeper on hover)", () => {
    const s = src("components/ColumnPickLayer.tsx");
    expect(s).toContain("border-2 border-dashed border-danger hover:border-solid ${DROP_TINT} ${PICK_TINT}");
    expect(s).toContain("[--drop-tint:color-mix(in_srgb,var(--danger)_10%,transparent)] hover:[--drop-tint:color-mix(in_srgb,var(--danger)_20%,transparent)]");
    expect(s).not.toMatch(/bg-danger\/(10|20)/);
  });

  it("no dashed preview box anywhere paints a coloured fill outside DROP_TINT (new previews can't bypass the switch)", () => {
    const COLOURED = /(^|[\s"'`])(hover:|group-hover:)?bg-(accent|danger|ok|warn|info|success|primary)(\/\d+|-soft)?(?=[\s"'`]|$)|background(Color)?: *["'`]?(color-mix|rgba?\(|var\(--(accent|danger|ok|warn))/;
    const leaks: string[] = [];
    for (const f of files(ROOT).filter((f) => !f.startsWith("i18n/") && !f.startsWith("dev/"))) {
      const s = src(f);
      if (f.endsWith(".css")) {
        // Every rule with a dashed border gives its tint only as --drop-tint.
        for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/dashed/.test(m[2]!) && /(^|[;\s])background(-color)?:/.test(m[2]!)) leaks.push(`${f}: ${m[1]!.trim()}`);
        continue;
      }
      // Each className chunk (up to the next className=) that draws a dashed box: no coloured bg / background.
      for (const chunk of s.split("className=").slice(1)) {
        const own = chunk.split("\n")[0]!;
        if (/border-dashed|borderStyle: "dashed"/.test(own) && COLOURED.test(own)) leaks.push(`${f}: ${own.slice(0, 120)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("every drop preview uses lib/dropTint, and none reads the setting or paints its own tint", () => {
    for (const f of PREVIEWS) {
      const s = src(f);
      expect(s, f).toMatch(/import \{ DROP_TINT(, dropTint)? \} from "(\.\.\/)+lib\/dropTint";/);
      expect(s, f).toContain("${DROP_TINT}");
      expect(s, f).not.toMatch(/useDropFill|dropPreview/);
    }
    // The old per-component tints are gone.
    expect(src("components/side/SideDndLayer.tsx")).not.toMatch(/bg-\[color-mix/);
    expect(src("components/WorkspaceDndLayer.tsx")).not.toMatch(/background: fill|data-drop-fill/);
    expect(src("components/Sidebar.tsx")).not.toMatch(/"bg-accent\/10"/);
    expect(src("components/side/ShelfRail.tsx")).not.toMatch(/"bg-accent\/15"/);
    expect(src("modules/services/ServiceCards.tsx")).not.toMatch(/"bg-accent\/5"/);
    // The composer's input box: its drag state adds DROP_TINT (and the opaque tint), no bg of its own.
    expect(src("components/Composer.tsx")).toContain('dragOver ? `border-accent ${DROP_TINT}` : "border-border"');
    expect(src("components/Composer.tsx")).toContain("style={dragOver ? INPUT_DROP_TINT : undefined}");
    // The insert target's soft fills (dead under bg-surface anyway) went to DROP_TINT; so did the refusing tab strip's stripes.
    expect(src("components/TurnQueue.tsx")).not.toMatch(/bg-accent-soft|bg-danger-soft/);
    expect(src("components/side/SideDndLayer.tsx")).not.toMatch(/background: "repeating-linear-gradient/);
    // Only the settings, the first-run choice and lib/appearance(Model) know the setting.
    const knows = files(ROOT).filter((f) => !f.startsWith("i18n/") && /\bdropPreview\b|DropPreviewStyle/.test(src(f)));
    expect(knows.sort()).toEqual(["components/WorkSurfaceSettings.tsx", "lib/appearance.ts", "lib/appearanceModel.ts", "lib/firstChoices.ts", "modules/shell/settingsSearch.ts"]);
  });

  it("the tray's and the desk's previews keep a border and give their tint only as --drop-tint", () => {
    const css = src("components/tray.css") + src("modules/home/home.css") + src("components/foretell.css");
    for (const cls of ["foretell-mark", "tray-zone","tray-drop-refuse", "tray-drop-accept", "desk-ghost-target", "desk-ghost-moved", "desk-drop-hint"]) {
      const rules = [...css.matchAll(new RegExp(`\\.${cls}(\\[[^\\]]*\\])? \\{([^}]*)\\}`, "g"))].map((m) => m[2] ?? "");
      expect(rules.length, cls).toBeGreaterThan(0);
      expect(rules.some((r) => /\bborder:/.test(r)), cls).toBe(true);
      expect(rules.some((r) => /--drop-tint:/.test(r)), cls).toBe(true);
      for (const r of rules) expect(r, cls).not.toMatch(/(^|[;\s])background:/);
    }
  });
});
