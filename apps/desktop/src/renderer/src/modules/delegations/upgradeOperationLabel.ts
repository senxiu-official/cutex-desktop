import type { UpgradePanelSnapshot } from "../../../../shared/delegationUpgradePreview";

/**
 * A readable name for an unresolved operation's fence entity (lib/delegationOperations
 * operationEntity): the delegation title, member name or approval's delegation, else the raw id.
 */
export function operationTargetLabel(entity: string, panel: UpgradePanelSnapshot | null): string {
  const [kind, ...rest] = entity.split(":");
  if (kind === "node") {
    const id = rest.slice(1).join(":");
    const node = panel?.nodes.find(n => n.kind === "delegation" && n.id === id && n.hostId === rest[0]);
    return node && node.kind === "delegation" ? node.title || id : id;
  }
  if (kind === "member") {
    const id = rest.join(":");
    return panel?.members?.find(m => m.id === id)?.name || id;
  }
  if (kind === "approval") {
    const id = rest.join(":");
    const approval = panel?.approvals?.find(a => a.id === id);
    return approval ? approval.delegationRef.id : id;
  }
  return ""; // runControl / routing: project-wide; the operation name says it all
}
