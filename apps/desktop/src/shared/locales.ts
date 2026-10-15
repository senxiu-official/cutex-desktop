// Every UI locale the desktop ships. The id doubles as the BCP-47 tag used for localStorage,
// the shell IPC (ShellLocale), Intl arguments and navigator-language matching. The renderer
// catalogs live in renderer/src/i18n/<id>.ts; test/i18n-locales.test.ts keeps every catalog
// key- and placeholder-complete against zh-CN / en.
export const APP_LOCALES = ["zh-CN", "zh-Hant-CN", "en", "en-AU", "ru-RU", "fr-FR", "es-ES", "pt-BR", "it-IT", "de-DE", "ja-JP", "ko-KR"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

/** BCP-47 tag → shipped locale (zh-TW/HK/MO/Hant → zh-Hant-CN; pt → pt-BR; en-NZ → en-AU; …). */
export function matchAppLocale(tag: string): AppLocale | null {
  const t = tag.toLowerCase();
  if (t.startsWith("zh")) return /hant|tw|hk|mo/.test(t) ? "zh-Hant-CN" : "zh-CN";
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
