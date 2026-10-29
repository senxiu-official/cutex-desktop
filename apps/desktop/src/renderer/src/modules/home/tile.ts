// Service template tiles (cutex `service-tiles`, docs/SERVICES.md "Tiles"; home-page-20261019.md §2):
// what a tile of each size shows, and where its actions go. The template is read-only JSON main fetched;
// it is checked again here (readServiceTile): text only, paths inside the service only — an action
// opens `cutex:service/<slug><path>` in the in-app browser, never a URL of the template's choosing and
// never an API call. Pure; test/homeTile.test.ts.
import { readServiceTile, tilePath, type HomeTileSize, type ServiceTile } from "../../../../shared/home";

/** A tile action's target: the service path as an in-app browser link (null: not a service-internal path). */
export function tileActionLink(slug: string, path: unknown): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  const p = tilePath(path);
  return p ? `cutex:service/${slug}${p}` : null;
}

export interface TileParts {
  title: string | null;
  subtitle: string | null;
  lines: string[];
  /** The template has an image (fetched by main through `/tile/image`). */
  image: boolean;
  progress: { value: number; label: string | null } | null;
  badge: string | null;
  actions: { label: string; link: string }[];
}

/**
 * The parts a tile of `size` draws (s: icon + name only; m: + title / one line; w: + image or progress,
 * up to three lines; l: + up to three actions). null: nothing beyond the icon tile.
 */
export function tileParts(raw: unknown, size: HomeTileSize, slug: string): TileParts | null {
  const tile: ServiceTile | null = readServiceTile(raw);
  if (!tile || size === "s") return null;
  const wide = size === "w" || size === "l";
  const lines = [...(tile.lines ?? [])].slice(0, wide ? 3 : 1);
  return {
    title: tile.title ?? null,
    subtitle: tile.subtitle ?? null,
    lines: size === "m" && tile.subtitle ? [] : lines,
    image: wide && !!tile.image,
    progress: wide && tile.progress ? { value: tile.progress.value, label: tile.progress.label ?? null } : null,
    badge: tile.badge ?? null,
    actions:
      size === "l"
        ? (tile.actions ?? []).flatMap((a) => {
            const link = tileActionLink(slug, a.path);
            return link ? [{ label: a.label, link }] : [];
          })
        : [],
  };
}

/** How long a fetched tile stays fresh (the template's refreshSeconds, 60 s – 1 day; default 5 min). */
export function tileRefreshMs(raw: unknown): number {
  const tile = readServiceTile(raw);
  return (tile?.refreshSeconds ?? 300) * 1000;
}

/** An icon tile's colour (services, by their slug): one of a few gradients, stable per key. */
const GRADIENTS = [
  "linear-gradient(140deg,#f97316,#db2777)",
  "linear-gradient(140deg,#0ea5e9,#6366f1)",
  "linear-gradient(140deg,#10b981,#0f766e)",
  "linear-gradient(140deg,#8b5cf6,#4f46e5)",
  "linear-gradient(140deg,#facc15,#f97316)",
  "linear-gradient(140deg,#14b8a6,#2563eb)",
];
export const gradientOf = (key: string) => GRADIENTS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % GRADIENTS.length]!;
