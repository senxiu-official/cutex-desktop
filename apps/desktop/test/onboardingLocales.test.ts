import { describe, expect, it } from "vitest";
import { zhCN } from "../src/renderer/src/modules/onboarding/i18n";
import { en } from "../src/renderer/src/modules/onboarding/i18n.en";
import { locales } from "../src/renderer/src/modules/onboarding/i18n.locales";
import { modulesLocale } from "../src/renderer/src/modules/i18nCatalogLocales";
import { APP_LOCALES } from "../src/shared/locales";
import { unknownTermTokens } from "../src/renderer/src/lib/terms";
import { loadLocale, loadedCatalog } from "../src/renderer/src/i18n";
import { locales as sharedLabels } from "../src/renderer/src/modules/shell/i18n.locales";

const catalogFiles = import.meta.glob<Record<string, Record<string, string>>>("../src/renderer/src/i18n/*.ts");
const keys = Object.keys(zhCN).sort();
const regional = ["zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO"] as const;
const direct = APP_LOCALES.filter(locale => !(regional as readonly string[]).includes(locale));
const vars = (text: string) => [...new Set([...text.replace(/\{\{[^}]+\}\}/g, "").matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();

describe("complete onboarding, guide, Help and what’s-new translations", () => {
  it("ships one explicit module catalog for every non-source locale", () => {
    expect(Object.keys(locales).sort()).toEqual(direct.filter(locale => locale !== "zh-CN" && locale !== "en").sort());
  });
  for (const locale of direct) {
    it(`${locale} supplies every key without falling back to English`, async () => {
      const own: Record<string, string> = locale === "zh-CN" ? zhCN : locale === "en" ? en : locales[locale as keyof typeof locales];
      expect(Object.keys(own).sort()).toEqual(keys);
      for (const key of keys) {
        expect(Object.hasOwn(own, key), `${locale}: ${key}`).toBe(true);
        expect(own[key]?.trim(), `${locale}: ${key}`).toBeTruthy();
        expect(vars(own[key]!), `${locale}: ${key} interpolation`).toEqual(vars(en[key as keyof typeof en]));
        expect(unknownTermTokens(own[key]!), `${locale}: ${key} term tokens`).toEqual([]);
      }
      if (locale === "zh-CN" || locale === "en") return;
      expect(Object.keys(modulesLocale(locale)).filter(key => key.startsWith("onboarding.")).sort()).toEqual(keys);
      const file = catalogFiles[`../src/renderer/src/i18n/${locale}.ts`];
      expect(file, locale).toBeDefined();
      const loaded = await file!();
      const merged = Object.values(loaded).find(value => value && typeof value === "object" && "onboarding.title" in value)!;
      expect(merged, `${locale} merged catalog`).toBeDefined();
      for (const key of keys) expect(merged[key], `${locale}: stale core override for ${key}`).toBe(own[key]);
      for (const [key, value] of Object.entries(sharedLabels[locale]!)) {
        expect(value.trim(), `${locale}: ${key}`).toBeTruthy();
        expect(merged[key], `${locale}: shared performance label ${key}`).toBe(value);
      }
    });
  }
  for (const locale of regional) it(`${locale} inherits a complete regional onboarding catalog`, async () => {
    await loadLocale(locale);
    const catalog = loadedCatalog(locale)!;
    for (const key of keys) {
      const text = catalog[key as keyof typeof catalog]!;
      expect(text.trim(), `${locale}: ${key}`).toBeTruthy();
      expect(vars(text), `${locale}: ${key}`).toEqual(vars(en[key as keyof typeof en]));
      expect(unknownTermTokens(text)).toEqual([]);
    }
  });
});
