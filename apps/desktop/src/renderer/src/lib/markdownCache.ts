// Cross-mount cache for completed markdown (perf survey 2026-10-12 发现 1 / 1a). Switching back to
// a session remounts its timeline, and streamdown re-parses every message (markdown → mdast → hast)
// on mount. For static (completed) messages the hast depends only on the text and the fixed plugin
// list of components/Markdown.tsx, so it is kept here, keyed by the exact text, and a remount only
// rebuilds the React elements from it (links / chips / thumbnails still run their hooks per mount).
// Shiki tokens need no cache of ours: @streamdown/code already keeps completed blocks' tokens in a
// module-level LRU (keyed by code + language + themes), so a remount highlights synchronously.

/** Least-recently-used map bounded by entry count and by a total weight (e.g. source chars). */
export class WeightedLru<K, V> {
  private readonly map = new Map<K, { value: V; weight: number }>();
  private total = 0;

  constructor(
    readonly maxEntries: number,
    readonly maxWeight: number,
    /** Values heavier than this are never kept (one huge message would flush everything else). */
    readonly maxEntryWeight = maxWeight,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get weight(): number {
    return this.total;
  }

  /** The value (and marks it most recently used), or undefined. */
  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V, weight: number): void {
    this.delete(key);
    if (weight > this.maxEntryWeight || weight > this.maxWeight || this.maxEntries <= 0) return;
    this.map.set(key, { value, weight });
    this.total += weight;
    while (this.map.size > this.maxEntries || this.total > this.maxWeight) this.delete(this.map.keys().next().value as K);
  }

  delete(key: K): void {
    const hit = this.map.get(key);
    if (!hit) return;
    this.map.delete(key);
    this.total -= hit.weight;
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}

/** Completed messages kept: ~200, at most ~2M source chars in all, none above 256K chars. */
export const HAST_CACHE_MAX_ENTRIES = 200;
export const HAST_CACHE_MAX_CHARS = 2_000_000;
export const HAST_CACHE_MAX_ENTRY_CHARS = 256_000;

/** Structural unist root: no runtime dependency on unified / hast types. */
interface TreeRoot {
  type: string;
  children?: unknown[];
}
// `file` is a VFile, only passed through.
type Parser = (doc: string, file: never) => TreeRoot;
interface ProcessorLike {
  parser?: Parser;
}
interface FileLike {
  value?: unknown;
}

/**
 * A unified plugin (put it LAST in a rehype plugin list) that caches the final hast per source text.
 * Its attacher wraps the processor's parser: a cached text parses to an empty root (so the remark /
 * rehype transforms run on nothing), and this plugin's transformer swaps the cached tree back in.
 * A miss runs the normal pipeline and keeps the result. streamdown calls `parse` then `runSync` back
 * to back for one text, so the hand-off holds at most one pending tree.
 *
 * The cache is keyed by text only: use one plugin instance with ONE plugin configuration, and only
 * for text that no longer changes (cache by exact text keeps a streaming prefix harmless, but it
 * would evict useful entries). The cached tree must be treated as read-only: hast-util-to-jsx-runtime
 * does not mutate it, and nothing may run after this plugin.
 */
export function createHastCachePlugin(cache: WeightedLru<string, TreeRoot> = new WeightedLru(HAST_CACHE_MAX_ENTRIES, HAST_CACHE_MAX_CHARS, HAST_CACHE_MAX_ENTRY_CHARS)) {
  let pending: { text: string; tree: TreeRoot } | null = null;
  // Named: streamdown keys its processor cache by plugin function names.
  return function cutexHastCache(this: ProcessorLike) {
    const parse = this.parser;
    if (parse) {
      this.parser = (doc, file) => {
        const hit = cache.get(doc);
        if (!hit) {
          pending = null;
          return parse(doc, file);
        }
        pending = { text: doc, tree: hit };
        return { type: "root", children: [] };
      };
    }
    return (tree: TreeRoot, file: FileLike): TreeRoot | undefined => {
      const text = String(file.value ?? "");
      const hit = pending;
      pending = null;
      if (hit && hit.text === text) return hit.tree;
      if (parse) cache.set(text, tree, text.length);
      return undefined;
    };
  };
}
