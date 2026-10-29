// Every UI locale the desktop ships. The id doubles as the BCP-47 tag used for localStorage,
// the shell IPC (ShellLocale), Intl arguments and navigator-language matching. The renderer
// catalogs live in renderer/src/i18n/<id>.ts; test/i18n-locales.test.ts keeps every catalog
// key- and placeholder-complete against zh-CN / en.
export const APP_LOCALES = ["zh-CN", "zh-Hant-CN", "zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO", "en", "en-AU", "ru-RU", "fr-FR", "es-ES", "pt-BR", "it-IT", "de-DE", "ja-JP", "ko-KR"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const TRADITIONAL_REGIONS = ["CN", "HK", "MO", "TW"] as const;
export type TraditionalRegion = (typeof TRADITIONAL_REGIONS)[number];
export type TraditionalLocale = `zh-Hant-${TraditionalRegion}`;
export function isTraditionalLocale(value: unknown): value is TraditionalLocale {
  return typeof value === "string" && /^zh-Hant-(?:CN|HK|MO|TW)$/.test(value);
}
export function traditionalRegionOf(locale: unknown): TraditionalRegion | null {
  return isTraditionalLocale(locale) ? locale.slice(8) as TraditionalRegion : null;
}
export const traditionalLocale = (region: TraditionalRegion): TraditionalLocale => `zh-Hant-${region}`;

/** Regional catalogs and term defaults share this chain; mainland wording stays separate. */
export function localeFallbacks(locale: AppLocale): readonly AppLocale[] {
  if (locale === "zh-Hant-MO") return ["zh-Hant-MO", "zh-Hant-HK", "zh-Hant-TW"];
  if (locale === "zh-Hant-HK") return ["zh-Hant-HK", "zh-Hant-TW"];
  return [locale];
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

/** BCP-47 tag → shipped locale; an explicit script wins over a Chinese region. */
export function matchAppLocale(tag: string): AppLocale | null {
  const t = tag.trim().replace(/_/g, "-").toLowerCase();
  if (t.startsWith("zh")) {
    if (/(?:^|-)hans(?:-|$)/.test(t)) return "zh-CN";
    for (const region of ["TW", "HK", "MO"] as const) if (new RegExp(`(?:^|-)${region}(?:-|$)`, "i").test(t)) return traditionalLocale(region);
    return /(?:^|-)hant(?:-|$)/.test(t) ? "zh-Hant-CN" : "zh-CN";
  }
  if (t.startsWith("en")) return /^(en-(au|nz))/.test(t) ? "en-AU" : "en";
  if (t.startsWith("ru")) return "ru-RU";
  if (t.startsWith("fr")) return "fr-FR";
  if (t.startsWith("es")) return "es-ES";
  if (t.startsWith("pt")) return "pt-BR";
  if (t.startsWith("it")) return "it-IT";
  if (t.startsWith("de")) return "de-DE";
  if (t.startsWith("ja")) return "ja-JP";
  if (t.startsWith("ko")) return "ko-KR";
  return null;
}
