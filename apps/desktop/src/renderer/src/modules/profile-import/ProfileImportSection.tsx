// Settings → Profile → 从 CC Switch 导入: the shell's ProfileImport on the page's target host.
import { ProfileImport } from "../../components/ProfileImport";
import { Section } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useTargetHostId } from "../../lib/targetHost";

export function ProfileImportSection() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  return (
    <Section title={t("profile-import.section")} hint={t("profile-import.sectionHint")}>
      <ProfileImport hostId={hostId} />
    </Section>
  );
}
