// 成果 for the quick switcher: fetched once when the palette opens (never per keystroke), one
// `GET /v2/artifact-store?project=…` per project of each host with `artifacts`, kept in memory for a
// minute so reopening the palette is instant. Errors leave that project out.
import type { ArtifactList, ArtifactListQuery } from "../../../../shared/artifactStore";
import type { ArtifactSource } from "./items";

export interface ProjectRef {
  hostId: string;
  projectId: string;
  name: string;
}

export const ARTIFACT_TTL_MS = 60_000;
/** Newest artifacts per project. */
export const ARTIFACTS_PER_PROJECT = 30;
/** Projects per host asked (sidebar order). */
export const PROJECTS_PER_HOST = 24;

type Fetch = (hostId: string, query: ArtifactListQuery) => Promise<ArtifactList | null>;

const cache = new Map<string, { at: number; source: ArtifactSource | null; pending?: Promise<ArtifactSource | null> }>();
const keyOf = (p: ProjectRef) => `${p.hostId}\n${p.projectId}`;

/** Cached lists (fresh or not) for these projects — what to show before the fetch answers. */
export function cachedArtifacts(projects: readonly ProjectRef[]): ArtifactSource[] {
  return projects.map((p) => cache.get(keyOf(p))?.source).filter((s): s is ArtifactSource => !!s);
}

/** Fetches the lists not fetched in the last minute (one call per project in flight at most). */
export async function loadArtifacts(projects: readonly ProjectRef[], fetch: Fetch, now = Date.now()): Promise<ArtifactSource[]> {
  const perHost = new Map<string, number>();
  const wanted = projects.filter((p) => {
    const n = perHost.get(p.hostId) ?? 0;
    perHost.set(p.hostId, n + 1);
    return n < PROJECTS_PER_HOST;
  });
  const results = await Promise.all(
    wanted.map((p) => {
      const key = keyOf(p);
      const hit = cache.get(key);
      if (hit?.pending) return hit.pending;
      if (hit && now - hit.at < ARTIFACT_TTL_MS) return Promise.resolve(hit.source);
      const pending = fetch(p.hostId, { project: p.projectId, archived: "false", limit: ARTIFACTS_PER_PROJECT })
        .then(
          (list) => (list ? { hostId: p.hostId, project: p.name, items: list.items } : null),
          () => null,
        )
        .then((source) => {
          cache.set(key, { at: Date.now(), source });
          return source;
        });
      cache.set(key, { at: hit?.at ?? 0, source: hit?.source ?? null, pending });
      return pending;
    }),
  );
  return results.filter((s): s is ArtifactSource => !!s);
}

/** Tests. */
export function resetArtifactCache(): void {
  cache.clear();
}
