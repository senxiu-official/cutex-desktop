// 结束跟进 on a capsule row whose outcome can't be confirmed (sub-agents / background terminals of a disconnected agent,
// lib/localFollowUp). Medium risk: confirmed in place (the first click arms, 「再左键点击一次，结束跟进」), the hover says
// what it does and does not do (followUp.confirm).
import { useI18n } from "../i18n";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";
import { CAPSULE_ROW_ACTION } from "../lib/capsuleRows";

export function LocalEndFollowUp({ onEnd }: { onEnd(): void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  return (
    <button
      data-end-follow-up=""
      data-tip={t("followUp.confirm")}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onEnd();
      }}
      className={armed ? `${ARMED_BUTTON} shrink-0` : `${CAPSULE_ROW_ACTION} hover:text-foreground`}
    >
      {armed ? t("followUp.confirmButton") : t("followUp.end")}
    </button>
  );
}
