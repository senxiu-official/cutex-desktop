// 设置 → 对话 → 成果: what happens when the agent in view publishes (autoOpen.ts).
import { Section, Select, SettingRow } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { services } from "../app";
import { useModulePref } from "../react";
import { AUTO_OPEN_PREF, AUTO_OPEN_SETTINGS, autoOpenSetting, DEFAULT_AUTO_OPEN, type AutoOpenSetting } from "./autoOpen";

export function ArtifactSettings() {
  const { t } = useI18n();
  const [raw, set] = useModulePref<string>("artifacts", AUTO_OPEN_PREF, DEFAULT_AUTO_OPEN);
  return (
    <Section title={t("artifacts.settings")}>
      <SettingRow label={t("artifacts.autoOpen")} hint={t("artifacts.autoOpenHint")}>
        <Select<AutoOpenSetting>
          value={autoOpenSetting(raw)}
          options={AUTO_OPEN_SETTINGS.map((value) => ({ value, label: t(`artifacts.autoOpen.${value}`) }))}
          onChange={(value) => {
            try {
              set(value);
            } catch (e) {
              services.ui.notice(String(e), "error");
            }
          }}
        />
      </SettingRow>
    </Section>
  );
}
