import { Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { services } from "../app";
import { useModulePref } from "../react";
export function BookmarksSettings() {
  const { t } = useI18n();
  const [show, setShow] = useModulePref<boolean>("bookmarks", "showRibbon", true);
  return <Section title={t("bookmarks.settings")}><SettingRow label={t("bookmarks.showRibbon")} hint={t("bookmarks.showRibbonHint")}><Toggle checked={show} onChange={(v) => { try { setShow(v); } catch (e) { services.ui.notice(String(e), "error"); } }} /></SettingRow></Section>;
}
