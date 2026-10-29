import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOCALES } from "../src/shared/locales";
import { COMMANDS } from "../src/renderer/src/lib/keybindings";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const files = import.meta.glob<Record<string, Record<string, string>>>("../src/renderer/src/i18n/*.ts");
const keys = [...new Set([
  ...Object.keys(zhCN).filter(key => key.startsWith("shortcuts.") || key.startsWith("shell.shortcuts.")),
  ...COMMANDS.map(command => command.desc),
])].sort();
const variables = (text: string) => [...text.replace(/\{\{[^}]+\}\}/g, "").matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("keybinding translations", () => {
  for (const locale of APP_LOCALES) {
    it(`${locale} supplies keyboard-shortcut labels and explicit editor translations`, async () => {
      const load = files[`../src/renderer/src/i18n/${locale}.ts`];
      expect(load, locale).toBeDefined();
      const module = await load!();
      let catalog = Object.values(module).find(value => value && typeof value === "object" && "shortcuts.custom.title" in value)!;
      const chain = locale === "zh-Hant-MO" ? ["zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO"] : locale === "zh-Hant-HK" ? ["zh-Hant-TW", "zh-Hant-HK"] : [locale];
      if (chain.length > 1) {
        catalog = Object.assign({}, ...await Promise.all(chain.map(async tag => Object.values(await files[`../src/renderer/src/i18n/${tag}.ts`]!())[0])));
      }
      expect(catalog, locale).toBeDefined();
      const source = chain.map(tag => readFileSync(join(__dirname, `../src/renderer/src/i18n/${tag}.ts`), "utf8")).join("\n");
      for (const key of keys) {
        expect(Object.hasOwn(catalog, key), `${locale}: ${key}`).toBe(true);
        expect(catalog[key]?.trim(), `${locale}: ${key}`).toBeTruthy();
        expect(variables(catalog[key]!), `${locale}: ${key} placeholders`).toEqual(variables(en[key as keyof typeof en]));
        if (!["zh-CN", "zh-Hant-CN", "en", "en-AU"].includes(locale)
          && (key.startsWith("shortcuts.") || key === "shell.shortcuts.pageHint")) {
          expect(source.includes(`"${key}":`), `${locale}: ${key} must not fall back`).toBe(true);
        }
      }
    });
  }
});
