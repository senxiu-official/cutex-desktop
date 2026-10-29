// 拖放落点预览 (Settings → 外观 → 工作区: 只要框线 / 框线+底色; owner 2026-10-26: 只要框线 must hold for every drop
// target). The one switch for every drop preview's tint: the preview carries DROP_TINT and names its tint in
// --drop-tint (dropTint() for the React-drawn ones, a CSS declaration for the tray / desk ones); styles.css paints
// it only under :root[data-drop-preview="fill"] (lib/appearance applyAppearance), so 只要框线 — the default — keeps
// just the outline. No preview reads the setting itself.
import type { CSSProperties } from "react";

/** The class every drop preview's tinted box carries (styles.css 「拖放落点预览」). */
export const DROP_TINT = "drop-tint";

/**
 * The tint a DROP_TINT box shows under 框线+底色: `color` at `percent` over what is under it. `over`: an opaque box
 * (the composer's input, the queue's insert target) names its own background, so the tint replaces it without
 * letting what is underneath show through.
 */
export function dropTint(color = "var(--accent)", percent = 13, over = "transparent"): CSSProperties {
  return { "--drop-tint": `color-mix(in srgb, ${color} ${percent}%, ${over})` } as CSSProperties;
}
