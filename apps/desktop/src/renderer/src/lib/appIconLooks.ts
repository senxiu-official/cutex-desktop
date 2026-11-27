// 外观 → 应用图标: the styles as the renderer shows them (lib/appIcon holds the chosen one), from the files
// scripts/make-app-icons.mjs builds (shared/appIcons.ts). No bridge import, so anything may read it early.
import { APP_ICON_STYLES, DEFAULT_APP_ICON, appIconDir, appIconLabel, appIconSubLabel, type AppIconStyle } from "../../../shared/appIcons";

export type AppIconSize = 16 | 24 | 32 | 48 | 256;

/** A style as the renderer shows it. */
export interface AppIconLook {
  id: string;
  label(locale: string): string;
  /** The other language's name (small, under the label). */
  subLabel(locale: string): string;
  /** The picture made for `size` px. */
  url(size: AppIconSize): string;
}

// Every style's files (the default's in resources/icons, the others' in resources/app-icons/<id>).
const FILES = import.meta.glob("../../../../resources/{icons,app-icons/*}/icon-{16,24,32,48,256}.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const file = (id: string, size: AppIconSize): string | undefined => FILES[`../../../../resources/${appIconDir(id)}/icon-${size}.png`];

function look(style: AppIconStyle): AppIconLook {
  return {
    id: style.id,
    label: (locale) => appIconLabel(style, locale),
    subLabel: (locale) => appIconSubLabel(style, locale),
    // A style with missing files (a broken drop-in) shows the default's picture rather than nothing.
    url: (size) => file(style.id, size) ?? file(DEFAULT_APP_ICON, size) ?? "",
  };
}

const LOOKS: readonly AppIconLook[] = APP_ICON_STYLES.map(look);

export function appIconLooks(): readonly AppIconLook[] {
  return LOOKS;
}

export function appIconLook(id: string): AppIconLook {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0]!;
}
