// The fonts that come with the desktop (owner 2026-11-10; SIL OFL 1.1, LICENSES/fonts/<id>/). The catalog itself is
// generated from the font handoff (fontCatalog.generated.ts, scripts/font-assets.py).
// - Latin families are bundled (renderer assets, a few hundred KB each) and load only when chosen.
// - CJK families are 7–10 MB per weight, so they are not in the install: the 中文字体包, imported into
//   `<userData>/fonts/` (main/fontPack.ts, each file checked against its pinned SHA-256) and served to the app window
//   by main under `cutex-font:` one weight at a time, only when used. The font picker shows them with a tiny bundled
//   preview subset, so opening the list loads none of the big files.
import { FONT_CATALOG } from "./fontCatalog.generated";

export interface FontCatalogFace {
  /** CSS font-weight: one weight or a variable range ("100 900"). */
  weight: string;
  style: "normal" | "italic";
  /** Bundled: the file name under assets/fonts/latin/. Pack: the file name under <userData>/fonts/. */
  file: string;
  bytes: number;
  /** Pack faces: the pinned SHA-256 of the file, and where its upstream source is. */
  sha256?: string;
  source?: { url: string; sha256: string };
}

export interface FontCatalogEntry {
  id: string;
  /** The CSS family; also the value stored in Settings → 外观. */
  family: string;
  script: "latin" | "cjk";
  delivery: "bundled" | "pack";
  faces: FontCatalogFace[];
  /** Pack families: names shown in the picker and the pack card. */
  names?: { zh: string; en: string };
  /** Pack families: the bundled preview subset (assets/fonts/preview/). */
  preview?: { file: string; bytes: number };
}

export { FONT_CATALOG };

export const FONT_SCHEME = "cutex-font";
export const FONT_PACK_DIR = "fonts";
export const FONT_PACK_CHANNEL = "cutex-desktop:font-pack";

const byFamily = new Map(FONT_CATALOG.map((entry) => [entry.family.toLowerCase(), entry]));

/** The catalog entry for a family name (as stored in the settings), or undefined for any other font. */
export function catalogFont(family: string): FontCatalogEntry | undefined {
  return byFamily.get(family.trim().toLowerCase());
}

export const BUNDLED_LATIN_FONTS: readonly string[] = FONT_CATALOG.filter((e) => e.delivery === "bundled").map((e) => e.family);
export const PACK_FONTS: readonly FontCatalogEntry[] = FONT_CATALOG.filter((e) => e.delivery === "pack");

/** The URL of an imported pack file for the app window (main serves it from <userData>/fonts/). */
export function packFontUrl(file: string): string {
  return `${FONT_SCHEME}://pack/${encodeURIComponent(file)}`;
}

export interface FontPackFamilyState {
  id: string;
  /** Faces present in the folder (each was checked when imported). */
  installed: number;
  total: number;
  /** Bytes of all its faces. */
  bytes: number;
}
/**
 * The 中文字体包 as one release asset of the public desktop repo (owner 2026-11-10, option B; built by
 * scripts/font-pack-archive.mjs, reproducible). Pinned here: main downloads exactly this URL through the updater's
 * network session, checks size and SHA-256, then installs only catalog file names whose own SHA-256 matches.
 */
export const FONT_PACK_ARCHIVE = {
  name: "cutex-fonts-zh-1.tar",
  url: "https://github.com/senxiu-official/cutex-desktop/releases/download/fonts-zh-1/cutex-fonts-zh-1.tar",
  sha256: "82a82dbd3bf406d7701b6475ea766ec8414d9650e3b4c3e4fd495341a57c1596",
  bytes: 87_826_432,
  /** The archive's top folder; the fonts are under <root>/fonts/. */
  root: "cutex-fonts-zh-1",
} as const;

/** Why a download did not finish, in words the settings card shows. */
export type FontPackDownloadError = "network" | "proxyAuth" | "mismatch" | "disk" | "cancelled";

export interface FontPackDownload {
  phase: "downloading" | "verifying" | "installing" | "failed";
  /** Bytes of the archive downloaded so far (kept between attempts: a retry continues). */
  received: number;
  total: number;
  error?: FontPackDownloadError;
}

export interface FontPackState {
  families: FontPackFamilyState[];
  /** The running or last failed download; absent when none. */
  download?: FontPackDownload;
}
export interface FontPackImportResult {
  canceled: boolean;
  /** Files copied (checked against the catalog's SHA-256). */
  imported: string[];
  /** Files with a pack name whose content did not match. */
  refused: string[];
  state: FontPackState;
}

export type FontPackRequest = { op: "state" } | { op: "import" } | { op: "remove"; id: string } | { op: "openFolder" } | { op: "download" } | { op: "cancelDownload" };

export interface FontPackBridge {
  state(): Promise<FontPackState>;
  /** Opens main's folder dialog, then imports every matching file from the chosen folder (and its subfolders). */
  import(): Promise<FontPackImportResult>;
  /** Deletes one family's imported files. */
  remove(id: string): Promise<FontPackState>;
  openFolder(): Promise<void>;
  /** 下载并安装: main downloads FONT_PACK_ARCHIVE and installs its fonts; resolves with the final state. */
  download(): Promise<FontPackState>;
  cancelDownload(): Promise<void>;
  /** State pushes while a download runs. */
  onState(listener: (state: FontPackState) => void): () => void;
}

/** A request from the renderer, shape-checked; null when malformed. */
export function parseFontPackRequest(raw: unknown): FontPackRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if ((r.op === "state" || r.op === "import" || r.op === "openFolder" || r.op === "download" || r.op === "cancelDownload") && keys.length === 1) return { op: r.op };
  if (r.op === "remove" && keys.length === 2 && typeof r.id === "string" && PACK_FONTS.some((e) => e.id === r.id)) return { op: "remove", id: r.id };
  return null;
}
