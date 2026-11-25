import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { PageBody } from "../../components/Page";
import { useI18n } from "../../i18n";
import { useTargetHostId } from "../../lib/targetHost";
import { featuresOf, sidebarOf, useApp } from "../../store";
import { services } from "../app";
import type { PageParams, ProjectTabProps } from "../slots";
import { TreePanel } from "./TreePanel";
import { delegationUpgradeCapabilities } from "./upgradeCapabilities";
import { MANUAL_KINDS, upgradePreviewApiOf, useUpgradeProject } from "./useUpgradeProject";
import { UpgradeRunControls } from "./UpgradeRunControls";
import { UpgradeRouting } from "./UpgradeRouting";
import { UpgradeMembers } from "./UpgradeMembers";
import { panelSnapshotOf } from "./upgradeContract";
import { FIELD } from "./upgradeLook";
import { ArmedButton } from "../../components/ArmedButton";
import type { MessageKey } from "../../i18n";
import { operationTargetLabel } from "./upgradeOperationLabel";
import { EntitySelect } from "../../components/EntitySelect";
import { projectEntity } from "../../lib/entityIcon";

// The title (委托树) is the Shelf / tab header's; the workspace starts with its toolbar (`lead` = the page's
// project picker), then run control, the tree, routing and members as sections on the panel.
export function UpgradeWorkspace({ hostId, projectId, lead }: ProjectTabProps & { lead?: ReactNode }) {
  const { t } = useI18n();
  const features = useApp(s => featuresOf(s, hostId));
  const capabilities = delegationUpgradeCapabilities([...features]);
  const { snapshot, readOnly, busy, notice, refresh, more, onAction, reviewRetirement, readApproval, pending, forget } = useUpgradeProject(hostId, projectId, capabilities.treeStop, capabilities);
  const archiveSupported = capabilities.retirement;
  const panel = snapshot ? panelSnapshotOf(snapshot) : null;
  const disabled = busy || readOnly;
  if (!capabilities.treeStop || !upgradePreviewApiOf(hostId).delegationUpgradeSnapshot) return <>{lead}<p className="py-8 text-center text-ui text-subtle">{t("delegations.upgrade.tree.unavailable")}</p></>;
  return <div className="min-w-0 space-y-5" data-testid="delegation-upgrade-workspace">
    <div className="flex min-h-7 flex-wrap items-center gap-2">
      {lead}
      <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} aria-hidden />{t("delegations.upgrade.tree.refresh")}</Button>
    </div>
    {notice && <p role="status" className={`-mt-2 rounded-ctl px-3 py-2 text-meta ${notice === "done" ? "bg-surface text-muted" : "bg-attention-soft text-warn-text"}`}>{notice === "manualResolution" ? t("delegations.upgrade.tree.manualResolution", { operation: t(`delegations.upgrade.tree.op.${pending.find(op => MANUAL_KINDS.has(op.action.kind))?.action.kind ?? "retire"}` as MessageKey) }) : t(`delegations.upgrade.tree.${notice}`)}</p>}
    {pending.length > 0 && <div className="-mt-2 space-y-1 rounded-ctl bg-attention-soft px-3 py-2 text-meta text-warn-text" data-testid="delegation-unresolved-ops">
      <p>{t("delegations.upgrade.tree.unresolvedTitle")}</p>
      {pending.map(op => <div key={op.scope} className="flex items-center gap-2" data-unresolved-entity={op.entity ?? "project"}>
        <span className="min-w-0 flex-1 truncate">{(() => {
          const opName = t(`delegations.upgrade.tree.op.${op.action.kind}` as MessageKey);
          const target = op.entity === null ? t("delegations.upgrade.tree.unresolvedProject") : operationTargetLabel(op.entity, panel);
          return target ? t("delegations.upgrade.tree.unresolvedOp", { op: opName, target }) : opName;
        })()}</span>
        <ArmedButton shape="rounded px-2 py-0.5 text-meta" idle="border border-border text-muted" hint={t("delegations.upgrade.tree.forgetHint")} resetKey={op.action.actionId} disabled={busy} testId="delegation-forget-op" onConfirm={() => forget(op)}>{t("delegations.upgrade.tree.forget")}</ArmedButton>
      </div>)}
    </div>}
    {!panel || !snapshot ? !readOnly && <p className="py-8 text-center text-ui text-subtle">{t("delegations.loading")}</p> : <>
      {capabilities.runControl && snapshot.runControl && <UpgradeRunControls snapshot={panel} busy={disabled} onAction={onAction} />}
      <div>
        <TreePanel snapshot={panel} busy={disabled} onAction={onAction} continuation={capabilities.continuation} />
        {snapshot.nextCursor && <Button variant="ghost" size="sm" className="mt-1 w-full" disabled={busy} onClick={() => void more()}>{t("delegations.upgrade.tree.more")}</Button>}
      </div>
      {capabilities.routing && snapshot.policy && snapshot.grants && <UpgradeRouting snapshot={panel} busy={disabled} onAction={onAction} readApproval={readApproval} />}
      {(capabilities.activity || archiveSupported) && snapshot.members && <UpgradeMembers snapshot={panel} busy={disabled} onAction={onAction} reviewRetirement={archiveSupported ? reviewRetirement : undefined} archiveSupported={archiveSupported} activitySupported={capabilities.activity} />}
    </>}
  </div>;
}

export function UpgradeTreePage({ params }: { params: PageParams }) {
  const targetHostId = useTargetHostId();
  const hostId = params.host ?? targetHostId;
  const sidebar = useApp(s => sidebarOf(s, hostId));
  const { t } = useI18n();
  const projectId = params.project ?? sidebar?.projects?.projects[0]?.project_id;
  const picker = <label className="flex min-w-0 items-center gap-2 text-meta text-muted">{t("delegations.upgrade.tree.project")}<EntitySelect label={t("delegations.upgrade.tree.project")} className={`flex w-56 max-w-[16rem] items-center justify-between gap-2 ${FIELD}`} value={projectId ?? ""}
    onChange={value => services.ui.openPage("delegations.treePage", { project: value, host: hostId })}
    options={(sidebar?.projects?.projects ?? []).map(project => ({ value: project.project_id, label: project.presentation.display_name || project.project_id, entity: projectEntity(hostId, project) }))} /></label>;
  return <PageBody>{projectId ? <UpgradeWorkspace key={`${hostId}/${projectId}`} hostId={hostId} projectId={projectId} lead={picker} /> : <>{picker}<p className="py-8 text-center text-ui text-subtle">{t("delegations.upgrade.tree.choose")}</p></>}</PageBody>;
}
