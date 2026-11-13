import { Shield } from "lucide-react";
import type { MessageKey } from "../i18n";
import { translate } from "../i18n";
import { isOwnerFeatures } from "../../../shared/users";
import { featuresOf, sidebarOf, useApp } from "../store";
import type { MenuAction } from "./contextMenu";
import { setProjectOperator } from "./projectOperators";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * 设为副主管 / 取消副主管 in an agent's own menus (sidebar row, conversation header, tray), next to the project
 * page's member-row item: the same `setProjectOperator` call. Shown only for a live member of a project whose
 * host reports deputies (the sidebar's `projectOperators` roster for that project, read by main only from hosts
 * with the operator projection) and only to the owner. Granting adds authority, so it confirms in place.
 */
export function operatorMenuItem(hostId: string, sessionId: string, t: T): MenuAction | null {
  const app = useApp.getState();
  if (!isOwnerFeatures(featuresOf(app, hostId))) return null;
  const sidebar = sidebarOf(app, hostId);
  const projectId = sidebar?.hostRows[sessionId]?.projectId;
  if (!sidebar || !projectId) return null;
  const roster = sidebar.projectOperators?.[projectId];
  const project = sidebar.projects?.projects.find((p) => p.project_id === projectId);
  if (!roster || !project) return null;
  const session = sidebar.active.find((s) => s.cutexSessionId === sessionId);
  if (!session || session.lifecycle === "retired") return null;
  const granted = roster.includes(sessionId);
  // Where the project page would not offer it (its canManageOperators / director row): disabled, with the reason.
  const blocked: MessageKey | null =
    project.director_cutex_session_id === sessionId ? ("projects.operatorMenuDirector" as MessageKey)
      : project.lifecycle !== "active" || !project.director_cutex_session_id || (project.access_role != null && project.access_role !== "human_management")
        ? ("projects.operatorMenuUnavailable" as MessageKey) : null;
  const label = t((granted ? "projects.revokeOperator" : "projects.setOperator") as MessageKey);
  return {
    label,
    icon: <Shield size={14} />,
    ...(blocked ? { disabled: true, title: t(blocked) } : {}),
    ...(!granted && !blocked ? { armed: t("projects.operatorMenuArmed" as MessageKey, { name: session.displayName }) } : {}),
    onSelect: () => void changeOperatorFromMenu(hostId, projectId, sessionId, !granted, label),
  };
}

/** The project page shows the daemon's error in its error line; a menu has none, so the same text goes to a toast. */
export async function changeOperatorFromMenu(hostId: string, projectId: string, sessionId: string, grant: boolean, action: string): Promise<void> {
  try {
    await setProjectOperator(hostId, projectId, sessionId, grant);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const error = message === "operator_unavailable" ? translate("projects.operatorMenuUnavailable" as MessageKey) : message;
    useApp.getState().notify(translate("projects.operatorMenuFailed" as MessageKey, { action, error }), "error");
  }
}
