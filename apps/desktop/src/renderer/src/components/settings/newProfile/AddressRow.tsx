// 新建 Profile: the 接口地址 row. Starts as the provider's official address (or empty and required
// when there is none); editing it marks the Profile as going through a relay — which never changes
// the runtimes it can use (decision A2) — and 「恢复官方地址」 puts the official one back.
import { useI18n } from "../../../i18n";
import { addressSpecOf, addressState, type Resolved } from "../../../lib/newProfileModel";
import { addressHint } from "../../../lib/newProfileText";
import { Tag } from "../../Tag";
import { HintAction, SettingRow, TextInput } from "../Form";

export function AddressRow({ resolved, value, onChange, disabled }: { resolved: Resolved; value: string | null; onChange(next: string | null): void; disabled?: boolean }) {
  const { t } = useI18n();
  const spec = addressSpecOf(resolved);
  if (!spec) return null;
  const state = addressState(spec, value);
  const hint = addressHint(t, resolved, value);
  return (
    <SettingRow
      agents="newAgents"
      source="host"
      label={t("newProfile.address.label")}
      hint={
        hint && (
          <span data-address-hint={state.relay ? "relay" : state.official ? "official" : "required"}>
            {hint.text}
            {hint.restore && spec.official && (
              <HintAction title={spec.official} onClick={() => onChange(null)} disabled={disabled}>
                {t("newProfile.address.restore")}
              </HintAction>
            )}
          </span>
        )
      }
    >
      <TextInput mono width="w-80" label={t("newProfile.address.label")} value={state.value} disabled={disabled} placeholder={spec.official ?? (spec.interface === "anthropic" ? "https://example.com/anthropic" : "https://example.com/v1")} onChange={(v) => onChange(v)} />
      {state.relay && <Tag data-address-relay="">{t("newProfile.address.tag.relay")}</Tag>}
    </SettingRow>
  );
}
