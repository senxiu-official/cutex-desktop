// 「今日」 (owner 2026-11-27): the assistant-only right view of an assistant's conversation (it takes the project
// view's place: the assistant's coordination project is internal). From the top: 待你确认 (发给主管 / 取消请求 on the
// card), 在办 grouped by project and host, 简报, 提醒 (with 添加) and 记一下 (a note into 备忘 the assistant reads).
// Requests come from the 个人助理 store; 提醒 from the agenda; 简报, adding a reminder and 记一下 go through the
// phase-1 contract (./phase1Contract, cutex shared types) — a host without it says so in place. `compact`: the top band of a
// portrait / narrow window (./TodayBand).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, CheckCheck, Loader, NotebookPen, Settings2, Sparkles, StickyNote } from "lucide-react";
import { useI18n } from "../../i18n";
import { Tag } from "../../components/Tag";
import type { PaAssistant, PaReminder, PaRequest } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { newActionId, requestGroup } from "../../lib/personalAssistants";
import { usePa } from "../../lib/personalAssistantStore";
import { localTimeZone } from "../../lib/dateText";
import { formatAbsolute } from "../../lib/time";
import { services } from "../app";
import { RequestCard, RequestStateTag } from "./RequestCard";
import { useDefaultAssistantRef } from "./defaultAssistant";
import { phase1 } from "./phase1Api";
import { OWNER_NOTE_DETAIL_MAX, OWNER_NOTE_TITLE_MAX, OWNER_PINS_CREATE_FEATURE, PA_REMINDERS_WRITE_FEATURE, type PaBriefView } from "./phase1Contract";
import { paErrorText, projectName, usePaHosts, usePaRefresh, usePaTick, type PaHost } from "./paHooks";

const NO_REQUESTS: readonly PaRequest[] = [];

const hhmm = (iso: string) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function Block({ icon, title, count, extra, children, attr }: { icon: ReactNode; title: string; count?: number; extra?: ReactNode; children: ReactNode; attr: string }) {
  return (
    <section className="mb-4" data-pa-today-block={attr}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-caption/[inherit] font-semibold text-subtle">
        {icon}
        {title}
        {count ? <span className="rounded-full bg-surface-2 px-1.5 text-caption/[inherit] font-medium text-muted">{count}</span> : null}
        <span className="flex-1" />
        {extra}
      </h3>
      {children}
    </section>
  );
}

const quiet = (text: string) => <div className="px-1 text-ui/[inherit] text-subtle">{text}</div>;

export function TodayView({ hostId, assistant, compact = false }: { hostId: string; assistant: PaAssistant; compact?: boolean }) {
  const { t, locale } = useI18n();
  const hosts = usePaHosts();
  const host = hosts.find((h) => h.hostId === hostId);
  usePaRefresh(useMemo(() => (host?.supported && host.online ? [host] : []), [host]));
  const requests = usePa((s) => s.byHost[hostId]?.requests[assistant.id] ?? NO_REQUESTS);
  const readOnly = !host?.online;
  const stored = useDefaultAssistantRef();
  const isDefault = stored ? stored.hostId === hostId && stored.assistantId === assistant.id : false;
  const decide = requests.filter((r) => requestGroup(r.state) === "decide");
  const open = requests.filter((r) => requestGroup(r.state) === "open");
  const settings = () => services.ui.openPage("personal-assistants.page", { host: hostId, id: assistant.id, tab: "settings" });
  return (
    <div className={compact ? "text-ui/[inherit]" : "px-3 py-3"} data-pa-today={assistant.id}>
      {!compact && (
        <header className="mb-3 flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-ui/[inherit] font-semibold">{assistant.config.name}</span>
          <span className="min-w-0 shrink-[2] truncate text-caption/[inherit] text-subtle">
            {[host?.label, new Date().toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "short" })].filter(Boolean).join(" · ")}
          </span>
          {isDefault && <Tag tone="neutral">{t("personal-assistants.default.tag")}</Tag>}
          <span className="flex-1" />
          <button type="button" className="press flex size-7 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground" title={t("personal-assistants.todayView.settings")} aria-label={t("personal-assistants.todayView.settings")} onClick={settings} data-pa-today-settings="">
            <Settings2 size={15} />
          </button>
        </header>
      )}
      {readOnly && <div className="mb-2 text-caption/[inherit] text-warn">{t("personal-assistants.offline", { host: host?.label ?? hostId })}</div>}
      <Block icon={<CheckCheck size={12} aria-hidden />} title={t("personal-assistants.todayView.decide")} count={decide.length} attr="decide">
        {decide.length === 0 ? quiet(t("personal-assistants.todayView.decideNone"))
          // The band (compact) lists them as rows that open the card; the right view shows each card.
          : compact ? <InFlight hostId={hostId} host={host} hosts={hosts} assistant={assistant} rows={decide} readOnly={readOnly} />
          : decide.map((r) => <RequestCard key={r.id} hostId={hostId} assistant={assistant} request={r} host={host} readOnly={readOnly} />)}
      </Block>
      <Block icon={<Loader size={12} aria-hidden />} title={t("personal-assistants.todayView.open")} count={open.length} attr="open">
        {open.length === 0 ? quiet(t("personal-assistants.todayView.openNone")) : <InFlight hostId={hostId} host={host} hosts={hosts} assistant={assistant} rows={open} readOnly={readOnly} />}
      </Block>
      <BriefBlock hostId={hostId} host={host} assistant={assistant} onSettings={settings} />
      <RemindersBlock hostId={hostId} host={host} assistant={assistant} readOnly={readOnly} />
      <CaptureBlock hostId={hostId} host={host} assistant={assistant} readOnly={readOnly} />
    </div>
  );
}

/** 在办 (and the band's 待你确认): requests grouped by project and host; a row opens its card. */
function InFlight({ hostId, host, hosts, assistant, rows, readOnly }: { hostId: string; host: PaHost | undefined; hosts: readonly PaHost[]; assistant: PaAssistant; rows: readonly PaRequest[]; readOnly: boolean }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState<string | null>(null);
  // A request names its project's instance (r296 `projectRef`): a project on another host is listed under that host.
  const groups = new Map<string, { where: PaHost | undefined; projectId: string; list: PaRequest[] }>();
  for (const r of rows) {
    const where = r.projectRef && r.projectRef.instanceId !== host?.instanceId ? hosts.find((h) => h.instanceId === r.projectRef!.instanceId) : host;
    const key = `${where?.hostId ?? r.projectRef?.instanceId ?? hostId}\n${r.projectId}`;
    const g = groups.get(key) ?? { where, projectId: r.projectId, list: [] };
    g.list.push(r);
    groups.set(key, g);
  }
  const ordered = [...groups].sort(([, a], [, b]) => (a.where?.label ?? "").localeCompare(b.where?.label ?? "") || projectName(a.where, a.projectId).localeCompare(projectName(b.where, b.projectId)));
  return (
    <div data-pa-today-open="">
      {ordered.map(([key, { where, projectId, list }]) => (
        <div key={key} className="mb-1.5" data-pa-today-project={projectId}>
          <div className="px-1 text-caption/[inherit] font-medium text-muted">
            {projectName(where, projectId)}
            <span className="font-normal text-subtle"> · {where?.label ?? t("personal-assistants.todayView.otherHost")}</span>
          </div>
          <ul>
            {list.map((r) => (
              <li key={r.id}>
                <button type="button" className="press flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-2/60" onClick={() => setOpened(opened === r.id ? null : r.id)} data-pa-today-request={r.id}>
                  <RequestStateTag state={r.state} />
                  <span className="min-w-0 flex-1 truncate text-ui/[inherit]">{r.outcome}</span>
                </button>
                {opened === r.id && <RequestCard hostId={hostId} assistant={assistant} request={r} host={host} readOnly={readOnly} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 简报: the latest brief, or why there is none (off by default; the times are set in 设置). */
function BriefBlock({ hostId, host, assistant, onSettings }: { hostId: string; host: PaHost | undefined; assistant: PaAssistant; onSettings(): void }) {
  const { t } = useI18n();
  const [brief, setBrief] = useState<PaBriefView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const online = !!host?.online;
  // A brief written or re-scheduled announces `brief` (cutex/personalAssistant/changed): read it again then.
  const tick = usePaTick(hostId, assistant.id, "brief");
  useEffect(() => {
    let live = true;
    if (!online) return;
    phase1.brief(hostId, host?.featureSet, assistant.id).then((b) => live && (setBrief(b), setError(null)), (e: unknown) => live && setError(paErrorText(e, t)));
    return () => {
      live = false;
    };
  }, [hostId, assistant.id, online, host?.featureSet, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- `t` only words the error
  const link = (
    <button type="button" className="press rounded-sm text-caption/[inherit] font-normal text-accent" onClick={onSettings} data-pa-brief-settings="">
      {t("personal-assistants.todayView.briefTimes")}
    </button>
  );
  // r299: a run handed to the assistant now (「08:00 的简报正在写…」) and a run that a newer slot replaced unwritten
  // (the last good brief stays shown under it).
  const status = brief && !error ? (
    <>
      {brief.stale && <div className="mb-1 px-1 text-caption/[inherit] text-warn" data-pa-brief-stale="">{t("personal-assistants.todayView.briefStale")}</div>}
      {brief.pending?.queued && <div className="mb-1 px-1 text-caption/[inherit] text-subtle" data-pa-brief-writing={brief.pending.runId}>{t("personal-assistants.todayView.briefWriting", { time: hhmm(brief.pending.scheduledAt) })}</div>}
    </>
  ) : null;
  return (
    <Block icon={<Sparkles size={12} aria-hidden />} title={t("personal-assistants.todayView.brief")} attr="brief" extra={brief ? link : null}>
      {status}
      {error ? <div className="px-1 text-caption/[inherit] text-danger">{error}</div>
        : brief === undefined ? quiet(t("personal-assistants.rail.loading"))
        : brief === null ? quiet(t("personal-assistants.todayView.briefUnsupported"))
        : brief.times.length === 0 && !brief.latest ? <div className="px-1 text-ui/[inherit] text-subtle" data-pa-brief-off="">{t("personal-assistants.todayView.briefOff")} {link}</div>
        : brief.latest ? (
          <div className="px-1" data-pa-brief="">
            <div className="text-ui/[inherit] whitespace-pre-wrap">{brief.latest.text}</div>
            <div className="mt-1 text-caption/[inherit] text-subtle">
              {t("personal-assistants.todayView.briefAt", { at: formatAbsolute(Math.floor(Date.parse(brief.latest.at) / 1000)), times: brief.times.join("、") || "—" })}
            </div>
          </div>
        )
        : brief.pending?.queued ? null
        : quiet(t("personal-assistants.todayView.briefPending", { times: brief.times.join("、") }))}
    </Block>
  );
}

/** 提醒: today's reminders (the agenda) and 添加 where the host takes it. */
function RemindersBlock({ hostId, host, assistant, readOnly }: { hostId: string; host: PaHost | undefined; assistant: PaAssistant; readOnly: boolean }) {
  const { t } = useI18n();
  const [list, setList] = useState<PaReminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const canAdd = !!host?.featureSet?.has(PA_REMINDERS_WRITE_FEATURE);
  const online = !!host?.online;
  const usable = !!assistant.sessionId;
  const load = () => {
    if (!online || !usable) return;
    const zone = host?.features.readiness ? localTimeZone() : undefined;
    hostApi(hostId).paAgenda(assistant.id, { limit: 50, ...(zone ? { displayTimezone: zone } : {}) }).then((a) => (setList(a.reminders), setError(null)), (e: unknown) => setError(paErrorText(e, t)));
  };
  // The same areas as the agenda card (AgendaCard): a reminder added or delivered elsewhere shows up.
  const tick = usePaTick(hostId, assistant.id, "requests", "calendar", "assistant");
  useEffect(load, [hostId, assistant.id, online, usable, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- read on open and on change
  const add = async () => {
    const [h, m] = time.split(":").map(Number);
    if (!text.trim() || !Number.isFinite(h) || !Number.isFinite(m)) return;
    const at = new Date();
    at.setHours(h!, m!, 0, 0);
    setBusy(true);
    try {
      const r = await phase1.addReminder(hostId, assistant.id, { actionId: newActionId("reminder"), at: at.toISOString(), message: text.trim() });
      setList((cur) => [...(cur ?? []), r].sort((a, b) => a.at.localeCompare(b.at)));
      setAdding(false);
      setText("");
      setTime("");
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const addButton = (
    <button type="button" className="press rounded-sm text-caption/[inherit] font-normal text-accent disabled:text-subtle" disabled={!canAdd || readOnly} title={canAdd ? undefined : t("personal-assistants.todayView.reminderAddUnsupported")} onClick={() => setAdding(true)} data-pa-reminder-add="">
      ＋ {t("personal-assistants.todayView.reminderAdd")}
    </button>
  );
  return (
    <Block icon={<Bell size={12} aria-hidden />} title={t("personal-assistants.todayView.reminders")} count={list?.length} attr="reminders" extra={addButton}>
      {error && <div className="px-1 text-caption/[inherit] text-danger">{error}</div>}
      {adding && (
        <div className="mb-1.5 flex items-center gap-1.5 px-1" data-pa-reminder-form="">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-7 rounded-md border border-border bg-surface px-1.5 text-ui/[inherit]" aria-label={t("personal-assistants.todayView.reminderTime")} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("personal-assistants.todayView.reminderText")} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-ui/[inherit]" onKeyDown={(e) => e.key === "Enter" && void add()} />
          <button type="button" className="press h-7 rounded-md bg-accent px-2 text-caption/[inherit] text-on-accent disabled:opacity-50" disabled={busy || !text.trim() || !time} onClick={() => void add()}>
            {t("personal-assistants.todayView.reminderSave")}
          </button>
          <button type="button" className="press h-7 rounded-md px-1.5 text-caption/[inherit] text-subtle" onClick={() => setAdding(false)}>
            {t("personal-assistants.todayView.cancel")}
          </button>
        </div>
      )}
      {list === null ? (usable ? quiet(t("personal-assistants.rail.loading")) : null)
        : list.length === 0 ? quiet(t("personal-assistants.today.remindersNone"))
        : (
          <ul data-pa-today-reminders="">
            {list.map((r) => (
              <li key={r.alarmId} className="flex min-w-0 items-baseline gap-2 px-1 py-0.5" data-pa-reminder={r.alarmId}>
                <span className="w-11 shrink-0 font-mono text-caption/[inherit] text-subtle">{hhmm(r.at)}</span>
                <span className="min-w-0 flex-1 text-ui/[inherit] break-words">{r.message}</span>
              </li>
            ))}
          </ul>
        )}
    </Block>
  );
}

/** 记一下: a note into 备忘 (an owner pin of kind `note`, under the assistant so it reads it). */
function CaptureBlock({ hostId, host, assistant, readOnly }: { hostId: string; host: PaHost | undefined; assistant: PaAssistant; readOnly: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const can = !!host?.featureSet?.has(OWNER_PINS_CREATE_FEATURE);
  const save = async () => {
    const body = text.trim();
    if (!body) return;
    const [title, ...rest] = body.split("\n");
    setBusy(true);
    try {
      await phase1.captureMemo(hostId, { actionId: newActionId("memo"), kind: "note", title: title!.slice(0, OWNER_NOTE_TITLE_MAX), detail: rest.join("\n").trim().slice(0, OWNER_NOTE_DETAIL_MAX) || null, agentId: assistant.sessionId });
      setText("");
      setNote({ ok: true, text: t("personal-assistants.todayView.captured") });
    } catch (e) {
      setNote({ ok: false, text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const memo = (
    <button type="button" className="press rounded-sm text-caption/[inherit] font-normal text-accent" onClick={() => services.side.open("bookmarks.list", { tab: "pins" })} data-pa-open-memo="">
      {t("personal-assistants.todayView.openMemo")}
    </button>
  );
  return (
    <Block icon={<NotebookPen size={12} aria-hidden />} title={t("personal-assistants.todayView.capture")} attr="capture" extra={memo}>
      <div className="flex items-start gap-1.5 px-1">
        <textarea
          value={text}
          onChange={(e) => (setText(e.target.value), setNote(null))}
          rows={2}
          disabled={!can || readOnly || busy}
          placeholder={can ? t("personal-assistants.todayView.capturePlaceholder") : t("personal-assistants.todayView.captureUnsupported")}
          className="min-h-[2.25rem] min-w-0 flex-1 resize-none rounded-md border border-border bg-surface px-2 py-1 text-ui/[inherit] disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-pa-capture=""
        />
        <button type="button" className="press flex h-8 items-center gap-1 rounded-md bg-accent px-2 text-caption/[inherit] text-on-accent disabled:opacity-50" disabled={!can || readOnly || busy || !text.trim()} onClick={() => void save()} data-pa-capture-save="">
          <StickyNote size={12} aria-hidden />
          {t("personal-assistants.todayView.captureSave")}
        </button>
      </div>
      {note && <div className={`mt-1 px-1 text-caption/[inherit] ${note.ok ? "text-subtle" : "text-danger"}`} role="status" data-pa-capture-note={note.ok ? "ok" : "error"}>{note.text}</div>}
    </Block>
  );
}
