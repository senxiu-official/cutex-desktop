// Read-only prospective first-seen assignments. All Avatar instances share one
// planner result per source snapshot; rendering does not write or start saving.
import { useCallback, useSyncExternalStore } from "react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { useApp } from "../store";
import { subscribeAvatarStyles } from "./avatarStyle";
import { getUiPrefs, subscribeUiPrefs } from "./prefs";
import { portraitIndexNow, subscribePortraitPacks } from "./portraitPacks";
import { subscribeProfileLooks } from "./profileLooks";
import { planStyleSaves, saveCandidatesNow, saveKey, styleSaveDoneSnapshot, subscribeStyleSaveChanges, YOUNG_MS } from "./portraitSave";

type PreviewCache = { inputs: readonly unknown[]; avatars: ReadonlyMap<string, SessionAvatar>; expires: number };
let cache: PreviewCache | null = null;
let sourceVersion = 0;
const listeners = new Set<() => void>();
let stops: (() => void)[] | null = null;
let ageTimer: ReturnType<typeof setTimeout> | null = null;

function inputs(): readonly unknown[] {
  const state = useApp.getState();
  const done = styleSaveDoneSnapshot();
  return [state.sidebar, state.byHost, state.hosts, state.features, state.pinned,
    getUiPrefs(), portraitIndexNow(), done, done.size, sourceVersion];
}
const sameInputs = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((item, index) => item === b[index]);

function current(): PreviewCache {
  const next = inputs(), now = Date.now();
  if (cache && sameInputs(cache.inputs, next) && now < cache.expires) return cache;
  const done = styleSaveDoneSnapshot();
  const agents = saveCandidatesNow();
  const plan = planStyleSaves(portraitIndexNow(), agents, done, undefined, now);
  const avatars = new Map(plan.map(save => [save.seed, save.avatar]));
  let expires = Infinity;
  for (const agent of agents) {
    if (agent.avatar || !agent.active || agent.minor || !agent.writable || !agent.family || done.has(saveKey(agent)) || agent.createdAt === null) continue;
    const eligibleAt = agent.createdAt + YOUNG_MS;
    if (eligibleAt > now) expires = Math.min(expires, eligibleAt);
  }
  return cache = { inputs: next, avatars, expires };
}

function armAgeTimer(): void {
  if (ageTimer) clearTimeout(ageTimer);
  ageTimer = null;
  if (!listeners.size) return;
  const expires = current().expires;
  if (Number.isFinite(expires)) ageTimer = setTimeout(invalidate, Math.min(2_147_483_647, Math.max(1, expires - Date.now())));
}

function invalidate(): void {
  sourceVersion += 1; cache = null;
  for (const listener of listeners) listener();
  armAgeTimer();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stops) {
    stops = [
      useApp.subscribe(() => { if (cache && !sameInputs(cache.inputs, inputs())) invalidate(); }),
      subscribeUiPrefs(invalidate), subscribePortraitPacks(invalidate),
      subscribeProfileLooks(invalidate), subscribeAvatarStyles(invalidate), subscribeStyleSaveChanges(invalidate),
    ];
    // Recheck after subscribing: source changes during the first render must
    // not leave a stale cached assignment until the next unrelated event.
    invalidate();
  } else armAgeTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    for (const stop of stops ?? []) stop();
    stops = null;
    if (ageTimer) clearTimeout(ageTimer);
    ageTimer = null; cache = null;
  };
}

/** Null means the first-seen planner will not save this agent now. Keep the
 * regular fallback (especially for a young agent whose creator owns its write). */
export function useStyleAssignmentPreview(seed: string | null | undefined): SessionAvatar | null {
  const snapshot = useCallback(() => seed ? current().avatars.get(seed) ?? null : null, [seed]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
