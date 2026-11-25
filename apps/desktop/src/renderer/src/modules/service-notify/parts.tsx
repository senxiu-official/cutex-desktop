// Shared pieces of 服务通知: the settings card of one service, its quiet hours and the history list. Titles and bodies are only rendered, never logged or copied anywhere.
import type { ServiceView } from "../../../../shared/ipc";
import type { ServiceNotificationConfiguration, ServiceNotificationEntry, ServiceNotificationRetention, ServiceNotificationSettings } from "../../../../shared/serviceNotifications";
import { Button, EmptyState, ErrorNote, ListRow, Loading, Notice, RowGroup, Section, Select, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { FIELD_W } from "../../lib/fieldWidths";
import { settingsAnchorId } from "../../lib/settingsNav";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { services as moduleServices } from "../app";
import type { HistoryState, ServiceSettingsState } from "./data";
import { crossesMidnight, DEFAULT_QUIET, entryOpenTarget, groupHistory, minuteLabel, minuteOptions, phoneState, timezoneLabel, WHATSAPP_SLUG, withQuietEnd } from "./model";
import { openServiceNotification } from "./open";

export function SettingsCard({ slug, state }: { slug: string; state: ServiceSettingsState }) {
  const { t } = useI18n();
  const s = state.shown;
  const whatsapp = slug === WHATSAPP_SLUG;
  const chip = state.saving ? <span className="text-xs text-subtle" role="status">{t("service-notify.settings.saving")}</span> : null;
  return (
    <Section id={settingsAnchorId("alerts")} title={t("service-notify.settings.title")} hint={t("service-notify.settings.hint")} actions={chip}>
      {state.loadError ? (
        <ErrorNote>
          {state.loadError} <Button onClick={state.reload}>{t("service-notify.settings.retry")}</Button>
        </ErrorNote>
      ) : !s ? (
        <Loading rows={3} />
      ) : (
        <>
          {state.saveError && (
            <ErrorNote>
              {t("service-notify.settings.saveFailed", { error: state.saveError })} <Button onClick={state.retry}>{t("service-notify.settings.retry")}</Button>
            </ErrorNote>
          )}
          {s.enabled && !whatsapp && state.config && !state.config.credentialConfigured && <Notice tone="info">{t("service-notify.settings.noCredential")}</Notice>}
          <SettingRow agents="none" source="host" label={t("service-notify.settings.enabled")} hint={t("service-notify.settings.enabledHint")}>
            <Toggle checked={s.enabled} onChange={(enabled) => state.save({ ...s, enabled })} />
          </SettingRow>
          <SettingRow agents="none" source="host" label={t("service-notify.settings.desktop")} hint={t("service-notify.settings.desktopHint")}>
            <Toggle checked={s.desktop} disabled={!s.enabled} onChange={(desktop) => state.save({ ...s, desktop })} />
          </SettingRow>
          <PhoneRow settings={s} config={state.config} save={state.save} />
          <SettingRow agents="none" source="host" label={t("service-notify.settings.retain")} hint={whatsapp ? t("service-notify.settings.retainWhatsApp") : t("service-notify.settings.retainHint")}>
            <Toggle checked={whatsapp ? false : s.retainContent} disabled={whatsapp || !s.enabled} onChange={(retainContent) => state.save({ ...s, retainContent })} />
          </SettingRow>
          <QuietRows settings={s} save={state.save} timezone={timezoneLabel(state.config?.timezone)} />
        </>
      )}
    </Section>
  );
}

/**
 * 手机通知: no Android paired with full owner scope → the switch can only be turned off (greyed while off); paired but
 * not reporting lately → it stays usable with a warning; unknown (older host / not read) → the generic hint.
 */
function PhoneRow({ settings: s, config, save }: { settings: ServiceNotificationSettings; config: ServiceNotificationConfiguration | null; save(next: ServiceNotificationSettings): void }) {
  const { t } = useI18n();
  const phone = phoneState(config?.phone);
  const hint = phone === "unpaired" ? t("service-notify.settings.phoneUnpaired") : phone === "away" ? t("service-notify.settings.phoneAway") : t("service-notify.settings.phoneHint");
  return (
    <SettingRow agents="none" source="host" label={t("service-notify.settings.phone")} hint={hint}>
      <Toggle checked={s.phone} disabled={!s.enabled || (phone === "unpaired" && !s.phone)} onChange={(on) => save({ ...s, phone: on })} />
    </SettingRow>
  );
}

function QuietRows({ settings: s, save, timezone }: { settings: ServiceNotificationSettings; save(next: ServiceNotificationSettings): void; timezone: string | null }) {
  const { t } = useI18n();
  const q = s.quietHours;
  const options = (end: "start" | "end", value: number) =>
    minuteOptions(value)
      // The other end's time is not offered: start and end must differ.
      .filter((m) => m === value || (end === "start" ? m !== q?.endMinute : m !== q?.startMinute))
      .map((m) => ({ value: String(m), label: minuteLabel(m) }));
  const pick = (end: "start" | "end", v: string) => {
    const next = q && withQuietEnd(q, end, Number(v));
    if (next) save({ ...s, quietHours: next });
  };
  return (
    <RowGroup title={t("service-notify.quiet.title")} hint={t("service-notify.quiet.hint")}>
      <SettingRow agents="none" source="host" label={t("service-notify.quiet.on")} hint={timezone ? t("service-notify.quiet.timezone", { zone: timezone }) : undefined}>
        <Toggle checked={!!q} disabled={!s.enabled} onChange={(on) => save({ ...s, quietHours: on ? DEFAULT_QUIET : null })} />
      </SettingRow>
      {q && (
        <>
          <SettingRow agents="none" source="host" label={t("service-notify.quiet.start")}>
            <Select width={FIELD_W.effort} value={String(q.startMinute)} disabled={!s.enabled} options={options("start", q.startMinute)} onChange={(v) => pick("start", v)} />
          </SettingRow>
          <SettingRow agents="none" source="host" label={t("service-notify.quiet.end")} hint={crossesMidnight(q) ? t("service-notify.quiet.nextDay", { time: minuteLabel(q.endMinute) }) : undefined}>
            <Select width={FIELD_W.effort} value={String(q.endMinute)} disabled={!s.enabled} options={options("end", q.endMinute)} onChange={(v) => pick("end", v)} />
          </SettingRow>
        </>
      )}
    </RowGroup>
  );
}

/** One history entry; 打开 only for a target that still resolves to a registered service. */
export function HistoryRow({ entry, hostId, services, showService, now }: { entry: ServiceNotificationEntry; hostId: string; services: readonly ServiceView[] | null; showService: boolean; now: number }) {
  const { t, locale } = useI18n();
  const target = entryOpenTarget(entry, services);
  const when = formatWhen(entry.createdAt, now, locale);
  const detail = [showService ? entry.serviceName || entry.slug : null, entry.body ?? null].filter(Boolean).join(" · ");
  return (
    <ListRow
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          {entry.priority === "high" && <span className="shrink-0 rounded bg-warn/15 px-1 text-meta font-medium text-warn">{t("service-notify.history.high")}</span>}
          <span className="min-w-0 truncate">{entry.title}</span>
        </span>
      }
      detail={
        <span>
          <time dateTime={new Date(entry.createdAt * 1000).toISOString()} title={formatAbsolute(entry.createdAt)}>
            {when}
          </time>
          {detail ? ` · ${detail}` : entry.body === null && !showService ? ` · ${t("service-notify.history.noContent")}` : ""}
        </span>
      }
      actions={
        target ? (
          <Button title={t("service-notify.history.openHint")} onClick={() => void openServiceNotification({ hostId, slug: target.slug, id: entry.id, path: target.path }, moduleServices.side)}>
            {t("service-notify.history.open")}
          </Button>
        ) : undefined
      }
    />
  );
}

/** A history list: flat for one service, grouped by service for all (按来源聚合). */
export function HistoryList({ history, hostId, services, grouped, max }: { history: HistoryState; hostId: string; services: readonly ServiceView[] | null; grouped: boolean; max?: number }) {
  const { t } = useI18n();
  const now = useClock();
  if (history.error && !history.entries) {
    return (
      <ErrorNote>
        {history.error} <Button onClick={history.reload}>{t("service-notify.settings.retry")}</Button>
      </ErrorNote>
    );
  }
  if (!history.entries) return <Loading rows={3} />;
  if (!history.entries.length) return <EmptyState>{t("service-notify.history.empty")}</EmptyState>;
  const entries = max ? history.entries.slice(0, max) : history.entries;
  const bound = !max && history.atBound && <p className="pt-2 text-xs text-subtle">{t("service-notify.history.bound")}</p>;
  const more = !max && history.more && (
    <div className="pt-2">
      <Button disabled={history.loading} onClick={history.loadMore}>
        {history.loading ? t("service-notify.summary.loading") : t("service-notify.history.more")}
      </Button>
    </div>
  );
  const error = history.error && <ErrorNote>{history.error}</ErrorNote>;
  if (!grouped) {
    return (
      <>
        {entries.map((e) => <HistoryRow key={e.id} entry={e} hostId={hostId} services={services} showService={false} now={now} />)}
        {error}
        {more}
        {bound}
      </>
    );
  }
  return (
    <>
      {groupHistory(entries).map((g) => (
        <RowGroup key={g.slug} title={g.name} hint={t("service-notify.history.count", { n: g.entries.length })}>
          {g.entries.map((e) => <HistoryRow key={e.id} entry={e} hostId={hostId} services={services} showService={false} now={now} />)}
        </RowGroup>
      ))}
      {error}
      {more}
      {bound}
    </>
  );
}

/** The host's history bounds as one hint (older hosts: the fixed 7 天 / 200 text). */
export function RetentionHint({ retention }: { retention: ServiceNotificationRetention | null }) {
  const { t } = useI18n();
  if (!retention) return <>{t("service-notify.history.hint")}</>;
  const days = Math.max(1, Math.round(retention.maxAgeSeconds / 86_400));
  return <>{t("service-notify.history.retention", { days, perService: retention.maxPerService, perHost: retention.maxPerHost })}</>;
}
