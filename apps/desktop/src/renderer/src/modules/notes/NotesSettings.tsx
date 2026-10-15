import { Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { services } from "../app";
import { useModulePref } from "../react";

export function NotesSettings() {
  const { t } = useI18n();
  const [show, setShow] = useModulePref<boolean>("notes", "showTimeline", true);
  return <Section title={t("notes.settings")}><SettingRow label={t("notes.showTimeline")} hint={t("notes.showTimelineHint")}><Toggle checked={show} onChange={(next) => { try { setShow(next); } catch (e) { services.ui.notice(String(e), "error"); } }} /></SettingRow></Section>;
}
