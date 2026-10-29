import { Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { setUiPref, useUiPrefs } from "../../lib/prefs";

export function ViewerSettings() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return <Section title={t("workspace.preview")}><SettingRow agents="none" source="local" label={t("workspace.autoRefresh")} info={t("workspace.autoRefreshHint")}><Toggle checked={ui.viewerAutoRefresh} onChange={(value) => setUiPref("viewerAutoRefresh", value)} /></SettingRow></Section>;
}
