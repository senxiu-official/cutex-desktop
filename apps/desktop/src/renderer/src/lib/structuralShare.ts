// Structural sharing for derived view data (perf §9): `share(prev, next)` returns `next` with every part that
// equals the matching part of `prev` replaced by `prev`'s object — `prev` itself when nothing changed. Plain
// objects and arrays are compared member by member down to `depth`; anything else (class instances, Maps,
// functions, objects below the depth) by identity. Memoised children given the shared parts skip their render.

const plain = (v: unknown): v is Record<string, unknown> | unknown[] =>
  v !== null && typeof v === "object" && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export function share<T>(prev: unknown, next: T, depth = 8): T {
  if (Object.is(prev, next) || depth <= 0 || !plain(prev) || !plain(next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let same = prev.length === next.length;
    const out = next.map((v, i) => {
      const s = share(prev[i], v, depth - 1);
      if (!Object.is(s, prev[i])) same = false;
      return s;
    });
    return (same ? prev : out) as T;
  }
  if (Array.isArray(prev)) return next;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const s = share(p[k], n[k], depth - 1);
    if (!Object.is(s, p[k]) || !(k in p)) same = false;
    out[k] = s;
  }
  return (same ? prev : out) as T;
}
