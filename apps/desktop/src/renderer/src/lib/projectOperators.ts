import { OPERATOR_ACTION_SCHEMA, hasOperatorActionsProjection, type OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";
import type { DaemonApi } from "../../../shared/ipc";
import { isOwnerFeatures } from "../../../shared/users";
import { projectOperatorIds } from "../../../shared/projectOperatorMembers";
import { apiFor } from "../bridge";
import { translate } from "../i18n";
import { featuresOf, useApp } from "../store";
import { captureHostAction } from "./hostSwitch";

export function operatorSupported(workspace: OperatorProjectWorkspace | null | undefined): workspace is OperatorProjectWorkspace & {
  agent_operators: NonNullable<OperatorProjectWorkspace["agent_operators"]>; operator_grant_revision: number;
} {
  return !!workspace && hasOperatorActionsProjection(workspace);
}

export function operatorIds(workspace: OperatorProjectWorkspace | null | undefined): ReadonlySet<string> {
  return operatorSupported(workspace) ? projectOperatorIds(workspace, workspace.project_id) : new Set();
}

// The daemon lists a member holding this project's Operator grant under agent_operators, not active_agents.
function isProjectMember(workspace: OperatorProjectWorkspace & { agent_operators: NonNullable<OperatorProjectWorkspace["agent_operators"]> }, sessionId: string): boolean {
  return workspace.active_agents.some(member => member.agent.cutex_session_id === sessionId && member.agent.retired_at == null) || operatorIds(workspace).has(sessionId);
}

interface ChangeOptions {
  api: Pick<DaemonApi, "projectRead" | "operatorAction">;
  projectId: string; sessionId: string; grant: boolean;
  current(): boolean;
  owner(): boolean;
  refresh(): Promise<void>;
  runtimeNotice(): Promise<void>;
}

/** Fresh canonical CAS only. A conflict refreshes the roster and never retries a changed decision. */
export async function changeProjectOperator(options: ChangeOptions): Promise<void> {
  const { api, projectId, sessionId, grant } = options;
  if (!options.current() || !options.owner()) throw Error("operator_unavailable");
  const workspace = await api.projectRead(projectId);
  if (!options.current() || !options.owner() || workspace.project_id !== projectId || !operatorSupported(workspace) ||
      workspace.access_role !== "human_management" || workspace.lifecycle !== "active" || !workspace.director ||
      !Number.isSafeInteger(workspace.authority_epoch) || workspace.authority_epoch < 0 ||
      workspace.director.cutex_session_id === sessionId || !isProjectMember(workspace, sessionId)) {
    throw Error("operator_unavailable");
  }
  if (operatorIds(workspace).has(sessionId) === grant) { await options.refresh(); return; }
  try {
    await api.operatorAction({ schema: OPERATOR_ACTION_SCHEMA, action_id: `desktop-${crypto.randomUUID()}`, project_id: projectId,
      expected_authority_epoch: workspace.authority_epoch, expected_grant_revision: workspace.operator_grant_revision,
      operation: grant ? "grant" : "revoke", operator_cutex_session_id: sessionId });
  } finally {
    // This also handles the daemon's generic HTTP409 conflict code.
    if (options.current()) {
      await api.projectRead(projectId).catch(() => {});
      await options.refresh().catch(() => {});
    }
  }
  if (options.current()) await options.runtimeNotice();
}

const pending = new Set<string>();
export async function setProjectOperator(hostId: string, projectId: string, sessionId: string, grant: boolean): Promise<void> {
  const key = JSON.stringify([hostId, projectId, sessionId]);
  if (pending.has(key)) return;
  pending.add(key);
  const current = captureHostAction(hostId);
  try {
    await changeProjectOperator({ api: apiFor(hostId), projectId, sessionId, grant, current,
      owner: () => isOwnerFeatures(featuresOf(useApp.getState(), hostId)),
      refresh: () => useApp.getState().refreshHostSidebar(hostId),
      runtimeNotice: async () => {
        // Only records a UI notice; online runtimes are never stopped automatically.
        try {
          const result = await apiFor(hostId).operatorRuntimeNotice(projectId, sessionId);
          if (current()) useApp.getState().notify(translate(result.state === "required" ? "projects.operatorRestartRequired" : "projects.operatorOffline"));
        } catch {
          if (current()) useApp.getState().notify(translate("projects.operatorRuntimeUnknown"));
        } finally {
          if (current()) await useApp.getState().refreshHostSidebar(hostId);
        }
      },
    });
  } finally { pending.delete(key); }
}
