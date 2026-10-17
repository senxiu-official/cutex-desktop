// Terminal colours (modules/terminal/xtermTheme): a 16-colour ANSI palette per app theme, every colour
// readable on the theme's background (WCAG AA 4.5:1) except the documented background-role colours,
// which xterm lifts through minimumContrastRatio.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANSI_BACKGROUND_ROLE, ANSI_NAMES, ANSI_PALETTES, contrastRatio, PALETTE_BACKGROUND, TERMINAL_MIN_CONTRAST, themeFromTokens } from "../src/renderer/src/modules/terminal/xtermTheme";

const MODES = ["light", "dark"] as const;
const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");

describe("ANSI palettes", () => {
  it("define all 16 colours as #rrggbb, distinct within a theme", () => {
    for (const mode of MODES) {
      const p = ANSI_PALETTES[mode];
      expect(Object.keys(p).sort()).toEqual([...ANSI_NAMES].sort());
      for (const name of ANSI_NAMES) expect(p[name]).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(Object.values(p)).size).toBe(16);
    }
  });

  for (const mode of MODES) {
    it(`${mode}: every colour except the background-role ones reaches 4.5:1 on ${PALETTE_BACKGROUND[mode]}`, () => {
      const bg = PALETTE_BACKGROUND[mode];
      const exempt = new Set(ANSI_BACKGROUND_ROLE[mode]);
      const failing = ANSI_NAMES.filter((n) => !exempt.has(n) && contrastRatio(ANSI_PALETTES[mode][n], bg) < 4.5);
      expect(failing).toEqual([]);
      expect(ANSI_NAMES.length - exempt.size).toBe(mode === "light" ? 14 : 15);
    });
  }

  it("exempts only colours that are the theme's own background role", () => {
    expect(ANSI_BACKGROUND_ROLE.light).toEqual(["white", "brightWhite"]);
    expect(ANSI_BACKGROUND_ROLE.dark).toEqual(["black"]);
    // …and xterm lifts any glyph below AA against its cell background.
    expect(TERMINAL_MIN_CONTRAST).toBeGreaterThanOrEqual(4.5);
  });

  it("tunes against the app's --bg tokens", () => {
    const light = /:root \{[^}]*--bg: (#[0-9a-f]{6});/.exec(css)?.[1];
    const dark = /:root\[data-theme="dark"\] \{[^}]*--bg: (#[0-9a-f]{6});/.exec(css)?.[1];
    expect(light).toBe(PALETTE_BACKGROUND.light);
    expect(dark).toBe(PALETTE_BACKGROUND.dark);
  });
});

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("rgb(119, 119, 119)", "#fff")).toBeCloseTo(4.48, 2);
  });
});

describe("themeFromTokens", () => {
  it("picks the palette from the --bg luminance and keeps the app's colours", () => {
    const light = themeFromTokens({ bg: "#ffffff", fg: "#1d1d1f", accent: "#3b82f6" });
    expect(light).toMatchObject({ ...ANSI_PALETTES.light, background: "#ffffff", foreground: "#1d1d1f", cursor: "#1d1d1f", cursorAccent: "#ffffff" });
    expect(light.selectionBackground).toMatch(/^#3b82f6[0-9a-f]{2}$/);
    const dark = themeFromTokens({ bg: "#161616", fg: "#ececec", accent: "#60a5fa" });
    expect(dark).toMatchObject({ ...ANSI_PALETTES.dark, background: "#161616", foreground: "#ececec" });
    expect(dark.selectionBackground).toMatch(/^#60a5fa[0-9a-f]{2}$/);
  });

  it("falls back to the light palette when the tokens are missing", () => {
    expect(themeFromTokens({})).toMatchObject({ ...ANSI_PALETTES.light, background: "#ffffff" });
  });

  it("foreground on background passes AA in both themes", () => {
    expect(contrastRatio("#1d1d1f", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#ececec", "#161616")).toBeGreaterThan(4.5);
  });
});
