// The 外部 marker next to an external plugin's module name, navigation entry or page title (O5).
import { useI18n } from "../i18n";

export function ExternalBadge() {
  const { t } = useI18n();
  return (
    <span title={t("modules.externalHint")} className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 font-normal text-subtle">
      {t("modules.external")}
    </span>
  );
}
