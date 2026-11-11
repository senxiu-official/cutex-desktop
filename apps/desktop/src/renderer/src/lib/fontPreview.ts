// The font picker draws each choice in its own font (owner 2026-11-10). An installed font is used by name; a font
// that comes with the desktop (shared/fontCatalog.ts) gets a face of its own registered on first use but not loaded:
// the browser fetches it only when an option is drawn. For a 中文字体包 family that face is the bundled preview
// subset (a few dozen KB), so opening the list never loads the big files.
import { catalogFont } from "../../../shared/fontCatalog";
import { cssString } from "./fontFaces";
import { previewSource } from "./fontSources";

/** Text shown after each choice, in its own font. */
export const FONT_SAMPLE = { cjk: "永和 Aa 123", latin: "Aa Gg 123", mono: "0O 1lI {}" } as const;
export type FontSampleKind = keyof typeof FONT_SAMPLE;

const registered = new Map<string, string>();

/** The CSS font-family that draws `font`'s preview. */
export function previewFontFamily(font: string, fonts: Pick<FontFaceSet, "add"> | undefined = typeof document === "undefined" ? undefined : document.fonts): string {
  const entry = catalogFont(font);
  if (!entry) return `${cssString(font)}, system-ui, sans-serif`;
  let alias = registered.get(entry.id);
  if (!alias) {
    alias = `cutex-preview-${entry.id}`;
    const source = previewSource(entry);
    if (source && fonts && typeof FontFace !== "undefined") {
      try {
        fonts.add(new FontFace(alias, source, { display: "swap" }));
      } catch {
        // No preview face: the option shows in the fallback font.
      }
    }
    registered.set(entry.id, alias);
  }
  return `${cssString(alias)}, system-ui, sans-serif`;
}

/** The name a font is listed under: a 中文字体包 family by its Chinese or English name, any other by its family. */
export function fontLabel(font: string, locale: string): string {
  const names = catalogFont(font)?.names;
  return names ? (locale.startsWith("zh") ? names.zh : names.en) : font;
}

/** Which sample a choice shows: CJK fonts show Han characters. */
export function sampleKind(font: string, cjkFonts: readonly string[], mono = false): FontSampleKind {
  if (mono) return "mono";
  return catalogFont(font)?.script === "cjk" || cjkFonts.includes(font) ? "cjk" : "latin";
}
