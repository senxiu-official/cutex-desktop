import type { DirectorStartReview } from "@cutex-desktop/cutex-client";
export function canAdopt(item: DirectorStartReview, epoch: number): boolean {
  return item.state === "open" && item.epochAtReview === epoch;
}
export function scopeIds(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,，]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function directorConflict(code: string): boolean {
  return /epoch|revision_conflict|authority_conflict|stale|director_changed/.test(
    code,
  );
}
/**
 * Whether 项目交接 has something for the owner to act on, so it opens by itself: a vacant seat, a pending
 * delegation handover or a first-message review still open (or with unknown delivery) — the items its
 * section counts show. History alone never requires attention.
 */
export function handoverAttention(
  snap: {
    director: { directorSessionId: string | null };
    handovers: readonly { state: string }[];
    starts: readonly { state: string }[];
  },
  on: { handover: boolean; adoption: boolean },
): boolean {
  if (!snap.director.directorSessionId) return true;
  if (on.handover && snap.handovers.some((h) => h.state === "pending"))
    return true;
  return (
    on.adoption &&
    snap.starts.some((s) => ["open", "deliveryUnknown"].includes(s.state))
  );
}

export const DIRECTOR_NOTICE_LIFETIME = 7 * 24 * 60 * 60 * 1000;
export function recentDirectorNotice(change: { state: string; oldDirector: string | null; newDirector: string | null; settledAt?: string; preparedAt: string }, now: number): boolean {
  const at = Date.parse(change.settledAt ?? change.preparedAt);
  return change.state === "finalized" && change.oldDirector !== change.newDirector
    && Number.isFinite(at) && at <= now && now - at < DIRECTOR_NOTICE_LIFETIME;
}

// One local presentation marker per host/project/notice; no daemon record is changed.
export function directorNoticeKey(hostId: string, projectId: string, changeId: string): string {
  return `cutex-desktop.director-notice.v1:${JSON.stringify([hostId, projectId, changeId])}`;
}
export function directorNoticeDismissed(hostId: string, projectId: string, changeId: string): boolean {
  try { return localStorage.getItem(directorNoticeKey(hostId, projectId, changeId)) === "1"; }
  catch { return false; }
}
export function dismissDirectorNotice(hostId: string, projectId: string, changeId: string): void {
  try { localStorage.setItem(directorNoticeKey(hostId, projectId, changeId), "1"); }
  catch { /* The current view still dismisses it when local storage is unavailable. */ }
}
