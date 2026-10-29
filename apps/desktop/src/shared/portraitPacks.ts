// 拟人头像包 (docs/design/040 §3.2): portrait packs in the owner's generator format, shared by main (the owner's
// folder) and the renderer (packs shipped in the app).
//
// A pack is a folder whose `manifest.json` lists its pictures (schemaVersion 1):
//   { "schemaVersion": 1, "name"?: string | {"zh-CN", "en"}, "source"?: string,
//     "entries": [{ "theme": "lolita", "themeName": "洛丽塔", "model": "claude", "variant": 1,
//                   "avatarPath": "avatars/lolita/claude-v1.png", "previewPath"?: "previews/lolita/claude-v1.png" }, …],
//     "themes"?: [{ "id": "lolita", "name"?: {"zh-CN": "洛丽塔", "en": "Lolita"}, "subtitle"?: {"en": "…"},
//                   "cover"?: "gpt-v1" }, …] }
// `themes` (optional, owner 2026-10-24): per theme a Chinese and an English name, an English subtitle and the one
// face that stands for it (`cover`: a stem of that theme; the onboarding shows it). Missing: the entries' themeName,
// no subtitle, the theme's first picture.
// Folder name = pack id. Without a manifest, `avatars/<theme>/<model>-v<N>.<png|jpg|webp>` (and the same under
// `previews/`) is read as is, names = folder names. A theme is what the owner picks (Settings → 外观 → 拟人头像);
// inside it, pictures are pooled by model family (`model`: claude, gpt, deepseek, kimi, glm, gemini …).
//
// An agent wearing one stores `{kind: "icon", value: "portrait:<pack>/<theme>/<stem>"}` in cutex (≤ 64 chars;
// stem = `<model>-v<N>` or the catalog's `<character>/<NN>`). Packs are replaced in place when regenerated, so
// a stored id may point at a picture that is gone: resolvePortrait falls back (same pack + theme + family by the
// agent's hash → same pack + family → any pack's family → the default avatar), for display only.

export const PORTRAIT_PACKS_CHANNEL = "cutex-desktop:portrait-packs";

/** The owner's packs under userData (one sub-folder per pack). A pack here with a shipped pack's id replaces it. */
export const PORTRAIT_PACK_DIR = "avatars/portraits";
/** Packs read from the owner's folder (by name); the rest are ignored. */
export const PORTRAIT_PACK_MAX = 32;
/** Entries read from one manifest. */
export const PORTRAIT_ENTRY_MAX = 4000;
/** A manifest's size cap. */
export const PORTRAIT_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
/** One picture's cap (the generator writes ~165 KB 256 px PNGs). */
export const PORTRAIT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const PORTRAIT_PREFIX = "portrait:";
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const STEM = /^[a-z0-9][a-z0-9_-]{0,12}$/;
// Legacy stems and catalog identities share cutex's total 64-character avatar value limit.
const CATALOG_STEM = /^(?:gpt|deepseek|claude|kimi|glm|gemini)\/0[1-6]$/;
const VALUE = /^portrait:([a-z0-9][a-z0-9-]{0,19})\/([a-z0-9][a-z0-9-]{0,31})\/(.+)$/;

export const isPackId = (id: unknown): id is string => typeof id === "string" && PACK_ID.test(id);
export const isThemeId = (id: unknown): id is string => typeof id === "string" && THEME_ID.test(id);
export const isPortraitStem = (id: unknown): id is string => typeof id === "string" && (STEM.test(id) || CATALOG_STEM.test(id));

/** The model families pools are kept in (lib/avatarThemes ModelFamily). */
export type PortraitFamily = "claude" | "openai" | "gemini" | "deepseek" | "kimi" | "glm" | "other";
export const PORTRAIT_FAMILIES: readonly PortraitFamily[] = ["claude", "openai", "gemini", "deepseek", "kimi", "glm"];

/** A generator `model` token → its family (gpt / codex / openai → openai; Kimi's k-series ids like
 *  `k3.1-pro` count as kimi; unknown → other). */
export function familyOfModel(model: string): PortraitFamily {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "claude";
  if (/^(gpt|openai|codex|o\d)/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "gemini";
  if (m.startsWith("deepseek")) return "deepseek";
  if (/^(kimi|moonshot)/.test(m) || /^k\d+(\.\d+)?([-_.]|$)/.test(m)) return "kimi";
  if (/^(glm|chatglm|zhipu)/.test(m)) return "glm";
  return "other";
}

/** A stem's model token: `gpt-v3` → `gpt`. */
export const modelOfStem = (stem: string): string => stem.split("/")[0]!.replace(/[-_]v?\d+$/, "");

export interface PortraitRef {
  pack: string;
  theme: string;
  stem: string;
}

/** `pack/theme/stem`: a picture's id (what follows `portrait:`). */
export const portraitKey = (r: PortraitRef): string => `${r.pack}/${r.theme}/${r.stem}`;

/** The picture a stored avatar points at, else null. */
export function portraitRefOf(avatar: { kind: string; value: string } | null | undefined): PortraitRef | null {
  if (avatar?.kind !== "icon" || avatar.value.length > 64) return null;
  const m = VALUE.exec(avatar.value);
  return m && isPortraitStem(m[3]) ? { pack: m[1]!, theme: m[2]!, stem: m[3]! } : null;
}

export const isPortraitAvatar = (avatar: { kind: string; value: string } | null | undefined): boolean => portraitRefOf(avatar) !== null;

/** The cutex avatar for a picture. */
export function portraitAvatarOf(r: PortraitRef): { kind: "icon"; value: string } {
  return { kind: "icon", value: `${PORTRAIT_PREFIX}${portraitKey(r)}` };
}

/** A display name: one string, or per locale. */
export type PortraitName = string | { "zh-CN"?: string; en?: string };

export interface PortraitPackEntry {
  stem: string;
  model: string;
  family: PortraitFamily;
  /** Path inside the pack (relative, `/`-separated). */
  avatarPath: string;
  previewPath: string | null;
}

export interface PortraitPackTheme {
  id: string;
  name: string;
  /** From the manifest's `themes`: names per locale, an (English) subtitle, the stem of the face that stands for it. */
  names?: PortraitName;
  subtitle?: PortraitName;
  cover?: string;
  entries: PortraitPackEntry[];
}

export interface PortraitPackData {
  name: PortraitName | null;
  themes: PortraitPackTheme[];
}

const IMAGE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_./-]{1,200}\.(png|jpe?g|webp)$/i;

/** A relative picture path inside a pack (no `..`, no absolute path, no backslashes), else null. */
export function safePackPath(path: unknown): string | null {
  return typeof path === "string" && IMAGE_PATH.test(path) && !path.includes("//") ? path : null;
}

const cleanName = (v: unknown, max = 40): string | null => (typeof v === "string" && v.trim() ? [...v.trim()].slice(0, max).join("") : null);

function packName(v: unknown): PortraitName | null {
  const one = cleanName(v);
  if (one) return one;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const zh = cleanName(o["zh-CN"]);
  const en = cleanName(o.en);
  return zh || en ? { ...(zh ? { "zh-CN": zh } : {}), ...(en ? { en } : {}) } : null;
}

const stemOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.[a-z]+$/i, "").toLowerCase();

/**
 * A manifest (parsed JSON) → its themes, each with its usable entries in manifest order; entries with a bad
 * theme / stem / path or a stem already seen in that theme are dropped. null: not a schemaVersion 1 manifest.
 */
export function parsePackManifest(json: unknown): PortraitPackData | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const m = json as Record<string, unknown>;
  if (m.schemaVersion !== 1 || !Array.isArray(m.entries)) return null;
  const themes = new Map<string, PortraitPackTheme>();
  const seen = new Set<string>();
  for (const raw of m.entries.slice(0, PORTRAIT_ENTRY_MAX)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const avatarPath = safePackPath(e.avatarPath);
    if (!avatarPath || !isThemeId(e.theme)) continue;
    // New catalogs provide the logical theme/character/variant id. Paths remain only image locations.
    const stem = typeof e.id !== "string" || !e.id.includes("/") ? stemOf(avatarPath)
      : typeof e.id === "string" && e.id.startsWith(`${e.theme}/`) ? e.id.slice(e.theme.length + 1) : "";
    const model = typeof e.model === "string" && e.model ? e.model.toLowerCase() : modelOfStem(stem);
    if (!isPortraitStem(stem) || seen.has(`${e.theme}/${stem}`)) continue;
    seen.add(`${e.theme}/${stem}`);
    let theme = themes.get(e.theme);
    if (!theme) themes.set(e.theme, (theme = { id: e.theme, name: cleanName(e.themeName) ?? e.theme, entries: [] }));
    theme.entries.push({ stem, model, family: familyOfModel(model), avatarPath, previewPath: safePackPath(e.previewPath) });
  }
  if (Array.isArray(m.themes))
    for (const raw of m.themes.slice(0, 200)) {
      if (!raw || typeof raw !== "object") continue;
      const t = raw as Record<string, unknown>;
      const theme = isThemeId(t.id) ? themes.get(t.id) : undefined;
      if (!theme) continue;
      const names = packName(t.name);
      const subtitle = packName(t.subtitle);
      const cover = typeof t.cover === "string" && theme.entries.some((e) => e.stem === t.cover) ? t.cover : null;
      if (names) theme.names = names;
      if (subtitle) theme.subtitle = subtitle;
      if (cover) theme.cover = cover;
    }
  return { name: packName(m.name), themes: [...themes.values()] };
}

/** A pack without a manifest: `avatars/<theme>/<file>` paths (+ `previews/<theme>/<same file>` when present). */
export function packFromFiles(paths: readonly string[]): PortraitPackData {
  const previews = new Set(paths.filter((p) => p.startsWith("previews/")));
  const entries = paths
    .filter((p) => /^avatars\/[^/]+\/[^/]+$/.test(p))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((avatarPath) => {
      const theme = avatarPath.split("/")[1]!;
      const preview = `previews/${avatarPath.slice("avatars/".length)}`;
      return { theme, themeName: theme, avatarPath, previewPath: previews.has(preview) ? preview : undefined };
    });
  return parsePackManifest({ schemaVersion: 1, entries }) ?? { name: null, themes: [] };
}

/** PNG / JPEG / WebP by signature (pictures are handed over as data URLs of this type). */
export function portraitImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

// ── IPC (the owner's folder; main/portraitPacks.ts) ─────────────────────────────────────────────────────

export interface UserPortraitPack extends PortraitPackData {
  id: string;
}

export interface PortraitPacksState {
  packs: UserPortraitPack[];
  /** Absolute path of the owner's folder. */
  dir: string;
  /** Folders / entries skipped (bad id, unreadable manifest, missing or oversized pictures). */
  skipped: number;
}

export type PortraitImageKind = "full" | "preview";

export type PortraitPacksRequest =
  | { op: "list" }
  | { op: "openFolder" }
  | { op: "image"; pack: string; theme: string; stem: string; kind: PortraitImageKind };

export interface PortraitPacksBridge {
  list(): Promise<PortraitPacksState>;
  openFolder(): Promise<PortraitPacksState>;
  /** A picture of an owner's pack as a data URL (null: gone / not a picture). */
  image(ref: PortraitRef, kind: PortraitImageKind): Promise<string | null>;
}
