// @vitest-environment jsdom
// lib/portraitThemes as the 0.2.0 guide uses it (040 §3.2): installed themes with names, counts and one face; enabling
// writes UiPrefs.portraitPacks (none = 不用).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import { BUNDLED_PORTRAIT_PACKS, packOf, resetPortraitPacksForTest } from "../src/renderer/src/lib/portraitPacks";
import { disableAllPortraitThemes, enableAllPortraitThemes, portraitThemesOf, setPortraitThemeEnabled, themeCover } from "../src/renderer/src/lib/portraitThemes";
import { parsePackManifest } from "../src/shared/portraitPacks";

const entries = (theme: string) => ["claude", "gpt", "kimi"].flatMap((model) => [1, 2].map((v) => ({ theme, themeName: theme.toUpperCase(), model, avatarPath: `avatars/${theme}/${model}-v${v}.webp` })));
const PACK = packOf("p", parsePackManifest({ schemaVersion: 1, name: "测试包", entries: [...entries("beach"), ...entries("office")] })!, "bundled", (path) => `/p/${path}`);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setUiPref("portraitPacks", []);
  resetPortraitPacksForTest([PACK]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => setUiPref("portraitPacks", []));
  resetPortraitPacksForTest();
});


// The settings card (now 头像风格: theme cards, 全选, batch) is covered in test/avatarStylePicker.test.tsx.

describe("lib/portraitThemes (the guide's API)", () => {
  it("lists themes with names, counts and one face each; toggles without duplicates", () => {
    const themes = portraitThemesOf([PACK], "zh-CN");
    expect(themes.map((t) => [t.key, t.name, t.count, t.packName, t.bundled])).toEqual([["p/beach", "BEACH", 6, "测试包", true], ["p/office", "OFFICE", 6, "测试包", true]]);
    expect(themes.map((t) => t.cover.key)).toEqual(["p/beach/claude-v1", "p/office/claude-v1"]);
    expect(themes[0]!.families).toEqual({ claude: 2, openai: 2, kimi: 2 });
    act(() => setPortraitThemeEnabled("p/beach", true));
    act(() => setPortraitThemeEnabled("p/beach", true));
    expect(getUiPrefs().portraitPacks).toEqual(["p/beach"]);
    act(() => enableAllPortraitThemes(themes.map((t) => t.key)));
    expect(getUiPrefs().portraitPacks).toEqual(["p/beach", "p/office"]);
    act(() => disableAllPortraitThemes());
    expect(getUiPrefs().portraitPacks).toEqual([]);
  });

  it("one representative face per theme (owner 2026-10-29): the manifest cover, else the first family in family order, else the first picture", () => {
    const gptFirst = ["kimi", "gpt", "claude"].flatMap((model) => [1, 2].map((v) => ({ theme: "t", themeName: "T", model, avatarPath: `avatars/t/${model}-v${v}.webp` })));
    const pack = (extra: object) => packOf("q", parsePackManifest({ schemaVersion: 1, name: "q", entries: gptFirst, ...extra })!, "bundled", (path) => `/q/${path}`);
    expect(themeCover(pack({ themes: [{ id: "t", cover: "gpt-v2" }] }).themes[0]!).stem).toBe("gpt-v2");
    // No cover: claude before openai / kimi whatever the manifest order (a stable pick for packs without one).
    expect(themeCover(pack({}).themes[0]!).stem).toBe("claude-v1");
    const other = packOf("o", parsePackManifest({ schemaVersion: 1, name: "o", entries: [{ theme: "t", model: "mystery", avatarPath: "avatars/t/mystery-v1.webp" }] })!, "bundled", (path) => `/o/${path}`);
    expect(themeCover(other.themes[0]!).stem).toBe("mystery-v1");
  });

  it("shipped themes rotate their cover through the families in theme order (owner 2026-10-29), each an existing picture", () => {
    const pack = BUNDLED_PORTRAIT_PACKS.find((p) => p.id === "kit-20261029")!;
    const themes = portraitThemesOf(BUNDLED_PORTRAIT_PACKS, "zh-CN").filter((t) => t.pack === pack.id);
    expect(themes.length).toBe(20);
    // The manifest's own cover resolves (not the fallback) and is a picture of that theme.
    for (const t of pack.themes) {
      expect(t.cover).toBeTruthy();
      expect(t.pictures.some((p) => p.stem === t.cover)).toBe(true);
      expect(themeCover(t).stem).toBe(t.cover);
    }
    const families = themes.map((t) => t.cover.family);
    expect(families.slice(0, 6)).toEqual(["claude", "openai", "gemini", "deepseek", "kimi", "glm"]);
    families.forEach((f, i) => expect(f).toBe(families[i % 6]));
    expect(new Set(themes.map((t) => t.cover.key)).size).toBe(20);
  });
});
