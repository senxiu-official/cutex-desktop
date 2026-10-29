// The UI languages offered (Settings → 通用 → 界面语言 and the identity menu's 语言 ▸), each named in itself.
import type { Locale } from "../i18n";
import { isTraditionalLocale, matchAppLocale, traditionalLocale, traditionalRegionOf, type TraditionalLocale, type TraditionalRegion } from "../../../shared/locales";
export { isTraditionalLocale, traditionalLocale, traditionalRegionOf, TRADITIONAL_REGIONS } from "../../../shared/locales";
export type { TraditionalRegion, TraditionalLocale } from "../../../shared/locales";

const REGION_KEY = "cutex-desktop.traditional-region";
/** The regional choice survives switching through another language; existing installs default to CN. */
export function traditionalLanguageLocale(): TraditionalLocale {
  try {
    const region = localStorage.getItem(REGION_KEY);
    if (["CN", "HK", "MO", "TW"].includes(region ?? "")) return traditionalLocale(region as TraditionalRegion);
  } catch { /* Storage can be unavailable in a sandbox. */ }
  return "zh-Hant-CN";
}
export function rememberTraditionalLocale(locale: Locale): void {
  const region = traditionalRegionOf(locale);
  if (region) try { localStorage.setItem(REGION_KEY, region); } catch { /* Keep the in-memory choice. */ }
}
export function preferredTraditionalRegion(tags?: readonly string[]): Exclude<TraditionalRegion, "CN"> {
  const languages = tags ?? (typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language]);
  for (const tag of languages) {
    const locale = matchAppLocale(tag);
    const region = isTraditionalLocale(locale) ? traditionalRegionOf(locale) : null;
    if (region && region !== "CN") return region;
  }
  return "TW";
}

export const LANGUAGES: readonly { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-Hant-CN", label: "繁體中文" },
  { value: "en", label: "English (US)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "ru-RU", label: "Русский" },
  { value: "fr-FR", label: "Français" },
  { value: "es-ES", label: "Español (España)" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "it-IT", label: "Italiano" },
  { value: "de-DE", label: "Deutsch" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
];
