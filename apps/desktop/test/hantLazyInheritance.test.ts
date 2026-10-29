import { expect, it, vi } from "vitest";
vi.hoisted(()=>{ Object.defineProperty(globalThis,"navigator",{configurable:true,value:{language:"zh-CN",languages:["zh-CN"]}}); });
import { loadLocale, loadedCatalog } from "../src/renderer/src/i18n";

it("loads only the chosen regional branch and its required ancestors",async()=>{
  expect(loadedCatalog("en")).toBeUndefined();
  expect(loadedCatalog("zh-Hant-TW")).toBeUndefined();
  await loadLocale("zh-Hant-HK");
  expect(loadedCatalog("zh-Hant-TW")).toBeDefined();
  expect(loadedCatalog("zh-Hant-HK")).toBeDefined();
  expect(loadedCatalog("zh-Hant-MO")).toBeUndefined();
  expect(loadedCatalog("zh-Hant-CN")).toBeUndefined();
  expect(loadedCatalog("en")).toBeUndefined();
  const hk=loadedCatalog("zh-Hant-HK");
  await loadLocale("zh-Hant-MO");
  expect(loadedCatalog("zh-Hant-MO")).toEqual(hk);
  expect(loadedCatalog("en")).toBeUndefined();
});
