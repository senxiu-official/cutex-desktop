import type { ProfileDetail, ProfilePatch } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { fieldEditable, isAcpKind, type ProfileKind } from "../../lib/profileKind";
import { SettingRow, Toggle } from "./Form";

/** Session switching never applies to a DSH profile, including stale older-host flags. */
export function ProfileSessionSwitch({ detail, kind, patch, set }: { detail: ProfileDetail; kind: ProfileKind; patch: ProfilePatch; set(patch: ProfilePatch): void }) {
  const { t } = useI18n();
  if (isAcpKind(kind)) return null;
  return (
        <SettingRow source="host"
          agents="now" label={t("agent-config.profile.allowSwitch")}
          hint={t("agent-config.profile.allowSwitchHint", { def: detail.detail?.allowSessionSwitchDefault ? t("agent-config.profile.on") : t("agent-config.profile.off") })}
        >
          <Toggle
            checked={patch.allowSessionSwitch !== undefined ? (patch.allowSessionSwitch ?? detail.detail?.allowSessionSwitchDefault) : detail.allowSessionSwitch}
            disabled={!fieldEditable(detail, "allowSessionSwitch")}
            onChange={(v) => set({ allowSessionSwitch: v })}
          />
        </SettingRow>
  );
}

