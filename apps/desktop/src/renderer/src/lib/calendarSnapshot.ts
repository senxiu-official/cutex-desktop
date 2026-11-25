// The owner's calendar snapshot for a 个人助理 (cutex r296 read-only calendar): read from an .ics export (the common
// subset: single events with UTC, floating, all-day or IANA-zoned times) or a JSON snapshot in cutex's own shape. An
// .ics import keeps today's and later events, earliest first, at most PA_CALENDAR_EVENTS_MAX, with ids and titles cut
// to cutex's byte limits; repeating events (RRULE) and zones this app cannot convert are left out and counted, never
// guessed. A JSON snapshot is passed through as written (cutex's checks report what does not fit).
import { cutBytes, PA_CALENDAR_EVENTS_MAX, PA_CALENDAR_LIMITS, utf8Bytes, type PaCalendarEvent } from "../../../shared/personalAssistants";

export interface ParsedCalendar {
  events: PaCalendarEvent[];
  /** From the file (X-WR-CALNAME / JSON `source`), else null. */
  source: string | null;
  /** JSON `observedAt` when given; an .ics file is observed now. */
  observedAt: string | null;
  skippedRecurring: number;
  skippedZone: number;
  skippedPast: number;
  /** More events than PA_CALENDAR_EVENTS_MAX were left: only the earliest kept. */
  truncated: boolean;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
/** An id within cutex's limit: long ones keep their start and a hash of the whole. */
function eventId(raw: string): string {
  return utf8Bytes(raw) <= PA_CALENDAR_LIMITS.id ? raw : `${cutBytes(raw, PA_CALENDAR_LIMITS.id - 9)}~${fnv(raw)}`;
}

/** The UTC offset (ms) of an IANA zone at a UTC instant; throws for a zone Intl does not know. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(utcMs / 1000) * 1000;
}
/** A wall time in a zone as a UTC instant (two passes cover a DST edge). */
function fromZone(wall: number, timeZone: string): number {
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone);
  return utc;
}

interface Prop {
  params: Record<string, string>;
  value: string;
}
type Time = { ms: number; allDay: boolean } | "zone" | null;
function parseTime(p: Prop | undefined): Time {
  if (!p) return null;
  const v = p.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || p.params.VALUE === "DATE") {
    const d = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!d) return null;
    return { ms: new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).getTime(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  const tz = p.params.TZID?.replace(/^"|"$/g, "");
  if (!tz) return { ms: new Date(y, mo, d, h, mi, s).getTime(), allDay: false };
  try {
    return { ms: fromZone(Date.UTC(y, mo, d, h, mi, s), tz), allDay: false };
  } catch {
    return "zone";
  }
}
function parseDuration(v: string | undefined): number | null {
  const m = v ? /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim()) : null;
  if (!m) return null;
  const ms = (((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 24 + Number(m[4] ?? 0)) * 60 + Number(m[5] ?? 0)) * 60_000 + Number(m[6] ?? 0) * 1000;
  return m[1] === "-" ? -ms : ms;
}
const unescape = (v: string) => v.replace(/\\[nN]/g, " ").replace(/\\([,;\\])/g, "$1").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

/** Today's start on this device (events ending before it are past). */
const todayStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

function parseIcs(text: string, now: Date): ParsedCalendar {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: ParsedCalendar = { events: [], source: null, observedAt: null, skippedRecurring: 0, skippedZone: 0, skippedPast: 0, truncated: false };
  let ev: Record<string, Prop> | null = null;
  let depth = 0;
  const cutoff = todayStart(now);
  const kept: { start: number; end: number; uid: string; title: string }[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [rawName, ...rawParams] = head.split(";");
    const name = rawName!.toUpperCase();
    if (name === "BEGIN") {
      if (value.trim().toUpperCase() === "VEVENT" && depth === 0) ev = {};
      else if (ev) depth += 1;
      continue;
    }
    if (name === "END") {
      if (ev && depth > 0) depth -= 1;
      else if (ev && value.trim().toUpperCase() === "VEVENT") {
        const e = ev;
        ev = null;
        if (e.STATUS?.value.trim().toUpperCase() === "CANCELLED") continue;
        if (e.RRULE || e.RDATE) {
          out.skippedRecurring += 1;
          continue;
        }
        const start = parseTime(e.DTSTART);
        const endProp = parseTime(e.DTEND);
        if (start === "zone" || endProp === "zone") {
          out.skippedZone += 1;
          continue;
        }
        if (!start) continue;
        const duration = parseDuration(e.DURATION?.value);
        const end = endProp ? endProp.ms : duration !== null ? start.ms + duration : start.allDay ? start.ms + 86_400_000 : start.ms + 60_000;
        if (end <= start.ms) continue;
        if (end <= cutoff) {
          out.skippedPast += 1;
          continue;
        }
        const uid = unescape(e.UID?.value ?? "") || `${start.ms}-${unescape(e.SUMMARY?.value ?? "")}`;
        const recurrence = e["RECURRENCE-ID"]?.value.trim();
        kept.push({ start: start.ms, end, uid: recurrence ? `${uid}@${recurrence}` : uid, title: unescape(e.SUMMARY?.value ?? "") || "—" });
      }
      continue;
    }
    if (ev && depth === 0) {
      const params: Record<string, string> = {};
      for (const p of rawParams) {
        const eq = p.indexOf("=");
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
      }
      if (!ev[name]) ev[name] = { params, value };
    } else if (!ev && name === "X-WR-CALNAME" && !out.source) out.source = unescape(value) || null;
  }
  kept.sort((a, b) => a.start - b.start || a.uid.localeCompare(b.uid));
  out.truncated = kept.length > PA_CALENDAR_EVENTS_MAX;
  const ids = new Set<string>();
  for (const k of kept.slice(0, PA_CALENDAR_EVENTS_MAX)) {
    let id = eventId(k.uid);
    for (let n = 2; ids.has(id); n++) id = eventId(`${k.uid}#${n}`);
    ids.add(id);
    out.events.push({ id, title: cutBytes(k.title, PA_CALENDAR_LIMITS.title), startsAt: new Date(k.start).toISOString(), endsAt: new Date(k.end).toISOString() });
  }
  return out;
}

function parseJson(text: string): ParsedCalendar | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const o = (Array.isArray(v) ? { events: v } : v) as { events?: unknown; source?: unknown; observedAt?: unknown } | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.events)) return null;
  return {
    events: o.events.map((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      return { id: String(x.id ?? ""), title: String(x.title ?? ""), startsAt: String(x.startsAt ?? ""), endsAt: String(x.endsAt ?? "") };
    }),
    source: typeof o.source === "string" ? o.source : null,
    observedAt: typeof o.observedAt === "string" ? o.observedAt : null,
    skippedRecurring: 0,
    skippedZone: 0,
    skippedPast: 0,
    truncated: false,
  };
}

/** An .ics export or a JSON snapshot; null when it is neither. */
export function parseCalendarText(text: string, now = new Date()): ParsedCalendar | null {
  const t = text.replace(/^﻿/, "").trim();
  if (!t) return null;
  if (t.startsWith("{") || t.startsWith("[")) return parseJson(t);
  if (/^BEGIN:VCALENDAR/im.test(t)) return parseIcs(t, now);
  return null;
}
