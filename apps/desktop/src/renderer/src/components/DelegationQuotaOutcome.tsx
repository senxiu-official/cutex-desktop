import type { AskSummary } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { useDelegationQuota } from "../lib/delegationHoldText";

const REASONS: Record<string, string> = {
  archived: "archived", offline: "offline", runtimeOffline: "offline",
  runtimeRestarted: "runtimeRestarted", paused: "paused", asksRedelivered: "asksRedelivered",
  owner: "owner", ownerMessage: "owner", ownerStop: "owner",
  turnCompleted: "turnCompleted", resetUnknown: "resetUnknown",
};

/** Handler-wide history, deliberately independent of this ask's execution and resume state. */
export function DelegationQuotaOutcome({ d, host }: { d: AskSummary; host: string }) {
  const { t, locale } = useI18n();
  const last = useDelegationQuota(host, d)?.last;
  if (!last) return null;
  const result = last.result === "fired" ? (last.reason === "queued" ? "queued" : "sent") : last.result;
  const reason = last.result !== "fired" && last.reason && Object.hasOwn(REASONS, last.reason) ? REASONS[last.reason] : null;
  const ms = Date.parse(last.at);
  const at = Number.isFinite(ms) ? new Date(ms).toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="mt-1 text-caption/[inherit] text-subtle" data-delegation-quota-outcome="">
      <span>{t("delegation.quotaRecovery.title" as MessageKey)}</span>
      {" · "}<span>{t(`delegation.quotaRecovery.${result}` as MessageKey)}</span>
      {reason ? <> · {t(`delegation.quotaRecovery.reason.${reason}` as MessageKey)}</> : null}
      {at ? <> · <time dateTime={last.at}>{at}</time></> : null}
    </div>
  );
}
