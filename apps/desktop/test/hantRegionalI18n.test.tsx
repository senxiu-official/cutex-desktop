// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, loadLocale, loadedCatalog, registerModuleMessages, unregisterModuleMessages, useI18n, type Locale, type MessageKey } from "../src/renderer/src/i18n";
import { matchAppLocale } from "../src/shared/locales";
import { traditionalLanguageLocale } from "../src/renderer/src/lib/languages";
import { DEFAULT_TERMS, resolveTerms } from "../src/renderer/src/lib/terms";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, current: ReturnType<typeof useI18n> | null;
function Probe() { current = useI18n(); return null; }
beforeEach(() => { localStorage.clear(); current=null; host=document.createElement("div"); document.body.append(host); root=createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount()); host.remove(); unregisterModuleMessages("regional-test"); vi.restoreAllMocks(); });
async function mount(tag: string, saved?: Locale) {
  vi.spyOn(navigator,"language","get").mockReturnValue(tag);
  vi.spyOn(navigator,"languages","get").mockReturnValue([tag]);
  if(saved) localStorage.setItem("cutex-desktop.locale",saved);
  await act(async()=>{ root.render(h(I18nProvider,{children:h(Probe)})); await loadLocale(saved??matchAppLocale(tag)??"en"); });
}
async function choose(locale: Locale) { await act(async()=>{ current!.setLocale(locale); await loadLocale(locale); }); }

it.each([["zh-TW","zh-Hant-TW"],["zh-HK","zh-Hant-HK"],["zh-MO","zh-Hant-MO"]] as const)("preselects the actual OS Traditional region %s", async(tag,locale)=>{
  await mount(tag);
  expect(current!.locale).toBe(locale);
  expect(traditionalLanguageLocale()).toBe(locale);
});

it("respects a saved mainland setting over a different OS region",async()=>{
  await mount("zh-TW","zh-Hant-CN");
  expect(current!.locale).toBe("zh-Hant-CN");
  expect(traditionalLanguageLocale()).toBe("zh-Hant-CN");
});

it("persists the selected region through another language and provider restart",async()=>{
  await mount("zh-CN","zh-Hant-CN"); await choose("zh-Hant-MO");
  expect(localStorage.getItem("cutex-desktop.locale")).toBe("zh-Hant-MO");
  await choose("en"); expect(traditionalLanguageLocale()).toBe("zh-Hant-MO");
  await choose(traditionalLanguageLocale());
  await act(async()=>root.unmount()); root=createRoot(host);
  await act(async()=>root.render(h(I18nProvider,{children:h(Probe)})));
  expect(current!.locale).toBe("zh-Hant-MO");
});

it("uses the region chain for runtime module messages as well as bundled catalogs",async()=>{
  await mount("zh-MO");
  registerModuleMessages("regional-test",{
    "zh-Hant-TW":{"regional-test.value":"臺灣內容"},
    "zh-Hant-HK":{"regional-test.value":"香港內容"},
  });
  expect(current!.t("regional-test.value" as MessageKey)).toBe("香港內容");
  registerModuleMessages("regional-test",{"zh-Hant-TW":{"regional-test.value":"臺灣內容"}});
  expect(current!.t("regional-test.value" as MessageKey)).toBe("臺灣內容");
  const catalog=loadedCatalog("zh-Hant-MO")!;
  expect(current!.t("shell.language.traditional.MO")).toBe(catalog["shell.language.traditional.MO"]);
});

it("inherits region term defaults while keeping mainland wording separate",()=>{
  expect(DEFAULT_TERMS["zh-Hant-TW"].agent.one).toBe("智慧體");
  expect(DEFAULT_TERMS["zh-Hant-HK"].agent.one).toBe("智能體");
  expect(DEFAULT_TERMS["zh-Hant-MO"]).toEqual(DEFAULT_TERMS["zh-Hant-HK"]);
  for(const locale of ["zh-Hant-TW","zh-Hant-HK","zh-Hant-MO"] as const) {
    expect(resolveTerms({},locale)).toEqual(DEFAULT_TERMS[locale]);
    expect(DEFAULT_TERMS[locale].operator.one).toBe("副主管");
  }
  expect(DEFAULT_TERMS["zh-Hant-CN"].agent.one).toBe("智能體");
});
