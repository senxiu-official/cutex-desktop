export interface MentionResults {
  query: string;
  paths: readonly string[];
}

const NO_PATHS: readonly string[] = [];

/** A previous query's results must not become selectable before the new effect runs. */
export function mentionPathsFor(results: MentionResults | null, query: string | null): readonly string[] {
  return query !== null && results?.query === query ? results.paths : NO_PATHS;
}

/** Cleanup fences in-flight replies as well as the debounce, including a repeated query (A/B/A). */
export function startMentionSearch(query: string, search: (query: string) => Promise<readonly string[]>, publish: (result: MentionResults) => void): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    void Promise.resolve().then(() => cancelled ? NO_PATHS : search(query)).then(
      (paths) => { if (!cancelled) publish({ query, paths }); },
      () => { if (!cancelled) publish({ query, paths: NO_PATHS }); },
    );
  }, 120);
  return () => { cancelled = true; clearTimeout(timer); };
}

/** The list can shrink between renders; the same valid index drives highlighting and picking. */
export function candidateIndex(selected: number, count: number): number | null {
  return count > 0 ? Math.max(0, Math.min(selected, count - 1)) : null;
}

export function composerCandidateKey(event: { key: string; shift: boolean; isComposing: boolean }, count: number, selected: number): "composing" | { index: number } | null {
  // IME confirmation is never a candidate pick or a send, even while a popup changes.
  if (event.isComposing) return "composing";
  if (!((event.key === "Enter" && !event.shift) || event.key === "Tab")) return null;
  const index = candidateIndex(selected, count);
  return index === null ? null : { index };
}
