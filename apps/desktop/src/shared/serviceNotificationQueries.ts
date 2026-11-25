// Request helpers for service notifications (cutex `service-notifications-v1`, DTOs in ./serviceNotifications):
// the history query and the PUT body main sends. The renderer reads settings and history only through main;
// the publishing credential never reaches it.
import type { ServiceNotificationSettings } from "./serviceNotifications";

export type ServiceNotificationQuietHours = NonNullable<ServiceNotificationSettings["quietHours"]>;

export interface ServiceNotificationHistoryQuery {
  service?: string;
  /** A `nextBefore` from the previous page: entries older than it. */
  before?: number;
  limit?: number;
}

export const SERVICE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Minutes after midnight (host local time), start ≠ end; may cross midnight. */
export function validQuietHours(q: ServiceNotificationQuietHours | null): boolean {
  if (q === null) return true;
  const ok = (m: number) => Number.isInteger(m) && m >= 0 && m < 1440;
  return ok(q.startMinute) && ok(q.endMinute) && q.startMinute !== q.endMinute;
}

/** The query main sends (bounded; unknown fields dropped). */
export function historyQuery(q: ServiceNotificationHistoryQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.service !== undefined) {
    if (!SERVICE_SLUG.test(q.service)) throw new Error("bad service slug");
    out.service = q.service;
  }
  if (q.before !== undefined) {
    if (!Number.isSafeInteger(q.before) || q.before <= 0) throw new Error("bad cursor");
    out.before = String(q.before);
  }
  out.limit = String(Math.min(100, Math.max(1, Math.floor(q.limit ?? 50))));
  return out;
}

/** The PUT body: exactly the five fields cutex accepts (deny_unknown_fields). */
export function settingsBody(s: ServiceNotificationSettings): ServiceNotificationSettings {
  if (!validQuietHours(s.quietHours)) throw new Error("bad quiet hours");
  return {
    enabled: !!s.enabled,
    desktop: !!s.desktop,
    phone: !!s.phone,
    retainContent: !!s.retainContent,
    quietHours: s.quietHours ? { startMinute: s.quietHours.startMinute, endMinute: s.quietHours.endMinute } : null,
  };
}
