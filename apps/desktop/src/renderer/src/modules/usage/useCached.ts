// Last answers per host + query, so reopening 用量 shows the previous numbers at once and only
// refreshes them in the background (stale-while-revalidate). In memory only; a few dozen entries.
import { useEffect, useState } from "react";

const cache = new Map<string, unknown>();
const LIMIT = 40;

function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
}

/**
 * `data` is the cached value for `key` (undefined until the first answer); `load` runs whenever
 * `key` or `nonce` changes (bump `nonce` to refetch the same query, e.g. after saving prices).
 */
export function useCached<T>(key: string, load: () => Promise<T>, nonce = 0): { data: T | undefined; error: string | null } {
  const [state, setState] = useState<{ key: string; data: T | undefined; error: string | null }>(() => ({ key, data: cache.get(key) as T | undefined, error: null }));
  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        remember(key, data);
        if (live) setState({ key, data, error: null });
      },
      (e: unknown) => {
        if (live) setState({ key, data: cache.get(key) as T | undefined, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
    // `load` is a fresh closure every render; the query is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return state.key === key ? state : { data: cache.get(key) as T | undefined, error: null };
}
