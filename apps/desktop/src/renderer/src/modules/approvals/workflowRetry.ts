// A workflow retry after steps whose outcome is unconfirmed (cutex r295 Z3: `step_outcome_unknown`). cutex asks the owner
// first (`details.unconfirmedSteps`, never auto-approved by a rule) because those steps may already have made changes;
// the card lists them with their delegation and session ids so the owner can look before approving. The steps are the
// previous run's (`details.resumedFrom`). Pure (test/workflowRetryApproval.test.ts).
import type { ApprovalRecord } from "../../../../shared/ipc";
import type { WorkflowStepView } from "../../../../shared/workflows";

/** Step error codes that leave a step's effect unknown (cutex workflows engine `step_needs_owner`). */
const UNCONFIRMED_CODES = new Set(["step_outcome_unknown", "ask_missing", "runtime_restart", "outcome_unknown"]);
const RUN_ID = /^wr-[A-Za-z0-9_-]{1,64}$/;

/** The previous run to read, when this approval is such a retry; null otherwise. */
export function unconfirmedRetryRun(record: Pick<ApprovalRecord, "kind"> & { details?: ApprovalRecord["details"] }): string | null {
  if (record.kind !== "workflow_run" || record.details?.unconfirmedSteps !== true) return null;
  const from = record.details.resumedFrom;
  return typeof from === "string" && RUN_ID.test(from) ? from : null;
}

export interface UnconfirmedStep {
  stepKey: string;
  label: string;
  /** `live`: it was still running when the run stopped; `unknown`: its result was never recorded. */
  why: "live" | "unknown";
  askIds: string[];
  sessionId: string | null;
}

/** The steps the owner should check: still live, or ended with an unconfirmed outcome. */
export function unconfirmedSteps(steps: readonly WorkflowStepView[]): UnconfirmedStep[] {
  return steps.flatMap((s): UnconfirmedStep[] => {
    const live = s.state === "starting" || s.state === "running";
    if (!live && !(s.error && UNCONFIRMED_CODES.has(s.error.code))) return [];
    const askIds = [...new Set([...(s.askIds ?? []), ...(s.askId ? [s.askId] : [])])];
    return [{ stepKey: s.stepKey, label: s.label?.trim() || s.stepKey, why: live ? "live" : "unknown", askIds, sessionId: s.sessionId ?? null }];
  });
}
