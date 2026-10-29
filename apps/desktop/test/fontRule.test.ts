// Font rule (owner 2026-10-23): readable text follows the owner's 外观 fonts; only tiny fixed-size glyphs
// (count digits, avatar badges) use the fixed --font-fixed stack; keycaps use the mono stack. Also: the big
// alert window applies the same stored fonts (lib/storedFonts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFontPlan } from "../src/renderer/src/lib/fontFaces";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { APPEARANCE_KEY, storedAppearance } from "../src/renderer/src/lib/storedFonts";

const src = (p: string) => readFileSync(resolve(__dirname, "../src/renderer/src", p), "utf8");

describe("font rule", () => {
  it("--font-fixed is a sans stack the owner's font plan never overrides", () => {
    const m = /--font-fixed:\s*([^;]+);/.exec(src("styles.css"));
    expect(m?.[1]).toMatch(/sans-serif\s*$/);
    const plan = buildFontPlan({ ...DEFAULT_APPEARANCE, uiFont: "Noto Serif SC" }, 1);
    expect(Object.keys(plan.variables)).not.toContain("--font-fixed");
  });

  it("the avatar badge uses the fixed font; keycaps use mono", () => {
    expect(src("components/Avatar.tsx")).toMatch(/data-avatar-badge[\s\S]{0,200}font-fixed/);
    expect(src("components/TitleBar.tsx")).toMatch(/<kbd className="[^"]*\bfont-mono\b/);
    expect(src("modules/quick-switch/Palette.tsx")).toMatch(/function Kbd[\s\S]{0,200}\bfont-mono\b/);
    expect(src("styles.css")).toMatch(/\.fullscreen-hint kbd \{[^}]*font-family: var\(--font-mono\)/);
  });

  it("readable text has no hard-coded face: the launch portrait name and the alert window follow the 外观 fonts", () => {
    expect(src("components/LaunchPage.css")).not.toMatch(/Georgia|serif;/);
    const alert = src("ownerAlert/ownerAlert.css");
    expect(alert).toMatch(/font: 14px\/1\.5 var\(--font-sans,/);
    expect(alert).toMatch(/\.refs \{[^}]*font-family: var\(--font-mono,/);
    expect(src("ownerAlert/main.ts")).toMatch(/followStoredFonts\(\)/);
  });

  it("storedAppearance reads the main window's entry and falls back to defaults", () => {
    const store = (v: string | null) => ({ getItem: (k: string) => (k === APPEARANCE_KEY ? v : null) });
    expect(storedAppearance(store(JSON.stringify({ uiFont: "Noto Serif SC" }))).uiFont).toBe("Noto Serif SC");
    expect(storedAppearance(store("{broken")).uiFont).toBe(DEFAULT_APPEARANCE.uiFont);
    expect(storedAppearance(store(null))).toEqual(DEFAULT_APPEARANCE);
  });
});
