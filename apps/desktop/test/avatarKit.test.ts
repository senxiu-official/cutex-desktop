import { describe, expect, it, vi } from "vitest";
import { normalizeCatalog } from "../../../scripts/avatar-kit-import.mjs";
import { DEFAULT_PORTRAIT_PACK, DEFAULT_PORTRAIT_THEME_IDS, DEFAULT_PORTRAIT_THEMES, migratePortraitThemes } from "../src/shared/portraitDefaults";
import { familyOfModel, parsePackManifest, portraitAvatarOf, portraitRefOf } from "../src/shared/portraitPacks";
import { BUNDLED_PORTRAIT_PACKS, indexPacks, packOf, poolFor, portraitFor, resolvePortrait } from "../src/renderer/src/lib/portraitPacks";
import { portraitThemesOf } from "../src/renderer/src/lib/portraitThemes";

const characters = ["gpt", "deepseek", "claude", "kimi", "glm", "gemini"];
const catalog = () => ({ schemaVersion: 1,
  themes: DEFAULT_PORTRAIT_THEME_IDS.map((id, index) => ({ id, name: id, order: index + 1 })).reverse(),
  characters: characters.map(id => ({ id })),
  avatars: DEFAULT_PORTRAIT_THEME_IDS.flatMap(themeId => characters.flatMap(characterId => Array.from({ length: 6 }, (_, index) => {
    const variant = index + 1, id = `${themeId}/${characterId}/0${variant}`;
    return { id, themeId, characterId, variant, image: `assets/${id}.png`, thumbnail: `thumbnails/${id}.webp`, sha256: "a".repeat(64), width: 512, height: 512, reviewStatus: "unreviewed" };
  }))).reverse(),
});

describe("owner avatar kit", () => {
  it("spreads ten distinct Claude and DeepSeek agents across the whole default pool and repeats after restart", async () => {
    const ids = ["alden", "helper", "ifm-dir", "ifm-figures", "ifm-plot", "ifm-review", "demo-director-r2", "sampler", "writer", "kai"];
    const index = indexPacks(BUNDLED_PORTRAIT_PACKS);
    const before = new Map<string, string[]>();
    for (const family of ["claude", "deepseek"] as const) {
      expect(poolFor(index, DEFAULT_PORTRAIT_THEMES, family)).toHaveLength(120);
      const picks = ids.map(id => portraitFor(index, null, id, family, DEFAULT_PORTRAIT_THEMES)!.picture.key);
      expect(new Set(picks).size).toBeGreaterThanOrEqual(8);
      expect(new Set(picks.map(key => portraitRefOf({ kind: "icon", value: `portrait:${key}` })!.theme)).size).toBeGreaterThanOrEqual(8);
      before.set(family, picks);
    }
    // A fresh module graph recreates the shipped manifests, hash implementation and empty pool caches.
    vi.resetModules();
    const restarted = await import("../src/renderer/src/lib/portraitPacks");
    const after = restarted.indexPacks(restarted.BUNDLED_PORTRAIT_PACKS);
    for (const family of ["claude", "deepseek"] as const) {
      expect(ids.map(id => restarted.portraitFor(after, null, id, family, DEFAULT_PORTRAIT_THEMES)!.picture.key)).toEqual(before.get(family));
      // An explicit theme subset and an explicit stored selection keep their own precedence.
      const subset = [DEFAULT_PORTRAIT_THEMES[0]!];
      expect(restarted.poolFor(after, subset, family)).toHaveLength(6);
      const chosen = restarted.poolFor(after, subset, family)[5]!;
      expect(restarted.portraitFor(after, portraitAvatarOf(chosen), ids[0], family, DEFAULT_PORTRAIT_THEMES)!.picture.key).toBe(chosen.key);
    }
  });
  it("orders shuffled input by theme order, catalog characters and variant, including unreviewed art", () => {
    const result = normalizeCatalog(catalog());
    expect(result.themes.map((x: { id: string }) => x.id)).toEqual(DEFAULT_PORTRAIT_THEME_IDS);
    expect(result.entries.slice(0, 36).map((x: { id: string }) => x.id)).toEqual(characters.flatMap(character => Array.from({ length: 6 }, (_, i) => `cloud-woven-silks/${character}/0${i + 1}`)));
    expect(result.entries).toHaveLength(720);
    const duplicate = catalog(); duplicate.avatars[0] = duplicate.avatars[1]!;
    expect(() => normalizeCatalog(duplicate)).toThrow(/duplicate catalog id/);
  });

  it("ships exactly that order with bilingual catalog themes and logical identities under 64 characters", () => {
    const p = BUNDLED_PORTRAIT_PACKS.find(x => x.id === DEFAULT_PORTRAIT_PACK)!;
    expect(p.themes.map(x => x.id)).toEqual(DEFAULT_PORTRAIT_THEME_IDS);
    for (const theme of p.themes) {
      expect(theme.pictures.map(x => x.stem)).toEqual(characters.flatMap(c => Array.from({ length: 6 }, (_, i) => `${c}/0${i + 1}`)));
      for (const picture of theme.pictures) {
        const avatar = portraitAvatarOf(picture);
        expect(avatar.value).toBe(`portrait:${p.id}/${theme.id}/${picture.stem}`);
        expect(avatar.value.length).toBeLessThanOrEqual(64);
        expect(portraitRefOf(avatar)).toEqual({ pack: p.id, theme: theme.id, stem: picture.stem });
      }
    }
    expect(portraitThemesOf([p], "en").every(x => /^[\x20-\x7e]+$/.test(x.name))).toBe(true);
    expect(portraitThemesOf([p], "zh-CN")[0]!.name).toBe("云想华裳");
  });

  it("persists catalog entry.id independently of image filenames", () => {
    const data = parsePackManifest({ schemaVersion: 1, entries: [{ id: "great-ming/kimi/05", theme: "great-ming", model: "kimi", avatarPath: "avatars/renamed-file.webp" }] })!;
    const picture = packOf(DEFAULT_PORTRAIT_PACK, data, "bundled", x => x).themes[0]!.pictures[0]!;
    expect(portraitAvatarOf(picture).value).toBe("portrait:kit-20261029/great-ming/kimi/05");
  });

  it("retired saved ids fall back to the same drawn family without rewriting the stored selection", () => {
    const index = indexPacks(BUNDLED_PORTRAIT_PACKS);
    for (const model of [...characters, "k3.1-pro"]) {
      const old = { pack: "overnight-test-v1", theme: "office", stem: `${model === "k3.1-pro" ? "kimi" : model}-v4` };
      const before = portraitAvatarOf(old);
      const result = resolvePortrait(index, old, "agent-1");
      expect(result!.picture.pack).toBe(DEFAULT_PORTRAIT_PACK);
      expect(result!.picture.family).toBe(familyOfModel(model));
      expect(portraitAvatarOf(old)).toEqual(before);
    }
  });

  it("migrates old theme preferences while preserving explicit off and custom packs", () => {
    expect(migratePortraitThemes([])).toEqual([]);
    expect(migratePortraitThemes(["overnight-test-v1/office", "mine/office", "overnight-test-v1/office"])).toEqual([`${DEFAULT_PORTRAIT_PACK}/metropolitan-muses`, "mine/office"]);
    expect(DEFAULT_PORTRAIT_THEMES).toHaveLength(20);
  });
});
