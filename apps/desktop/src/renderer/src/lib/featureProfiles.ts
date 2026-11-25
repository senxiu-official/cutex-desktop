// 功能 Profile (shared/featureProfiles.ts) in the renderer: one list per host, its own cache. Never merged into the
// ordinary Profile cache / pickers (lib/profileSnapshot): agent create, fork, switch, routing and auto-pick do not
// see these rows (feature-profiles-desktop.md). Read by Settings → 功能 Profile and 提示词增强's picker.
import { useEffect, useSyncExternalStore } from "react";
import type { FeatureProfile } from "../../../shared/featureProfiles";
import { apiFor } from "../bridge";

export interface FeatureProfileList {
  /** null while the first read runs (or after it failed). */
  list: FeatureProfile[] | null;
  /** IDs of records the host could not read: Settings shows them (delete only); never offered for rewrite. */
  damaged: string[];
  error: string | null;
}

const EMPTY: FeatureProfileList = { list: null, damaged: [], error: null };
const lists = new Map<string, FeatureProfileList>();
const reads = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (hostId: string, next: FeatureProfileList) => { lists.set(hostId, next); emit(); };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Read the host's list again (a later read wins over an earlier one still running). */
export async function loadFeatureProfiles(hostId: string): Promise<void> {
  const mine = (reads.get(hostId) ?? 0) + 1;
  reads.set(hostId, mine);
  try {
    const { profiles, damaged } = await apiFor(hostId).featureProfiles();
    if (reads.get(hostId) === mine) set(hostId, { list: profiles, damaged, error: null });
  } catch (e) {
    const cur = lists.get(hostId);
    if (reads.get(hostId) === mine) set(hostId, { list: cur?.list ?? null, damaged: cur?.damaged ?? [], error: errorText(e) });
  }
}

/** A row the host returned after a create / edit (sorted in by the list's order: appended when new). */
export function putFeatureProfile(hostId: string, profile: FeatureProfile): void {
  const cur = lists.get(hostId)?.list ?? [];
  reads.set(hostId, (reads.get(hostId) ?? 0) + 1);
  set(hostId, { list: cur.some((p) => p.id === profile.id) ? cur.map((p) => (p.id === profile.id ? profile : p)) : [...cur, profile], damaged: lists.get(hostId)?.damaged ?? [], error: null });
}

export function dropFeatureProfile(hostId: string, id: string): void {
  const cur = lists.get(hostId);
  if (!cur?.list) return;
  reads.set(hostId, (reads.get(hostId) ?? 0) + 1);
  set(hostId, { list: cur.list.filter((p) => p.id !== id), damaged: cur.damaged.filter((d) => d !== id), error: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The host's 功能 Profiles; read on first use (and per host). `enabled` false (no capability): nothing is read. */
export function useFeatureProfiles(hostId: string, enabled = true): FeatureProfileList & { reload(): void } {
  const value = useSyncExternalStore(subscribe, () => (enabled ? (lists.get(hostId) ?? EMPTY) : EMPTY));
  useEffect(() => {
    if (enabled) void loadFeatureProfiles(hostId);
  }, [hostId, enabled]);
  return { ...value, reload: () => void loadFeatureProfiles(hostId) };
}

/** Tests: forget every host's list. */
export function resetFeatureProfilesForTests(): void {
  lists.clear();
  reads.clear();
  emit();
}
