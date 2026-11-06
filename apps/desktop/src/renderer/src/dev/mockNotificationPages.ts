// Shared preview notification sources: safety and owner messages use the same list route.
import type { OwnerNotification, OwnerNotificationList, OwnerNotifyFilter } from "@cutex-desktop/protocol";
import { isAlerting, isPending } from "../../../shared/ownerNotify";

export const s10PagesScene = typeof location !== "undefined" && new URLSearchParams(location.search).has("s10pages");
const sources: OwnerNotification[][] = [];
export function registerMockOwnerNotes(rows: OwnerNotification[]): void { if (!sources.includes(rows)) sources.push(rows); }
export function mockNotificationRows(): OwnerNotification[] { return sources.flat(); }

type Query = { filter?: OwnerNotifyFilter; agentId?: string; limit?: number; cursor?: string };
const keyOf = (r: OwnerNotification) => `${r.createdAt}\0${r.notificationId}`;
/** Deliberately short byte-bounded pages, including the single oversized-row exception. */
export function mockNotificationPage(rows: readonly OwnerNotification[], { filter = "all", agentId, limit = 50, cursor }: Query, shortPages = true): OwnerNotificationList {
  const scope = JSON.stringify([filter, agentId ?? null]);
  let after: string | null = null;
  if (cursor) {
    try {
      const decoded = JSON.parse(atob(cursor));
      if (decoded.scope !== scope || typeof decoded.after !== "string") throw new Error();
      after = decoded.after;
    } catch { throw Object.assign(new Error("invalid_cursor: invalid preview notification cursor"), { status: 400, code: "invalid_cursor" }); }
  }
  const sorted = rows.filter(r => (!agentId || r.agentId === agentId) && (filter === "all" || (filter === "pending" ? isPending(r) : isAlerting(r))) && (!after || keyOf(r) < after))
    .sort((a, b) => keyOf(a) < keyOf(b) ? 1 : keyOf(a) > keyOf(b) ? -1 : 0);
  const notifications: OwnerNotification[] = [];
  let bytes = 0;
  for (const r of sorted) {
    const size = new TextEncoder().encode(JSON.stringify(r)).length;
    if (notifications.length && bytes + size > (shortPages ? 4096 : 256 * 1024)) break;
    notifications.push(r);
    bytes += size;
    if (notifications.length >= Math.min(shortPages ? 3 : 500, Math.max(1, limit))) break;
  }
  const last = notifications.at(-1);
  return structuredClone({ notifications, ...(last && sorted.length > notifications.length ? { nextCursor: btoa(JSON.stringify({ scope, after: keyOf(last) })) } : {}) });
}
