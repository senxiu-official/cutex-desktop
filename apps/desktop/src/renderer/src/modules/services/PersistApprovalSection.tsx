// Settings → 协作 → 服务 (cutex `services-persistent-approval`): whether an agent's request for a
// persistent (长期) service needs the owner's approval. On = cutex setting `ask` (default), off =
// `off`. Running a managed command outside the agent's own permissions still needs its approval
// either way (managed_service). Loaded when the section opens and when the settings host changes /
// reconnects; reads and writes the settings host picker's host (lib/targetHost).
import { useEffect, useRef, useState } from "react";
import type { AgentPersistentApproval } from "../../../../shared/ipc";
import { SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_PERSIST_APPROVAL_FEATURE, agentPersistentApprovalOf } from "../../../../shared/servicesSettings";
import { ErrorNote, Loading, Notice, Section, Select, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PersistApprovalSection() {
  const { t } = useI18n();
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const host = useHostData(hostId);
  const connected = host?.daemon.kind === "connected";
  const hasApproval = host?.features.has(SERVICES_PERSIST_APPROVAL_FEATURE) ?? false;
  const hasTtl = host?.features.has(SERVICES_EPHEMERAL_TTL_FEATURE) ?? false;
  const [value, setValue] = useState<AgentPersistentApproval | null | undefined>(undefined);
  const [idleMinutes, setIdleMinutes] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A reply from before a host switch is dropped.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setValue(undefined);
    setIdleMinutes(undefined);
    setError(null);
    if (!connected) return;
    api
      .services()
      .then((list) => {
        if (mine !== seq.current) return;
        setValue(agentPersistentApprovalOf(list.settings));
        setIdleMinutes(typeof list.settings.ephemeralIdleMinutes === "number" ? list.settings.ephemeralIdleMinutes : null);
      })
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

  const changeTtl = async (minutes: string) => {
    const mine = seq.current;
    setSaving(true);
    setError(null);
    try {
      const settings = await api.patchServicesSettings({ ephemeralIdleMinutes: Number(minutes) });
      if (mine === seq.current) setIdleMinutes(settings.ephemeralIdleMinutes ?? null);
    } catch (e) {
      if (mine === seq.current) setError(message(e));
    } finally {
      if (mine === seq.current) setSaving(false);
    }
  };

  if (!hasApproval && !hasTtl) return null;

  return (
    <Section title={t("services.settings")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {(hasApproval ? value === undefined : false) || (hasTtl ? idleMinutes === undefined : false) ? !error && <Loading rows={(hasApproval ? 1 : 0) + (hasTtl ? 1 : 0)} /> : null}
      {hasTtl && idleMinutes === null && <Notice>{t("services.idleTtl.unknown")}</Notice>}
      {hasTtl && typeof idleMinutes === "number" && (
        <SettingRow agents="now" source="host" label={t("services.idleTtl")} hint={t("services.idleTtl.hint")}>
          <Select
            value={String(idleMinutes)}
            disabled={saving}
            label={t("services.idleTtl")}
            options={[
              { value: "30", label: t("services.idleTtl.30") },
              { value: "120", label: t("services.idleTtl.120") },
              { value: "480", label: t("services.idleTtl.480") },
              { value: "1440", label: t("services.idleTtl.1440") },
              { value: "0", label: t("services.idleTtl.0") },
            ]}
            onChange={(minutes) => void changeTtl(minutes)}
          />
        </SettingRow>
      )}
      {hasApproval && value === null && <Notice>{t("services.persistApproval.unknown")}</Notice>}
      {hasApproval && value && (
        <SettingRow agents="now" source="host" label={t("services.persistApproval")} hint={t("services.persistApproval.hint")}>
          <Toggle checked={value === "ask"} disabled={saving} label={t("services.persistApproval")} onChange={(on) => void change(on)} />
        </SettingRow>
      )}
    </Section>
  );
}
