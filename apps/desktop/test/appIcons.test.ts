// 外观 → 应用图标: the manifest (shared/appIcons.ts) and the built files under resources/ agree, and the build script
// uses the manifest's sizes and id rule.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ICON_BUILD_SIZES, APP_ICON_ICO_SIZES, APP_ICON_ID, APP_ICON_SIZES, APP_ICON_SMALL_MAX, APP_ICON_STYLES, DEFAULT_APP_ICON, LEGACY_APP_ICON, appIconDir, appIconLabel, appIconMaxSize, appIconSubLabel, isAppIconId, resolveAppIcon } from "../src/shared/appIcons";
import { parsePrefs } from "../src/shared/shell";

const resources = join(__dirname, "..", "resources");

describe("app icon manifest", () => {
  it("the owner's order: 螺钿 (the default) first, 「旧版墨龙」 last; unique, well-formed ids and both labels", () => {
    expect(APP_ICON_STYLES.map((s) => s.id)).toEqual(["luodian", "ink", "luodian-lacquer", "qinghua", "cloisonne", "suxiu", "woodcut-jade", "papercut-jade", "shadow", "titanium", "glass", "oil", "watercolor", "pencil", "cyanotype", "pixel", "ink-dragon"]);
    expect(APP_ICON_STYLES[0]!.id).toBe(DEFAULT_APP_ICON);
    expect(APP_ICON_STYLES.at(-1)!.id).toBe(LEGACY_APP_ICON);
    expect(APP_ICON_STYLES.at(-1)!.label).toEqual({ "zh-CN": "旧版墨龙", en: "Classic ink dragon" });
    const ids = APP_ICON_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of APP_ICON_STYLES) {
      expect(s.id).toMatch(APP_ICON_ID);
      expect(s.label["zh-CN"].trim()).not.toBe("");
      expect(s.label.en.trim()).not.toBe("");
    }
  });

  it("every style has every size and an .ico", () => {
    for (const s of APP_ICON_STYLES) {
      const dir = join(resources, appIconDir(s.id));
      for (const n of s.id === DEFAULT_APP_ICON ? APP_ICON_BUILD_SIZES : APP_ICON_SIZES) expect(existsSync(join(dir, `icon-${n}.png`)), `${s.id} icon-${n}.png`).toBe(true);
      // 512s only for the build icon (bundle size).
      if (s.id !== DEFAULT_APP_ICON) expect(existsSync(join(dir, "icon-512.png")), `${s.id} icon-512.png`).toBe(false);
      expect(appIconMaxSize(s.id)).toBe(s.id === DEFAULT_APP_ICON ? 512 : 256);
      expect(existsSync(join(dir, "icon.ico")), `${s.id} icon.ico`).toBe(true);
    }
  });

  it("every built style folder has a manifest entry", () => {
    const built = join(resources, "app-icons");
    const dirs = existsSync(built) ? readdirSync(built, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "src").map((d) => d.name) : [];
    for (const d of dirs) expect(isAppIconId(d), `resources/app-icons/${d} has no entry in APP_ICON_STYLES`).toBe(true);
  });

  it("the build script uses the manifest's sizes and id rule", () => {
    const script = readFileSync(join(__dirname, "..", "..", "..", "scripts", "make-app-icons.mjs"), "utf8");
    expect(script).toContain(`const SIZES = [${APP_ICON_SIZES.join(", ")}];`);
    expect(script).toContain(`const ICO_SIZES = [${APP_ICON_ICO_SIZES.join(", ")}];`);
    expect(script).toContain(`const SMALL_MAX = ${APP_ICON_SMALL_MAX};`);
    expect(script).toContain(`const ID = ${APP_ICON_ID.toString()};`);
    expect(script).toContain(`const DEFAULT = "${DEFAULT_APP_ICON}";`);
    expect(script).toContain(`const LEGACY = "${LEGACY_APP_ICON}";`);
    expect(script).toContain("const BUILD_SIZES = [...SIZES, 512];");
  });

  it("resolves unknown (synced from a newer build) styles to the default and labels by locale", () => {
    expect(resolveAppIcon("not-in-this-build")).toBe(DEFAULT_APP_ICON);
    expect(resolveAppIcon(42)).toBe(DEFAULT_APP_ICON);
    expect(appIconDir(DEFAULT_APP_ICON)).toBe("icons");
    expect(appIconDir("butterflies-03")).toBe("app-icons/butterflies-03");
    const extra = [...APP_ICON_STYLES, { id: "butterflies-03", label: { "zh-CN": "蝶三", en: "Three" } }];
    expect(resolveAppIcon("butterflies-03", extra)).toBe("butterflies-03");
    expect(appIconLabel(extra.at(-1)!, "zh-Hant-TW")).toBe("蝶三");
    expect(appIconSubLabel(APP_ICON_STYLES[0]!, "zh-CN")).toBe("Luodian");
    expect(appIconSubLabel(APP_ICON_STYLES[0]!, "en")).toBe("螺钿");
    expect(appIconLabel(extra.at(-1)!, "en-AU")).toBe("Three");
  });

  it("prefs keep a known non-default style only", () => {
    expect(parsePrefs({ appIcon: DEFAULT_APP_ICON }).appIcon).toBeUndefined();
    expect(parsePrefs({ appIcon: "../../evil" }).appIcon).toBeUndefined();
    expect(parsePrefs({ appIcon: 3 }).appIcon).toBeUndefined();
  });
});

describe("the build icon", () => {
  it("cutex.exe / the .app / the tray default are the default style (resources/icons), the old logo is 「旧版墨龙」", () => {
    const portable = readFileSync(join(__dirname, "..", "..", "..", "scripts", "package-portable.mjs"), "utf8");
    expect(portable).toContain('join(app, "resources/icons/icon.ico")');
    expect(appIconDir(DEFAULT_APP_ICON)).toBe("icons");
    expect(appIconDir(LEGACY_APP_ICON)).toBe("app-icons/ink-dragon");
    // Hand-made pixel-art sizes are used as they are.
    expect(readFileSync(join(resources, "app-icons", "pixel", "icon-32.png")).length).toBeGreaterThan(0);
  });
});
