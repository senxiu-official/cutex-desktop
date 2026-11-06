// Tiny i18n layer (same shape as ZCode's IntlProvider: flat namespaced keys + {var} substitution).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applyTerms, getTermOverrides, resolveTerms, useTermOverrides, type TermSet } from "../lib/terms";
import { isAppLocale, localeFallbacks, matchAppLocale, type AppLocale } from "../../../shared/locales";
import { rememberTraditionalLocale } from "../lib/languages";
import { zhCN } from "./zh-CN";
import { setUiLocale } from "../lib/uiLocale";

export type Locale = AppLocale;
export type MessageKey = keyof typeof zhCN;

type Catalog = Partial<Record<MessageKey, string>>;

// zh-CN and en are the maintained sources. Regional Traditional catalogs inherit MO → HK → TW;
// other partial catalogs fall back to en per key (owner 2026-10-13: missing translations never block development).
// Only zh-CN (the owner's language and the MessageKey source, complete) is bundled eagerly. en and the
// other catalogs are split into their own chunks and loaded on demand (en since the 0.2.0 beta
// perf audit, 2026-10-24: ~0.5 MB of the entry chunk with the modules' en and other-locale tables):
// at start for a saved / detected language — with en too for the partial ones, their per-key
// fallback — before the first render (the provider renders nothing until it arrives, so no flash of
// zh-CN, of keys or of en), on a language switch before the switch (the previous language stays until
// then). The zh UI's English search aliases (settings search, slash commands) load en when a search
// opens (useEnglishCatalog). Tests import the catalog files directly.
const catalogs: Partial<Record<Locale, Catalog>> = { "zh-CN": zhCN };
const ownCatalogs: Partial<Record<Locale, Catalog>> = { "zh-CN": zhCN };
const inherited = new Set<Locale>();
type LazyLocale = Exclude<Locale, "zh-CN">;
/** Complete catalogs (every key): they need no en fallback. */
const COMPLETE: ReadonlySet<Locale> = new Set<Locale>(["zh-CN", "zh-Hant-CN", "zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO", "en"]);
const loaders: Record<LazyLocale, () => Promise<Catalog>> = {
  en: () => import("./en").then((m) => m.en),
  "zh-Hant-CN": () => import("./zh-Hant-CN").then((m) => m.zhHantCN),
  "zh-Hant-TW": () => import("./zh-Hant-TW").then((m) => m.zhHantTW),
  "zh-Hant-HK": () => import("./zh-Hant-HK").then((m) => m.zhHantHK),
  "zh-Hant-MO": () => import("./zh-Hant-MO").then((m) => m.zhHantMO),
  "en-AU": () => import("./en-AU").then((m) => m.enAU),
  "ru-RU": () => import("./ru-RU").then((m) => m.ruRU),
  "fr-FR": () => import("./fr-FR").then((m) => m.frFR),
  "es-ES": () => import("./es-ES").then((m) => m.esES),
  "pt-BR": () => import("./pt-BR").then((m) => m.ptBR),
  "it-IT": () => import("./it-IT").then((m) => m.itIT),
  "de-DE": () => import("./de-DE").then((m) => m.deDE),
  "ja-JP": () => import("./ja-JP").then((m) => m.jaJP),
  "ko-KR": () => import("./ko-KR").then((m) => m.koKR),
};
const loading = new Map<Locale, Promise<void>>();

/** The catalog of a locale once loaded (zh-CN always is), else undefined. */
export function loadedCatalog(locale: Locale): Catalog | undefined {
  return isLoaded(locale) ? catalogs[locale] : undefined;
}

/** Loads a locale's catalog (no-op when already loaded) and, for a partial one, en; a failed load can be retried. */
export function loadLocale(locale: Locale): Promise<void> {
  const parent = localeFallbacks(locale)[1];
  if (parent) return Promise.all([loadLocale(parent), loadOne(locale)]).then(() => {
    if (!inherited.has(locale)) {
      catalogs[locale] = { ...catalogs[parent], ...ownCatalogs[locale] };
      inherited.add(locale);
    }
  });
  if (!COMPLETE.has(locale)) return Promise.all([loadOne("en"), loadOne(locale)]).then(() => undefined);
  return loadOne(locale);
}

/** The locale and, for a partial one, its en fallback are loaded. */
function isLoaded(locale: Locale): boolean {
  if (localeFallbacks(locale).length > 1) return !!catalogs[locale] && inherited.has(locale);
  return !!catalogs[locale] && (COMPLETE.has(locale) || !!catalogs.en);
}

function loadOne(locale: Locale): Promise<void> {
  if (catalogs[locale]) return Promise.resolve();
  let pending = loading.get(locale);
  if (!pending) {
    pending = loaders[locale as LazyLocale]().then(
      (catalog) => {
        catalogs[locale] = catalog;
        ownCatalogs[locale] = catalog;
        loading.delete(locale);
      },
      (error: unknown) => {
        loading.delete(locale);
        throw error;
      },
    );
    loading.set(locale, pending);
  }
  return pending;
}

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem("cutex-desktop.locale");
    if (isAppLocale(saved)) return saved;
  } catch {
    // storage unavailable
  }
  for (const tag of [...(navigator.languages ?? []), navigator.language]) {
    const matched = tag ? matchAppLocale(tag) : null;
    if (matched) return matched;
  }
  return "en";
}

interface I18n {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}

const I18nContext = createContext<I18n | null>(null);

/**
 * Counted messages: with `{n}` = 1, `<key>.one` ("1 device") replaces `<key>` ("{n} devices") when it
 * exists — in the locale's catalog, or in en when the locale falls back to en for `<key>` anyway (a
 * catalog that translated only the plural keeps its own text). zh ships `.one` equal to the plural.
 */
export function countKey(key: string, vars: Record<string, string | number> | undefined, catalog: Readonly<Record<string, string | undefined>> | undefined, fallback: Readonly<Record<string, string | undefined>>): string {
  if (vars?.n !== 1) return key;
  const one = `${key}.one`;
  if (catalog?.[one] !== undefined) return one;
  return catalog?.[key] === undefined && fallback[one] !== undefined ? one : key;
}

// Messages of loaded signed module packs (docs/desktop-modules.md §23.6), per module id. A pack's text
// wins over the bundled catalog for its own keys: pack (locale) → app catalog (locale) → pack (en) → app en.
const packMessages = new Map<string, Partial<Record<Locale, Readonly<Record<string, string>>>>>();
let packOverlay: Partial<Record<Locale, Record<string, string>>> = {};

function rebuildPackOverlay(): void {
  const next: Partial<Record<Locale, Record<string, string>>> = {};
  for (const byLocale of packMessages.values()) {
    for (const [locale, entries] of Object.entries(byLocale) as [Locale, Record<string, string>][]) Object.assign((next[locale] ??= {}), entries);
  }
  packOverlay = next;
}

/**
 * Registers a loaded pack's messages (replacing earlier ones of that module). Only keys of the module's
 * own prefix (`<moduleId>.`) and known locales are taken; anything else is refused with an error.
 */
export function registerModuleMessages(moduleId: string, messages: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined): void {
  const byLocale: Partial<Record<Locale, Record<string, string>>> = {};
  for (const [locale, entries] of Object.entries(messages ?? {})) {
    if (!isAppLocale(locale)) throw new Error(`pack ${moduleId}: unknown locale ${locale}`);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error(`pack ${moduleId}: bad messages for ${locale}`);
    const out: Record<string, string> = {};
    for (const [key, text] of Object.entries(entries)) {
      if (!key.startsWith(`${moduleId}.`) || typeof text !== "string") throw new Error(`pack ${moduleId}: message ${key} is not its own`);
      out[key] = text;
    }
    byLocale[locale] = out;
  }
  packMessages.set(moduleId, byLocale);
  rebuildPackOverlay();
}

export function unregisterModuleMessages(moduleId: string): void {
  if (packMessages.delete(moduleId)) rebuildPackOverlay();
}

/** One message: catalog lookup (en fallback), display terms (lib/terms `{{agent}}` …), then `{var}`s. */
function format(locale: Locale, terms: TermSet, key: MessageKey, vars?: Record<string, string | number>): string {
  // (Counted `.one` variants are looked up in the app catalogs only.)
  const en = catalogs.en;
  key = countKey(key, vars, catalogs[locale], en ?? {}) as MessageKey;
  let text: string | undefined;
  for (const language of localeFallbacks(locale)) {
    text = packOverlay[language]?.[key] ?? ownCatalogs[language]?.[key];
    if (text !== undefined) break;
  }
  const template = applyTerms(text ?? packOverlay.en?.[key] ?? en?.[key] ?? zhCN[key] ?? key, terms, locale);
  return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : template;
}

const initialLocale = detectLocale();
// Start fetching a lazy start-up locale right away (in parallel with the rest of the boot). main.tsx waits
// for it before the first render (and before the modules start), so nothing is drawn or noted in zh-CN first.
/** The start-up language is loaded (or failed: zh-CN then, as the provider falls back). Never rejects. */
export const startLocaleReady: Promise<void> = loadLocale(initialLocale).catch(() => {});

// Current locale for code outside React (store normalizers); kept in sync by the provider. Always a
// loaded locale (zh-CN until a lazy start-up locale has arrived).
let activeLocale: Locale = isLoaded(initialLocale) ? initialLocale : "zh-CN";
setUiLocale(activeLocale);
void startLocaleReady.then(() => {
  if (isLoaded(initialLocale) && activeLocale === "zh-CN") setUiLocale((activeLocale = initialLocale));
});
/** The UI locale for code outside React (e.g. picking a registry text). */
export function currentLocale(): Locale {
  return activeLocale;
}

export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  return format(activeLocale, resolveTerms(getTermOverrides(), activeLocale), key, vars);
}

function persistLocale(locale: Locale): void {
  rememberTraditionalLocale(locale);
  try {
    localStorage.setItem("cutex-desktop.locale", locale);
  } catch {
    // ignore
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [startLocale] = useState(detectLocale);
  // null = the start-up locale's catalog is still loading (render nothing meanwhile).
  const [loadedLocale, setLocaleState] = useState<Locale | null>(() => (isLoaded(startLocale) ? startLocale : null));
  const locale = loadedLocale ?? "zh-CN";
  useEffect(() => { if (loadedLocale) rememberTraditionalLocale(loadedLocale); }, [loadedLocale]);
  if (loadedLocale) setUiLocale((activeLocale = loadedLocale));
  // The latest requested locale: a slower earlier switch must not win over a later one.
  const requested = useRef<Locale | null>(null);
  useEffect(() => {
    if (loadedLocale) return;
    let live = true;
    loadLocale(startLocale).then(
      () => live && setLocaleState((current) => current ?? startLocale),
      (error: unknown) => {
        const fallback: Locale = catalogs.en ? "en" : "zh-CN";
        console.warn(`i18n: could not load ${startLocale}, using ${fallback}`, error);
        if (live) setLocaleState((current) => current ?? fallback);
      },
    );
    return () => {
      live = false;
    };
  }, [loadedLocale, startLocale]);
  const setLocale = useCallback((next: Locale) => {
    requested.current = next;
    const apply = () => {
      if (requested.current !== next) return;
      setLocaleState(next);
      persistLocale(next);
    };
    if (isLoaded(next)) {
      apply();
      return;
    }
    loadLocale(next).then(apply, (error: unknown) => console.warn(`i18n: could not load ${next}`, error));
  }, []);
  const overrides = useTermOverrides();
  const terms = useMemo(() => resolveTerms(overrides, locale), [overrides, locale]);
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => format(locale, terms, key, vars), [locale, terms]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  if (!loadedLocale) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The en catalog when loaded (the zh UI's English search aliases), else undefined. */
export function englishCatalog(): Readonly<Record<MessageKey, string>> | undefined {
  return catalogs.en as Record<MessageKey, string> | undefined;
}

/** Loads the en catalog (no-op when loaded); never rejects (aliases are then just missing). */
export function loadEnglish(): Promise<void> {
  return loadOne("en").catch((error: unknown) => console.warn("i18n: could not load en", error));
}

const englishListeners = new Set<() => void>();
let englishAsked = false;
/**
 * The en catalog for search aliases (settings search, slash commands): undefined until loaded. While `active`
 * (a search open) it starts the load once; the component renders again when it arrives, so a search typed
 * before then also finds the English names.
 */
export function useEnglishCatalog(active = true): Readonly<Record<MessageKey, string>> | undefined {
  const [catalog, setCatalog] = useState(englishCatalog);
  useEffect(() => {
    if (catalog) return;
    const update = () => setCatalog(englishCatalog);
    englishListeners.add(update);
    update();
    if (active && !englishAsked) {
      englishAsked = true;
      void loadEnglish().then(() => {
        englishAsked = !!catalogs.en;
        for (const l of [...englishListeners]) l();
      });
    }
    return () => void englishListeners.delete(update);
  }, [active, catalog]);
  return catalog;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}
