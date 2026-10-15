// cutex's API-key provider presets (`GET /v2/profile-presets`) for the profile pages (添加 form, editor,
// cards): read once per host and shared, kept per host (Settings may show another host than the focus
// one). Until then — and for a host without the route (older cutex) or when the read fails — the
// built-in copy of cutex's list (lib/profilePresets FALLBACK_PRESETS).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ProfilePreset } from "../../../shared/ipc";
import { onHostReset } from "./hostSwitch";
import { FALLBACK_PRESETS, presetsOf } from "./profilePresets";
import { daemonApiOf, useFocusHostId, useTargetHostId } from "./targetHost";

interface Entry {
  presets: readonly ProfilePreset[];
  /** idle = not read yet (or the last read failed: the next page that needs it retries). */
  state: "idle" | "loading" | "done";
  /** Bumped when the host's connection is replaced: a reply of the old one is dropped. */
  epoch: number;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function entryOf(hostId: string): Entry {
  let entry = cache.get(hostId);
  if (!entry) cache.set(hostId, (entry = { presets: FALLBACK_PRESETS, state: "idle", epoch: 0 }));
  return entry;
}

onHostReset((hostId) => {
  const entry = cache.get(hostId);
  if (!entry) return;
  const changed = entry.presets !== FALLBACK_PRESETS;
  cache.set(hostId, { presets: FALLBACK_PRESETS, state: "idle", epoch: entry.epoch + 1 });
  if (changed) emit();
});

function load(hostId: string, focus: string): void {
  const entry = entryOf(hostId);
  if (entry.state !== "idle") return;
  entry.state = "loading";
  const mine = entry.epoch;
  daemonApiOf(hostId, focus)
    .profilePresets()
    .then(
      (raw) => {
        const now = cache.get(hostId);
        if (!now || now.epoch !== mine) return;
        cache.set(hostId, { presets: presetsOf(raw) ?? FALLBACK_PRESETS, state: "done", epoch: mine });
        emit();
      },
      () => {
        const now = cache.get(hostId);
        if (now && now.epoch === mine) now.state = "idle";
      },
    );
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** The presets of the page's target host (lib/targetHost; the focus host outside a provider). */
export function useProfilePresets(): readonly ProfilePreset[] {
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  useEffect(() => load(hostId, focus), [hostId, focus]);
  const snapshot = useCallback(() => cache.get(hostId)?.presets ?? FALLBACK_PRESETS, [hostId]);
  return useSyncExternalStore(subscribe, snapshot);
}
