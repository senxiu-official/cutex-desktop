// Settings → 协作 → 服务 (cutex `services-persistent-approval`): whether an agent's request for a
// persistent (长期) service needs the owner's approval. On = cutex setting `ask` (default), off =
// `off`. Running a managed command outside the agent's own permissions still needs its approval
// either way (managed_service). Loaded when the section opens and when the settings host changes /
// reconnects; reads and writes the settings host picker's host (lib/targetHost).
import { useEffect, useRef, useState } from "react";
import type { AgentPersistentApproval } from "../../../../shared/ipc";
import { agentPersistentApprovalOf } from "../../../../shared/servicesSettings";
import { ErrorNote, Loading, Notice, Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PersistApprovalSection() {
  const { t } = useI18n();
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [value, setValue] = useState<AgentPersistentApproval | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A reply from before a host switch is dropped.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setValue(undefined);
    setError(null);
    if (!connected) return;
    api
      .services()
      .then((list) => mine === seq.current && setValue(agentPersistentApprovalOf(list.settings)))
      .catch((e: unknown) => mine === seq.current && setError(message(e)));
  }, [api, hostId, connected]);

  const change = async (on: boolean) => {
    const mine = seq.current;
    setSaving(true);
    setError(null);
    try {
      const settings = await api.patchServicesSettings({ agentPersistentApproval: on ? "ask" : "off" });
      if (mine === seq.current) setValue(agentPersistentApprovalOf(settings));
    } catch (e) {
      if (mine === seq.current) setError(message(e));
    } finally {
      if (mine === seq.current) setSaving(false);
    }
  };

  return (
    <Section title={t("services.settings")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {value === undefined && !error && <Loading rows={1} />}
      {value === null && <Notice>{t("services.persistApproval.unknown")}</Notice>}
      {value && (
        <SettingRow label={t("services.persistApproval")} hint={t("services.persistApproval.hint")}>
          <Toggle checked={value === "ask"} disabled={saving} label={t("services.persistApproval")} onChange={(on) => void change(on)} />
        </SettingRow>
      )}
    </Section>
  );
}
