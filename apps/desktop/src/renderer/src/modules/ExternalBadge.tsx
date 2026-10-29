// The 外部 marker next to an external plugin's module name, navigation entry or page title (O5).
import { useI18n } from "../i18n";
import { Tag } from "../components/Tag";

export function ExternalBadge() {
  const { t } = useI18n();
  return (
    <Tag title={t("modules.externalHint")}>
      {t("modules.external")}
    </Tag>
  );
}
