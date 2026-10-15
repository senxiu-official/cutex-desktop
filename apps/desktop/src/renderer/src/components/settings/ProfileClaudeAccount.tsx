// Profile editor → 账户 → Claude 账户 (cutex `claude-accounts`): which of the host's Claude accounts
// new agents of this Claude profile run on. Part of the profile draft (saved by the sticky bar as
// PATCH `/v2/profiles/{p}` `{claudeAccount}`); the choices come from `GET /v2/claude/accounts`.
// The 添加 profile form has the same select (`POST /v2/profiles {kind:"claude", claudeAccount}`).
// The account list and its state helpers are lib/claudeAccounts.ts (shared with the claude-accounts
// module's Claude 账户 section of this page), so core never imports that module: 管理账户 scrolls to
// that section only when it is there (settings slot), and 「+ 添加订阅」 beside the select is the
// module's `profile.fieldAction` (absent without the module / capability).
import { useEffect, type ReactNode } from "react";
import type { ProfileDetail, ProfilePatch } from "../../../../shared/ipc";
import { DEFAULT_CLAUDE_ACCOUNT } from "../../../../shared/claudeAccounts";
import { useI18n } from "../../i18n";
import { chosenClaudeAccount, CLAUDE_ACCOUNTS_SECTION, claudeAccountOptionText, claudeAccountOptions, isUnknownClaudeAccountError, storedClaudeAccount } from "../../lib/claudeAccounts";
import { fieldEditable, sessionsUsingProfile } from "../../lib/profileKind";
import { useClaudeAccountList } from "../../lib/useClaudeAccountList";
import { services } from "../../modules/app";
import { ProfileFieldActions } from "../../modules/Outlet";
import { useSlot } from "../../modules/react";
import { Select, SettingRow } from "./Form";
import { useTargetSidebar } from "../../lib/targetHost";

/** 管理账户: scrolls to the Claude 账户 section of Settings → Profile (only while the module shows it). */
function ManageLink() {
  const { t } = useI18n();
  const sections = useSlot("settings.section");
  if (!sections.some((e) => e.item.id === CLAUDE_ACCOUNTS_SECTION && e.mode === "show")) return null;
  return (
    <button
      type="button"
      onClick={() => services.ui.openSettings("profiles", { anchor: CLAUDE_ACCOUNTS_SECTION })}
      className="shrink-0 rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
    >
      {t("agent-config.profile.claudeAccount.manage")}
    </button>
  );
}

export function ClaudeAccountRow({ detail, patch, onChoose, saveError }: {
  detail: ProfileDetail;
  patch: ProfilePatch;
  /** A choice from the select (the editor keeps it in the draft only when it differs from the stored one). */
  onChoose(account: string): void;
  /** The last save failed while the draft carried an account: cutex's message (not saved). */
  saveError: string | null;
}) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const { list, loadError, load } = useClaudeAccountList();
  const unknown = saveError !== null && isUnknownClaudeAccountError(saveError);
  // The account went away since the list was read: read it again so the select shows what is left.
  useEffect(() => {
    if (unknown) void load();
  }, [unknown, saveError, load]);

  const current = chosenClaudeAccount(patch, detail);
  const changed = current !== storedClaudeAccount(detail);
  const staying = changed ? sessionsUsingProfile(sidebar?.active ?? [], detail).length : 0;
  const options = claudeAccountOptions(list, current).map((o) => ({ value: o.id, label: claudeAccountOptionText(o, t) }));
  const editable = fieldEditable(detail, "claudeAccount");
  return (
    <SettingRow
      label={t("agent-config.profile.claudeAccount")}
      hint={
        <>
          <span className="block">{t("agent-config.profile.claudeAccount.hint")}</span>
          {staying > 0 && <span className="block text-warn">{t("agent-config.profile.claudeAccount.staying", { n: staying })}</span>}
          {loadError && <span className="block text-danger">{t("agent-config.profile.claudeAccount.loadFailed", { error: loadError })}</span>}
          {/* Unknown account: our words, cutex's message as the tooltip (and in the save bar). */}
          {saveError && (
            <span role="alert" title={unknown ? saveError : undefined} className="block text-danger">
              {unknown ? t("agent-config.profile.claudeAccount.unknown") : t("agent-config.profile.claudeAccount.saveFailed", { error: saveError })}
            </span>
          )}
        </>
      }
    >
      <AccountControl
        select={<Select width="w-64" value={current} options={options} disabled={!editable} onChange={onChoose} />}
        links={
          <>
            <ManageLink />
            {/* A new account lands in the draft (read the list first, so the select names it). */}
            <ProfileFieldActions field="claudeAccount" disabled={!editable} pick={async (id) => (await load(), onChoose(id))} />
          </>
        }
      />
    </SettingRow>
  );
}

/** The select with its links underneath (管理账户, 「+ 添加订阅」), so a narrow card still fits them. */
function AccountControl({ select, links }: { select: ReactNode; links: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 @max-[28rem]:items-start">
      {select}
      <div className="flex items-center gap-3 empty:hidden">{links}</div>
    </div>
  );
}

/** 添加 profile → 账户 (Claude only; laid out for every kind so the form never changes height). */
export function NewClaudeAccountRow({ value, onChange, disabled }: { value: string; onChange(account: string): void; disabled: boolean }) {
  const { t } = useI18n();
  const { list, loadError, load } = useClaudeAccountList();
  const current = disabled ? DEFAULT_CLAUDE_ACCOUNT : value;
  const options = claudeAccountOptions(list, current).map((o) => ({ value: o.id, label: claudeAccountOptionText(o, t) }));
  return (
    <SettingRow
      label={t("agent-config.profile.claudeAccount")}
      hint={
        disabled ? (
          t("agent-config.profiles.new.claudeOnly")
        ) : loadError ? (
          <span className="text-danger">{t("agent-config.profile.claudeAccount.loadFailed", { error: loadError })}</span>
        ) : undefined
      }
    >
      <AccountControl
        select={<Select width="w-64" value={current} options={options} disabled={disabled} onChange={onChange} />}
        links={<ProfileFieldActions field="claudeAccount" disabled={disabled} pick={async (id) => (await load(), onChange(id))} />}
      />
    </SettingRow>
  );
}
