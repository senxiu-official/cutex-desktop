// Settings → 应用 → 通知 → 服务通知 (host part: the Settings target host). One row per service (R6: the first
// SERVICES_ON_PAGE, then 「全部 N 个服务」); a row opens that service's page. Hidden on a host without
// service-notifications-v1.
import type { ServiceView } from "../../../../shared/ipc";
import { SERVICE_NOTIFICATIONS_FEATURE } from "../../../../shared/serviceNotifications";
import { EmptyState, ErrorNote, Loading, Section, SubPageRow, TextLink } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useFocusHostId, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useHostServices, useServiceSettings } from "./data";
import { channelSummary, crossesMidnight, quietRange, SERVICES_ON_PAGE } from "./model";
import type { ServiceNotificationSettings } from "../../../../shared/serviceNotifications";
import { openServiceNotifyHistory, openServiceNotifySettings } from "./nav";

export function ServiceNotifySection() {
  const supported = useTargetFeatures().has(SERVICE_NOTIFICATIONS_FEATURE);
  return supported ? <ServiceNotifyCard /> : null;
}

function ServiceNotifyCard() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  const { services, error } = useHostServices(hostId, focus);
  return (
    <Section
      id={settingsAnchorId("service-notifications")}
      title={t("service-notify.section.title")}
      hint={t("service-notify.section.hint")}
      actions={<TextLink onClick={() => openServiceNotifyHistory(null)}>{t("service-notify.section.history")}</TextLink>}
    >
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : !services ? (
        <Loading rows={2} />
      ) : !services.length ? (
        <EmptyState>{t("service-notify.section.empty")}</EmptyState>
      ) : (
        <>
          {services.slice(0, SERVICES_ON_PAGE).map((s) => <ServiceRow key={s.slug} service={s} hostId={hostId} focus={focus} />)}
          {services.length > SERVICES_ON_PAGE && <SubPageRow title={t("service-notify.section.all", { n: services.length })} onOpen={() => openServiceNotifySettings(null)} />}
        </>
      )}
    </Section>
  );
}

function ServiceRow({ service, hostId, focus }: { service: ServiceView; hostId: string; focus: string }) {
  const { t } = useI18n();
  const state = useServiceSettings(hostId, focus, service.slug);
  const summary = useSummaryText(state.config?.settings ?? null, !!state.loadError);
  return <SubPageRow title={service.displayName || service.slug} summary={summary} onOpen={() => openServiceNotifySettings(service.slug)} />;
}

/** One line about a service's settings (通知 page rows). */
function useSummaryText(s: ServiceNotificationSettings | null, failed: boolean): string {
  const { t } = useI18n();
  if (failed) return t("service-notify.summary.unavailable");
  if (!s) return t("service-notify.summary.loading");
  const parts = [t(`service-notify.summary.${channelSummary(s)}` as const)];
  if (s.enabled && s.quietHours) parts.push(t("service-notify.summary.quiet", { range: quietRange(s.quietHours) }) + (crossesMidnight(s.quietHours) ? t("service-notify.summary.nextDay") : ""));
  return parts.join(" · ");
}

