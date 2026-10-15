// Locale catalog contract (owner 2026-10-13: i18n is periodic — normal development maintains only
// zh-CN + en, zh-Hant-CN is regenerated from zh-CN, every other catalog is partial with en fallback;
// a missing translation is never an error, a WRONG placeholder always is):
//   • zh-CN / en: complete (the two maintained sources);
//   • zh-Hant-CN: complete against zh-CN — the one-click conversion contract, regenerate when zh-CN grows;
//   • en-AU / ru / fr / es-ES / pt-BR / it / de / ja / ko-KR: keys must be a SUBSET of zh-CN (no typos),
//     ≥ 90 % coverage (a corruption guard, not a completeness demand), and every present key keeps
//     en's {var} / {{term}} placeholders;
//   • ko-KR values never contain Han / kana (machine-literal leftover guard);
//   • no unknown term placeholders anywhere; the derived sub-agent word is never hard-coded from
//     {{agent}} (lib/terms derives it: 子智能体 / sub-agent / sous-agent / サブエージェント / 하위 에이전트 …).
import { describe, expect, it } from "vitest";
import { APP_LOCALES, type AppLocale } from "../src/shared/locales";
import { unknownTermTokens } from "../src/renderer/src/lib/terms";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { enAU } from "../src/renderer/src/i18n/en-AU";
import { ruRU } from "../src/renderer/src/i18n/ru-RU";
import { frFR } from "../src/renderer/src/i18n/fr-FR";
import { esES } from "../src/renderer/src/i18n/es-ES";
import { ptBR } from "../src/renderer/src/i18n/pt-BR";
import { itIT } from "../src/renderer/src/i18n/it-IT";
import { deDE } from "../src/renderer/src/i18n/de-DE";
import { jaJP } from "../src/renderer/src/i18n/ja-JP";
import { koKR } from "../src/renderer/src/i18n/ko-KR";

const CATALOGS: Record<AppLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  "zh-Hant-CN": zhHantCN,
  en,
  "en-AU": enAU,
  "ru-RU": ruRU,
  "fr-FR": frFR,
  "es-ES": esES,
  "pt-BR": ptBR,
  "it-IT": itIT,
  "de-DE": deDE,
  "ja-JP": jaJP,
  "ko-KR": koKR,
};

const VAR = /\{(\w+)\}/g;
const TERM = /\{\{([^}]*)\}\}/g;
// Placeholders are compared by what they mean, not their spelling: en marks the plural ({{agents}})
// and the en article ({{an agent}}), zh / the other languages use the bare singular — same term.
const BASE: Record<string, string> = { agent: "agent", agents: "agent", subagent: "subagent", subagents: "subagent", parentagent: "parentagent", parentagents: "parentagent", director: "director", directors: "director", owner: "owner", owners: "owner" };
const termIds = (v: string) => [...v.matchAll(TERM)].map((m) => BASE[m[1]!.replace(/^(an? |An? )/, "").toLowerCase()] ?? m[1]!).sort();
const vars = (v: string) => [...v.replace(TERM, " ").matchAll(VAR)].map((m) => m[1]!).sort();
const HARDCODED_SUB = /(子|sub-|Sub-|sous-|sotto-|суб-|サブ)\{\{agents?\}\}/;

describe("i18n locale catalogs", () => {
  it("APP_LOCALES and the catalog table cover the same locales", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...APP_LOCALES].sort());
  });

  it("zh-CN and en ship the same key set", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it("zh-Hant-CN tracks zh-CN completely (regenerate it when zh-CN grows)", () => {
    expect(Object.keys(zhHantCN).sort()).toEqual(Object.keys(zhCN).sort());
    expect(zhHantCN["appearance.uiFont"]).toBe("界面 · 非 CJK 字體");
    expect(zhHantCN["appearance.monoFont"]).toBe("代碼字體");
  });

  describe("partial catalogs (en fallback)", () => {
    const partial: AppLocale[] = ["en-AU", "ru-RU", "fr-FR", "es-ES", "pt-BR", "it-IT", "de-DE", "ja-JP", "ko-KR"];
    for (const locale of partial) {
      const catalog = CATALOGS[locale]!;
      it(`${locale}: only valid zh-CN keys, ≥ 90 % coverage`, () => {
        const keys = Object.keys(catalog);
        const unknown = keys.filter((key) => !(key in zhCN));
        expect(unknown, "keys not in zh-CN (typos?)").toEqual([]);
        expect(keys.length / Object.keys(zhCN).length).toBeGreaterThanOrEqual(0.9);
      });
      it(`${locale}: present keys keep en's {var} / {{term}} placeholders`, () => {
        const bad: string[] = [];
        for (const [key, value] of Object.entries(catalog)) {
          const enValue = en[key as keyof typeof en];
          if (enValue === undefined) continue;
          if (JSON.stringify(vars(value)) !== JSON.stringify(vars(enValue))) bad.push(`${key} {var}: ${value}`);
          if (JSON.stringify(termIds(value)) !== JSON.stringify(termIds(enValue))) bad.push(`${key} {{term}}: ${value}`);
        }
        expect(bad).toEqual([]);
      });
    }
  });

  it("no unknown term placeholders, no hard-coded sub-agent, in any catalog", () => {
    const bad: string[] = [];
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        if (unknownTermTokens(value).length > 0 || HARDCODED_SUB.test(value)) bad.push(`${locale} ${key}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("ko-KR values contain no Han / kana (machine-literal leftover guard)", () => {
    const bad = Object.entries(koKR).filter(([, v]) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});
