// Settings → 通知 → 服务通知 (a detail page under 通知, Settings target host): pick a service, its alerts
// and quiet hours, and its latest history (「全部记录」: the
// history sub-page, filterable by service, grouped by source).
import { useEffect } from "react";
import { SERVICE_NOTIFICATIONS_FEATURE } from "../../../../shared/serviceNotifications";
import { EmptyState, ErrorNote, Loading, Section, Select, SettingRow, SubPageRow } from "../../components/settings/Form";
import { SettingsHostPart } from "../../components/SettingsHostFrame";
import { useI18n } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { useFocusHostId, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useHistory, useHostServices, useServiceSettings } from "./data";
import { HISTORY_ON_PAGE, HISTORY_PAGE_SIZE } from "./model";
import { openServiceNotifyHistory, useServiceNotifyNav } from "./nav";
import { HistoryList, RetentionHint, SettingsCard } from "./parts";

export function ServiceNotifyPage() {
  return (
    <SettingsHostPart>
      <ServiceNotifyHost />
    </SettingsHostPart>
  );
}

function ServiceNotifyHost() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  const supported = useTargetFeatures().has(SERVICE_NOTIFICATIONS_FEATURE);
  const { services, error } = useHostServices(hostId, focus);
  const wanted = useServiceNotifyNav((s) => s.slug);
  const slug = services?.find((s) => s.slug === wanted)?.slug ?? services?.[0]?.slug ?? null;
  // Remember the shown service (a host switch keeps it when that host has it too).
  useEffect(() => {
    if (slug && slug !== wanted) useServiceNotifyNav.setState({ slug });
  }, [slug, wanted]);
  const settings = useServiceSettings(hostId, focus, supported ? slug : null);
  const history = useHistory(hostId, focus, slug, HISTORY_ON_PAGE, supported && !!slug);
  if (!supported) return <Section title={t("service-notify.page")} hint={t("service-notify.upgrade")} />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!services) return <Loading rows={4} />;
  if (!services.length || !slug) return <EmptyState>{t("service-notify.service.none")}</EmptyState>;
  return (
    <>
      <Section id={settingsAnchorId("service")} title={t("service-notify.service.title")}>
        <SettingRow agents="none" source="host" navigation label={t("service-notify.service.label")}>
          <Select value={slug} options={services.map((s) => ({ value: s.slug, label: s.displayName || s.slug }))} onChange={(v) => useServiceNotifyNav.setState({ slug: v })} />
        </SettingRow>
      </Section>
      <SettingsCard slug={slug} state={settings} />
      <Section id={settingsAnchorId("history")} title={t("service-notify.history.title")} hint={<RetentionHint retention={history.retention} />}>
        <HistoryList history={history} hostId={hostId} services={services} grouped={false} max={HISTORY_ON_PAGE} />
        {!!history.entries?.length && <SubPageRow title={t("service-notify.history.all")} onOpen={() => openServiceNotifyHistory(slug)} />}
      </Section>
    </>
  );
}

/** 全部记录: every entry the host keeps, by service (filter), newest first, paged with 加载更早的. */
export function ServiceNotifyHistoryPage() {
  return (
    <SettingsHostPart>
      <HistoryHost />
    </SettingsHostPart>
  );
}

function HistoryHost() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  const supported = useTargetFeatures().has(SERVICE_NOTIFICATIONS_FEATURE);
  const { services } = useHostServices(hostId, focus);
  const service = useServiceNotifyNav((s) => s.historyService);
  const history = useHistory(hostId, focus, service, HISTORY_PAGE_SIZE, supported);
  if (!supported) return <Section title={t("service-notify.history.title")} hint={t("service-notify.upgrade")} />;
  const options = [{ value: "", label: t("service-notify.history.allServices") }, ...(services ?? []).map((s) => ({ value: s.slug, label: s.displayName || s.slug }))];
  if (service && !options.some((o) => o.value === service)) options.push({ value: service, label: service });
  return (
    <Section id={settingsAnchorId("history-all")} hint={<RetentionHint retention={history.retention} />}>
      <SettingRow agents="none" source="host" navigation label={t("service-notify.history.filter")}>
        <Select value={service ?? ""} options={options} onChange={(v) => useServiceNotifyNav.setState({ historyService: v || null })} />
      </SettingRow>
      <HistoryList history={history} hostId={hostId} services={services} grouped={!service} />
    </Section>
  );
}
