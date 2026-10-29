import { useEffect } from "react";
import { useI18n } from "../../i18n";
import { NumberField, Section, SettingRow, Toggle } from "../../components/settings/Form";
import { refreshCopies, runCopyAction, useCopies } from "../../lib/remoteCopies";
export function CopySettings() {
  const { t } = useI18n();
  const settings = useCopies(s => s.state?.settings);
  useEffect(() => { void refreshCopies(); }, []);
  const days = settings?.retentionDays;
  return <Section title={t("remote-copies.settings")} hint={t("remote-copies.hint")}>
    <SettingRow agents="none" source="local" label={t("remote-copies.retention")} hint={t("remote-copies.retentionHint")}><div className="flex items-center gap-2"><Toggle checked={days !== null} onChange={on => void runCopyAction({ kind: "settings", retentionDays: on ? 7 : null })} />{days !== null && <NumberField value={days ?? 7} range={[1, 3650]} unit={t("remote-copies.days")} onCommit={v => { if (v !== null) void runCopyAction({ kind: "settings", retentionDays: v }); }} />}</div></SettingRow>
  </Section>;
}
