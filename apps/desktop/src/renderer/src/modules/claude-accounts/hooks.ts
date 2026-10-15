// Small hooks shared by the Claude 账户 section and the add flow (kept out of the .tsx files so Fast
// Refresh works).
import type { ClaudeAccount } from "../../../../shared/claudeAccounts";
import type { CutexRefusal } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { useTargetHostLabel } from "../../lib/targetHost";
import { refusalKey } from "./accountView";

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** cutex's refusal in our words (with the blocking agents), or its own message for an unknown code. */
export function useRefusalText() {
  const { t } = useI18n();
  return (error: CutexRefusal) => {
    const key = refusalKey(error.code);
    const names = error.sessions?.map((s) => s.displayName).join(", ");
    if (!key) return error.message;
    return names ? t("claude-accounts.refusal.withNames", { text: t(key), names }) : t(key);
  };
}

/** The account name as shown: the shared default home has no label. */
export function useAccountTitle() {
  const { t } = useI18n();
  return (a: Pick<ClaudeAccount, "isDefault" | "label" | "id">) => (a.isDefault ? t("claude-accounts.default") : (a.label ?? a.id));
}

/** The target host's name (Settings: the picked host; else the focus host), for "open a terminal on <host>". */
export function useHostLabel(): string {
  return useTargetHostLabel();
}
