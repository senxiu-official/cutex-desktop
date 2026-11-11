// Where the catalog fonts (shared/fontCatalog.ts) come from in this window: bundled Latin files are build assets
// (hashed URLs, loaded only when a face is used), 中文字体包 files are main's `cutex-font:` URLs, and the picker's
// previews are the bundled subsets.
import { catalogFont, packFontUrl, type FontCatalogEntry } from "../../../shared/fontCatalog";

const LATIN = import.meta.glob<string>("../assets/fonts/latin/*", { query: "?url", import: "default", eager: true });
const PREVIEW = import.meta.glob<string>("../assets/fonts/preview/*", { query: "?url", import: "default", eager: true });
const assetUrl = (files: Record<string, string>, dir: string, file: string): string | undefined => files[`../assets/fonts/${dir}/${file}`];

export interface CatalogFaceSource {
  weight: string;
  style: "normal" | "italic";
  /** A CSS src value. */
  source: string;
}

function src(url: string, file: string): string {
  return `url(${JSON.stringify(url)}) format("${file.endsWith(".ttf") ? "truetype" : "woff2"}")`;
}

/** The faces of a catalog family with their sources, or undefined for any other (system) font. */
export function catalogFaceSources(family: string): CatalogFaceSource[] | undefined {
  const entry = catalogFont(family);
  if (!entry) return undefined;
  return entry.faces.flatMap((face) => {
    const url = entry.delivery === "bundled" ? assetUrl(LATIN, "latin", face.file) : packFontUrl(face.file);
    return url ? [{ weight: face.weight, style: face.style, source: src(url, face.file) }] : [];
  });
}

/** The picker preview's CSS src for a catalog family: the subset for a pack family, the regular face otherwise. */
export function previewSource(entry: FontCatalogEntry): string | undefined {
  if (entry.preview) {
    const url = assetUrl(PREVIEW, "preview", entry.preview.file);
    return url && src(url, entry.preview.file);
  }
  const regular = entry.faces.find((f) => f.style === "normal" && weightCovers(f.weight, 400)) ?? entry.faces[0];
  const url = regular && assetUrl(LATIN, "latin", regular.file);
  return url && src(url, regular.file);
}

export function weightCovers(weight: string, value: number): boolean {
  const [lo, hi = lo] = weight.split(" ").map(Number);
  return lo! <= value && value <= hi!;
}
