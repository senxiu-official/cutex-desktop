// 结束跟进 (End follow-up) on a job (state surfaces WP-D4, fix plan S7). A Job Service with `humanOperations`
// closeFollowUp records it (`POST /v2/job-service/close-follow-up`): the job becomes terminal `unconfirmed`
// (followUpEnded) and no signal is sent to its process. An older Job Service cannot record it: the desktop then keeps
// a local, durable mark (lib/jobLocalMarks, this device only) so the job leaves 进行中 and reads 结果未确认 here.
import type { JobResult, JobRow } from "../../../shared/ipc";
import { api, apiFor } from "../bridge";
import { focusHostId } from "./hostKeys";
import { markJobLocallyEnded } from "./jobLocalMarks";
import { refreshAgentJobs, refreshAllJobs, refreshHostJobs, useJobs } from "./jobStore";

/** The reason sent with 结束跟进 (the Job Service keeps it on the record). */
export const JOB_FOLLOW_UP_REASON = "owner ended follow-up from the desktop";

export type JobFollowUpOutcome = { kind: "ended" } | { kind: "local" } | { kind: "conflict" } | { kind: "changed"; message: string } | { kind: "failed"; message: string };

/**
 * What a Job Service answer means. `conflict`: the same action was sent with other details (followUp.actionConflict);
 * `changed`: the job's revision moved (it may have finished meanwhile): the list is refreshed.
 */
export function jobFollowUpOutcome(r: JobResult<unknown>): JobFollowUpOutcome {
  if (r.ok) return { kind: "ended" };
  if (r.code === "idempotency_conflict" || r.code === "action_id_conflict") return { kind: "conflict" };
  if (r.code === "job_conflict" || r.code === "conflict" || r.code === "revision_conflict") return { kind: "changed", message: r.message || r.code };
  return { kind: "failed", message: r.message || r.code };
}

/**
 * 结束跟进 on `job`. `server`: the Job Service offers closeFollowUp (else the local mark). Refreshes the job's list
 * either way. Never retried automatically.
 */
export async function endJobFollowUp(job: Pick<JobRow, "jobId" | "revision" | "sessionId">, server: boolean, hostId?: string | null): Promise<JobFollowUpOutcome> {
  if (!server) {
    markJobLocallyEnded(job.jobId);
    return { kind: "local" };
  }
  const focus = !hostId || hostId === focusHostId();
  try {
    return jobFollowUpOutcome(await (focus ? api : apiFor(hostId!)).jobCloseFollowUp(job.jobId, job.revision, JOB_FOLLOW_UP_REASON));
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : String(e) };
  } finally {
    if (!focus) void refreshHostJobs(hostId!);
    else {
      void refreshAgentJobs(job.sessionId);
      if (useJobs.getState().allIds) void refreshAllJobs();
    }
  }
}
