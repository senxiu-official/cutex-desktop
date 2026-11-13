import { describe, expect, it, vi } from "vitest";
import { MARK_MIN_CONTRAST, MARK_TILE_TINT, markTileInks, baseMark, distinctMarks, nameMark, projectMarkCrowded, projectMarkFont, projectMarkHeight, projectMarkText, PROJECT_MARK_MIN_AVATAR } from "../src/renderer/src/lib/projectMark";
import { mixHex, SIDEBAR_BACKGROUNDS } from "../src/renderer/src/lib/folderInk";
import { contrastRatio, hexRgb } from "../src/renderer/src/lib/workSurface";

vi.mock("../src/renderer/src/store", () => ({ useApp: () => null, pinnedOn: () => new Set() }));
const { agentIndex } = await import("../src/renderer/src/lib/agentLook");
const { projectColor } = await import("../src/renderer/src/lib/sidebar");
const { PROJECT_PALETTE } = await import("../src/renderer/src/lib/projectCreate");
const { BADGE_TINTS, badgeColor } = await import("../src/renderer/src/lib/sessionBadge");

describe("project mark text", () => {
  it("the chosen text / emoji icon wins, else the project's own distinct mark", () => {
    expect(projectMarkText({ kind: "text", value: "桌" }, "CD")).toBe("桌");
    expect(projectMarkText({ kind: "emoji", value: "🚀" }, "CD")).toBe("🚀");
    expect(projectMarkText({ kind: "icon", value: "folder" }, "CD")).toBe("CD");
    expect(projectMarkText(null, "CDX")).toBe("CDX");
  });
  it("keeps up to four columns whole: a hanzi counts two, a ZWJ emoji is never split", () => {
    expect(projectMarkText(null, "CT副")).toBe("CT副");
    expect(projectMarkText(null, "副总")).toBe("副总");
    expect(projectMarkText(null, "副总裁")).toBe("副总");
    expect(projectMarkText(null, "ABCDE")).toBe("ABCD");
    expect(projectMarkText({ kind: "emoji", value: "👩‍💻" }, "CD")).toBe("👩‍💻");
    expect(baseMark("kks", "CT副")).toBe("CT副");
  });
  it("text with a hanzi: the UI font, two px under the box; Latin stays small", () => {
    expect(projectMarkFont(12, "CT")).toEqual({ size: 8.5, sans: false });
    expect(projectMarkFont(12, "CT副")).toEqual({ size: 10, sans: true });
    expect(projectMarkFont(14, "副总")).toEqual({ size: 12, sans: true });
    expect(projectMarkFont(12, "CT副", true)).toEqual({ size: 9.5, sans: true });
    expect(projectMarkFont(12, "ABCD", true)).toEqual({ size: 8.5, sans: true });
  });
  it("crowded: more than two columns on an avatar under 36 px with a presence dot", () => {
    expect(projectMarkCrowded(28, "CT副", true)).toBe(true);
    expect(projectMarkCrowded(32, "ABCD", true)).toBe(true);
    expect(projectMarkCrowded(32, "AB", true)).toBe(false);
    expect(projectMarkCrowded(28, "副总", false)).toBe(false);
    expect(projectMarkCrowded(40, "CT副", true)).toBe(false);
  });
  it("initials from word boundaries", () => {
    expect(nameMark("cutex-desktop")).toBe("CD");
    expect(nameMark("cutex-E")).toBe("CE");
    expect(nameMark("sc-polya-v2")).toBe("SP");
    expect(nameMark("ifm_ema")).toBe("IE");
    expect(nameMark("cutexDesktop")).toBe("CD");
    expect(nameMark("cutex")).toBe("CU");
    expect(nameMark("x")).toBe("X");
    expect(nameMark("桌面项目")).toBe("桌");
    expect(nameMark("  ")).toBe("");
  });
  it("a deliberate badge label wins; the auto-filled one (name's first two letters) does not", () => {
    expect(baseMark("cutex-desktop", "CU")).toBe("CD");
    expect(baseMark("cutex-desktop", "桌")).toBe("桌");
    expect(baseMark("cutex-desktop", "")).toBe("CD");
    expect(baseMark("ifm-ema", "IE")).toBe("IE");
  });
  it("two projects never share a mark", () => {
    const m = distinctMarks([
      { key: "h/a", name: "cutex-desktop", badge: "CU" },
      { key: "h/b", name: "cutex-docs", badge: "CU" },
      { key: "h/c", name: "cutex-design", badge: "" },
    ]);
    expect(m.get("h/a")).toBe("CD");
    expect(new Set(m.values()).size).toBe(3);
    expect(m.get("h/b")).toBe("CO");
    expect(m.get("h/c")).toBe("CE");
  });
  it("sizes: none under 24 px, 14 / 16 / 18 above", () => {
    expect(PROJECT_MARK_MIN_AVATAR).toBe(24);
    expect([24, 32, 44].map(projectMarkHeight)).toEqual([12, 13, 14]);
  });
});

describe("a Director's project in the agent index", () => {
  const session = (id: string) => ({ cutexSessionId: id, displayName: id }) as never;
  const project = (id: string, director: string | null) => ({ project_id: id, director_cutex_session_id: director, presentation: { display_name: id, badge_label: id.slice(0, 2).toUpperCase(), color: "blue" } }) as never;
  const index = (projects: unknown[]) =>
    agentIndex({ sidebar: { active: [session("d1"), session("m1")], retired: [], hostRows: {}, projects: { projects } } as never, byHost: {}, pinned: new Set(), hosts: { active: "local" } });
  it("one project: the mark's source; a member: none", () => {
    const i = index([project("desk", "d1")]);
    expect(i.get("d1")!.project).toMatchObject({ id: "desk", badge: "DE", hostId: "local", mark: "DE" });
    expect(i.get("m1")!.project).toBeNull();
  });
  it("a Director of several projects: no mark", () => {
    const i = index([project("a", "d1"), project("b", "d1")]);
    expect(i.get("d1")!.isDirector).toBe(true);
    expect(i.get("d1")!.project).toBeNull();
  });
});

describe("the mark's ink stays readable (WCAG ≥ 4.5 on its tile, light and dark)", () => {
  // The tile is the project colour mixed into the card behind the avatar (components/ProjectMarkChip), so the ink is
  // checked on that tile over every palette's card and surface (lib/folderInk SIDEBAR_BACKGROUNDS), per theme family.
  const named = PROJECT_PALETTE.map((c) => projectColor(c));
  const tints = BADGE_TINTS.map((t) => projectColor(badgeColor(t)));
  const fallback = projectColor("no-such-colour");
  // Custom #hex: the extremes, a grey ramp and seeded random colours.
  let seed = 20261101;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const greys = Array.from({ length: 33 }, (_, i) => Math.min(255, i * 8)).map((v) => hex(v, v, v));
  const random = Array.from({ length: 200 }, () => hex(Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)));
  const extremes = ["#ffffff", "#000000", "#ffff00", "#00ff00", "#ff00ff", "#00ffff", "#0000ff", "#ff0000", "#3fa7a3", "#a89f8a", "#f4a6b0", "#8b5cf6", "#101820", "#fffbe0"];
  const worst = (c: string) => Math.min(...(["light", "dark"] as const).flatMap((theme) => SIDEBAR_BACKGROUNDS[theme].map((bg) => contrastRatio(hexRgb(markTileInks(c)[theme]), hexRgb(mixHex(bg, c, MARK_TILE_TINT[theme]))))));
  for (const [name, colours] of Object.entries({ palette: named, "badge tints": tints, "fallback grey": [fallback], "custom hex": [...extremes, ...greys, ...random] })) {
    it(name, () => {
      for (const c of colours) expect(worst(c), `${name} ${c}`).toBeGreaterThanOrEqual(MARK_MIN_CONTRAST);
    });
  }
  it("stays the project's hue where it already reads (not black / white)", () => {
    const inks = markTileInks("#3fa7a3");
    expect(inks.light).not.toBe("#000000");
    expect(inks.dark).not.toBe("#ffffff");
  });
});

describe("the mark's ink on the colour picker's preview surface (--surface-2)", () => {
  // Cross-review 2026-11-13: the picker previews the chip on --surface-2 (ProjectColorPicker ColorPreview), which the
  // ink was not computed against — dark olive + #ff11bb read 4.00:1. Every theme's --surface-2 (styles.css).
  const SURFACE_2 = { light: ["#ececee", "#e8e5da", "#e6e6e3"], dark: ["#262628", "#313130", "#353534", "#363633", "#363332", "#18181a"] } as const;
  it("reaches 4.5:1 there too, for the reported colour and the palette", () => {
    for (const c of ["#ff11bb", ...PROJECT_PALETTE.map((p) => projectColor(p)), "#3fa7a3", "#8b5cf6", "#f4a6b0"])
      for (const theme of ["light", "dark"] as const)
        for (const bg of SURFACE_2[theme])
          expect(contrastRatio(hexRgb(markTileInks(c)[theme]), hexRgb(mixHex(bg, c, MARK_TILE_TINT[theme]))), `${c} ${theme} on ${bg}`).toBeGreaterThanOrEqual(MARK_MIN_CONTRAST);
  });
  it("covers every --surface-2 in styles.css (a new palette must add its own)", async () => {
    const { MARK_BACKGROUNDS } = await import("../src/renderer/src/lib/projectMark");
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
    const all = new Set<string>([...MARK_BACKGROUNDS.light, ...MARK_BACKGROUNDS.dark]);
    const found = [...css.matchAll(/--surface-2:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => m[1]!.toLowerCase());
    expect(found.length).toBeGreaterThan(5);
    for (const c of found) expect(all.has(c), c).toBe(true);
  });
});
