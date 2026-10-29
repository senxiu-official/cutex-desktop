// Owner Operator actions use the daemon's snake_case wire contract.
import type { ProjectPresentation } from "@cutex-desktop/protocol";

export const OPERATOR_ACTION_SCHEMA = "cutex/human-management-operator-action/v1" as const;

export interface OperatorActionRequest {
  schema: typeof OPERATOR_ACTION_SCHEMA;
  /** Supply a stable action ID when a write may be retried. */
  action_id?: string;
  project_id: string;
  expected_authority_epoch?: number;
  expected_grant_revision?: number;
  operation: "grant" | "revoke";
  operator_cutex_session_id: string;
}

export interface OperatorGrant {
  project_id: string;
  operator_cutex_session_id: string;
  grant_revision: number;
  granted_at: string;
  granted_by_primary_director_session: string;
  performed_by_human_management?: boolean;
}

export interface OperatorProjectMember {
  agent: {
    cutex_session_id: string;
    native_session_id?: string;
    spec: { name: string; [field: string]: unknown };
    retired_at?: string | null;
    [field: string]: unknown;
  };
  lifecycle: string;
  runtime?: Record<string, unknown>;
  observation_error?: string;
}

export interface ProjectAgentOperator {
  grant: OperatorGrant;
  member: OperatorProjectMember;
}

export interface OperatorProjectWorkspace {
  project_id: string;
  authority_epoch: number;
  director?: { cutex_session_id: string; member?: OperatorProjectMember } | null;
  access_role?: "primary_director" | "agent_operator" | "human_management" | (string & {});
  /** Absent on a daemon without the Operator projection: never assume revision 0. */
  operator_grant_revision?: number;
  agent_operators?: ProjectAgentOperator[];
  presentation: ProjectPresentation;
  active_agents: OperatorProjectMember[];
  archived_agents?: OperatorProjectMember[];
  retired_agents: OperatorProjectMember[];
  lifecycle?: string;
  project_revision?: number;
  workspace_root?: string | null;
}

export interface OperatorRoster {
  grant_revision: number;
  operators: OperatorGrant[];
}

export interface OperatorAuditEvent {
  event_id: string;
  action_id: string;
  project_id: string;
  operator_cutex_session_id: string;
  kind: "granted" | "revoked" | "retained_after_director_rotation" | "removed_for_primary_director" | "removed_by_director_rotation";
  previous_grant_revision: number;
  grant_revision: number;
  primary_director_cutex_session_id: string;
  performed_by_human_management?: boolean;
  committed_at: string;
}

export interface OperatorActionReceipt {
  schema: typeof OPERATOR_ACTION_SCHEMA;
  action_id: string;
  request_sha256: string;
  operation: "grant" | "revoke";
  project_id: string;
  authority_epoch: number;
  primary_director_cutex_session_id: string;
  operator_cutex_session_id: string;
  previous_grant_revision: number;
  grant_revision: number;
  grant?: OperatorGrant;
  roster: OperatorRoster;
  audit_event: OperatorAuditEvent;
  committed_at: string;
}

/** Feature evidence only; owner/full access and current authority remain required.
 * No separate Operator capability is advertised by the current daemon. */
export function hasOperatorActionsProjection(workspace: OperatorProjectWorkspace): workspace is OperatorProjectWorkspace & {
  operator_grant_revision: number;
  agent_operators: ProjectAgentOperator[];
} {
  const revision = workspace.operator_grant_revision;
  return Array.isArray(workspace.agent_operators)
    && typeof revision === "number"
    && Number.isSafeInteger(revision)
    && revision >= 0;
}
