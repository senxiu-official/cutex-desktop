import type { OperatorProjectMember, OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";

/**
 * Members holding this project's Agent Operator grant. The daemon lists them under agent_operators only (never also
 * in active_agents). A row counts only when its grant is for `projectId`, names that same member, the member is not
 * retired and is not the project's Director. Absent on an older daemon: empty.
 */
export function projectOperatorMembers(workspace: Pick<OperatorProjectWorkspace, "agent_operators" | "director">, projectId: string): OperatorProjectMember[] {
  return (workspace.agent_operators ?? []).flatMap(({ grant, member }) =>
    grant.project_id === projectId && grant.operator_cutex_session_id === member.agent.cutex_session_id &&
    grant.operator_cutex_session_id !== workspace.director?.cutex_session_id && member.agent.retired_at == null ? [member] : []);
}
export function projectOperatorIds(workspace: Pick<OperatorProjectWorkspace, "agent_operators" | "director">, projectId: string): Set<string> {
  return new Set(projectOperatorMembers(workspace, projectId).map(member => member.agent.cutex_session_id));
}
