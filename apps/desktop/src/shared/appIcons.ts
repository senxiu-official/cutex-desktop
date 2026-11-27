// 外观 → 应用图标 (owner 2026-11-28): the app icon styles, one manifest for main (tray, window, shortcuts), the
// renderer (in-app logos, system avatars, 关于, the picker) and scripts/make-app-icons.mjs (which renders each style's
// files).
//
// Adding a style (the drop-in point): put the owner's master in apps/desktop/resources/app-icons/src/<id>.png
// (optionally a hand-simplified <id>-small.png for 16 / 24 px, or hand-made <id>-<n>.png pictures used as is at n px),
// add one entry below, run `node scripts/make-app-icons.mjs <id>`. That writes resources/app-icons/<id>/icon-<size>.png
// and icon.ico; test/appIcons.test.ts fails while an entry has no files. The default style (螺钿) is also the build's
// icon — cutex.exe, the .app, the tray before any choice — so its files are resources/icons. The ink-dragon logo (the
// icon until 2026-11-28) stays as the last choice, 「旧版墨龙」 (scripts/make-icons.mjs).

export interface AppIconStyle {
  /** Lowercase letters, digits and dashes; the folder and file name. */
  id: string;
  label: { "zh-CN": string; en: string };
}

/** The style of a new install, and of an install that never picked one. */
export const DEFAULT_APP_ICON = "luodian";
/** The ink-dragon logo of the first releases. */
export const LEGACY_APP_ICON = "ink-dragon";

/** In picker order (the owner's, 2026-11-28). */
export const APP_ICON_STYLES: readonly AppIconStyle[] = [
  { id: DEFAULT_APP_ICON, label: { "zh-CN": "螺钿", en: "Luodian" } },
  { id: "ink", label: { "zh-CN": "水墨", en: "Chinese Ink Wash" } },
  { id: "luodian-lacquer", label: { "zh-CN": "大漆嵌螺钿", en: "Luodian on Black Lacquer" } },
  { id: "qinghua", label: { "zh-CN": "青花瓷", en: "Blue-and-White Porcelain" } },
  { id: "cloisonne", label: { "zh-CN": "掐丝珐琅", en: "Cloisonné Enamel" } },
  { id: "suxiu", label: { "zh-CN": "苏绣", en: "Suzhou Embroidery" } },
  { id: "woodcut-jade", label: { "zh-CN": "套色木刻", en: "Color Woodcut" } },
  { id: "papercut-jade", label: { "zh-CN": "剪纸", en: "Chinese Paper Cutting" } },
  { id: "shadow", label: { "zh-CN": "皮影", en: "Chinese Shadow Puppetry" } },
  { id: "titanium", label: { "zh-CN": "钛金属", en: "Titanium" } },
  { id: "glass", label: { "zh-CN": "花窗玻璃", en: "Stained Glass" } },
  { id: "oil", label: { "zh-CN": "油画", en: "Oil Painting" } },
  { id: "watercolor", label: { "zh-CN": "水彩", en: "Watercolor" } },
  { id: "pencil", label: { "zh-CN": "彩铅", en: "Colored Pencil" } },
  { id: "cyanotype", label: { "zh-CN": "蓝晒", en: "Cyanotype" } },
  { id: "pixel", label: { "zh-CN": "像素画", en: "Pixel Art" } },
  { id: LEGACY_APP_ICON, label: { "zh-CN": "旧版墨龙", en: "Classic ink dragon" } },
];

/** The files every style has (icon-<size>.png); the default style also has 512 (the .icns and the build icon). */
export const APP_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
export const APP_ICON_BUILD_SIZES = [...APP_ICON_SIZES, 512] as const;
export const APP_ICON_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
/** At or below this size a style's hand-simplified drawing is used when it has one. */
export const APP_ICON_SMALL_MAX = 24;

export const APP_ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A style's folder under apps/desktop/resources (packaged as resources/app/resources). */
export function appIconDir(id: string): string {
  return id === DEFAULT_APP_ICON ? "icons" : `app-icons/${id}`;
}

/** The largest file a style has. */
export function appIconMaxSize(id: string): number {
  return id === DEFAULT_APP_ICON ? 512 : 256;
}

export function isAppIconId(value: unknown, styles: readonly AppIconStyle[] = APP_ICON_STYLES): value is string {
  return typeof value === "string" && styles.some((s) => s.id === value);
}

/** The style to use for a stored / synced value: an unknown one (a style this build lacks) falls back to the default. */
export function resolveAppIcon(value: unknown, styles: readonly AppIconStyle[] = APP_ICON_STYLES): string {
  return isAppIconId(value, styles) ? value : DEFAULT_APP_ICON;
}

export function appIconLabel(style: AppIconStyle, locale: string): string {
  return locale.startsWith("zh") ? style.label["zh-CN"] : style.label.en;
}

/** The other language's name, shown small under the tile's name (like the owner's sheet): English under Chinese. */
export function appIconSubLabel(style: AppIconStyle, locale: string): string {
  return locale.startsWith("zh") ? style.label.en : style.label["zh-CN"];
}
