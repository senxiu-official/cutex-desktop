// CC Switch providers are independent of Claude accounts; only their card folds.
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ProfileImport, type ProfileImportStatus } from "../../components/ProfileImport";
import { Section, SettingsGroup } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useTargetHostId } from "../../lib/targetHost";

const openKey = (hostId: string) => `cutex-desktop.profile-import.open:${hostId}`;
function readOpen(hostId: string): boolean {
  try { return sessionStorage.getItem(openKey(hostId)) === "1"; } catch { return false; }
}

export function ProfileImportSection() {
  const hostId = useTargetHostId();
  return <ImportSection key={hostId} hostId={hostId} />;
}

function ImportSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const panelId = useId();
  const [open, setOpen] = useState(() => readOpen(hostId));
  const [status, setStatus] = useState<ProfileImportStatus | null>(null);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { sessionStorage.setItem(openKey(hostId), next ? "1" : "0"); } catch { /* Per-mount state if storage is unavailable. */ }
  };
  return <Section collapsed={!open} title={
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle}
      className="inline-flex min-w-0 items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <ChevronRight size={14} aria-hidden className={`shrink-0 text-subtle ${open ? "rotate-90" : ""}`} />
      <span>{t("profile-import.section")}</span>
    </button>
  } hint={t("profile-import.sectionHint")}
    actions={status && <span data-profile-import-status className={`text-xs ${status.attention ? "text-warn" : "text-muted"}`}>{status.text}</span>}>
    <div id={panelId}>
      <SettingsGroup agents="newAgents" source="host">
        <ProfileImport hostId={hostId} onStatus={setStatus} />
      </SettingsGroup>
    </div>
  </Section>;
}
