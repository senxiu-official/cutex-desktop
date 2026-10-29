// The appearance fonts (Settings → 外观 → 西文字体 / 中文字体 / 代码字体) for a page without the main
// window's bridge — the big alert window (ownerAlert/main.ts). Reads the same per-machine localStorage
// entry as lib/appearance and routes the same faces (lib/fontFaces buildFontPlan), publishing
// --font-sans / --font-mono etc. on <html>. No sizes, zoom or density: that page has its own layout.
import { parseAppearance, type Appearance } from "./appearanceModel";
import { FontRoutingController } from "./fontFaces";

export const APPEARANCE_KEY = "cutex-desktop.appearance";

/** The stored appearance; defaults when unset or unreadable. */
export function storedAppearance(storage: Pick<Storage, "getItem"> = localStorage): Appearance {
  try {
    return parseAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY) ?? "{}"));
  } catch {
    return parseAppearance({});
  }
}

/** Applies the stored fonts now and again whenever another window changes them. */
export function followStoredFonts(): void {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const root = document.documentElement;
  const controller = new FontRoutingController<FontFace>({
    createFace: ({ alias, source, descriptors }) => new FontFace(alias, source, descriptors),
    add: (face) => { document.fonts.add(face); },
    remove: (face) => { document.fonts.delete(face); },
    publish: (variables) => {
      for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    },
  });
  void controller.update(storedAppearance());
  window.addEventListener("storage", (e) => {
    if (e.key === APPEARANCE_KEY) void controller.update(storedAppearance());
  });
}
