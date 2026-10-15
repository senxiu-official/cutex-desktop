// 成果 caches per host (memory only): resolved refs (batched `POST /v2/artifact-store/resolve` for
// link chips), artifact details, immutable version contents / diffs. `cutex/artifact/published` and
// `cutex/artifact/updated` invalidate what they touch (startArtifactSync), so open lists, tabs and
// chips refresh live.
import { useEffect } from "react";
import { create } from "zustand";
import { ARTIFACT_PUBLISHED_EVENT, ARTIFACT_RESOLVE_MAX, ARTIFACT_UPDATED_EVENT, type ArtifactContent, type ArtifactDetail, type ArtifactDiff, type ArtifactResolveItem } from "../../../../shared/artifactStore";
import { bridge } from "../../bridge";
import { services } from "../app";
import type { AppModuleContext } from "../slots";

interface CacheState {
  /** `${hostId}|${ref}` */
  resolved: Record<string, ArtifactResolveItem>;
  /** `${hostId}|${artifactId}`: null = not found. */
  details: Record<string, ArtifactDetail | null>;
  /** `${hostId}|${artifactId}`: the last load failed (no automatic retry until invalidated). */
  errors: Record<string, string>;
  /** Per host: bumped on every artifact event (lists reload). */
  epoch: Record<string, number>;
}

export const useArtifactCache = create<CacheState>(() => ({ resolved: {}, details: {}, errors: {}, epoch: {} }));

const k = (hostId: string, id: string) => `${hostId}|${id}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── resolve (link chips, thumbnails) ──────────────────────────────────────────────────────────────

const queued = new Map<string, Set<string>>();
const inflight = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function storeResolved(hostId: string, items: readonly ArtifactResolveItem[]) {
  if (!items.length) return;
  useArtifactCache.setState((s) => ({ resolved: { ...s.resolved, ...Object.fromEntries(items.map((i) => [k(hostId, i.ref), i])) } }));
}

async function flush() {
  timer = null;
  const batches = [...queued.entries()];
  queued.clear();
  for (const [hostId, set] of batches) {
    const refs = [...set];
    for (let i = 0; i < refs.length; i += ARTIFACT_RESOLVE_MAX) {
      const chunk = refs.slice(i, i + ARTIFACT_RESOLVE_MAX);
      void services
        .daemonFor(hostId)
        .artifactStoreResolve(chunk)
        .then((items) => storeResolved(hostId, items ?? []))
        .catch(() => undefined)
        .finally(() => chunk.forEach((ref) => inflight.delete(k(hostId, ref))));
    }
  }
}

/** Queue a ref for the next batched resolve (≈ 30 ms). */
export function requestResolve(hostId: string, ref: string): void {
  const key = k(hostId, ref);
  if (inflight.has(key) || useArtifactCache.getState().resolved[key]) return;
  inflight.add(key);
  const set = queued.get(hostId) ?? new Set<string>();
  set.add(ref);
  queued.set(hostId, set);
  timer ??= setTimeout(() => void flush(), 30);
}

/** The resolved ref (undefined while unknown); asks cutex once per invalidation. */
export function useResolved(hostId: string, ref: string | null): ArtifactResolveItem | undefined {
  const key = ref ? k(hostId, ref) : "";
  const item = useArtifactCache((s) => (key ? s.resolved[key] : undefined));
  useEffect(() => {
    if (ref && !item) requestResolve(hostId, ref);
  }, [hostId, ref, item]);
  return item;
}

/** One ref now (thumbnails): the cache, else a direct resolve. */
export async function resolveNow(hostId: string, ref: string): Promise<ArtifactResolveItem | null> {
  const hit = useArtifactCache.getState().resolved[k(hostId, ref)];
  if (hit) return hit;
  const items = await services.daemonFor(hostId).artifactStoreResolve([ref]);
  storeResolved(hostId, items ?? []);
  return items?.find((i) => i.ref === ref) ?? null;
}

// ── details ──────────────────────────────────────────────────────────────────────────────────────

const detailInflight = new Set<string>();

export async function loadDetail(hostId: string, artifactId: string): Promise<ArtifactDetail | null> {
  const key = k(hostId, artifactId);
  if (detailInflight.has(key)) return useArtifactCache.getState().details[key] ?? null;
  detailInflight.add(key);
  try {
    const detail = await services.daemonFor(hostId).artifactStoreGet(artifactId);
    useArtifactCache.setState((s) => {
      const errors = { ...s.errors };
      delete errors[key];
      return { details: { ...s.details, [key]: detail }, errors };
    });
    return detail;
  } catch (e) {
    useArtifactCache.setState((s) => ({ errors: { ...s.errors, [key]: errorText(e) } }));
    return null;
  } finally {
    detailInflight.delete(key);
  }
}

/** Summary + versions (undefined while loading, null = not found) and the load error, if any. */
export function useDetail(hostId: string | null, artifactId: string | null): { detail: ArtifactDetail | null | undefined; error: string | null } {
  const key = hostId && artifactId ? k(hostId, artifactId) : "";
  const detail = useArtifactCache((s) => (key ? s.details[key] : undefined));
  const error = useArtifactCache((s) => (key ? (s.errors[key] ?? null) : null));
  useEffect(() => {
    if (hostId && artifactId && detail === undefined && !error) void loadDetail(hostId, artifactId);
  }, [hostId, artifactId, detail, error]);
  return { detail, error };
}

/** Cached detail only (tab titles: cheap, never fetches). */
export function useCachedDetail(hostId: string | null, artifactId: string | null): ArtifactDetail | null | undefined {
  return useArtifactCache((s) => (hostId && artifactId ? s.details[k(hostId, artifactId)] : undefined));
}

export function useEpoch(hostId: string | null): number {
  return useArtifactCache((s) => (hostId ? (s.epoch[hostId] ?? 0) : 0));
}

// ── immutable version contents / diffs (bounded) ─────────────────────────────────────────────────

const MAX_ENTRIES = 40;
const contents = new Map<string, Promise<ArtifactContent | null>>();
const diffs = new Map<string, Promise<ArtifactDiff | null>>();

function bounded<V>(map: Map<string, V>, key: string, make: () => V): V {
  const hit = map.get(key);
  if (hit !== undefined) {
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const value = make();
  map.set(key, value);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
  return value;
}

/** A pinned version's content (versions never change, so it is cached; a failure is not). */
export function loadContent(hostId: string, artifactId: string, version: number, maxBytes: number): Promise<ArtifactContent | null> {
  const key = `${hostId}|${artifactId}@${version}|${maxBytes}`;
  const p = bounded(contents, key, () => services.daemonFor(hostId).artifactStoreContent(artifactId, version, { maxBytes }));
  p.catch(() => contents.delete(key));
  return p;
}

export function loadDiff(hostId: string, artifactId: string, from: number, to: number): Promise<ArtifactDiff | null> {
  const key = `${hostId}|${artifactId}|${from}|${to}`;
  const p = bounded(diffs, key, () => services.daemonFor(hostId).artifactStoreDiff(artifactId, from, to));
  p.catch(() => diffs.delete(key));
  return p;
}

// ── invalidation ─────────────────────────────────────────────────────────────────────────────────

/**
 * Something about this artifact changed: drop its resolved refs, reload a cached detail in place
 * (the open tab keeps showing the old one until the new one arrives); lists reload (epoch).
 */
export function invalidateArtifact(hostId: string, artifactId: string | null): void {
  const prefix = `${hostId}|${artifactId ?? ""}`;
  const hit = (key: string) => (artifactId ? key === prefix || key.startsWith(`${prefix}@`) : key.startsWith(prefix));
  const drop = <V>(rec: Record<string, V>) => Object.fromEntries(Object.entries(rec).filter(([key]) => !hit(key)));
  // A deleted artifact's cached contents go too (a later artifact never reuses the id).
  if (artifactId) for (const key of [...contents.keys()]) if (key.startsWith(`${prefix}@`)) contents.delete(key);
  const stale = Object.keys(useArtifactCache.getState().details).filter(hit);
  useArtifactCache.setState((s) => ({ resolved: drop(s.resolved), errors: drop(s.errors), epoch: { ...s.epoch, [hostId]: (s.epoch[hostId] ?? 0) + 1 } }));
  for (const key of stale) void loadDetail(hostId, key.slice(hostId.length + 1));
}

/** Module activation: follow `cutex/artifact/*` on every connected host until the module stops. */
export function startArtifactSync(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    const method = envelope.cutex?.method;
    if (method !== ARTIFACT_PUBLISHED_EVENT && method !== ARTIFACT_UPDATED_EVENT) return;
    const params = envelope.cutex?.params as { artifactId?: unknown } | undefined;
    invalidateArtifact(hostId, typeof params?.artifactId === "string" ? params.artifactId : null);
  });
  ctx.signal.addEventListener("abort", () => off?.());
}
