// 设置 → 对话 → 成果: what happens when the agent in view publishes (autoOpen.ts), and what agent pages saved
// on this computer (pageData.tsx).
import { Notice, Section, Select, SettingRow, TextLink } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { services } from "../app";
import { useModulePref, useSlot } from "../react";
import { useApp } from "../../store";
import { AUTO_OPEN_PREF, AUTO_OPEN_SETTINGS, autoOpenSetting, DEFAULT_AUTO_OPEN, type AutoOpenSetting } from "./autoOpen";

export function ArtifactSettings() {
  const { t } = useI18n();
  const [raw, set] = useModulePref<string>("artifacts", AUTO_OPEN_PREF, DEFAULT_AUTO_OPEN);
  const storageAvailable = useSlot("settings.page").some((e) => e.item.page === "storage" && e.mode === "show");
  return (
    <>
    <Section title={t("artifacts.settings")} actions={storageAvailable ? <TextLink onClick={() => useApp.getState().openSettings("storage")}>{t("settings.ia.storageLink")}</TextLink> : undefined}>
      <SettingRow agents="none" source="local" label={t("artifacts.autoOpen")} info={t("artifacts.autoOpenHint")}>
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
      <Notice tone="info">{t("settings.ia.pageDataLink")}</Notice>
    </Section>
    </>
  );
}
