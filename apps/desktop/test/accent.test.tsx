// @vitest-environment jsdom
// 外观 → 强调色 (lib/accent, components/settings/AccentPicker): derivation keeps text readable on every palette
// background and on accent fills, the pick lands on <html> and (coalesced) in storage, the default is blue run
// through the same rule, and the picker is one radio group.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_PRESETS, applyAccent, contrast, DARK_BACKGROUNDS, DEFAULT_ACCENT, DEFAULT_ACCENT_VALUES, deriveAccent, flushAccentWrite,
  followStoredAccent, LIGHT_BACKGROUNDS, loadAccent, minContrast, ON_ACCENT_DARK, onAccentFor, parseAccentPref, TEXT_CONTRAST,
} from "../src/renderer/src/lib/accent";
import { I18nProvider } from "../src/renderer/src/i18n";
import { AccentPicker } from "../src/renderer/src/components/settings/AccentPicker";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const html = document.documentElement;
const SRC = join(__dirname, "../src/renderer/src");

beforeEach(() => {
  localStorage.clear();
  applyAccent(DEFAULT_ACCENT);
  flushAccentWrite();
});

describe("derivation", () => {
  const seeds = [...ACCENT_PRESETS.map((p) => p.seed), "#ffc0cb", "#ffff00", "#ffffff", "#000000", "#1e3a8a", "#0f0", "#808080"];
  it.each(seeds)("%s reads as text on every light and dark background, and text on its fills reads (WCAG AA)", (seed) => {
    const { light, dark, onLight, onDark } = deriveAccent(seed);
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(minContrast(light, LIGHT_BACKGROUNDS)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(minContrast(dark, DARK_BACKGROUNDS)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrast(light, onLight)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrast(dark, onDark)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });
  it("a white pick gets dark text on its fills, never white on white", () => {
    const white = deriveAccent("#ffffff");
    expect(white.onDark).toBe(ON_ACCENT_DARK);
    expect(contrast(white.dark, white.onDark)).toBeGreaterThan(15);
    expect(onAccentFor(DEFAULT_ACCENT_VALUES.light)).toBe("#ffffff");
  });
  it("keeps the hue: pink stays pink, and an already readable colour is not changed", () => {
    const pink = deriveAccent("#ec4899");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(pink.light.slice(i, i + 2), 16)) as [number, number, number];
    expect(r).toBeGreaterThan(g + 80);
    expect(b).toBeGreaterThan(g);
    expect(deriveAccent("#1e3a8a").light).toBe("#1e3a8a");
  });
  it("the dark value is lighter than the light one", () => {
    for (const p of ACCENT_PRESETS) {
      const { light, dark } = deriveAccent(p.seed);
      expect(contrast(dark, "#000000")).toBeGreaterThan(contrast(light, "#000000"));
    }
  });
  // Each palette rule of styles.css with its theme: inside the dark media query or a data-theme="dark" selector = dark.
  const paletteBackgrounds = () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf8");
    const themes = css.slice(0, css.indexOf("--r-sm:")).replace(/\/\*[\s\S]*?\*\//g, "");
    const out = { light: [] as string[], dark: [] as string[] };
    let depth = 0, media = false, selector = "", start = 0;
    for (let i = 0; i < themes.length; i++) {
      const c = themes[i];
      if (c === "{") {
        const head = themes.slice(start, i).trim();
        if (head.startsWith("@media")) media = /prefers-color-scheme:\s*dark/.test(head);
        else selector = head;
        depth++;
        start = i + 1;
      } else if (c === "}") {
        if (selector) {
          const body = themes.slice(start, i);
          const dark = (media && depth === 2) || /data-theme="dark"/.test(selector);
          for (const m of body.matchAll(/--(?:bg|surface|surface-2|raised|win|bubble|peer):\s*(#[0-9a-f]{6});/g)) out[dark ? "dark" : "light"].push(m[1]!);
          selector = "";
        } else media = false;
        depth--;
        start = i + 1;
      } else if (c === ";" && depth === 0) start = i + 1;
    }
    return { ...out, themes };
  };
  it("LIGHT_BACKGROUNDS holds every light palette's page, card, popover, window and bubble colour", () => {
    const { light } = paletteBackgrounds();
    expect(new Set(light).size).toBe(LIGHT_BACKGROUNDS.length);
    for (const v of light) expect(LIGHT_BACKGROUNDS as readonly string[], v).toContain(v);
  });
  it("DARK_BACKGROUNDS holds every dark palette's page, card, popover, window and bubble colour", () => {
    const { dark, themes } = paletteBackgrounds();
    expect(new Set(dark).size).toBe(DARK_BACKGROUNDS.length);
    for (const v of dark) expect(DARK_BACKGROUNDS as readonly string[], v).toContain(v);
    // --float is --raised (popovers): no palette gives it a value of its own.
    expect(themes).not.toMatch(/--float:\s*#/);
  });
  it("the review's cases read", () => {
    // The review's cases: pink on the 宣纸 card, a black pick's dark value on a 茶色 popover.
    expect(contrast(deriveAccent("#ec4899").light, "#e8e5da")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrast(deriveAccent("#000000").dark, "#40403c")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });
});

describe("stored pick", () => {
  it("reads presets and colours, falls back to the default for anything else", () => {
    expect(parseAccentPref(null)).toBe("blue");
    expect(parseAccentPref("pink")).toBe("pink");
    expect(parseAccentPref("#FF66AA")).toBe("#ff66aa");
    expect(parseAccentPref("#f6a")).toBe("#ff66aa");
    expect(parseAccentPref("red; background: url(x)")).toBe("blue");
    expect(parseAccentPref("magenta")).toBe("blue");
  });
  it("the default sets nothing; a pick sets its four values on <html> and persists", () => {
    expect(html.style.getPropertyValue("--accent-light")).toBe("");
    expect(html.dataset.accent).toBeUndefined();
    applyAccent("pink");
    const pink = deriveAccent(ACCENT_PRESETS.find((p) => p.id === "pink")!.seed);
    expect(html.style.getPropertyValue("--accent-light")).toBe(pink.light);
    expect(html.style.getPropertyValue("--accent-dark")).toBe(pink.dark);
    expect(html.style.getPropertyValue("--on-accent-light")).toBe(pink.onLight);
    expect(html.style.getPropertyValue("--on-accent-dark")).toBe(pink.onDark);
    expect(html.dataset.accent).toBe("pink");
    flushAccentWrite();
    expect(loadAccent()).toBe("pink");
    applyAccent("#22aa88");
    expect(html.dataset.accent).toBe("custom");
    flushAccentWrite();
    expect(loadAccent()).toBe("#22aa88");
    applyAccent(DEFAULT_ACCENT);
    flushAccentWrite();
    for (const v of ["--accent-light", "--accent-dark", "--on-accent-light", "--on-accent-dark"]) expect(html.style.getPropertyValue(v)).toBe("");
    expect(localStorage.getItem("cutex-desktop.accent")).toBeNull();
  });
  it("dragging the custom picker repaints at once but writes storage once, after 150 ms of stillness", () => {
    vi.useFakeTimers();
    const writes = vi.spyOn(Storage.prototype, "setItem");
    try {
      for (const c of ["#ff0000", "#ff1100", "#ff2200", "#ff3300"]) {
        applyAccent(c as never);
        expect(html.style.getPropertyValue("--accent-light")).toBe(deriveAccent(c).light);
        vi.advanceTimersByTime(40);
      }
      expect(writes).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(loadAccent()).toBe("#ff3300");
    } finally {
      writes.mockRestore();
      vi.useRealTimers();
    }
  });
  it("other windows follow a change made in Settings", () => {
    const stop = followStoredAccent();
    localStorage.setItem("cutex-desktop.accent", "teal");
    window.dispatchEvent(new StorageEvent("storage", { key: "cutex-desktop.accent" }));
    expect(html.dataset.accent).toBe("teal");
    stop();
  });
});

describe("stylesheets and components", () => {
  it("the default is blue run through the same rule, and every --accent / --on-accent falls back to it", () => {
    expect(deriveAccent(ACCENT_PRESETS[0].seed)).toEqual(DEFAULT_ACCENT_VALUES);
    for (const file of ["styles.css", "ownerAlert/ownerAlert.css"]) {
      const css = readFileSync(join(SRC, file), "utf8");
      const decls = [...css.matchAll(/--accent:\s*([^;]+);/g)].map((m) => m[1]);
      expect(decls.length).toBeGreaterThanOrEqual(3);
      for (const d of decls) expect(d).toMatch(/^var\(--accent-(light, #1861d2|dark, #79acff)\)$/);
      const on = [...css.matchAll(/--on-accent:\s*([^;]+);/g)].map((m) => m[1]);
      expect(on.length).toBeGreaterThanOrEqual(3);
      for (const d of on) expect(d).toMatch(/^var\(--on-accent-(light, #ffffff|dark, #0f1115)\)$/);
    }
  });
  it("text and marks on an accent fill use the accent's own foreground, never a fixed white", () => {
    // A solid accent fill: bg-accent (no /alpha), or an inline / CSS background of var(--accent).
    const FILL = /\bbg-accent(?![\w/-])|background:\s*"?var\(--accent\)/;
    // A fixed white foreground: text / bg / fill white, or #fff / white as a colour.
    const WHITE = /\b(?:text|bg|fill|stroke)-white\b|color:\s*"?(?:#fff(?:fff)?|white)\b/;
    const offenders: string[] = [];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== "dev" && f.name !== "i18n") walk(p); continue; }
        if (/\.(tsx?|css)$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p);
      }
    };
    walk(SRC);
    for (const p of files) {
      const src = readFileSync(p, "utf8");
      if (p.endsWith(".css")) {
        // A rule that paints the accent behind fixed white text (danger / ok / warn rules keep white).
        // Custom properties some rule sets to the accent (foretell's --ft, the big alert's --level) count as the accent.
        const aliases = new Set(["accent", ...[...src.matchAll(/--([\w-]+):\s*var\(--accent\)/g)].map((m) => m[1]!)]);
        for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
          const body = m[2]!;
          const bg = /background(?:-color)?:\s*var\(--([\w-]+)/.exec(body)?.[1];
          if (bg && aliases.has(bg) && /(?:^|;|\s)color:\s*(?:#fff(?:fff)?|white)\b/.test(body)) offenders.push(`${p}: ${m[1]!.trim()}`);
        }
        continue;
      }
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        // Each quoted class / style string on its own: a branch that fills with the accent must not also say white.
        for (const str of line.match(/"[^"]*"|'[^']*'/g) ?? []) {
          if (FILL.test(str) && WHITE.test(str)) offenders.push(`${p}:${i + 1}`);
        }
        // A template whose fixed part says white while one of its branches fills with the accent (mixed ternaries).
        for (const tpl of line.match(/`[^`]*`/g) ?? []) {
          const fixed = tpl.replace(/"[^"]*"|'[^']*'/g, "");
          if (FILL.test(tpl) && WHITE.test(fixed)) offenders.push(`${p}:${i + 1}`);
        }
        // Child marks: within the next few lines of an accent fill, a white child (a knob, a dash, an icon colour).
        if (FILL.test(line)) {
          for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
            if (/^\s*<\/(?:button|span|div)>/.test(lines[j]!)) break;
            for (const str of lines[j]!.match(/"[^"]*"|`[^`]*`/g) ?? []) {
              if (WHITE.test(str.replace(/"[^"]*"/g, (q) => (str.startsWith("`") ? "" : q))) && !/danger|warn|bg-ok/.test(str)) offenders.push(`${p}:${j + 1} (inside the fill on ${i + 1})`);
            }
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
  it("the scan catches the shapes it guards against", () => {
    const FILL = /\bbg-accent(?![\w/-])/;
    const fixed = (tpl: string) => tpl.replace(/"[^"]*"|'[^']*'/g, "");
    expect(FILL.test('`px-3 text-white ${danger ? "bg-danger-solid" : "bg-accent"}`') && /\btext-white\b/.test(fixed('`px-3 text-white ${danger ? "bg-danger-solid" : "bg-accent"}`'))).toBe(true);
    expect(/\btext-white\b/.test(fixed('`px-3 ${danger ? "bg-danger-solid text-white" : "bg-accent text-on-accent"}`'))).toBe(false);
  });
  it("no app component hard-codes the default blue any more", () => {
    for (const file of ["components/side/WorkspaceRail.tsx", "modules/conversation/Projection.tsx"]) {
      expect(readFileSync(join(SRC, file), "utf8")).not.toMatch(/#3b82f6|59,\s*130,\s*246/i);
    }
  });
});

describe("picker", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  it("is one radio group: eight presets plus 自定义, arrows move and pick", async () => {
    let value: string = "blue";
    const picks: string[] = [];
    const draw = () => root.render(h(I18nProvider, null, h(AccentPicker, { label: "accent", value: value as never, onChange: (v: string) => { picks.push(v); value = v; draw(); } })));
    await act(async () => draw());
    const radios = [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    expect(radios.map((r) => r.dataset.accentChoice)).toEqual([...ACCENT_PRESETS.map((p) => p.id), "custom"]);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    act(() => host.querySelector<HTMLButtonElement>("[data-accent-choice=pink]")!.click());
    expect(picks).toEqual(["pink"]);
    expect(host.querySelector("[data-accent-choice=pink]")!.getAttribute("aria-checked")).toBe("true");
    act(() => host.querySelector<HTMLButtonElement>("[data-accent-choice=pink]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(picks.at(-1)).toBe("rose");
  });
  it("a custom colour shows on the 自定义 choice", async () => {
    await act(async () => root.render(h(I18nProvider, null, h(AccentPicker, { value: "#22aa88", onChange: () => {} }))));
    const custom = host.querySelector<HTMLButtonElement>("[data-accent-choice=custom]")!;
    expect(custom.getAttribute("aria-checked")).toBe("true");
    expect(custom.textContent).toContain("#22aa88");
  });
});

it("ships its words in zh-CN and en", () => {
  const keys = ["appearance.accent", "appearance.accentHint", "appearance.accent.custom", "appearance.accent.customPick", ...ACCENT_PRESETS.map((p) => `appearance.accent.${p.id}`)];
  for (const k of keys) {
    expect((zhCN as Record<string, string>)[k], k).toBeTruthy();
    expect((en as Record<string, string>)[k], k).toBeTruthy();
  }
});
