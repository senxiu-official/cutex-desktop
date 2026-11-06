// Turn-error surface (lib/turnErrorSurface; cutex `turn-error-surface`): the agent list's small error badge
// and the conversation header's banner for an agent whose last turn failed. Both read the session
// resource's `activity.lastTurnError`. The banner also hides after a later turn starts or the owner
// closes it. The badge goes once a later turn started or the agent was opened (lib/turnErrorBanner
// settleTurnErrorBadge); timeline history stays either way.
import { useEffect, useMemo } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { SessionResource } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { featuresOf, useApp, viewOf } from "../store";
import { dismissTurnErrorBanner, laterTurnStarted, settleTurnErrorBadge, useTurnErrorBadgeSettled, useTurnErrorBannerDismissed } from "../lib/turnErrorBanner";
import { lastTurnErrorOf, offersRelogin, turnErrorSummary, turnErrorSurfaceOn, type LastTurnError } from "../lib/turnErrorSurface";
import { jumpToTurn } from "../lib/jump";
import { profileOf } from "../lib/agentList";
import { setSettingsHost } from "../lib/settingsHost";

/** The agent's last failed turn when its host shows the turn-error surface (else null). */
export function useLastTurnError(hostId: string | null | undefined, session: Pick<SessionResource, "activity"> | null | undefined): LastTurnError | null {
  const on = useApp((s) => turnErrorSurfaceOn(featuresOf(s, hostId)));
  const activity = session?.activity;
  return useMemo(() => (on ? lastTurnErrorOf({ activity: activity ?? null }) : null), [on, activity]);
}

/** A small red mark beside an agent's name in the agent list; the summary is its tooltip. */
export function TurnErrorBadge({ session, hostId }: { session: SessionResource; hostId: string | null | undefined }) {
  const { t } = useI18n();
  const error = useLastTurnError(hostId, session);
  const host = useApp((s) => hostId ?? s.hosts?.active ?? "local");
  // The agent moved on: a later turn started (the resource's active turn, or the open timeline's turns).
  const later = useApp((s) => !!error && laterTurnStarted(error, viewOf(s, host, session.cutexSessionId)?.timeline, session.runtime.activeTurnId));
  const settled = useTurnErrorBadgeSettled(host, session.cutexSessionId, error?.turnId);
  useEffect(() => {
    if (error && later && !settled) settleTurnErrorBadge(host, session.cutexSessionId, error.turnId);
  }, [host, session.cutexSessionId, error, later, settled]);
  if (!error || later || settled) return null;
  const summary = turnErrorSummary(t, error);
  return (
    <span data-testid="turn-error-badge" data-turn-error-code={error.code} role="img" aria-label={summary} title={summary} className="flex shrink-0 text-danger">
      <AlertTriangle size={11} aria-hidden />
    </span>
  );
}

/** Opens the Profile's page (its account / login rows) on the agent's host, like the composer's /logout. */
export function openProfileLogin(hostId: string, profile: string | null): void {
  if (hostId !== (useApp.getState().hosts?.active ?? "local")) setSettingsHost(hostId);
  useApp.getState().openSettings("profiles", profile ? { profile, anchor: "account" } : undefined);
}

/** Under the conversation header: what failed, 查看 (scrolls to / focuses the failed turn), 重新登录 when it repeats. */
export function TurnErrorBanner({ session, hostId }: { session: SessionResource; hostId: string }) {
  const { t } = useI18n();
  const error = useLastTurnError(hostId, session);
  const later = useApp(s => !!error && laterTurnStarted(error, viewOf(s, hostId, session.cutexSessionId)?.timeline, session.runtime.activeTurnId));
  const dismissed = useTurnErrorBannerDismissed(hostId, session.cutexSessionId, error?.turnId);
  // The owner has this agent open: its list badge has been looked at.
  useEffect(() => {
    if (error) settleTurnErrorBadge(hostId, session.cutexSessionId, error.turnId);
  }, [hostId, session.cutexSessionId, error]);
  useEffect(() => {
    if (error && later && !dismissed) dismissTurnErrorBanner(hostId, session.cutexSessionId, error.turnId);
  }, [hostId, session.cutexSessionId, error, later, dismissed]);
  if (!error || later || dismissed) return null;
  const summary = turnErrorSummary(t, error);
  const relogin = offersRelogin(error);
  const profile = profileOf(session);
  const link = "shrink-0 rounded px-1 text-meta font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none";
  return (
    <div
      data-testid="turn-error-banner"
      data-turn-error-code={error.code}
      data-side-nodrag
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger/5 py-1 pr-2 pl-3 text-meta text-danger"
    >
      <AlertTriangle size={13} className="shrink-0" aria-hidden />
      <span data-turn-error-summary="" className="min-w-0 flex-1 truncate" title={error.message || summary}>
        {summary}
      </span>
      <button type="button" data-turn-error-view="" title={t("turnError.viewHint")} onClick={() => void jumpToTurn(hostId, session.cutexSessionId, error.turnId)} className={link}>
        {t("turnError.view")}
      </button>
      {relogin && (
        <button type="button" data-turn-error-relogin="" title={profile ? t("turnError.reloginHint", { profile }) : undefined} onClick={() => openProfileLogin(hostId, profile)} className={link}>
          {t("turnError.relogin")}
        </button>
      )}
      <button type="button" data-turn-error-dismiss="" aria-label={t("common.close")} title={t("common.close")} onClick={() => dismissTurnErrorBanner(hostId, session.cutexSessionId, error.turnId)} className={link}>
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
