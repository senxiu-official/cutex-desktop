// 拟人头像 themes as the owner turns them on (docs/design/040 §3.2): Settings → 外观 → 拟人头像 and the 0.2.0 guide
// share this. A theme = `pack/theme`; UiPrefs.portraitPacks = the enabled ones (empty = 不用, today's look; all =
// every installed theme). New agents and agents without an avatar of their own wear a picture of the enabled themes
// for their model family (lib/portraitPacks poolFor / pickPortrait; no repeats in a project at creation).
//
//   const { themes, enabled } = usePortraitThemes();       // every installed theme, with names and sample faces
//   setPortraitThemeEnabled("overnight-test-v1/lolita", true);
//   enableAllPortraitThemes() / disableAllPortraitThemes() / setEnabledPortraitThemes([...])
//   <img src={useSampleUrl(theme.cover, 56)} />             // the theme's one face (the owner's packs load on demand)
import { useMemo } from "react";
import { useI18n } from "../i18n";
import { getUiPrefs, setUiPref, useUiPrefs } from "./prefs";
import { packName, usePortraitImage, usePortraitPacks, type PortraitPack, type PortraitPicture, type PortraitTheme } from "./portraitPacks";
import type { PortraitName } from "../../../shared/portraitPacks";
import { PORTRAIT_FAMILIES } from "../../../shared/portraitPacks";
import { isPortraitThemeKey, migratePortraitThemes } from "../../../shared/portraitDefaults";

export interface PortraitThemeInfo {
  /** `pack/theme`: what UiPrefs.portraitPacks holds. */
  key: string;
  pack: string;
  packName: string;
  /** The pack ships with the app (else: the owner's folder). */
  bundled: boolean;
  theme: string;
  /** The theme's name in this locale (the manifest's `themes` names, else its entries' themeName, e.g. 洛丽塔). */
  name: string;
  /** Its English subtitle, when the manifest has one. */
  subtitle: string | null;
  /** The one face that stands for it (theme cards, onboarding): themeCover. */
  cover: PortraitPicture;
  /** Pictures in the theme. */
  count: number;
  /** Pictures per model family. */
  families: Partial<Record<PortraitPicture["family"], number>>;
}

/** A per-locale name: zh locales take zh-CN, others en; either falls back to the other. */
function localName(n: PortraitName | undefined, locale: string): string | null {
  if (!n) return null;
  if (typeof n === "string") return n;
  return (locale.startsWith("zh") ? (n["zh-CN"] ?? n.en) : (n.en ?? n["zh-CN"])) ?? null;
}

/**
 * A theme's representative face (owner 2026-10-29: one portrait per card, not one per family): the manifest's
 * `cover` (the shipped kit names gpt/01 in every theme, so cards compare the same character), else the first picture
 * of the first family in PORTRAIT_FAMILIES order (claude, openai, …), else its first picture.
 */
export function themeCover(theme: PortraitTheme): PortraitPicture {
  return theme.pictures.find((p) => p.stem === theme.cover)
    ?? PORTRAIT_FAMILIES.map((f) => theme.pictures.find((p) => p.family === f)).find((p) => !!p)
    ?? theme.pictures[0]!;
}

/** Every installed theme, packs in order (shipped first), themes in manifest order. */
export function portraitThemesOf(packs: readonly PortraitPack[], locale: string): PortraitThemeInfo[] {
  return packs.flatMap((pack) =>
    pack.themes.map((th) => {
      const families: PortraitThemeInfo["families"] = {};
      for (const p of th.pictures) families[p.family] = (families[p.family] ?? 0) + 1;
      return {
        key: `${pack.id}/${th.id}`,
        pack: pack.id,
        packName: packName(pack, locale),
        bundled: pack.source === "bundled",
        theme: th.id,
        name: localName(th.names, locale) ?? th.name,
        subtitle: localName(th.subtitle, "en"),
        cover: themeCover(th),
        count: th.pictures.length,
        families,
      };
    }),
  );
}

/** The installed themes and the enabled keys (an enabled theme that is not installed here is left out of `enabled`). */
export function usePortraitThemes(): { themes: PortraitThemeInfo[]; enabled: string[] } {
  const { locale } = useI18n();
  const { packs } = usePortraitPacks();
  const { portraitPacks } = useUiPrefs();
  const themes = useMemo(() => portraitThemesOf(packs, locale), [packs, locale]);
  const enabled = useMemo(() => portraitPacks.filter((k) => themes.some((t) => t.key === k)), [portraitPacks, themes]);
  return { themes, enabled };
}

export const getEnabledPortraitThemes = (): string[] => getUiPrefs().portraitPacks;

/** Replaces the enabled set (unknown-looking keys dropped; order kept, duplicates removed). */
export function setEnabledPortraitThemes(keys: readonly string[]): void {
  setUiPref("portraitPacks", migratePortraitThemes(keys.filter(isPortraitThemeKey)));
}

export function setPortraitThemeEnabled(key: string, on: boolean): void {
  const now = getEnabledPortraitThemes();
  setEnabledPortraitThemes(on ? [...now, key] : now.filter((k) => k !== key));
}

/** 全选 (`keys`: e.g. one pack's themes; default every installed theme the caller lists). */
export function enableAllPortraitThemes(keys: readonly string[]): void {
  setEnabledPortraitThemes([...getEnabledPortraitThemes(), ...keys]);
}

/** 全不选 (`keys`: only those; omitted = all, i.e. 不用). */
export function disableAllPortraitThemes(keys?: readonly string[]): void {
  setEnabledPortraitThemes(keys ? getEnabledPortraitThemes().filter((k) => !keys.includes(k)) : []);
}

/** A sample face's URL at `size` px (shipped: at once; the owner's packs: once main sent it). */
export const useSampleUrl = (picture: PortraitPicture | null | undefined, size: number): string | null => usePortraitImage(picture, size);
