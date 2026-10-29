// The desktop background at startup (owner 2026-10-21: "every launch shows a launch-art portrait first, then
// the desktop background"). The background (the home cover from the host's /v2/users/me/home, else the launch
// art over the sky scene) is only known once the home settings — and the cover — have loaded; until then the
// desktop used to fall back to the launch art, an unrelated portrait. Now:
//   • the last resolved background is remembered on this device (localStorage, small: the cover as a
//     size-limited data URL — scaled down when it is too big — or which launch art it was) and drawn at once;
//   • with nothing remembered: the neutral sky scene (never a portrait) until the background is known;
//   • when the host's answer differs, the new background cross-fades in (components: Parts DeskBackdrop;
//     instant with reduced motion).
// Pure parts (resolveBackdrop, sameBackdrop, shownBackdrop) are unit-tested in test/homeBackdrop.test.ts.
import type { PortraitProvider } from "../../lib/launchPortraits";
import { PORTRAIT_ORDER } from "../../lib/launchPortraits";
import type { HomeEntry } from "./store";

/** Which provider's portrait the art background shows: Codex first, then the launcher's order. */
export const ART_PREFERENCE: readonly PortraitProvider[] = ["codex", ...PORTRAIT_ORDER.filter((p) => p !== "codex")];

/** A desktop background: the host's cover, a launch art (by provider), or the sky scene alone. */
export type DeskBackdrop =
  | {
      kind: "cover";
      hostId: string;
      etag: string;
      /** The image (null: remembered without it — too big to keep). */
      dataUrl: string | null;
      /** `dataUrl` is the host's image as it is (not scaled down): it can stand in for a read of the cover. */
      exact?: boolean;
    }
  | { kind: "art"; provider: PortraitProvider }
  | { kind: "scene" };

/** The cover read for a host + etag: undefined = not asked yet, null = loading, false = none, string = the image. */
export type CoverRead = string | null | false | undefined;

export interface BackdropInput {
  /** The home page source host (null: no owner host connected yet). */
  hostId: string | null;
  /** The boot host's document: its `homeHost` can move the source to another host. */
  bootEntry: Pick<HomeEntry, "status"> | null;
  /** The source host's document. */
  entry: Pick<HomeEntry, "status" | "source" | "coverEtag"> | null;
  cover: CoverRead;
  /** The launch art is final (main answered with the imported art). */
  artReady: boolean;
  /** The provider whose portrait the art background shows (null: no art at all). */
  artProvider: PortraitProvider | null;
}

/** The background the host's settings say (null: not known yet — still loading, or unreachable). Pure. */
export function resolveBackdrop(input: BackdropInput): DeskBackdrop | null {
  const { hostId, bootEntry, entry } = input;
  if (!hostId || !bootEntry || bootEntry.status !== "ready" || !entry || entry.status !== "ready") return null;
  const etag = entry.source === "host" ? entry.coverEtag : null;
  if (etag) {
    if (typeof input.cover === "string" && input.cover) return { kind: "cover", hostId, etag, dataUrl: input.cover, exact: true };
    if (input.cover !== false) return null;
  }
  if (!input.artReady) return null;
  return input.artProvider ? { kind: "art", provider: input.artProvider } : { kind: "scene" };
}

/** The same background (a cover by host + etag, an art by provider). */
export function sameBackdrop(a: DeskBackdrop | null, b: DeskBackdrop | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "cover" && b.kind === "cover") return a.hostId === b.hostId && a.etag === b.etag;
  if (a.kind === "art" && b.kind === "art") return a.provider === b.provider;
  return a.kind === b.kind;
}

/** What to draw now: the known background, else the remembered one, else the neutral sky scene. */
export function shownBackdrop(known: DeskBackdrop | null, cached: DeskBackdrop | null): DeskBackdrop {
  return known ?? cached ?? { kind: "scene" };
}

/** A stable identity per drawn background (the cross-fade runs when it changes). */
export function backdropId(b: DeskBackdrop): string {
  if (b.kind === "cover") return `cover|${b.hostId}|${b.etag}|${b.dataUrl ? "img" : "none"}`;
  if (b.kind === "art") return `art|${b.provider}`;
  return "scene";
}

// ── The remembered background (this device) ─────────────────────────────────────────────────────

export const BACKDROP_CACHE_KEY = "cutex-desktop.deskBackdrop";
/** Longest cover data URL kept (characters ≈ bytes): localStorage is small and shared with everything else. */
export const COVER_CACHE_MAX = 900_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Parses a remembered background (anything malformed: none). Pure. */
export function parseBackdrop(raw: string | null): DeskBackdrop | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v.kind === "scene") return { kind: "scene" };
    if (v.kind === "art" && typeof v.provider === "string" && (PORTRAIT_ORDER as readonly string[]).includes(v.provider)) return { kind: "art", provider: v.provider as PortraitProvider };
    if (v.kind === "cover" && typeof v.hostId === "string" && typeof v.etag === "string" && v.hostId && v.etag) {
      const dataUrl = typeof v.dataUrl === "string" && v.dataUrl.startsWith("data:image/") ? v.dataUrl : null;
      return { kind: "cover", hostId: v.hostId, etag: v.etag, dataUrl, ...(dataUrl && v.exact === true ? { exact: true } : {}) };
    }
  } catch {
    // not ours / corrupt: none
  }
  return null;
}

let cached: DeskBackdrop | null | undefined;

/** The remembered background (read once per window, then kept in memory). */
export function cachedBackdrop(): DeskBackdrop | null {
  if (cached === undefined) cached = parseBackdrop(storage()?.getItem(BACKDROP_CACHE_KEY) ?? null);
  return cached;
}

/** A remembered cover that is the host's image as it is, for `hostId` + `etag` (stands in for reading it). */
export function cachedCoverFor(hostId: string, etag: string): string | null {
  const c = cachedBackdrop();
  return c?.kind === "cover" && c.exact && c.hostId === hostId && c.etag === etag ? c.dataUrl : null;
}

function write(b: DeskBackdrop): void {
  cached = b;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(BACKDROP_CACHE_KEY, JSON.stringify(b));
  } catch {
    // quota: keep it without the image, else not at all
    try {
      if (b.kind === "cover" && b.dataUrl) s.setItem(BACKDROP_CACHE_KEY, JSON.stringify({ ...b, dataUrl: null, exact: false }));
    } catch {
      // nothing remembered: the next start shows the sky scene first
    }
  }
}

/** Scales a cover down to fit COVER_CACHE_MAX (JPEG); null when that is not possible here. */
export type CoverShrinker = (dataUrl: string, maxChars: number) => Promise<string | null>;

/** The browser's way: draw it smaller on a canvas, lower the quality until it fits. */
export const canvasShrink: CoverShrinker = async (dataUrl, maxChars) => {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    return null;
  }
  for (const [edge, quality] of [
    [1920, 0.82],
    [1600, 0.75],
    [1280, 0.7],
    [960, 0.65],
  ] as const) {
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", quality);
    if (out.startsWith("data:image/jpeg") && out.length <= maxChars) return out;
  }
  return null;
};

let pending: string | null = null;

/**
 * Remembers a newly known background (nothing when it is the remembered one). A cover too big to keep is
 * scaled down first (async); when that fails it is remembered without its image (the next start then shows
 * the sky scene, never an unrelated portrait, until the cover is read).
 */
export async function rememberBackdrop(b: DeskBackdrop, shrink: CoverShrinker = canvasShrink): Promise<void> {
  const before = cachedBackdrop();
  if (sameBackdrop(before, b) && (b.kind !== "cover" || !b.dataUrl || before?.kind !== "cover" || before.dataUrl)) return;
  if (b.kind !== "cover" || !b.dataUrl || b.dataUrl.length <= COVER_CACHE_MAX) return write(b);
  const id = backdropId(b);
  if (pending === id) return;
  pending = id;
  try {
    const small = await shrink(b.dataUrl, COVER_CACHE_MAX).catch(() => null);
    write({ kind: "cover", hostId: b.hostId, etag: b.etag, dataUrl: small && small.length <= COVER_CACHE_MAX ? small : null, exact: false });
  } finally {
    pending = null;
  }
}

/** Tests: forget the in-memory copy (the next read goes to localStorage again). */
export function resetBackdropCacheForTests(): void {
  cached = undefined;
  pending = null;
}
