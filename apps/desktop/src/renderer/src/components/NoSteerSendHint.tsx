// Composer hint for a runtime without steering (DSH; lacks(agent, "turnSteer")): while a turn runs, a
// typed message cannot reach the running turn, so say before sending that it waits for the next turn.
// Same rule as the send button's 「排队」 label and queue.steer.runtimeNoSteer (docs/design/042).
import { useI18n } from "../i18n";

export function NoSteerSendHint() {
  const { t } = useI18n();
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-2 text-caption/[inherit] text-subtle" data-testid="no-steer-send" role="status">
      <span className="min-w-0 flex-1 truncate" title={t("composer.noSteerHint")}>{t("composer.noSteerHint")}</span>
    </div>
  );
}
