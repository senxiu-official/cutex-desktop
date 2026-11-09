// The size a host-path image had when it last loaded here, for a message image cutex gives no size for, so
// its box is reserved before the bytes after a reload too (the owner's wish: box first, image loads inside).
// cutex sizes only the session's own stored attachments; a file picked on the local host, a forked agent's copy
// of its parent's attachment and older hosts come without one. This device only, and only a cache: a size from
// cutex wins, a changed file corrects it on its next load, and the oldest entries go first.

const KEY = "cutex-desktop.imageSizes";
const MAX_ENTRIES = 2000;
const MAX_PATH = 1024;

type Size = { width: number; height: number };
let sizes: Map<string, [number, number]> | null = null;

const entryKey = (hostId: string, path: string) => `${hostId}\n${path}`;
const pixel = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

function load(): Map<string, [number, number]> {
  if (sizes) return sizes;
  sizes = new Map();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(stored)) for (const row of stored as unknown[]) {
      if (Array.isArray(row) && typeof row[0] === "string" && pixel(row[1]) && pixel(row[2])) sizes.set(row[0], [row[1], row[2]]);
    }
  } catch {
    // Nothing remembered yet: these images lay out from their bytes.
  }
  return sizes;
}

export function rememberedImageSize(hostId: string, path: string): Size | undefined {
  const size = load().get(entryKey(hostId, path));
  return size && { width: size[0], height: size[1] };
}

/** Called when the image loaded. True when an earlier remembered size turned out wrong (the box should follow). */
export function rememberImageSize(hostId: string, path: string, width: number, height: number): boolean {
  if (!pixel(width) || !pixel(height) || path.length > MAX_PATH) return false;
  const all = load();
  const key = entryKey(hostId, path);
  const known = all.get(key);
  if (known?.[0] === width && known[1] === height) return false;
  all.delete(key);
  all.set(key, [width, height]);
  for (const oldest of all.keys()) {
    if (all.size <= MAX_ENTRIES) break;
    all.delete(oldest);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([...all].map(([k, [w, h]]) => [k, w, h])));
  } catch {
    // Storage full: still remembered until this window reloads.
  }
  return !!known;
}

/** Tests: forget what this module loaded. */
export function resetImageSizes(): void {
  sizes = null;
}
