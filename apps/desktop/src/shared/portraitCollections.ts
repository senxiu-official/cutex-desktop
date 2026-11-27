import { isThemeId } from "./portraitPacks";
import { PACK_PATH_RE } from "./modulePacks";

export const PORTRAIT_COLLECTIONS_CHANNEL = "cutex-desktop:portrait-collections";
export const PORTRAIT_COLLECTIONS_RELEASE = "portrait-collections";
export const PORTRAIT_COLLECTIONS_INDEX = "portraits.json";
export const PORTRAIT_COLLECTIONS_ROOT = "avatars/official-collections";
export const PORTRAIT_ARCHIVE_LIMIT = 12 * 1024 * 1024;
export const PORTRAIT_FILE_LIMIT = 96;

export interface PortraitFile {
  path: string;
  size: number;
  sha256: string;
}

export interface PortraitCollection {
  theme: string;
  version: number;
  archive: PortraitFile & { url: string };
  files: PortraitFile[];
}

export interface PortraitCollectionIndex {
  schema: 1;
  sequence: number;
  collections: PortraitCollection[];
}

const whole = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= max;

const portableSegment = (name: string): boolean =>
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) && !/[. ]$/.test(name);

function file(raw: unknown, max: number): PortraitFile {
  const f = raw as Partial<PortraitFile> | null;
  if (!f || typeof f.path !== "string" || !PACK_PATH_RE.test(f.path) || !f.path.split("/").every(portableSegment)
      || !whole(f.size, max) || typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256)) {
    throw Error("invalid portrait collection file");
  }
  return { path: f.path, size: f.size, sha256: f.sha256 };
}

export function parsePortraitCollectionIndex(raw: unknown, allowedUrl: (url: string) => boolean): PortraitCollectionIndex {
  const index = raw as Partial<PortraitCollectionIndex> | null;
  if (!index || index.schema !== 1 || !whole(index.sequence, Number.MAX_SAFE_INTEGER) || !Array.isArray(index.collections) || index.collections.length > 100) {
    throw Error("invalid portrait collection index");
  }
  const seen = new Set<string>();
  const collections = index.collections.map(candidate => {
    if (!candidate || !isThemeId(candidate.theme) || !portableSegment(candidate.theme) || seen.has(candidate.theme)
        || !whole(candidate.version, Number.MAX_SAFE_INTEGER)
        || !Array.isArray(candidate.files) || !candidate.files.length || candidate.files.length > PORTRAIT_FILE_LIMIT) {
      throw Error("invalid portrait collection");
    }
    const { theme, version } = candidate;
    seen.add(theme);
    const archive = file(candidate.archive, PORTRAIT_ARCHIVE_LIMIT);
    const url = candidate.archive.url;
    if (archive.path !== `${theme}-${version}.tar.gz` || typeof url !== "string" || !allowedUrl(url)) {
      throw Error("invalid portrait archive location");
    }
    const paths = new Set<string>();
    const files = candidate.files.map(rawFile => {
      const f = file(rawFile, 2 * 1024 * 1024);
      const permitted = f.path === "manifest.json" || (
        (f.path.startsWith(`avatars/${theme}/`) || f.path.startsWith(`previews/${theme}/`))
        && /\.(?:webp|png|jpe?g)$/.test(f.path)
      );
      if (!permitted || paths.has(f.path.toLowerCase())) throw Error("invalid or duplicate portrait path");
      paths.add(f.path.toLowerCase());
      return f;
    });
    if (!paths.has("manifest.json") || files.reduce((sum, f) => sum + f.size, 0) > PORTRAIT_ARCHIVE_LIMIT) throw Error("invalid portrait collection size");
    return { theme, version, archive: { ...archive, url }, files };
  });
  return { schema: 1, sequence: index.sequence, collections };
}

export type PortraitCollectionsRequest = { op: "state" | "check" | "retry" } | { op: "install"; theme: string };
export interface PortraitCollectionsView {
  checked: boolean;
  themes: { theme: string; available: number | null; installed: number | null; bytes: number | null }[];
  operation: { theme: string | null; step: "check" | "download" | "verify" | "install"; received?: number; total?: number } | null;
  error: { code: "index_unavailable" | "signature_invalid" | "index_invalid" | "index_rollback" | "not_available" | "download_failed" | "verify_failed" | "install_failed"; theme: string | null } | null;
}
export interface PortraitCollectionsBridge {
  state(): Promise<PortraitCollectionsView>;
  check(): Promise<PortraitCollectionsView>;
  install(theme: string): Promise<PortraitCollectionsView>;
  retry(): Promise<PortraitCollectionsView>;
}
