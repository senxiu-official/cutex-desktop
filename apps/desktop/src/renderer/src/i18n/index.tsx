// Tiny i18n layer (same shape as ZCode's IntlProvider: flat namespaced keys + {var} substitution).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applyTerms, getTermOverrides, resolveTerms, useTermOverrides, type TermSet } from "../lib/terms";
import { isAppLocale, matchAppLocale, type AppLocale } from "../../../shared/locales";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = AppLocale;
export type MessageKey = keyof typeof zhCN;

type Catalog = Partial<Record<MessageKey, string>>;

// zh-CN and en are the maintained sources; every other catalog is partial and falls back to en
// per key (owner 2026-10-13: periodic translation, missing entries must never block development).
// en (the per-key fallback) and zh-CN (the owner's language and the MessageKey source; the slash-command
// / settings-search keywords import both anyway) are bundled eagerly. The other ten catalogs
// (~2.8 MB of source) are split into their own chunks and loaded on demand: at start for a saved /
// detected language (the provider renders nothing until it arrives, so no flash of keys or of en), on
// a language switch before the switch (the previous language stays until then). Tests import the
// catalog files directly.
const catalogs: Partial<Record<Locale, Catalog>> = { "zh-CN": zhCN, en };
type LazyLocale = Exclude<Locale, "zh-CN" | "en">;
const loaders: Record<LazyLocale, () => Promise<Catalog>> = {
  "zh-Hant-CN": () => import("./zh-Hant-CN").then((m) => m.zhHantCN),
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

/** The catalog of a locale once loaded (en and zh-CN always are), else undefined. */
export function loadedCatalog(locale: Locale): Catalog | undefined {
  return catalogs[locale];
}

/** Loads a locale's catalog (no-op when already loaded); a failed load can be retried. */
export function loadLocale(locale: Locale): Promise<void> {
  if (catalogs[locale]) return Promise.resolve();
  let pending = loading.get(locale);
  if (!pending) {
    pending = loaders[locale as LazyLocale]().then(
      (catalog) => {
        catalogs[locale] = catalog;
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

/** One message: catalog lookup (en fallback), display terms (lib/terms `{{agent}}` …), then `{var}`s. */
function format(locale: Locale, terms: TermSet, key: MessageKey, vars?: Record<string, string | number>): string {
  key = countKey(key, vars, catalogs[locale], en) as MessageKey;
  const template = applyTerms(catalogs[locale]?.[key] ?? en[key] ?? key, terms, locale);
  return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : template;
}

const initialLocale = detectLocale();
// Start fetching a lazy start-up locale right away (in parallel with the rest of the boot).
void loadLocale(initialLocale).catch(() => {});

// Current locale for code outside React (store normalizers); kept in sync by the provider. Always a
// loaded locale (en until a lazy start-up locale has arrived).
let activeLocale: Locale = catalogs[initialLocale] ? initialLocale : "en";
/** The UI locale for code outside React (e.g. picking a registry text). */
export function currentLocale(): Locale {
  return activeLocale;
}

export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  return format(activeLocale, resolveTerms(getTermOverrides(), activeLocale), key, vars);
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem("cutex-desktop.locale", locale);
  } catch {
    // ignore
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [startLocale] = useState(detectLocale);
  // null = the start-up locale's catalog is still loading (render nothing meanwhile).
  const [loadedLocale, setLocaleState] = useState<Locale | null>(() => (catalogs[startLocale] ? startLocale : null));
  const locale = loadedLocale ?? "en";
  activeLocale = locale;
  // The latest requested locale: a slower earlier switch must not win over a later one.
  const requested = useRef<Locale | null>(null);
  useEffect(() => {
    if (loadedLocale) return;
    let live = true;
    loadLocale(startLocale).then(
      () => live && setLocaleState((current) => current ?? startLocale),
      (error: unknown) => {
        console.warn(`i18n: could not load ${startLocale}, using en`, error);
        if (live) setLocaleState((current) => current ?? "en");
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
    if (catalogs[next]) {
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

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}
