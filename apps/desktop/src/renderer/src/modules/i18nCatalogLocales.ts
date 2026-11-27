// The modules’ Traditional Chinese dictionaries (other overrides load with their own app locale).
import type { ModuleZhHantMessages } from "./i18nCatalog";

const found = import.meta.glob<{ locales?: Record<string, Record<string, string>> }>(["./*/i18n.locales.ts", "!./desk-pet/**"], { eager: true });
const dictionaries = Object.values(found);

export const modulesZhHant = Object.assign({}, ...dictionaries.map((d) => d.locales?.["zh-Hant-CN"] ?? {})) as ModuleZhHantMessages;
