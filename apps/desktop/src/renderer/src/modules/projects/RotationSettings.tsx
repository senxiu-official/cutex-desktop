// Settings → 协作 → 轮换主管 (cutex `owner-rotation`): the default handoff wait of the rotation dialog.
import { useI18n } from "../../i18n";
import { Section, Select, SettingRow } from "../../components/settings/Form";
import { HANDOFF_MINUTE_CHOICES, setHandoffMinutes, useHandoffMinutes } from "./rotationPrefs";
import { minutesLabel } from "./rotationView";

export function RotationSettingsSection() {
  const { t } = useI18n();
  const minutes = useHandoffMinutes();
  const options = (HANDOFF_MINUTE_CHOICES as readonly number[]).map((n) => ({ value: String(n), label: minutesLabel(n, t) }));
  return (
    <Section title={t("projects.rotation.settings")}>
      <SettingRow label={t("projects.rotation.settingsHandoff")} hint={t("projects.rotation.settingsHandoffHint")}>
        <Select value={String(minutes)} options={options} onChange={(v) => setHandoffMinutes(Number(v))} />
      </SettingRow>
    </Section>
  );
}
