/**
 * Home page settings (cutex `user-home`, docs/remote-clients.md "Home page") and service tiles (cutex
 * `service-tiles`, docs/SERVICES.md "Tiles"): wire types, the read normalisers and the PUT body check.
 *
 * `home` is the client's document: the host checks only its size and the shape of the keys it knows,
 * and keeps unknown keys. Readers here keep unknown keys too (a newer desktop's settings survive an
 * older desktop's write) and drop known keys whose value has the wrong shape.
 */

export const USER_HOME_FEATURE = "user-home";
export const SERVICE_TILES_FEATURE = "service-tiles";
/** Pins of kind `page` (cutex `user-home-page-pins`); a host with `user-home` but without this refuses them (400 invalid_home). */
export const USER_HOME_PAGE_PINS_FEATURE = "user-home-page-pins";

export const HOME_PIN_KINDS = ["service", "artifact", "agent", "url", "page"] as const;
export type HomePinKind = (typeof HOME_PIN_KINDS)[number];
export const HOME_TILE_SIZES = ["s", "m", "w", "l"] as const;
export type HomeTileSize = (typeof HOME_TILE_SIZES)[number];

/** Host limits (cutex): blocks / pins ≤ 64, bio ≤ 200 characters, home ≤ 64 KiB of compact JSON. */
export const HOME_MAX_BLOCKS = 64;
export const HOME_MAX_PINS = 64;
export const HOME_BIO_MAX = 200;
export const HOME_MAX_BYTES = 64 * 1024;
/** Cover upload: PNG / JPEG / WebP, at most 2 MiB. */
export const HOME_COVER_MAX_BYTES = 2 * 1024 * 1024;
export const HOME_COVER_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type HomeCoverType = (typeof HOME_COVER_TYPES)[number];
/** Tile image: at most 512 KiB (cutex `/tile/image`). */
export const TILE_IMAGE_MAX_BYTES = 512 * 1024;

export interface HomeBlock {
  id: string;
  visible: boolean;
  [extra: string]: unknown;
}

/**
 * A `page` pin's key: `<pageId>:<argument>` — the page id 1–64 of `[a-z0-9._-]` starting with a letter (the
 * desktop's page-pin id, e.g. `project-view`), the argument not empty (e.g. a project id). Same rule as cutex
 * `user_home::valid_page_key`.
 */
const PAGE_KEY = /^[a-z][a-z0-9._-]{0,63}:./s;
export const isPagePinKey = (key: string): boolean => PAGE_KEY.test(key);

/** `<pageId>:<argument>` → its parts (null: not a page key). */
export function parsePagePinKey(key: string): { pageId: string; arg: string } | null {
  if (!isPagePinKey(key)) return null;
  const at = key.indexOf(":");
  return { pageId: key.slice(0, at), arg: key.slice(at + 1) };
}

export interface HomePin {
  hostId: string;
  kind: HomePinKind;
  key: string;
  title?: string | null;
  size?: HomeTileSize | null;
  [extra: string]: unknown;
}

/** The stored document (all keys optional; unknown keys kept). */
export interface HomeDoc {
  layout?: string | null;
  blocks?: HomeBlock[] | null;
  bio?: string | null;
  sidebarEntry?: boolean | null;
  showWhenEmpty?: boolean | null;
  homeHost?: string | null;
  pins?: HomePin[] | null;
  [extra: string]: unknown;
}

/** `GET|PUT /v2/users/me/home` (and the cover routes' answer). `home` null until the first write. */
export interface HomeView {
  revision: number;
  home: HomeDoc | null;
  coverEtag: string | null;
  updatedAt: string | null;
}

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const chars = (s: string) => [...s].length;
const str = (v: unknown, min: number, max: number): v is string => typeof v === "string" && chars(v) >= min && chars(v) <= max;

function readBlocks(raw: unknown): HomeBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: HomeBlock[] = [];
  for (const b of raw) {
    if (!isRecord(b) || !str(b.id, 1, 64) || typeof b.visible !== "boolean" || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push({ ...b, id: b.id, visible: b.visible });
    if (out.length >= HOME_MAX_BLOCKS) break;
  }
  return out;
}

/** One pin, or null when its known fields are malformed. */
export function readHomePin(p: unknown): HomePin | null {
  if (!isRecord(p) || !str(p.hostId, 1, 256) || !HOME_PIN_KINDS.includes(p.kind as HomePinKind) || !str(p.key, 1, 2048)) return null;
  if (p.kind === "page" && !isPagePinKey(p.key)) return null;
  const pin: HomePin = { ...p, hostId: p.hostId, kind: p.kind as HomePinKind, key: p.key };
  if (p.title === undefined || p.title === null) delete pin.title;
  else if (!str(p.title, 1, 200) || CONTROL.test(p.title)) delete pin.title;
  if (p.size === undefined || p.size === null || !HOME_TILE_SIZES.includes(p.size as HomeTileSize)) delete pin.size;
  return pin;
}

function readPins(raw: unknown): HomePin[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map(readHomePin).filter((p): p is HomePin => p !== null).slice(0, HOME_MAX_PINS);
}

/** A stored document → the same with malformed known keys dropped (unknown keys kept). */
export function readHomeDoc(raw: unknown): HomeDoc | null {
  if (!isRecord(raw)) return null;
  const doc: HomeDoc = { ...raw };
  delete doc.coverEtag;
  const drop = (key: string) => delete doc[key];
  if (raw.layout !== undefined && !(raw.layout === null || str(raw.layout, 1, 64))) drop("layout");
  if (raw.bio !== undefined && !(raw.bio === null || (str(raw.bio, 0, HOME_BIO_MAX) && !CONTROL_EXCEPT_NEWLINE.test(raw.bio)))) drop("bio");
  for (const key of ["sidebarEntry", "showWhenEmpty"] as const) if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== "boolean") drop(key);
  if (raw.homeHost !== undefined && !(raw.homeHost === null || str(raw.homeHost, 1, 256))) drop("homeHost");
  if (raw.blocks !== undefined && raw.blocks !== null) {
    const blocks = readBlocks(raw.blocks);
    if (blocks) doc.blocks = blocks;
    else drop("blocks");
  }
  if (raw.pins !== undefined && raw.pins !== null) {
    const pins = readPins(raw.pins);
    if (pins) doc.pins = pins;
    else drop("pins");
  }
  return doc;
}

/** `GET /v2/users/me/home` answer → a view (revision 0 / home null for anything unusable). */
export function readHomeView(raw: unknown): HomeView {
  const r = isRecord(raw) ? raw : {};
  const revision = typeof r.revision === "number" && Number.isInteger(r.revision) && r.revision >= 0 ? r.revision : 0;
  const coverEtag = typeof r.coverEtag === "string" && r.coverEtag ? r.coverEtag : null;
  return { revision, home: readHomeDoc(r.home), coverEtag, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null };
}

/** The `PUT /v2/users/me/home` body (throws on a document the host would refuse). */
export function homePutBody(revision: number, home: HomeDoc | null): { revision: number; home: HomeDoc | null } {
  if (!Number.isInteger(revision) || revision < 0) throw new Error("bad home revision");
  if (home === null) return { revision, home: null };
  const doc = readHomeDoc(home);
  if (!doc) throw new Error("bad home");
  for (const key of ["layout", "bio", "sidebarEntry", "showWhenEmpty", "homeHost"] as const) {
    if (home[key] !== undefined && doc[key] === undefined) throw new Error(`bad home field ${key}`);
  }
  if (Array.isArray(home.pins) && (doc.pins?.length ?? 0) !== home.pins.length) throw new Error("bad home field pins");
  if (Array.isArray(home.blocks) && (doc.blocks?.length ?? 0) !== home.blocks.length) throw new Error("bad home field blocks");
  if (new TextEncoder().encode(JSON.stringify(doc)).length > HOME_MAX_BYTES) throw new Error("home too large");
  return { revision, home: doc };
}

/** A cover upload: base64 of a PNG / JPEG / WebP (no data: prefix). */
export interface HomeCoverUpload {
  contentType: HomeCoverType;
  data: string;
}

export function homeCoverBody(upload: HomeCoverUpload): HomeCoverUpload {
  if (!upload || !HOME_COVER_TYPES.includes(upload.contentType)) throw new Error("bad cover type");
  if (typeof upload.data !== "string" || !upload.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(upload.data)) throw new Error("bad cover data");
  if (Math.floor((upload.data.length * 3) / 4) > HOME_COVER_MAX_BYTES + 2) throw new Error("cover too large");
  return { contentType: upload.contentType, data: upload.data };
}

// ── Service tiles ─────────────────────────────────────────────────────────────────────────────────

export interface ServiceTileAction {
  label: string;
  path: string;
}

/** A tile template (all fields optional). */
export interface ServiceTile {
  title?: string;
  subtitle?: string;
  lines?: string[];
  image?: string;
  progress?: { value: number; label?: string };
  badge?: string;
  actions?: ServiceTileAction[];
  refreshSeconds?: number;
  sizes?: HomeTileSize[];
}

export interface ServiceTileAnswer {
  tile: ServiceTile | null;
  fetchedAt: string | null;
  error: { code: string; message: string } | null;
  source: "static" | "service" | null;
}

/**
 * A path inside the service (docs/SERVICES.md "Tiles"): exactly one leading `/`, ≤ 512 bytes, no
 * whitespace, `\`, `#`, `.` / `..` segment or `/__cutex` prefix (also after percent decoding); a query
 * is kept. Anything else (URLs, `javascript:`, `data:`, `//host`) → null.
 */
export function tilePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (new TextEncoder().encode(raw).length > 512 || /[\s\\#]/.test(raw) || CONTROL.test(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  for (const p of [raw, decoded]) {
    if (p.startsWith("//") || /[\s\\#]/.test(p) || CONTROL.test(p)) return null;
    const pathPart = p.split("?")[0]!;
    if (pathPart.toLowerCase().startsWith("/__cutex")) return null;
    if (pathPart.split("/").some((seg) => seg === "." || seg === "..")) return null;
  }
  return raw;
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && chars(t) <= max && !CONTROL.test(t) ? t : undefined;
};

/** A tile template as the desktop draws it: unknown fields dropped, bad fields left out, paths service-internal only. */
export function readServiceTile(raw: unknown): ServiceTile | null {
  if (!isRecord(raw)) return null;
  const tile: ServiceTile = {};
  const title = text(raw.title, 60);
  if (title) tile.title = title;
  const subtitle = text(raw.subtitle, 120);
  if (subtitle) tile.subtitle = subtitle;
  if (Array.isArray(raw.lines)) {
    const lines = raw.lines.map((l) => text(l, 120)).filter((l): l is string => !!l).slice(0, 3);
    if (lines.length) tile.lines = lines;
  }
  const image = tilePath(raw.image);
  if (image) tile.image = image;
  if (isRecord(raw.progress) && typeof raw.progress.value === "number" && Number.isFinite(raw.progress.value)) {
    const label = text(raw.progress.label, 40);
    tile.progress = { value: Math.min(1, Math.max(0, raw.progress.value)), ...(label ? { label } : {}) };
  }
  const badge = text(raw.badge, 12);
  if (badge) tile.badge = badge;
  if (Array.isArray(raw.actions)) {
    const actions = raw.actions
      .map((a) => (isRecord(a) ? { label: text(a.label, 20), path: tilePath(a.path) } : null))
      .filter((a): a is ServiceTileAction => !!a?.label && !!a.path)
      .slice(0, 3);
    if (actions.length) tile.actions = actions;
  }
  if (typeof raw.refreshSeconds === "number" && Number.isFinite(raw.refreshSeconds)) tile.refreshSeconds = Math.min(86400, Math.max(60, Math.round(raw.refreshSeconds)));
  if (Array.isArray(raw.sizes)) {
    const sizes = HOME_TILE_SIZES.filter((s) => (raw.sizes as unknown[]).includes(s));
    if (sizes.length) tile.sizes = sizes;
  }
  return Object.keys(tile).length ? tile : null;
}

/** `GET /v2/services/{slug}/tile` → the answer with the template sanitised. */
export function readServiceTileAnswer(raw: unknown): ServiceTileAnswer {
  const r = isRecord(raw) ? raw : {};
  const error = isRecord(r.error) && typeof r.error.code === "string" ? { code: r.error.code, message: typeof r.error.message === "string" ? r.error.message : "" } : null;
  return {
    tile: readServiceTile(r.tile),
    fetchedAt: typeof r.fetchedAt === "string" ? r.fetchedAt : null,
    error,
    source: r.source === "static" || r.source === "service" ? r.source : null,
  };
}
