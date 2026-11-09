// More folder looks (外观…, owner 2026-11-06): any colour by hand with an ink that keeps the name ≥ 4.5:1 on every
// sidebar background, a much bigger grouped icon set, and automatic picks that never change.
import { describe, expect, it } from "vitest";
import { Bookmark, Box, Briefcase, Flag, Folder, Layers, Shapes, Tag } from "lucide-react";
import { cleanFolderColor, FOLDER_COLORS, FOLDER_EXTRA_COLORS, FOLDER_ICON_CHOICES, FOLDER_ICONS, folderIcon, folderLook, folderStyle, OLDER_FOLDER_LOOK, readFolderLookChoice } from "../src/renderer/src/lib/folderLook";
import { FOLDER_ICON_BY_ID, FOLDER_ICON_GROUPS, searchFolderIcons } from "../src/renderer/src/lib/folderIcons";
import { folderInks, INK_TARGET, SIDEBAR_BACKGROUNDS, worstContrast } from "../src/renderer/src/lib/folderInk";
import { readFileSync } from "node:fs";

describe("automatic picks never change", () => {
  it("the hashed palette and icons are exactly the first version's", () => {
    expect(FOLDER_COLORS).toEqual(["#0D9488", "#F76B15", "#D6409F", "#8B5CF6", "#0EA5E9", "#A87956", "#64748B"]);
    expect(FOLDER_ICONS).toEqual([Folder, Layers, Briefcase, Box, Bookmark, Flag, Shapes, Tag]);
  });
  it("a folder without a choice gets the same look as before (FNV-1a of its id)", () => {
    const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };
    for (const id of ["s-1", "s-mhn2k0-abcde", "s-life", "研究", "x".repeat(40)]) {
      const look = folderLook(id);
      expect(look.color).toBe(FOLDER_COLORS[fnv(id) % 7]);
      expect(look.icon).toBe(FOLDER_ICONS[(fnv(id) >>> 8) % 8]);
      expect(look.ink).toBeUndefined();
    }
  });
  it("red stays out of the automatic palette (by hand only)", () => {
    expect(FOLDER_COLORS).not.toContain("#DC2626");
    expect(FOLDER_EXTRA_COLORS.map(([n]) => n)).toContain("red");
  });
});

describe("custom colour validation", () => {
  it("accepts #RGB / #RRGGBB in any case, normalised; refuses the rest", () => {
    expect(cleanFolderColor("#1a2")).toBe("#11AA22");
    expect(cleanFolderColor(" #0d9488 ")).toBe("#0D9488");
    for (const bad of ["red", "#12", "#12345", "#1234567", "#ggg", "rgb(1,2,3)", 3, null, undefined]) expect(cleanFolderColor(bad)).toBeNull();
  });
  it("a stored look keeps only a valid colour (local prefs and the synced layout share this read)", () => {
    expect(readFolderLookChoice({ color: "#abcdef", icon: "plane" })).toEqual({ color: "#ABCDEF", icon: "plane" });
    expect(readFolderLookChoice({ color: "javascript:alert(1)", icon: "plane" })).toEqual({ icon: "plane" });
    expect(readFolderLookChoice({ color: "url(x)" })).toBeUndefined();
  });
  it("palette colours keep the CSS ink (no variables); any other colour sets its own", () => {
    expect(folderStyle(folderLook("a", { color: FOLDER_COLORS[2] }))).toEqual({ "--folder-color": FOLDER_COLORS[2], "--folder-ink-light": "initial", "--folder-ink-dark": "initial" });
    const custom = folderStyle(folderLook("a", { color: "#123456" })) as Record<string, string>;
    expect(custom["--folder-ink-light"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(custom["--folder-ink-dark"]).toMatch(/^#[0-9a-f]{6}$/);
    // 更早的项目 inside a custom-coloured folder must not inherit that folder's ink.
    expect(folderStyle(OLDER_FOLDER_LOOK)).toMatchObject({ "--folder-ink-light": "initial", "--folder-ink-dark": "initial" });
  });
});

describe("custom colour ink", () => {
  const samples = ["#FFFFFF", "#000000", "#FFFF00", "#00FFFF", "#FF0000", "#00FF00", "#0000FF", "#808080", "#F5F5F5", "#111111", "#FFE4E1", "#1A1A2E", ...FOLDER_EXTRA_COLORS.map(([, c]) => c)];
  // 200 more, spread over the cube (deterministic).
  for (let i = 0; i < 200; i++) samples.push(`#${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}`);
  it("reads ≥ 4.5:1 on every light and every dark sidebar background, extremes included", () => {
    for (const c of samples) {
      const ink = folderInks(c);
      expect(worstContrast(ink.light, "light"), `${c} light`).toBeGreaterThanOrEqual(4.5);
      expect(worstContrast(ink.dark, "dark"), `${c} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("a colour that already passes is only mixed as much as the palette rule", () => {
    // Mid hues stay close to themselves: the ink of a saturated blue is still blue-ish, not black / white.
    const { light, dark } = folderInks("#2563EB");
    expect(light).not.toBe("#000000");
    expect(dark).not.toBe("#ffffff");
    expect(worstContrast(light, "light")).toBeGreaterThanOrEqual(INK_TARGET);
  });
  it("the backgrounds are the styles.css palettes' --bg / --surface", () => {
    const css = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8").toLowerCase();
    for (const bg of [...SIDEBAR_BACKGROUNDS.light, ...SIDEBAR_BACKGROUNDS.dark]) expect(css).toContain(bg);
  });
});

describe("the icon set", () => {
  it("every earlier choice still resolves to the same icon", () => {
    for (const { id, Icon } of FOLDER_ICON_CHOICES) {
      const now = folderIcon(id);
      expect(now, id).not.toBeNull();
      if (FOLDER_ICON_BY_ID.has(id)) expect(FOLDER_ICON_BY_ID.get(id)).toBe(Icon);
    }
  });
  it("is much bigger, in groups, ids unique, without the 更早的项目 archive box", () => {
    const all = FOLDER_ICON_GROUPS.flatMap((g) => g.icons);
    expect(all.length).toBeGreaterThan(150);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    expect(all.map((i) => i.Icon)).not.toContain(OLDER_FOLDER_LOOK.icon);
    expect(FOLDER_ICON_GROUPS.length).toBeGreaterThanOrEqual(10);
  });
  it("search matches icon ids and shown group names", () => {
    const names: Record<string, string> = { travel: "出行" };
    const by = (q: string) => searchFolderIcons(q, (g) => names[g] ?? g).flatMap((g) => g.icons.map((i) => i.id));
    expect(by("plane")).toEqual(["plane"]);
    expect(by("出行")).toContain("plane");
    expect(by("zzz")).toEqual([]);
    expect(by("").length).toBe(FOLDER_ICON_GROUPS.flatMap((g) => g.icons).length);
  });
});
