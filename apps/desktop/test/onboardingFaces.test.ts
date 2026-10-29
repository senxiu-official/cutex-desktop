// Per-theme metadata in portrait pack manifests and the onboarding's fixed faces (owner 2026-10-24): a Chinese and an
// English name, an English subtitle and a cover face per theme; the onboarding shows one shipped face per theme,
// chosen in advance (the shipped pack's `cover`), and never loads one from the owner's folder while a card is open.
import { describe, expect, it } from "vitest";
import { parsePackManifest } from "../src/shared/portraitPacks";
import { BUNDLED_PORTRAIT_PACKS, packOf } from "../src/renderer/src/lib/portraitPacks";
import { portraitThemesOf } from "../src/renderer/src/lib/portraitThemes";
import { ONBOARDING_FACES, onboardingFaces } from "../src/renderer/src/lib/onboardingFaces";

const entries = (theme: string, themeName: string) =>
  ["claude", "gpt"].flatMap((model) => [1, 2].map((v) => ({ theme, themeName, model, variant: v, avatarPath: `avatars/${theme}/${model}-v${v}.png`, previewPath: `previews/${theme}/${model}-v${v}.png` })));

describe("per-theme metadata", () => {
  const json = {
    schemaVersion: 1,
    entries: [...entries("lolita", "洛丽塔"), ...entries("office", "上班族")],
    themes: [
      { id: "lolita", name: { "zh-CN": "洛丽塔", en: "Lolita" }, subtitle: { en: "Frills and lace" }, cover: "gpt-v2" },
      { id: "office", cover: "nope-v9" },
      { id: "missing", name: "x" },
    ],
  };

  it("reads names, subtitle and cover; a cover that is not in the theme is ignored", () => {
    const data = parsePackManifest(json)!;
    expect(data.themes[0]).toMatchObject({ names: { "zh-CN": "洛丽塔", en: "Lolita" }, subtitle: { en: "Frills and lace" }, cover: "gpt-v2" });
    expect(data.themes[1]!.cover).toBeUndefined();
    expect(data.themes.map((t) => t.id)).toEqual(["lolita", "office"]);
  });

  it("the theme list names each theme in the UI language and falls back to today's name; the cover, else the first face", () => {
    const pack = packOf("p", parsePackManifest(json)!, "bundled", (p) => `/p/${p}`);
    const zh = portraitThemesOf([pack], "zh-CN");
    const en = portraitThemesOf([pack], "en");
    expect(zh.map((t) => [t.name, t.subtitle])).toEqual([["洛丽塔", "Frills and lace"], ["上班族", null]]);
    expect(en.map((t) => t.name)).toEqual(["Lolita", "上班族"]);
    expect(zh[0]!.cover.stem).toBe("gpt-v2");
    expect(zh[1]!.cover.stem).toBe("claude-v1");
    expect(onboardingFaces([pack])).toEqual(new Map([["p/lolita", "/p/previews/lolita/gpt-v2.png"], ["p/office", "/p/previews/office/claude-v1.png"]]));
    expect(onboardingFaces([{ ...pack, source: "user" }]).size).toBe(0); // the owner's folder: no face loaded here
  });
});

describe("the shipped faces", () => {
  it("every shipped theme has its chosen cover, an English name, and a static preview URL", () => {
    const themes = BUNDLED_PORTRAIT_PACKS.flatMap((p) => p.themes.map((th) => ({ key: `${p.id}/${th.id}`, th })));
    expect(themes.length).toBe(20);
    for (const { key, th } of themes) {
      expect(th.cover, key).toBeTruthy();
      expect(typeof th.names === "object" && th.names?.en, key).toBeTruthy();
      expect(ONBOARDING_FACES.get(key), key).toMatch(new RegExp(`previews/${th.id}/${th.cover}\\.webp$`));
    }
  });
});
