// Workflow runs (cutex `workflows`, W1; docs/research/workflows-20261013.md): an agent's
// orchestration script whose agent() calls are one-shot step sessions. Wire shapes of
// `GET /v2/workflows/runs[/{id}]`, the owner commands and the host events
// `cutex/workflow/run/changed` / `cutex/workflow/step/changed` / `cutex/workflow/log`.
// cutex validates again; the main process only passes well-formed ids.

export const WORKFLOWS_FEATURE = "workflows";
export const WORKFLOW_RESUME_FEATURE = "workflow-resume";
export const WORKFLOW_RUN_CHANGED_EVENT = "cutex/workflow/run/changed";
export const WORKFLOW_STEP_CHANGED_EVENT = "cutex/workflow/step/changed";
export const WORKFLOW_LOG_EVENT = "cutex/workflow/log";
export const WORKFLOW_RUN_ID = /^wr-[A-Za-z0-9-]{1,61}$/;

export type WorkflowRunState = "pendingApproval" | "running" | "stopping" | "completed" | "errored" | "stopped" | "rejected" | "expired";
export type WorkflowStopReason = "user" | "model" | "interrupted" | "provider";
export type WorkflowStepState = "queued" | "starting" | "running" | "done" | "failed" | "cached";

export interface WorkflowLimits {
  maxAgents: number;
  maxConcurrency: number;
  maxTokens: number;
  hardStop?: boolean;
}

export interface WorkflowCounts {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  cached: number;
}

export interface WorkflowError {
  code: string;
  message: string;
}

export type WorkflowAuthor = { kind: "agent"; cutex_session_id: string; name?: string | null } | { kind: "owner" };

export interface WorkflowPhaseMeta {
  title: string;
  detail?: string | null;
  model?: string | null;
}

export interface WorkflowPhaseProgress {
  title: string;
  detail: string | null;
  total: number;
  done: number;
  running: number;
  failed: number;
}

export interface WorkflowStepView {
  runId: string;
  stepKey: string;
  callIndex: number;
  phase?: string | null;
  label?: string | null;
  prompt: string;
  profile?: string | null;
  sessionId?: string | null;
  askId?: string | null;
  askIds?: string[];
  state: WorkflowStepState;
  resultPreview?: string | null;
  result?: unknown;
  error?: WorkflowError | null;
  tokens: number;
  repairs: number;
  cachedFrom?: string | null;
  activity?: string | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface WorkflowLogLine {
  seq: number;
  at: string;
  level: "info" | "warn" | string;
  text: string;
}

/** A list row (`run_summary`). */
export interface WorkflowRunSummary {
  runId: string;
  seq: number;
  name: string;
  description: string;
  phases: WorkflowPhaseMeta[];
  author: WorkflowAuthor;
  projectId?: string | null;
  cwd: string;
  scriptSha256: string;
  args?: unknown;
  limits: WorkflowLimits;
  defaultProfile?: string | null;
  stepProfiles: string[];
  models: string[];
  approvalId?: string | null;
  state: WorkflowRunState;
  stopReason?: WorkflowStopReason | null;
  error?: WorkflowError | null;
  currentPhase?: string | null;
  counts: WorkflowCounts;
  tokens: number;
  hasResult: boolean;
  resultPreview?: string | null;
  resumedFrom?: string | null;
  draftPath?: string | null;
  warnings: string[];
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  revision: number;
}

/** `GET /v2/workflows/runs/{id}` (`run`). */
export interface WorkflowRunView extends WorkflowRunSummary {
  phaseProgress: WorkflowPhaseProgress[];
  steps: WorkflowStepView[];
  log?: WorkflowLogLine[];
  logTail?: WorkflowLogLine[];
  script?: string;
  result?: unknown;
}

export interface WorkflowRunList {
  hostId: string;
  runs: WorkflowRunSummary[];
}

export type WorkflowRunAction = "stop" | "resume" | "delete";

export interface WorkflowChange {
  method: typeof WORKFLOW_RUN_CHANGED_EVENT | typeof WORKFLOW_STEP_CHANGED_EVENT | typeof WORKFLOW_LOG_EVENT;
  runId: string;
  hostId?: string;
  state?: WorkflowRunState;
  deleted?: boolean;
}

/** A workflow host event's essentials, or null for any other / malformed event. */
export function workflowChangeOf(envelope: { cutex?: { method?: string; params?: unknown } | null } | null | undefined): WorkflowChange | null {
  const method = envelope?.cutex?.method;
  if (method !== WORKFLOW_RUN_CHANGED_EVENT && method !== WORKFLOW_STEP_CHANGED_EVENT && method !== WORKFLOW_LOG_EVENT) return null;
  const p = envelope?.cutex?.params as Partial<WorkflowChange> | undefined;
  if (!p || typeof p.runId !== "string" || !WORKFLOW_RUN_ID.test(p.runId)) return null;
  return { method, runId: p.runId, hostId: typeof p.hostId === "string" ? p.hostId : undefined, state: p.state, deleted: p.deleted === true };
}

export const isWorkflowRunOpen = (state: WorkflowRunState) => state === "pendingApproval" || state === "running" || state === "stopping";
