// Lazy locale catalogs (i18n/index.tsx): en + zh-CN are bundled eagerly, the other ten load on demand.
// Guards: nothing in the renderer imports a lazy catalog statically (that would pull it back into the
// main chunk), every app locale has a loader, and a loaded catalog is the file's table.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "../src/shared/locales";
import { loadedCatalog, loadLocale } from "../src/renderer/src/i18n";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { jaJP } from "../src/renderer/src/i18n/ja-JP";
import { koKR } from "../src/renderer/src/i18n/ko-KR";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

const EAGER = new Set(["en", "zh-CN"]);
const LAZY = APP_LOCALES.filter((l) => !EAGER.has(l));
const RENDERER = join(__dirname, "../src/renderer/src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("lazy locale catalogs", () => {
  it("en and zh-CN are always loaded", () => {
    expect(loadedCatalog("en")).toBe(en);
    expect(loadedCatalog("zh-CN")).toBe(zhCN);
  });

  it("loads every other app locale on demand", async () => {
    for (const locale of LAZY) {
      await loadLocale(locale);
      expect(Object.keys(loadedCatalog(locale) ?? {}).length, locale).toBeGreaterThan(0);
    }
    expect(loadedCatalog("ja-JP")).toBe(jaJP);
    expect(loadedCatalog("zh-Hant-CN")).toBe(zhHantCN);
    expect(loadedCatalog("ko-KR")).toBe(koKR);
    // A second load is a no-op on the same table.
    await loadLocale("ja-JP");
    expect(loadedCatalog("ja-JP")).toBe(jaJP);
    await loadLocale("ko-KR");
    expect(loadedCatalog("ko-KR")).toBe(koKR);
  });

  it("no renderer source imports a lazy catalog statically", () => {
    const names = LAZY.map((l) => l.replace(/-/g, "\\-")).join("|");
    const staticImport = new RegExp(`^\\s*(import|export)\\b[^;]*?from\\s+["'][^"']*/i18n/(${names})["']`, "m");
    const offenders = sources(RENDERER).filter((file) => staticImport.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
