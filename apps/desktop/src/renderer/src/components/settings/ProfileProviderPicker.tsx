import type { ProfilePreset } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { officialPresets, relayPresets } from "../../lib/profilePresets";
import { Button, InfoTip, Select, SettingRow } from "./Form";

/** Host presets stay authoritative; choosing one never submits or copies credentials. */
export function ProfileProviderPicker({ presets, value, onChange, edit = false, disabled = false, providerId, onCreateProvider }: {
  presets: readonly ProfilePreset[]; value: string; onChange(value: string): void; edit?: boolean; disabled?: boolean; providerId?: string | null; onCreateProvider?(id: string): void;
}) {
  const { t } = useI18n();
  const tr = (key: string) => t(`settings.provider.${key}` as MessageKey);
  const choices = [...officialPresets(presets), ...relayPresets(presets)];
  // OpenAI first, followed by the host's ordering for other providers. Keep regional plans distinct.
  const ordered = [...choices.filter((p) => p.id === "openai"), ...choices.filter((p) => p.id !== "openai")];
  const chosen = choices.find((p) => p.id === value);
  const other = edit && chosen && chosen.providerId !== providerId;
  return <><SettingRow agents={edit ? "next" : "newAgents"} source="host" label={<span className="inline-flex items-center gap-1">{tr("picker")}<InfoTip>{tr("anthropicHint")}</InfoTip></span>} hint={tr(edit ? "editHint" : "createHint")}>
    <Select label={tr("picker")} width="w-80" value={value} disabled={disabled}
      options={[
        ...ordered.map((p) => ({ value: p.id, label: edit && p.providerId !== providerId ? t("settings.provider.createOther" as MessageKey, { name: p.label }) : p.label, disabled: edit && p.providerId !== providerId && !onCreateProvider })),
        { value: "__anthropic", label: `${tr("anthropic")} · ${tr("anthropicAdd")}` },
        { value: "", label: tr("custom") },
      ]} onChange={onChange} />
  </SettingRow>{other && onCreateProvider && <div className="flex flex-wrap items-center justify-between gap-2 pb-3 text-xs text-subtle" data-provider-create>
    <p>{tr("createOtherHint")}</p><Button disabled={disabled} onClick={() => onCreateProvider(chosen.id)}>{t("settings.provider.openCreate" as MessageKey, { name: chosen.label })}</Button>
  </div>}</>;
}
