// Kimi 账户 select (cutex kimi-runtime-profiles + kimi-accounts, r266; docs/design/049): which Kimi account a Kimi-kind
// Profile signs in with — in the 添加 Profile form (POST `{kind:"kimi", kimiAccount}`) and the Profile editor's 服务与凭证
// (PATCH `{kimiAccount}`, new agents only). The accounts are logged in under Settings → Profile → Kimi 账户 (the
// kimi-accounts module); 管理 Kimi 账户 scrolls there only while that section is shown.
import { useI18n } from "../../i18n";
import type { KimiAccount } from "../../../../shared/kimiAccounts";
import { KIMI_ACCOUNTS_SECTION, kimiAccountOptions } from "../../lib/kimiAccounts";
import { services } from "../../modules/app";
import { useSlot } from "../../modules/react";
import { Select, SettingRow } from "./Form";

function ManageLink({ onReload }: { onReload?(): void }) {
  const { t } = useI18n();
  const sections = useSlot("settings.section");
  if (!sections.some((e) => e.item.id === KIMI_ACCOUNTS_SECTION && e.mode === "show")) return null;
  return (
    <span className="flex items-center gap-3">
      <button type="button" onClick={() => services.ui.openSettings("profiles", { anchor: KIMI_ACCOUNTS_SECTION })} className="shrink-0 rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
        {t("variants.credential.kimiManage")}
      </button>
      {onReload && (
        <button type="button" onClick={onReload} className="shrink-0 rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
          {t("variants.credential.kimiReload")}
        </button>
      )}
    </span>
  );
}

export function KimiAccountSelect({ list, value, onChange, disabled, onReload, readOnly }: {
  list: readonly KimiAccount[] | null;
  /** "" = none chosen. */
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
  onReload?(): void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const options = kimiAccountOptions(list, value || null);
  const chosen = options.find((o) => o.id === value) ?? null;
  const items = [
    ...(value ? [] : [{ value: "", label: t("variants.credential.kimiPick") }]),
    ...options.map((o) => ({ value: o.id, label: o.missing ? t("variants.credential.kimiMissing", { id: o.id }) : o.ready ? o.label : t("variants.credential.kimiNotLoggedIn", { label: o.label }) })),
  ];
  return (
    <SettingRow agents="newAgents" source="host" readOnly={readOnly}
      label={t("variants.credential.kimiAccount")}
      hint={
        list !== null && list.length === 0 ? <span className="text-warn">{t("variants.credential.kimiNone")}</span>
        : chosen && !chosen.ready ? <span className="text-warn">{t("variants.credential.kimiLoginFirst")}</span>
        : t("variants.credential.kimiHint")
      }
    >
      <div className="flex min-w-0 flex-col items-end gap-1 group-data-[narrow]/card:items-start" data-kimi-account-select="">
        <Select width="w-64" value={value} options={items} disabled={disabled || readOnly} label={t("variants.credential.kimiAccount")} onChange={onChange} />
        <ManageLink onReload={onReload} />
      </div>
    </SettingRow>
  );
}
