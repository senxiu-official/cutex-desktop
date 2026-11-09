// Regional dictionaries are generated during development; the renderer imports only data.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import OpenCC from "opencc-js";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { zhHantTW } from "../src/renderer/src/i18n/zh-Hant-TW";
import { zhHantHK } from "../src/renderer/src/i18n/zh-Hant-HK";
import { zhHantMO } from "../src/renderer/src/i18n/zh-Hant-MO";

// A pack-only module's strings are not in the app's zh-CN, but the regional catalogs keep them: its pack takes them from there.
const packOnlyFiles = import.meta.glob<{ packOnly?: boolean }>("../src/renderer/src/modules/*/pack.json", { eager: true, import: "default" });
const packOnlyDictionaries = import.meta.glob<{ zhCN: Record<string, string> }>("../src/renderer/src/modules/*/i18n.ts", { eager: true });
const source: Record<string, string> = { ...zhCN };
for (const [path, json] of Object.entries(packOnlyFiles)) if (json.packOnly) Object.assign(source, packOnlyDictionaries[path.replace("pack.json", "i18n.ts")]!.zhCN);

const generatorPath = resolve("../../scripts/generate-hant-regions.mjs");
const generator = await import(/* @vite-ignore */ pathToFileURL(generatorPath).href);
const { reviewed } = await import(/* @vite-ignore */ pathToFileURL(resolve("../../scripts/hant-region-review.mjs")).href);
const twConvert = OpenCC.Converter({ from: "cn", to: "twp" });
const hkConvert = OpenCC.Converter({ from: "cn", to: "hk" });
const tw = (value: string) => generator.regionalValue("fixture", value, twConvert, reviewed.TW) as string;
const hk = (value: string) => generator.regionalValue("fixture", value, hkConvert, reviewed.HK) as string;

describe("Traditional Chinese regional catalogs", () => {
  it("TW contains the complete merged source; HK and MO contain differences only", () => {
    expect(Object.keys(zhHantTW).sort()).toEqual(Object.keys(source).sort());
    expect(Object.keys(zhHantHK).length).toBeGreaterThan(0);
    expect(Object.keys(zhHantHK).length).toBeLessThan(Object.keys(zhHantTW).length);
    for (const [key, value] of Object.entries(zhHantHK)) {
      expect(key in source).toBe(true);
      expect(value, key).not.toBe(zhHantTW[key as keyof typeof zhCN]);
    }
    for (const [key, value] of Object.entries(zhHantMO)) {
      expect(key in source).toBe(true);
      expect(value, key).not.toBe(zhHantHK[key as keyof typeof zhCN] ?? zhHantTW[key as keyof typeof zhCN]);
    }
  });
  it("regenerates the same data from every module spread, with no stale reviewed keys", () => {
    const generated = generator.regionalCatalogs(source);
    expect(generated.TW).toEqual(zhHantTW);
    expect(generated.HK).toEqual(zhHantHK);
    expect(generated.MO).toEqual(zhHantMO);
  });
  it("preserves all source variables, term placeholders, URLs, paths and code", () => {
    const bad: string[] = [];
    for (const [key, source] of Object.entries(zhCN)) {
      for (const [region, catalog] of Object.entries({ TW: zhHantTW, HK: zhHantHK, MO: zhHantMO })) {
        const value = catalog[key as keyof typeof zhCN];
        if (value !== undefined && JSON.stringify(generator.protectedParts(source)) !== JSON.stringify(generator.protectedParts(value))) bad.push(`${region} ${key}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("uses Taiwan UI vocabulary and distinguishes files, documents and application verbs", () => {
    expect(tw("设置 默认 软件 程序 文件 文档 文件夹 登录 加载 保存 网络 内存 剪贴板 终端 链接 标签页"))
      .toBe("設定 預設 軟體 程式 檔案 文件 資料夾 登入 載入 儲存 網路 記憶體 剪貼簿 終端機 連結 分頁");
    expect(tw("应用设置 应用程序 桌面应用 配置文件 进程 重载 过载 只影响"))
      .toBe("套用設定 應用程式 桌面應用程式 設定檔 行程 重新載入 過載 只影響");
    expect(zhHantTW["projects.root.apply"]).toBe("套用");
    expect(zhHantTW["settings.group.app"]).toBe("應用程式");
  });
  it("uses Hong Kong software/program/file/default/network terminology", () => {
    expect(hk("软件 程序 文件 文档 默认 网络 文件夹 内存 加载 保存 用户"))
      .toBe("軟件 程序 文件 文檔 默認 網絡 文件夾 內存 加載 保存 用戶");
  });
  it("does not convert code, URLs, paths, product names or placeholder contents", () => {
    const value = "文件 Profile Shelf API key {{agent}} {{operator}} {中文变量} `默认文件` https://example.test/设置/文件 https://example.test/a?标签=值 C:\\文件\\默认.json /v2/文件 ~/文件/设置 ```json\n{\"文件\":\"默认\"}\n```";
    const result = tw(value);
    expect(result.startsWith("檔案 Profile Shelf API key")).toBe(true);
    expect(generator.protectedParts(result)).toEqual(generator.protectedParts(value));
    expect(result).toContain("`默认文件`");
    expect(tw("网页 /文件 /文档")).toBe("網頁 /檔案 /文件");
  });
  it("ships no converter code or child-to-parent runtime import", () => {
    for (const region of ["TW", "HK", "MO"]) {
      const source = readFileSync(resolve(`src/renderer/src/i18n/zh-Hant-${region}.ts`), "utf8");
      const imports = source.split("\n").filter(line => /^import /.test(line));
      expect(imports).toEqual(['import type { zhCN } from "./zh-CN";']);
      expect(source).not.toContain("opencc-js");
    }
  });
});
