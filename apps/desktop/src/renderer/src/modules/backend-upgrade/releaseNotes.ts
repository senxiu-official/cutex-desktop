// What the INSTALLED cutex release brought, for 主机后端更新. A cutex with capability
// `upgrade-installed-notes` reports it itself (`/v2/upgrade` `installed.notes` / `publishedAt`, read from
// the installed manifest) — preferred. Older cutex reports notes only for the release on offer
// (`available.notes`), so as a fallback this desktop keeps the notes of releases it has seen offered.
// Keyed by release name (same release = same notes on every host), at most MAX_RELEASES entries, newest
// kept. A per-viewer convenience in localStorage: unavailable storage only means the notes are not shown.
import type { UpgradeInstalled, UpgradeStatus } from "../../../../shared/backendUpgrade";

const KEY = "cutex-desktop.backend-upgrade.releaseNotes";
export const MAX_RELEASES = 20;

export interface SavedNotes {
  notes: Record<string, string>;
  publishedAt?: string | null;
  /** When this desktop saw it (ms). */
  seenAt: number;
}

function readAll(): Record<string, SavedNotes> {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, SavedNotes>) : {};
  } catch {
    return {};
  }
}

/** Remember the offered release's notes (no-op without notes, or when they are already saved unchanged). */
export function rememberReleaseNotes(status: Pick<UpgradeStatus, "available"> | null | undefined, now = Date.now()): void {
  const a = status?.available;
  if (!a?.release || !a.notes || typeof a.notes !== "object" || Object.keys(a.notes).length === 0) return;
  const all = readAll();
  const prev = all[a.release];
  if (prev && JSON.stringify(prev.notes) === JSON.stringify(a.notes)) return;
  all[a.release] = { notes: { ...a.notes }, publishedAt: a.publishedAt ?? null, seenAt: now };
  const kept = Object.entries(all)
    .sort(([, x], [, y]) => (y.seenAt ?? 0) - (x.seenAt ?? 0))
    .slice(0, MAX_RELEASES);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // ignore
  }
}

/** The saved notes of a release, or null. */
export function savedReleaseNotes(release: string | null | undefined): SavedNotes | null {
  if (!release) return null;
  const entry = readAll()[release];
  return entry && entry.notes && typeof entry.notes === "object" ? entry : null;
}

export interface InstalledNotes {
  notes: Record<string, string>;
  publishedAt: string | null;
  /** cutex = `installed.notes` (upgrade-installed-notes); cache = saved while it was on offer. */
  source: "cutex" | "cache";
}

/**
 * The installed release's notes: cutex's own `installed.notes` when the host has the capability and it
 * knows them (non-empty), else the notes this desktop saved while the release was on offer, else null.
 */
export function installedReleaseNotes(installed: UpgradeInstalled | null | undefined, fromCutex: boolean): InstalledNotes | null {
  if (!installed?.release) return null;
  const own = installed.notes;
  if (fromCutex && own && typeof own === "object" && !Array.isArray(own) && Object.keys(own).length > 0) {
    return { notes: own, publishedAt: installed.publishedAt ?? null, source: "cutex" };
  }
  const saved = savedReleaseNotes(installed.release);
  return saved ? { notes: saved.notes, publishedAt: saved.publishedAt ?? (fromCutex ? (installed.publishedAt ?? null) : null), source: "cache" } : null;
}
