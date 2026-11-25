// Which developer-folder build is actually running, per module id (Settings → 模块's tags, modules/moduleTags.ts).
// Main's view (useModuleDevView) names each folder's newest compiled build; that is not always the one running: a
// build that fails to activate leaves the previous one in place, and a folder whose id another module holds does not
// load at all. The renderer's loader (devModules.ts createDevModuleLoader → startDevModules) records what it put in the
// module host here, and Settings reads that.
import { useSyncExternalStore } from "react";
import type { ModuleDevView } from "../../../shared/moduleDev";

export interface DevRunning {
  folder: string;
  rev: number;
  version: string | null;
  host: Readonly<Record<string, readonly string[]>>;
  /** The definition the loader registered: the claim holds only while the host's definition under the id is this one. */
  module?: unknown;
}

interface Snapshot {
  /** A loader runs in this renderer: `byId` is its record. False: no loader (no dev bridge, tests); see devBuildsRunning. */
  started: boolean;
  byId: ReadonlyMap<string, DevRunning>;
}

let snapshot: Snapshot = { started: false, byId: new Map() };
const listeners = new Set<() => void>();
const emit = (next: Snapshot) => {
  snapshot = next;
  for (const l of listeners) l();
};

/** startDevModules: from now on the loader's record is the truth. */
export function markDevLoaderStarted(): void {
  if (!snapshot.started) emit({ ...snapshot, started: true });
}

/** The loader registered `run` under `id` (null: nothing from a folder runs under `id` any more). */
export function setDevRunning(id: string, run: DevRunning | null): void {
  const byId = new Map(snapshot.byId);
  if (run) byId.set(id, run);
  else if (!byId.delete(id)) return;
  emit({ ...snapshot, byId });
}

export function useDevRunning(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

// Without a loader, main's view is all there is: a build main reports without an error has run; a later build with
// an error has not, so the last clean one is kept (the loader's own fallback).
const lastClean = new Map<string, DevRunning & { id: string }>();

/**
 * id → the developer-folder build running under it: the loader's record, checked against the host's registry
 * (`registered`: the definitions there now; a record whose definition is no longer the one under its id is stale), or
 * (no loader) the view's last clean build.
 */
export function devBuildsRunning(view: ModuleDevView | null, run: Snapshot, registered?: readonly { id: string }[]): ReadonlyMap<string, DevRunning> {
  if (run.started) {
    if (!registered) return run.byId;
    return new Map([...run.byId].filter(([id, rec]) => rec.module === undefined || registered.find((d) => d.id === id) === rec.module));
  }
  const out = new Map<string, DevRunning>();
  for (const m of view?.modules ?? []) {
    if (!m.id || !m.entry) continue;
    if (!m.error) lastClean.set(m.folder, { id: m.id, folder: m.folder, rev: m.rev, version: m.version, host: m.host });
    const clean = lastClean.get(m.folder);
    if (clean && clean.id === m.id) out.set(m.id, clean);
  }
  return out;
}
