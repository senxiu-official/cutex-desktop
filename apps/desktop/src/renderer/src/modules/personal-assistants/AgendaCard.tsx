// 今日 (plan 「桌面接入规格」 5, contract 议程): the host's today. Every host: requests still to decide or follow up,
// the assistant's own reminders and the schedules that run today. r296 adds each chosen project's status (its Director
// now, or why it could not be read), the requests due today and the imported read-only calendar (with 导入 / 替换 /
// 清除: CalendarImport). Each source pages on its own cursor, merged by stable id (a filtered page may be empty: its
// cursor is still followed on 加载更多); a calendar replaced meanwhile (`calendar_changed`) reads today again. A request
// row opens its card on the 请求 tab. Shows what was read last and when. r299 hosts: the day is the owner's (this
// device's zone, `displayTimezone`), and each source says how it was read (read at / snapshot / unknown / not
// connected) — a source that could not be read says so instead of 「没有…」. A failed read keeps what was read before,
// marked as old (never an empty day).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Bell, CalendarClock, CalendarDays, FolderKanban, NotebookPen, Timer } from "lucide-react";
import { useI18n } from "../../i18n";
import { Section } from "../../components/settings/Form";
import type { PaAgenda, PaAgendaCalendar, PaAgendaProject, PaAgendaSource, PaAgendaSources, PaCalendarEvent, PaReminder, PaRequest, PaSchedule, PaSeat, PaView } from "../../../../shared/personalAssistants";
import { localTimeZone } from "../../lib/dateText";
import { hostApi } from "../../lib/hostLists";
import { paErrorCode } from "../../lib/personalAssistants";
import { formatAbsolute } from "../../lib/time";
import { CalendarImport } from "./CalendarImport";
import { RequestStateTag } from "./RequestCard";
import { paErrorText, projectName, sessionName, type PaHost } from "./paHooks";

const PAGE = 50;

interface Agenda {
  date: string;
  items: PaRequest[];
  reminders: PaReminder[];
  schedules: PaSchedule[];
  projects: PaAgendaProject[] | null;
  due: PaRequest[] | null;
  calendar: PaAgendaCalendar | null;
  next: { items: number | null; reminders: string | null; schedules: string | null; projects: string | null; due: string | null; calendar: string | null };
  readAt: number;
  /** r299: how each source was read (null: an older host, which does not say). */
  sources: PaAgendaSources | null;
  zone: string | null;
  hostZone: string | null;
}

/** A later page's source states: a source only becomes worse for a real reason (an empty page of a paged source says
 * `not_observed_on_page`, which says nothing about the day). */
function mergeSources(cur: PaAgendaSources | null, next: PaAgendaSources | null | undefined): PaAgendaSources | null {
  if (!cur || !next) return cur ?? next ?? null;
  const out = { ...cur };
  for (const [key, src] of Object.entries(next)) if (src.reason !== "not_observed_on_page" || !out[key]) out[key] = src;
  return out;
}

const scheduleId = (s: PaSchedule) => String(s.id ?? s.scheduleId ?? JSON.stringify(s));
const merge = <T,>(a: readonly T[], b: readonly T[], id: (x: T) => string) => {
  const seen = new Set(a.map(id));
  return [...a, ...b.filter((x) => !seen.has(id(x)))];
};
const time = (iso: string | null | undefined) => {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fromPage = (a: PaAgenda): Agenda => ({
  date: a.date, items: a.items, reminders: a.reminders, schedules: a.schedules, projects: a.projects, due: a.dueRequests, calendar: a.calendar,
  next: { items: a.nextCursor, reminders: a.nextReminderCursor, schedules: a.nextScheduleCursor, projects: a.nextProjectCursor, due: a.nextDueCursor, calendar: a.calendar?.nextCursor ?? null },
  readAt: Date.now(),
  sources: a.sources ?? null,
  zone: a.displayTimezone ?? null,
  hostZone: a.hostTimezone ?? null,
});

export function AgendaCard({ hostId, view, host, refreshKey, readOnly, onOpenRequest }: { hostId: string; view: PaView; host: PaHost | undefined; /** Changes when the host or this assistant's agenda sources change. */ refreshKey: unknown; readOnly: boolean; onOpenRequest(requestId: string): void }) {
  const { t } = useI18n();
  const id = view.assistant.id;
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const usable = !!view.assistant.sessionId && view.capabilities.agenda !== false;
  // r299: the owner's day (this device's zone); older hosts don't take it.
  const zone = host?.features.readiness ? localTimeZone() : undefined;
  const first = useCallback(async () => {
    if (!usable) return;
    try {
      setAgenda(fromPage(await hostApi(hostId).paAgenda(id, { limit: PAGE, ...(zone ? { displayTimezone: zone } : {}) })));
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    }
  }, [hostId, id, usable, zone, t]);
  useEffect(() => {
    void first();
  }, [first, refreshKey]);
  const loadMore = async () => {
    if (!agenda) return;
    setMore(true);
    const n = agenda.next;
    try {
      const a: PaAgenda = await hostApi(hostId).paAgenda(id, {
        date: agenda.date,
        limit: PAGE,
        ...(zone ? { displayTimezone: zone } : {}),
        ...(n.items !== null ? { cursor: n.items } : {}),
        ...(n.reminders ? { reminderCursor: n.reminders } : {}),
        ...(n.schedules ? { scheduleCursor: n.schedules } : {}),
        ...(n.projects ? { projectCursor: n.projects } : {}),
        ...(n.due ? { dueCursor: n.due } : {}),
        ...(n.calendar ? { calendarCursor: n.calendar } : {}),
      });
      setAgenda((cur) => {
        if (!cur) return cur;
        const c = cur.next;
        return {
          ...cur,
          items: c.items !== null ? merge(cur.items, a.items, (r) => r.id) : cur.items,
          reminders: c.reminders ? merge(cur.reminders, a.reminders, (r) => r.alarmId) : cur.reminders,
          schedules: c.schedules ? merge(cur.schedules, a.schedules, scheduleId) : cur.schedules,
          projects: c.projects && cur.projects ? merge(cur.projects, a.projects ?? [], (p) => p.projectRef.projectId) : cur.projects,
          due: c.due && cur.due ? merge(cur.due, a.dueRequests ?? [], (r) => r.id) : cur.due,
          calendar: c.calendar && cur.calendar ? { ...cur.calendar, items: merge(cur.calendar.items, a.calendar?.items ?? [], (e) => e.id) } : cur.calendar,
          next: {
            items: c.items !== null ? a.nextCursor : null,
            reminders: c.reminders ? a.nextReminderCursor : null,
            schedules: c.schedules ? a.nextScheduleCursor : null,
            projects: c.projects ? a.nextProjectCursor : null,
            due: c.due ? a.nextDueCursor : null,
            calendar: c.calendar ? (a.calendar?.nextCursor ?? null) : null,
          },
          readAt: Date.now(),
          sources: mergeSources(cur.sources, a.sources),
        };
      });
    } catch (e) {
      // The calendar was replaced between pages: today again from the start.
      if (paErrorCode(e) === "calendar_changed") await first();
      else setError(paErrorText(e, t));
    } finally {
      setMore(false);
    }
  };
  const hasMore = !!agenda && Object.values(agenda.next).some((c) => c !== null && c !== "");
  const heading = (icon: ReactNode, text: string, extra: ReactNode = null) => (
    <div className="mt-3 mb-1 flex items-center gap-1.5 text-caption/[inherit] font-semibold text-subtle first:mt-0">
      {icon}
      {text}
      {extra}
    </div>
  );
  /** A source's state after its heading (r299), and whether its list can be called empty. */
  const source = (key: string): PaAgendaSource | undefined => agenda?.sources?.[key];
  const readable = (key: string) => {
    const src = source(key);
    return !src || src.status === "ready" || src.status === "snapshot";
  };
  const note = (key: string) => {
    const src = source(key);
    if (!src) return null;
    const ms = src.observedAt ? Date.parse(src.observedAt) : NaN;
    const at = Number.isFinite(ms) ? formatAbsolute(Math.floor(ms / 1000)) : null;
    // A source read with the page says nothing more; one read clearly earlier says when.
    const older = Number.isFinite(ms) && !!agenda && agenda.readAt - ms > 120_000;
    const text = src.status === "ready" ? (at && older ? t("personal-assistants.today.source.ready", { at }) : null)
      : src.status === "snapshot" ? t("personal-assistants.today.source.snapshot", { at: at ?? "—" })
      : src.status === "disconnected" ? t("personal-assistants.today.source.disconnected")
      : t("personal-assistants.today.source.unknown", { reason: src.reason ?? src.status });
    return text ? <span className={`ml-auto font-normal ${readable(key) ? "" : "text-warn"}`} data-pa-source={key} data-pa-source-status={src.status}>{text}</span> : null;
  };
  const none = (key: string, text: string) => (readable(key) ? <div className="text-ui/[inherit] text-subtle">{text}</div> : null);
  const zoneText = agenda?.zone
    ? agenda.hostZone && agenda.hostZone !== agenda.zone ? t("personal-assistants.today.zoneHost", { zone: agenda.zone, host: agenda.hostZone }) : t("personal-assistants.today.zone", { zone: agenda.zone })
    : t("personal-assistants.today.hostTime");
  const seatText = (s: PaSeat | null) => (s?.sessionId ? t("personal-assistants.card.seat", { name: sessionName(host, s.sessionId) ?? s.sessionId, epoch: s.epoch }) : t("personal-assistants.card.vacant"));
  const requestRow = (r: PaRequest, attr: string) => (
    <li key={r.id}>
      <button type="button" className="press flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-2/60" onClick={() => onOpenRequest(r.id)} {...{ [attr]: r.id }}>
        <RequestStateTag state={r.state} />
        <span className="min-w-0 flex-1 truncate text-ui/[inherit]">{r.outcome}</span>
        {r.dueAt && attr === "data-pa-agenda-due" && <span className="shrink-0 font-mono text-caption/[inherit] text-subtle">{time(r.dueAt)}</span>}
        <span className="shrink-0 text-caption/[inherit] text-subtle">{projectName(host, r.projectId)}</span>
      </button>
    </li>
  );
  return (
    <div data-pa-agenda="">
      <Section
        title={t("personal-assistants.today.title", { date: agenda?.date ?? "—" })}
        hint={agenda ? `${zoneText} · ${t("personal-assistants.refreshed", { at: formatAbsolute(Math.floor(agenda.readAt / 1000)) })}` : zoneText}
      >
        {error && !agenda && <div className="mb-2 text-caption/[inherit] text-danger" role="alert">{t("personal-assistants.today.loadFailed", { error })}</div>}
        {error && agenda && (
          <div className="mb-2 rounded-md bg-warn/10 px-2 py-1 text-caption/[inherit] text-warn" role="alert" data-pa-agenda-stale="">
            {t("personal-assistants.today.stale", { at: formatAbsolute(Math.floor(agenda.readAt / 1000)), error })}
          </div>
        )}
        {!agenda && !error && usable && <div className="text-ui/[inherit] text-subtle" role="status">{t("personal-assistants.rail.loading")}</div>}
        {agenda && (<>
        {agenda.projects && (
          <>
            {heading(<FolderKanban size={12} aria-hidden />, t("personal-assistants.today.projects"), note("projects"))}
            {agenda.projects.length === 0 && none("projects", t("personal-assistants.today.projectsNone"))}
            <ul data-pa-agenda-projects="">
              {agenda.projects.map((p) => (
                <li key={`${p.projectRef.instanceId}\n${p.projectRef.projectId}`} className="flex min-w-0 items-baseline gap-2 px-1 py-0.5" data-pa-agenda-project={p.projectRef.projectId}>
                  <span className="min-w-0 flex-1 truncate text-ui/[inherit]">{projectName(host, p.projectRef.projectId)}</span>
                  {p.issue ? (
                    <span className="shrink-0 text-caption/[inherit] text-warn">{t("personal-assistants.today.projectIssue", { issue: p.issue })}</span>
                  ) : (
                    <span className={`shrink-0 text-caption/[inherit] ${p.director?.sessionId ? "text-subtle" : "text-warn"}`}>
                      {p.lifecycle === "archived" ? `${t("personal-assistants.today.projectArchived")} · ` : ""}
                      {t("personal-assistants.card.director")} {seatText(p.director)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {heading(null, t("personal-assistants.today.items"), note("requests"))}
        {agenda.items.length === 0 && none("requests", t("personal-assistants.today.itemsNone"))}
        <ul data-pa-agenda-items="">{agenda.items.map((r) => requestRow(r, "data-pa-agenda-item"))}</ul>
        {agenda.due && (
          <>
            {heading(<Timer size={12} aria-hidden />, t("personal-assistants.today.due"), note("dueRequests"))}
            {agenda.due.length === 0 && none("dueRequests", t("personal-assistants.today.dueNone"))}
            <ul data-pa-agenda-due-list="">{agenda.due.map((r) => requestRow(r, "data-pa-agenda-due"))}</ul>
          </>
        )}
        {agenda.calendar && (
          <>
            {heading(<CalendarDays size={12} aria-hidden />, t("personal-assistants.today.calendar"), note("calendar"))}
            <CalendarDay calendar={agenda.calendar} />
            <CalendarImport hostId={hostId} assistantId={id} info={agenda.calendar} readOnly={readOnly} onChanged={() => void first()} />
          </>
        )}
        {heading(<Bell size={12} aria-hidden />, t("personal-assistants.today.reminders"), note("reminders"))}
        {agenda.reminders.length === 0 && none("reminders", t("personal-assistants.today.remindersNone"))}
        <ul data-pa-agenda-reminders="">
          {agenda.reminders.map((r) => (
            <li key={r.alarmId} className="flex min-w-0 items-baseline gap-2 px-1 py-0.5" data-pa-reminder={r.alarmId} title={r.state}>
              <span className="w-11 shrink-0 font-mono text-caption/[inherit] text-subtle">{time(r.at)}</span>
              <span className="min-w-0 flex-1 text-ui/[inherit] break-words">{r.message}</span>
            </li>
          ))}
        </ul>
        {heading(<CalendarClock size={12} aria-hidden />, t("personal-assistants.today.schedules"), note("schedules"))}
        {agenda.schedules.length === 0 && none("schedules", t("personal-assistants.today.schedulesNone"))}
        <ul data-pa-agenda-schedules="">
          {agenda.schedules.map((s) => (
            <li key={scheduleId(s)} className="flex min-w-0 items-baseline gap-2 px-1 py-0.5">
              <span className="w-11 shrink-0 font-mono text-caption/[inherit] text-subtle">{time(typeof s.nextRunAt === "string" ? s.nextRunAt : null)}</span>
              <span className="min-w-0 flex-1 truncate text-ui/[inherit]">{String(s.name ?? s.title ?? scheduleId(s))}</span>
            </li>
          ))}
        </ul>
        {hasMore && (
          <button type="button" className="press mt-1 rounded-sm text-caption/[inherit] text-accent" disabled={more} onClick={() => void loadMore()} data-pa-agenda-more="">
            {t("personal-assistants.today.more")}
          </button>
        )}
        </>)}
        {!host?.features.ownerViews && (
          <>
            {heading(<NotebookPen size={12} aria-hidden />, t("personal-assistants.today.notes"))}
            <div className="text-caption/[inherit] text-subtle" data-pa-notes-unavailable="">{t("personal-assistants.today.notesUnavailable")}</div>
          </>
        )}
        {view.capabilities.recurringDirectorTemplates !== true && <div className="mt-2 text-caption/[inherit] text-subtle" data-pa-recurring-pending="">{t("personal-assistants.today.recurring")}</div>}
      </Section>
    </div>
  );
}

/** Today's events of the imported calendar (or that none was imported). */
function CalendarDay({ calendar }: { calendar: PaAgendaCalendar }) {
  const { t } = useI18n();
  if (calendar.status !== "ready") return <div className="text-caption/[inherit] text-subtle" data-pa-calendar-disconnected="">{t("personal-assistants.today.calendarDisconnected")}</div>;
  const observed = calendar.observedAt ? Date.parse(calendar.observedAt) : NaN;
  return (
    <div data-pa-calendar="">
      <div className="px-1 text-caption/[inherit] text-subtle" data-pa-calendar-source="">
        {t("personal-assistants.today.calendarSource", { source: calendar.source ?? "—", at: Number.isFinite(observed) ? formatAbsolute(Math.floor(observed / 1000)) : (calendar.observedAt ?? "—") })}
      </div>
      {calendar.items.length === 0 && <div className="px-1 text-ui/[inherit] text-subtle">{t("personal-assistants.today.calendarNone")}</div>}
      <ul data-pa-calendar-events="">
        {calendar.items.map((e) => (
          <li key={e.id} className="flex min-w-0 items-baseline gap-2 px-1 py-0.5" data-pa-calendar-event={e.id}>
            <span className="w-[5.5rem] shrink-0 font-mono text-caption/[inherit] text-subtle">{span(e, t("personal-assistants.today.allDay"))}</span>
            <span className="min-w-0 flex-1 text-ui/[inherit] break-words">{e.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An event's time on this device (an event of a whole day or more: 全天). */
function span(e: PaCalendarEvent, allDay: string): string {
  const s = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  if (Number.isFinite(s) && Number.isFinite(end) && end - s >= 86_400_000 && new Date(s).getHours() === 0 && new Date(s).getMinutes() === 0) return allDay;
  return `${time(e.startsAt)}–${time(e.endsAt)}`;
}
