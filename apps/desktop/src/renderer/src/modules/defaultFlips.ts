// Defaults that change must keep the previous behavior on devices that already used the app.
// The host stores only choices that differ from the default, so an absent entry used the old default.
// Run before the host starts and record each migration once, even for a fresh install.
import { MODULES_PREFS_KEY, type KeyValueStorage } from "./types";
import { ON_DEMAND_UPGRADE_PACKS } from "../../../shared/modulePacks";

export interface DefaultFlip {
  id: string;
  marker: string;
  previousDefault: boolean;
  /** Existing startup marker written by older builds, even without a saved module preference. */
  previousStartupMarker?: string;
  /** Also count an install with saved module choices as existing (one older than the startup marker). */
  orSavedChoices?: boolean;
}

const BROWSER_STARTUP_MARKER = "cutex-desktop.modules.flip.browser-on";

export const DEFAULT_FLIPS: readonly DefaultFlip[] = [
  // This startup marker predates the introduction of Baidu Netdisk in November 2026.
  { id: "baidu-pan", marker: "cutex-desktop.modules.flip.baidu-pan-off", previousDefault: true, previousStartupMarker: BROWSER_STARTUP_MARKER },
  { id: "browser", marker: BROWSER_STARTUP_MARKER, previousDefault: false },
  // 状态胶囊（旧版）off for new installs (owner 2026-11-27, slim audit #8). "Existing install" = the browser flip's
  // startup marker, written on every start since 2026-10-15, or saved module choices (an install older than that marker).
  // There an absent choice was the old default on, so it becomes an explicit on; an explicit on / off stays. Position
  // and size are separate keys (capsuleState) and untouched.
  { id: "status-capsule", marker: "cutex-desktop.modules.flip.status-capsule-off", previousDefault: true, previousStartupMarker: BROWSER_STARTUP_MARKER, orSavedChoices: true },
];

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

/** Returns the module ids whose previous defaults were pinned. */
export function pinFlippedDefaults(storage: KeyValueStorage, flips: readonly DefaultFlip[] = DEFAULT_FLIPS): string[] {
  const pending = flips.filter((flip) => storage.getItem(flip.marker) === null);
  if (!pending.length) return [];

  let value: Record<string, unknown> | null = null;
  try { value = record(JSON.parse(storage.getItem(MODULES_PREFS_KEY) ?? "null")); } catch { /* unreadable preferences */ }
  const prefs = value?.v === 1 ? value : null;
  const enabled = { ...record(prefs?.enabled) };
  const pinned: string[] = [];
  for (const flip of pending) {
    const existing = flip.previousStartupMarker
      ? storage.getItem(flip.previousStartupMarker) !== null || (!!flip.orSavedChoices && prefs !== null)
      : prefs !== null;
    if (!existing || typeof enabled[flip.id] === "boolean") continue;
    enabled[flip.id] = flip.previousDefault;
    pinned.push(flip.id);
  }
  if (pinned.length) storage.setItem(MODULES_PREFS_KEY, JSON.stringify({ v: 1, place: {}, ...prefs, enabled }));
  for (const flip of pending) storage.setItem(flip.marker, "1");
  return pinned;
}

/** Snapshot eligibility once, after the old defaults have been pinned and before any new pack can be enabled. */
export function pinnedBundledFallbacks(storage: KeyValueStorage): ReadonlySet<string> {
  let enabled: Record<string, unknown> | null = null;
  try {
    const prefs = record(JSON.parse(storage.getItem(MODULES_PREFS_KEY) ?? "null"));
    if (prefs?.v === 1) enabled = record(prefs.enabled);
  } catch { /* Unreadable preferences behave like a fresh install. */ }
  const legacy = new Set<string>();
  for (const id of ON_DEMAND_UPGRADE_PACKS) {
    const key = `cutex-desktop.modules.bundled-fallback.${id}`;
    const pinned = storage.getItem(key);
    const keep = pinned === null ? enabled?.[id] === true : pinned === "1";
    if (pinned === null) storage.setItem(key, keep ? "1" : "0");
    if (keep) legacy.add(id);
  }
  return legacy;
}
