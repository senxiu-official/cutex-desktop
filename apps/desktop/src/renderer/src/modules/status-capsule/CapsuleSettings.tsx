// Settings → 状态显示 → 胶囊外观: the capsule's own geometry (corner, edge, always show, size). A
// `settings.section` of this module on the shell's page, so it goes away with the module; the
// generic 放在哪里 table stays with the shell. Values are ui / appearance prefs and survive turning
// the module off.
import { useI18n, type MessageKey } from "../../i18n";
import { CAPSULE_CORNERS } from "../../lib/capsuleLayout";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { AppearanceNumberRow } from "../../components/settings/AppearanceRows";
import { Section, Segmented, SettingRow, Toggle } from "../../components/settings/Form";

export function CapsuleSettingsSection() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
    <Section title={t("status-capsule.section")}>
      <SettingRow label={t("status-capsule.corner")} hint={t("status-capsule.corner.hint")}>
        <Segmented
          value={ui.capsuleCorner}
          options={CAPSULE_CORNERS.map((c) => ({ value: c, label: t(`status-capsule.corner.${c}` as MessageKey) }))}
          onChange={(v) => setUiPref("capsuleCorner", v)}
        />
      </SettingRow>
      <SettingRow label={t("status-capsule.edge")} hint={t("status-capsule.edge.hint")}>
        <Segmented
          value={ui.capsuleEdge}
          options={[
            { value: "window" as const, label: t("status-capsule.edge.window") },
            { value: "content" as const, label: t("status-capsule.edge.content") },
          ]}
          onChange={(v) => setUiPref("capsuleEdge", v)}
        />
      </SettingRow>
      <SettingRow label={t("status-capsule.always")} hint={t("status-capsule.always.hint")}>
        <Toggle checked={ui.capsuleAlways} onChange={(v) => setUiPref("capsuleAlways", v)} />
      </SettingRow>
      <AppearanceNumberRow field="capsuleScale" label="status-capsule.scale" hint="status-capsule.scaleHint" unit="%" step={5} />
    </Section>
  );
}
