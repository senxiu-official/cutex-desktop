// The 闹钟 status category: alarm_set reminders of one agent — ones it set (for itself or another
// agent) and ones that will wake it. Rows: time · text · who → whom · relative time; a row expands to
// the whole preview; 取消 (armed two-click, the owner's cancel) while scheduled. 已响 / 已取消 · N
// folds the recent sent / cancelled ones. Live from `cutex/alarms/changed` (store.ts).
import { useState } from "react";
import { AlarmClock, ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { AlarmView } from "../../../../shared/alarms";
import { StatusChip } from "../../components/StatusChip";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { formatAbsolute, useClock } from "../../lib/time";
import { services } from "../app";
import type { StatusBarProps } from "../slots";
import { CAPSULE_LINE, CAPSULE_ROW_ACTION, CAPSULE_ROW_MAIN, capsuleRowActions } from "../../lib/capsuleRows";
import { alarmClock, alarmParties, atMs, relativeParts } from "./model";
import { patchAlarm, useAgentAlarms } from "./store";
import type { AlarmsData } from "./useAlarmsStatus";

/** "23 分钟后" / "in 23 min". */
function useRelative(): (ms: number, now: number) => string {
  const { t } = useI18n();
  return (ms, now) => {
    const r = relativeParts(ms, now);
    return t(`alarms.rel.${r.unit}.${r.past ? "past" : "future"}` as MessageKey, { n: r.n });
  };
}

function Parties({ alarm }: { alarm: AlarmView }) {
  const { t } = useI18n();
  const p = alarmParties(alarm);
  if (p.self) return <span className="min-w-0 truncate">{t("alarms.self")}</span>;
  return (
    <span className="min-w-0 truncate">
      {p.from ?? t("alarms.owner")} → {p.to}
    </span>
  );
}

async function cancel(hostId: string, alarm: AlarmView, t: (key: MessageKey, vars?: Record<string, string | number>) => string) {
  try {
    const r = await services.daemonFor(hostId).cancelAlarm(alarm.id);
    if (r.ok) patchAlarm(hostId, r.alarm);
    else services.ui.notice(r.error.code === "alarm_already_queued" ? t("alarms.alreadySent") : t("alarms.cancelFailed", { error: r.error.message }), "error");
  } catch (e) {
    services.ui.notice(t("alarms.cancelFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
  }
}

function Row({ alarm, hostId }: { alarm: AlarmView; hostId: string }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const relative = useRelative();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useArmed();
  const ms = atMs(alarm);
  const scheduled = alarm.state === "scheduled";
  const p = alarmParties(alarm);
  const title = [
    `${formatAbsolute(Math.floor(ms / 1000))} · ${relative(ms, now)}`,
    p.self ? t("alarms.self") : `${p.from ?? t("alarms.owner")} → ${p.to}`,
    alarm.alarmId,
    alarm.lastError ? t("alarms.retrying", { error: alarm.lastError }) : null,
  ]
    .filter(Boolean)
    .join("\n");
  // lib/capsuleRows: time · text · when (meta); who → whom in the tooltip and the expanded part;
  // 取消 takes the meta's place on hover / focus. A delivery error keeps its warning visible.
  const swap = scheduled && !armed ? "group-hover/row:hidden group-focus-within/row:hidden" : "";
  return (
    <li data-capsule-row="" className="group/row rounded-lg hover:bg-hover">
      <div className="flex min-h-8 min-w-0 items-center gap-1 px-2 text-[13px]">
        <button onClick={() => setOpen(!open)} aria-expanded={open} title={title} className={`${CAPSULE_ROW_MAIN} gap-1.5`}>
          <span className={`shrink-0 font-medium tabular-nums ${scheduled ? "" : "text-subtle"}`}>{alarmClock(ms, now, locale)}</span>
          {alarm.lastError && <TriangleAlert size={12} className="shrink-0 text-warn" />}
          <span className={`min-w-0 flex-1 truncate ${scheduled ? "" : "text-subtle"} ${alarm.state === "cancelled" ? "line-through" : ""}`}>{alarm.messagePreview}</span>
          <span className={`shrink-0 text-[11px] tabular-nums ${alarm.lastError ? "text-warn-text" : "text-subtle"} ${swap}`}>{scheduled ? relative(ms, now) : t(`alarms.state.${alarm.state}` as MessageKey)}</span>
        </button>
        {scheduled && (
          <span className={capsuleRowActions(armed)}>
            {armed ? (
              <button className={`${ARMED_BUTTON} shrink-0`} onClick={() => (setArmed(false), void cancel(hostId, alarm, t))}>
                {t("alarms.cancel")}
              </button>
            ) : (
              <button onClick={() => setArmed(true)} title={t("alarms.cancelConfirm")} className={`${CAPSULE_ROW_ACTION} hover:text-danger`}>
                {t("alarms.cancel")}
              </button>
            )}
          </span>
        )}
      </div>
      {open && (
        <div className="px-2 pb-1.5 text-[11px] text-muted">
          <div className="text-subtle">
            <Parties alarm={alarm} />
          </div>
          <p className="break-words whitespace-pre-wrap">
            {alarm.messagePreview}
            {alarm.messageTruncated && "…"}
          </p>
          {alarm.lastError && <span className="mt-0.5 block text-warn">{t("alarms.retrying", { error: alarm.lastError })}</span>}
        </div>
      )}
    </li>
  );
}

/** Scheduled alarms + the 已响 / 已取消 fold. */
export function AlarmsBody({ data }: { sessionId: string; data: AlarmsData }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div>
      {data.error && data.pending.length === 0 && data.recent.length === 0 && <p data-capsule-line="" className="px-2 py-1 text-[11px] text-subtle">{t("alarms.unavailable")}</p>}
      {data.pending.length > 0 && (
        <ul>
          {data.pending.map((a) => (
            <Row key={a.id} alarm={a} hostId={data.hostId} />
          ))}
        </ul>
      )}
      {data.recent.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)} aria-expanded={open} data-capsule-line="" className={`${CAPSULE_LINE} gap-1 hover:bg-hover hover:text-foreground`}>
            <AlarmClock size={12} className="shrink-0" />
            {t("alarms.recent", { n: data.recent.length })}
            {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
          </button>
          {open && (
            <ul>
              {data.recent.map((a) => (
                <Row key={a.id} alarm={a} hostId={data.hostId} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Header meta: 2 个待响 · 下次 14:30. */
export function AlarmsMeta({ data }: { sessionId?: string; data: AlarmsData }) {
  const { t, locale } = useI18n();
  const now = useClock();
  if (data.nextAt === null) return <span>{t("alarms.recentOnly", { n: data.recent.length })}</span>;
  return (
    <>
      <span>{t("alarms.pending", { n: data.pending.length })}</span>
      <span>·</span>
      <span>{t("alarms.next", { t: alarmClock(data.nextAt, now, locale) })}</span>
    </>
  );
}

/** The collapsed line: 闹钟 · 14:30 <text> 23 分钟后 (the next one; else the latest sent). */
export function AlarmLine({ data }: { data: AlarmsData }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const relative = useRelative();
  const alarm = data.pending[0] ?? data.recent[0];
  if (!alarm) return null;
  const ms = atMs(alarm);
  return (
    <>
      <span className="text-subtle">{t("alarms.statusTitle")} ·</span> <span className="font-medium tabular-nums">{alarmClock(ms, now, locale)}</span> <span>{alarm.messagePreview}</span>{" "}
      <span className="text-subtle">{alarm.state === "scheduled" ? relative(ms, now) : t(`alarms.state.${alarm.state}` as MessageKey)}</span>
    </>
  );
}

/** Status-row chip (⏰ 2 · 14:30 ▸) with the rows in a panel floating up (placement 输入栏). */
export function AlarmsStatusBar({ sessionId, inline }: StatusBarProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const now = useClock();
  const data = useAgentAlarms(sessionId, inline);
  if (!inline || data.nextAt === null) return null;
  return (
    <StatusChip
      open={open}
      onOpenChange={setOpen}
      className="text-accent"
      title={t("alarms.statusTitle")}
      label={
        <>
          <AlarmClock size={13} />
          {t("alarms.chip", { n: data.pending.length, t: alarmClock(data.nextAt, now, locale) })}
        </>
      }
    >
      <div className="flex h-6 items-center gap-1.5 px-2 text-[11px] text-subtle tabular-nums">
        <AlarmsMeta data={data} />
      </div>
      <AlarmsBody sessionId={sessionId} data={data} />
    </StatusChip>
  );
}
