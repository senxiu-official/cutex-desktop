// Permission defaults for new threads (cutex `/v2/settings` newThreadDefaults, feature
// new-thread-defaults): sandbox / approval / network / extra writable roots for one kind. Rendered
// as plain rows inside the caller's section (Settings → 新建: the 新建 agent and 快速工作 sections).
// cutex resolves these at creation and stores them on the session, so edits only affect new threads.
import { changedFields, type LaunchField, type LaunchPermissions, type ThreadKind } from "../../../../shared/launch";
import { useI18n } from "../../i18n";
import type { ThreadDefaultsPatch } from "../../lib/threadDefaults";
import { ApprovalControl, SandboxControl, WritableRootsEditor } from "../LaunchOptions";
import { ResetButton, SettingRow, Toggle } from "./Form";

export function ThreadDefaultRows({ current, builtin, onPatch }: { kind: ThreadKind; current: LaunchPermissions; builtin: LaunchPermissions; onPatch(patch: ThreadDefaultsPatch): void }) {
  const { t } = useI18n();
  const changed = new Set(changedFields(current, builtin));
  const workspace = current.sandbox === "workspace-write";
  const describe = (field: LaunchField): string => {
    const v = builtin[field];
    if (field === "sandbox") return t(`launch.sandbox.${builtin.sandbox}`);
    if (field === "approvalPolicy") return t(`launch.approval.${builtin.approvalPolicy}`);
    if (field === "networkAccess") return t(v ? "launch.on" : "launch.off");
    return builtin.writableRoots.length ? builtin.writableRoots.join(", ") : t("launch.noRoots");
  };
  // The hint only speaks up when something differs from the built-in default (or needs a sandbox mode).
  const row = (field: LaunchField, label: string, control: React.ReactNode, extraHint?: string) => {
    const hint = [changed.has(field) ? t("agent-config.threadDefaults.builtin", { value: describe(field) }) : null, extraHint].filter(Boolean).join("；");
    return (
      <SettingRow
        label={
          <span className="flex items-center gap-1.5">
            {label}
            {changed.has(field) && <span className="h-1.5 w-1.5 rounded-full bg-accent" title={t("agent-config.threadDefaults.changed")} />}
          </span>
        }
        hint={hint || undefined}
        reset={<ResetButton title={t("agent-config.threadDefaults.reset")} disabled={!changed.has(field)} onClick={() => onPatch({ [field]: null })} />}
      >
        {control}
      </SettingRow>
    );
  };
  return (
    <>
      {row("sandbox", t("launch.sandbox"), <SandboxControl value={current.sandbox} onChange={(sandbox) => onPatch({ sandbox })} />)}
      {row("approvalPolicy", t("launch.approval"), <ApprovalControl value={current.approvalPolicy} onChange={(approvalPolicy) => onPatch({ approvalPolicy })} />)}
      {row("networkAccess", t("launch.network"), <Toggle checked={current.networkAccess} onChange={(networkAccess) => onPatch({ networkAccess })} />, workspace ? undefined : t("launch.workspaceOnly"))}
      {row("writableRoots", t("launch.writableRoots"), <WritableRootsEditor roots={current.writableRoots} onChange={(writableRoots) => onPatch({ writableRoots })} />, workspace ? undefined : t("launch.workspaceOnly"))}
    </>
  );
}
