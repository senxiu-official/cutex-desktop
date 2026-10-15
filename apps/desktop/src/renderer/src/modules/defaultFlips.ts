// A module whose default flips from off to on must not turn itself on for an existing install. The
// module host stores only choices that differ from the default (host.ts persist), so "turned it off"
// and "never touched it" both look like "no entry" while the default was off. Before the host starts,
// an install that already saved module choices (the `cutex-desktop.modules` record exists) gets an
// explicit `false` for each flipped module it has no entry for; a fresh install (no record) gets the
// new default. Runs once per flip (marker key), so a later explicit choice is never overwritten.
import { MODULES_PREFS_KEY, type KeyValueStorage } from "./types";

export interface DefaultFlip {
  /** Module id whose default went from off to on. */
  id: string;
  /** Storage key set once the flip was applied (or found nothing to pin). */
  marker: string;
}

/** browser: on by default since 2026-10-15 (fresh-install defaults; lead decision). */
export const DEFAULT_FLIPS: readonly DefaultFlip[] = [{ id: "browser", marker: "cutex-desktop.modules.flip.browser-on" }];

/** Returns the module ids pinned off (for tests / logging). */
export function pinFlippedDefaults(storage: KeyValueStorage, flips: readonly DefaultFlip[] = DEFAULT_FLIPS): string[] {
  const pinned: string[] = [];
  const pending = flips.filter((flip) => storage.getItem(flip.marker) === null);
  if (!pending.length) return pinned;
  const raw = storage.getItem(MODULES_PREFS_KEY);
  if (raw !== null) {
    let record: unknown = null;
    try { record = JSON.parse(raw); } catch { record = null; }
    const value = record && typeof record === "object" && !Array.isArray(record) ? (record as Record<string, unknown>) : null;
    if (value && value.v === 1) {
      const enabled = value.enabled && typeof value.enabled === "object" && !Array.isArray(value.enabled) ? { ...(value.enabled as Record<string, unknown>) } : {};
      for (const flip of pending) {
        if (Object.hasOwn(enabled, flip.id)) continue;
        enabled[flip.id] = false;
        pinned.push(flip.id);
      }
      if (pinned.length) storage.setItem(MODULES_PREFS_KEY, JSON.stringify({ ...value, enabled }));
    }
  }
  for (const flip of pending) storage.setItem(flip.marker, "1");
  return pinned;
}
