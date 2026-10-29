import type { ProfileDetail, ProfilePreset } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { profileKind } from "../../lib/profileKind";
import { officialPresetOf } from "../../lib/profilePresets";
import { SettingRow } from "./Form";

/** Existing profiles keep their provider identity; changing providers starts a fresh profile. */
export function ProfileProviderSummary({ detail, presets, disabled, onCreateProvider }: {
  detail: ProfileDetail; presets: readonly ProfilePreset[]; disabled?: boolean; onCreateProvider?(id: string): void;
}) {
  const { t } = useI18n();
  if (profileKind(detail) !== "apiKey") return null;
  const url = detail.detail?.config?.providerBaseUrl ?? detail.baseUrl ?? null;
  const preset = officialPresetOf(url, presets);
  const provider = preset?.label ?? detail.providerFamilyLabel ?? detail.detail?.config?.modelProvider ?? detail.providerFamily ?? t("settings.provider.custom" as MessageKey);
  return <SettingRow source="host" agents="none" readOnly label={t("settings.provider.current" as MessageKey)} hint={url ? <span className="break-all font-mono">{url}</span> : undefined}>
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <span className="text-sm">{provider}</span>
      {onCreateProvider && <button type="button" disabled={disabled} onClick={() => onCreateProvider(preset?.id ?? "")} className="text-xs text-subtle underline underline-offset-2 hover:text-foreground disabled:opacity-50">
        {t("settings.provider.changeCreate" as MessageKey)}
      </button>}
    </div>
  </SettingRow>;
}
