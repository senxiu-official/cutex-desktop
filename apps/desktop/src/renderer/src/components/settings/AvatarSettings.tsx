import { useI18n, type MessageKey } from "../../i18n";
import { AVATAR_TINTS, setUiPref, uiPrefDefault, useUiPrefs } from "../../lib/prefs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { ResetButton, Section, Segmented, SettingRow, Toggle } from "./Form";

/** All-app display preferences: moved from Sidebar without changing either stored key. */
export function AvatarSettings() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return <Section id={settingsAnchorId("avatars")} title={t("settings.ia.avatars")} hint={t("settings.ia.avatarsHint")}  >
    <SettingRow agents="none" source="local" label={t("avatarStyle.important" as MessageKey)} hint={t("avatarStyle.importantHint" as MessageKey)}>
      <Toggle checked={ui.agentAvatarDefault === "important"} onChange={(v) => setUiPref("agentAvatarDefault", v ? "important" : "emoji")} />
    </SettingRow>
    <SettingRow agents="none" source="local" label={t("appearance.avatarTint")} hint={t("appearance.avatarTintHint")} reset={<ResetButton disabled={ui.avatarTint === uiPrefDefault("avatarTint")} onClick={() => setUiPref("avatarTint", uiPrefDefault("avatarTint"))} />}>
      <Segmented value={ui.avatarTint} options={AVATAR_TINTS.map((v) => ({ value: v, label: t(`appearance.avatarTint.${v}` as MessageKey) }))} onChange={(v) => setUiPref("avatarTint", v)} />
    </SettingRow>
  </Section>;
}
