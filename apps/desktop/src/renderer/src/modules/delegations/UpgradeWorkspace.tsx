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
import { upgradePreviewApiOf, useUpgradeProject } from "./useUpgradeProject";
import { UpgradeRunControls } from "./UpgradeRunControls";
import { UpgradeRouting } from "./UpgradeRouting";
import { UpgradeMembers } from "./UpgradeMembers";
import { panelSnapshotOf } from "./upgradeContract";
import { FIELD } from "./upgradeLook";

// The title (委托树) is the Shelf / tab header's; the workspace starts with its toolbar (`lead` = the page's
// project picker), then run control, the tree, routing and members as sections on the panel.
export function UpgradeWorkspace({ hostId, projectId, lead }: ProjectTabProps & { lead?: ReactNode }) {
  const { t } = useI18n();
  const features = useApp(s => featuresOf(s, hostId));
  const capabilities = delegationUpgradeCapabilities([...features]);
  const { snapshot, readOnly, busy, notice, refresh, more, onAction, reviewRetirement, readApproval } = useUpgradeProject(hostId, projectId, capabilities.treeStop, capabilities);
  const archiveSupported = capabilities.retirement;
  const panel = snapshot ? panelSnapshotOf(snapshot) : null;
  const disabled = busy || readOnly;
  if (!capabilities.treeStop || !upgradePreviewApiOf(hostId).delegationUpgradeSnapshot) return <>{lead}<p className="py-8 text-center text-ui text-subtle">{t("delegations.upgrade.tree.unavailable")}</p></>;
  return <div className="min-w-0 space-y-5" data-testid="delegation-upgrade-workspace">
    <div className="flex min-h-7 flex-wrap items-center gap-2">
      {lead}
      <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} aria-hidden />{t("delegations.upgrade.tree.refresh")}</Button>
    </div>
    {notice && <p role="status" className={`-mt-2 rounded-ctl px-3 py-2 text-meta ${notice === "done" ? "bg-surface text-muted" : "bg-attention-soft text-warn-text"}`}>{t(`delegations.upgrade.tree.${notice}`)}</p>}
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
  const picker = <label className="flex min-w-0 items-center gap-2 text-meta text-muted">{t("delegations.upgrade.tree.project")}<select aria-label={t("delegations.upgrade.tree.project")} className={`${FIELD} max-w-[16rem]`} value={projectId ?? ""} onChange={event => services.ui.openPage("delegations.treePage", { project: event.target.value, host: hostId })}>
    {sidebar?.projects?.projects.map(project => <option value={project.project_id} key={project.project_id}>{project.presentation.display_name || project.project_id}</option>)}
  </select></label>;
  return <PageBody>{projectId ? <UpgradeWorkspace key={`${hostId}/${projectId}`} hostId={hostId} projectId={projectId} lead={picker} /> : <>{picker}<p className="py-8 text-center text-ui text-subtle">{t("delegations.upgrade.tree.choose")}</p></>}</PageBody>;
}
