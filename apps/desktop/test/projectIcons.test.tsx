// 项目图标 (lib/projectIcons + prefs `projectIcons`): the choice shape, host keying, catalog
// search, the 自定义 parse, and what ProjectBadge draws for each kind (emoji / lucide icon /
// custom text / letter fallback).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SidebarGroup } from "../src/renderer/src/lib/sidebar";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { cleanProjectIcon, groupIcon, migrateIcons, parseCustomIcon, projectIcon, projectLucideIcon, PROJECT_EMOJIS, PROJECT_ICON_COLORS, PROJECT_LUCIDE_ICONS, PROJECT_NAMED_SWATCHES, sameProjectColor, searchProjectEmoji, searchProjectIcons, withIcon } from "../src/renderer/src/lib/projectIcons";
import { ProjectBadge } from "../src/renderer/src/components/ProjectBadge";

describe("cleanProjectIcon", () => {
  it("keeps a catalog emoji and a catalog icon id", () => {
    expect(cleanProjectIcon({ kind: "emoji", value: "🦊" })).toEqual({ kind: "emoji", value: "🦊" });
    expect(cleanProjectIcon({ kind: "icon", value: "folder" })).toEqual({ kind: "icon", value: "folder" });
  });

  it("keeps custom text: a hanzi or 1–2 letters", () => {
    expect(cleanProjectIcon({ kind: "text", value: "卷" })).toEqual({ kind: "text", value: "卷" });
    expect(cleanProjectIcon({ kind: "text", value: "CD" })).toEqual({ kind: "text", value: "CD" });
    expect(cleanProjectIcon({ kind: "text", value: "A" })).toEqual({ kind: "text", value: "A" });
  });

  it("rejects unknown icon ids, junk kinds, empties, control characters and whitespace", () => {
    expect(cleanProjectIcon({ kind: "icon", value: "not-an-icon" })).toBeNull();
    expect(cleanProjectIcon({ kind: "glyph", value: "x" } as never)).toBeNull();
    expect(cleanProjectIcon({ kind: "emoji", value: "  " })).toBeNull();
    expect(cleanProjectIcon({ kind: "emoji", value: "a b" })).toBeNull();
    expect(cleanProjectIcon({ kind: "emoji", value: "a\nb" })).toBeNull();
    expect(cleanProjectIcon(null)).toBeNull();
  });

  it("separates the kinds: emoji must be pictographic, text must not be, text is ≤ 2 chars", () => {
    expect(cleanProjectIcon({ kind: "emoji", value: "卷" })).toBeNull();
    expect(cleanProjectIcon({ kind: "text", value: "🦊" })).toBeNull();
    expect(cleanProjectIcon({ kind: "text", value: "ABC" })).toBeNull();
    expect(cleanProjectIcon({ kind: "text", value: "A B" })).toBeNull();
  });
});

describe("parseCustomIcon (自定义 tab)", () => {
  it("classifies any emoji as emoji and plain characters as text", () => {
    expect(parseCustomIcon("🌊")).toEqual({ kind: "emoji", value: "🌊" });
    expect(parseCustomIcon("🧑‍🚀")).toEqual({ kind: "emoji", value: "🧑‍🚀" });
    expect(parseCustomIcon(" 卷 ")).toEqual({ kind: "text", value: "卷" });
    expect(parseCustomIcon("CD")).toEqual({ kind: "text", value: "CD" });
    expect(parseCustomIcon("卷")).toEqual({ kind: "text", value: "卷" });
  });

  it("rejects empties, spaces, control characters and 3+ plain characters", () => {
    expect(parseCustomIcon("")).toBeNull();
    expect(parseCustomIcon("   ")).toBeNull();
    expect(parseCustomIcon("a b")).toBeNull();
    expect(parseCustomIcon("a\nb")).toBeNull();
    expect(parseCustomIcon("ABC")).toBeNull();
  });
});

describe("icon records", () => {
  it("keys by host + project, drops on null, keeps other hosts", () => {
    let icons = withIcon({}, "local", "p1", { kind: "icon", value: "folder" });
    expect(icons).toEqual({ [hostKey("local", "p1")]: { kind: "icon", value: "folder" } });
    icons = withIcon(icons, "workstation", "p1", { kind: "emoji", value: "🦊" });
    expect(projectIcon(icons, "local", "p1")).toEqual({ kind: "icon", value: "folder" });
    expect(projectIcon(icons, "workstation", "p1")).toEqual({ kind: "emoji", value: "🦊" });
    const same = withIcon(icons, "local", "p1", { kind: "icon", value: "folder" });
    expect(same).toBe(icons);
    icons = withIcon(icons, "local", "p1", null);
    expect(projectIcon(icons, "local", "p1")).toBeNull();
    expect(projectIcon(icons, "workstation", "p1")).toEqual({ kind: "emoji", value: "🦊" });
  });

  it("groupIcon reads a project group's host (the focus host when it has none)", () => {
    const icons = withIcon(withIcon({}, "workstation", "p1", { kind: "icon", value: "terminal" }), "local", "p2", { kind: "emoji", value: "🧠" });
    const g1 = { kind: "project", id: "p1", hostId: "workstation" } as Pick<SidebarGroup, "kind" | "id" | "hostId">;
    const g2 = { kind: "project", id: "p2" } as Pick<SidebarGroup, "kind" | "id" | "hostId">;
    const independent = { kind: "independent", id: "__independent__" } as Pick<SidebarGroup, "kind" | "id" | "hostId">;
    expect(groupIcon(icons, g1, "local")).toEqual({ kind: "icon", value: "terminal" });
    expect(groupIcon(icons, g2, "local")).toEqual({ kind: "emoji", value: "🧠" });
    expect(groupIcon(icons, independent, "local")).toBeNull();
  });

  it("migrate keeps only host-keyed valid choices", () => {
    const key = hostKey("local", "p1");
    expect(migrateIcons({ [key]: { kind: "icon", value: "folder" }, p2: { kind: "emoji", value: "🦊" }, [hostKey("local", "p3")]: { kind: "icon", value: "gone" }, [hostKey("local", "p5")]: { kind: "text", value: "卷" }, [hostKey("local", "p6")]: { kind: "text", value: "卷卷卷" }, [hostKey("local", "p4")]: "junk" })).toEqual({ [key]: { kind: "icon", value: "folder" }, [hostKey("local", "p5")]: { kind: "text", value: "卷" } });
    expect(migrateIcons(null)).toEqual({});
    expect(migrateIcons("x")).toEqual({});
  });
});

describe("catalog", () => {
  it("has the curated lucide set with resolvable components", () => {
    expect(PROJECT_LUCIDE_ICONS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(PROJECT_LUCIDE_ICONS.map((i) => i.id)).size).toBe(PROJECT_LUCIDE_ICONS.length);
    for (const i of PROJECT_LUCIDE_ICONS) expect(projectLucideIcon(i.id)).toBe(i.Icon);
    expect(projectLucideIcon("nope")).toBeNull();
  });

  it("has unique emoji and the eight colours", () => {
    expect(new Set(PROJECT_EMOJIS.map((e) => e.value)).size).toBe(PROJECT_EMOJIS.length);
    expect(PROJECT_ICON_COLORS).toHaveLength(8);
    expect(PROJECT_ICON_COLORS[0]).toBe("#ffffff");
  });

  it("sameProjectColor: a daemon palette name matches its twin swatch, cyan / magenta only their own", () => {
    // Names whose hue the swatch row carries count as that swatch (selected ring on edit).
    expect(sameProjectColor("red", "#e5484d")).toBe(true);
    expect(sameProjectColor("blue", "#3e63dd")).toBe(true);
    expect(sameProjectColor("green", "#30a46c")).toBe(true);
    expect(sameProjectColor("yellow", "#ffb224")).toBe(true);
    // Hex equality still works, including uppercase presentation values.
    expect(sameProjectColor("#E5484D", "#e5484d")).toBe(true);
    // No cross-matching: another hue's swatch, a same-hue hex that isn't the swatch, pink vs magenta.
    expect(sameProjectColor("red", "#3e63dd")).toBe(false);
    expect(sameProjectColor("#fa5252", "#e5484d")).toBe(false);
    expect(sameProjectColor("magenta", "#d6409f")).toBe(false);
    // The appended name swatches write daemon tokens and match only themselves.
    expect(PROJECT_NAMED_SWATCHES).toEqual(["cyan", "magenta"]);
    expect(sameProjectColor("cyan", "cyan")).toBe(true);
    expect(sameProjectColor("magenta", "magenta")).toBe(true);
    expect(sameProjectColor("cyan", "magenta")).toBe(false);
  });

  it("search matches zh / en keywords and icon ids, case-insensitively", () => {
    expect(searchProjectEmoji("狐狸").map((e) => e.value)).toContain("🦊");
    expect(searchProjectEmoji("fox").map((e) => e.value)).toContain("🦊");
    expect(searchProjectEmoji("🦊")).toHaveLength(1);
    expect(searchProjectIcons("终端").map((i) => i.id)).toContain("terminal");
    expect(searchProjectIcons("Graduation".toUpperCase()).map((i) => i.id)).toContain("graduation-cap");
    expect(searchProjectIcons("")).toHaveLength(PROJECT_LUCIDE_ICONS.length);
    expect(searchProjectEmoji("zzz")).toEqual([]);
  });
});

describe("ProjectBadge", () => {
  const html = (props: Partial<Parameters<typeof ProjectBadge>[0]>) => renderToStaticMarkup(createElement(ProjectBadge, { badge: "CD", color: "cyan", ...props }));

  it("letter fallback: the badge text in the project colour on a soft tint tile", () => {
    const out = html({});
    expect(out).toContain(">CD<");
    expect(out).toContain("project-icon");
    expect(out).toContain("--project-icon-color:#22b8cf");
    // No solid fill / white glyph any more: tile and ink come from .project-icon (styles.css).
    expect(out).not.toContain("background:");
    expect(out).not.toContain("text-white");
  });

  it("emoji and lucide choices draw in the same tile instead of the letters", () => {
    const emoji = html({ icon: { kind: "emoji", value: "🦊" } });
    expect(emoji).toContain("🦊");
    expect(emoji).not.toContain(">CD<");
    const icon = html({ icon: { kind: "icon", value: "folder" } });
    expect(icon).toContain("<svg");
    expect(icon).not.toContain(">CD<");
  });

  it("every kind sits in one fixed square per size; one glyph size and stroke", () => {
    const box = (out: string) => /width:(\d+(?:\.\d+)?)px;height:(\d+(?:\.\d+)?)px/.exec(out)?.slice(1);
    const kinds = [{}, { icon: { kind: "text", value: "卷" } }, { icon: { kind: "text", value: "AB" } }, { icon: { kind: "emoji", value: "🦊" } }, { icon: { kind: "icon", value: "graduation-cap" } }] as const;
    for (const k of kinds) expect(box(html({ ...k, size: "sm" }))).toEqual(["18", "18"]);
    for (const k of kinds) expect(box(html({ ...k }))).toEqual(["16", "16"]);
    const cap = html({ icon: { kind: "icon", value: "graduation-cap" }, size: "sm" });
    const book = html({ icon: { kind: "icon", value: "book" }, size: "sm" });
    for (const svg of [cap, book]) {
      expect(svg).toContain('width="12"');
      expect(svg).toContain('stroke-width="2.3"');
    }
  });

  it("custom text: one or two characters; a longer daemon badge label shows its first two", () => {
    expect(html({ icon: { kind: "text", value: "卷" } })).toContain(">卷<");
    expect(html({ icon: { kind: "text", value: "卷轴" } })).toContain(">卷轴<");
    expect(html({ badge: "ABCD" })).toContain(">AB<");
  });

  it("white takes the foreground colour; hex colours pass through", () => {
    expect(html({ color: "#ffffff" })).toContain("--project-icon-color:var(--fg)");
    expect(html({ color: "#e5484d" })).toContain("--project-icon-color:#e5484d");
  });

  it("线条 style: no tile, same box, a larger glyph; letters keep their size", () => {
    const box = (out: string) => /width:(\d+(?:\.\d+)?)px;height:(\d+(?:\.\d+)?)px/.exec(out)?.slice(1);
    const cap = html({ icon: { kind: "icon", value: "graduation-cap" }, size: "sm", look: "line" });
    expect(cap).toContain("project-icon-line");
    expect(cap).toContain('data-icon-style="line"');
    expect(box(cap)).toEqual(["18", "18"]);
    expect(cap).toContain('width="14"');
    // The same 1.15px stroke as the tile's 12px glyph.
    expect(cap).toMatch(/stroke-width="1\.97/);
    const letters = html({ size: "sm", look: "line" });
    expect(box(letters)).toEqual(["18", "18"]);
    expect(letters).toContain("font-size:9px");
    expect(letters).toContain("--project-icon-color:#22b8cf");
  });

  it("淡底色 is the default style (prefs projectIconStyle)", () => {
    const out = html({});
    expect(out).toContain('data-icon-style="tint"');
    expect(out).not.toContain("project-icon-line");
  });

  it("an unknown icon id falls back to the letter badge", () => {
    const out = html({ icon: { kind: "icon", value: "not-in-catalog" } });
    expect(out).toContain(">CD<");
  });
});
