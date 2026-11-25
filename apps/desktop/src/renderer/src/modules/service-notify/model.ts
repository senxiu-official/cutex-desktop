// Pure helpers of 服务通知 (service-notify module): quiet-hour labels, history grouping and merging,
// which history entries can open.
import type { ServiceView } from "../../../../shared/ipc";
import type { ServiceNotificationEntry, ServiceNotificationSettings } from "../../../../shared/serviceNotifications";
import type { ServiceNotificationQuietHours } from "../../../../shared/serviceNotificationQueries";

/** The host keeps no message content for this service (its retain switch stays off); WhatsApp's own UI is modules/whatsapp. */
export const WHATSAPP_SLUG = "whatsapp";
/** Services shown on the 通知 page before 「全部 N」 (settings layout R6). */
export const SERVICES_ON_PAGE = 5;
/** History rows shown on a service's page before 「全部记录」. */
export const HISTORY_ON_PAGE = 5;
export const HISTORY_PAGE_SIZE = 50;

/** Quiet hours offered when the owner turns them on (host local time). */
export const DEFAULT_QUIET: ServiceNotificationQuietHours = { startMinute: 22 * 60, endMinute: 7 * 60 };

const pad = (n: number) => String(n).padStart(2, "0");

export function minuteLabel(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** Half-hour steps; a stored value off the grid is kept as its own choice. */
export function minuteOptions(current?: number): number[] {
  const steps = Array.from({ length: 48 }, (_, i) => i * 30);
  if (current !== undefined && !steps.includes(current)) steps.push(current);
  return steps.sort((a, b) => a - b);
}

export function crossesMidnight(q: ServiceNotificationQuietHours): boolean {
  return q.startMinute > q.endMinute;
}

/** "22:00–07:00" (the caller adds 次日 when it crosses midnight). */
export function quietRange(q: ServiceNotificationQuietHours): string {
  return `${minuteLabel(q.startMinute)}–${minuteLabel(q.endMinute)}`;
}

/** A quiet-hours edit: moving one end onto the other is refused (cutex needs start ≠ end). */
export function withQuietEnd(q: ServiceNotificationQuietHours, end: "start" | "end", minute: number): ServiceNotificationQuietHours | null {
  const next = end === "start" ? { ...q, startMinute: minute } : { ...q, endMinute: minute };
  return next.startMinute === next.endMinute ? null : next;
}

export type ChannelSummary = "off" | "both" | "desktop" | "phone" | "none";

/** One word for a service row's detail line. */
export function channelSummary(s: ServiceNotificationSettings): ChannelSummary {
  if (!s.enabled) return "off";
  if (s.desktop && s.phone) return "both";
  if (s.desktop) return "desktop";
  if (s.phone) return "phone";
  return "none";
}

/** Older pages appended; an entry seen twice (a page boundary moved) is kept once, newest first. */
export function mergeHistory(current: readonly ServiceNotificationEntry[], page: readonly ServiceNotificationEntry[]): ServiceNotificationEntry[] {
  const seen = new Set<string>();
  const out: ServiceNotificationEntry[] = [];
  for (const e of [...current, ...page]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => b.cursor - a.cursor);
}

export interface HistoryGroup {
  slug: string;
  name: string;
  entries: ServiceNotificationEntry[];
}

/** By source (服务): groups in order of their newest entry, entries newest first. */
export function groupHistory(entries: readonly ServiceNotificationEntry[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const e of [...entries].sort((a, b) => b.cursor - a.cursor)) {
    const g = groups.get(e.slug) ?? { slug: e.slug, name: e.serviceName || e.slug, entries: [] };
    g.entries.push(e);
    groups.set(e.slug, g);
  }
  return [...groups.values()];
}

/**
 * Where 打开 goes, or null: only a target the host validated, for a service that is still registered and not
 * archived (a deleted / re-registered service's old entry does not open whatever now has the slug's path).
 */
export function entryOpenTarget(e: ServiceNotificationEntry, services: readonly ServiceView[] | null): { slug: string; path: string } | null {
  if (!e.target) return null;
  const service = services?.find((s) => s.slug === e.slug);
  if (!service || service.archived) return null;
  if (e.target.kind === "service") return { slug: e.slug, path: "/" };
  return { slug: e.slug, path: e.target.path };
}

/** "Australia/Sydney · UTC+11:00" (or just the offset when the host's zone has no IANA name). */
export function timezoneLabel(tz: { iana: string | null; offsetSeconds: number } | undefined): string | null {
  if (!tz || !Number.isFinite(tz.offsetSeconds)) return null;
  const abs = Math.abs(Math.trunc(tz.offsetSeconds / 60));
  const offset = `UTC${tz.offsetSeconds < 0 ? "−" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return tz.iana ? `${tz.iana} · ${offset}` : offset;
}

/** How many entries the host can hold for this view: one service's bound, or the host's for every service. */
export function historyCap(retention: { maxPerService: number; maxPerHost: number } | null | undefined, slug: string | null): number {
  if (!retention) return Infinity;
  const cap = slug ? retention.maxPerService : retention.maxPerHost;
  return Number.isSafeInteger(cap) && cap > 0 ? cap : Infinity;
}

export type PhoneState = "unpaired" | "away" | "ok" | "unknown";

/** The phone switch's note: no Android paired, paired but not reporting, fine, or not known. */
export function phoneState(phone: { androidPaired: boolean | null; reachable: boolean | null } | undefined): PhoneState {
  if (!phone || phone.androidPaired === null) return "unknown";
  if (phone.androidPaired === false) return "unpaired";
  if (phone.reachable === false) return "away";
  return phone.reachable === true ? "ok" : "unknown";
}
