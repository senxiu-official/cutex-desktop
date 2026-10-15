// cutex Job Service jobs (作业): long-running commands agents submit with `cutex_job.submit`. Pure
// helpers for the capsule's 作业 category and the 作业 page. Job Service states pass through as-is;
// JOB_STATES is the one table mapping them to a group, glyph, tone and word, so a future scheduler's
// states (queued / waiting_for_resources) only need a row here. Unknown states show their raw name.
import type { JobRow } from "../../../shared/ipc";
import type { StatusGlyph, StatusTone } from "./delegations";

export const JOB_SERVICE_FEATURE = "job-service";

/** in progress / waiting for a slot (no Job Service scheduler yet) / finished. */
export type JobGroup = "active" | "queued" | "done";
export type JobStatusKey = "starting" | "running" | "queued" | "registered" | "succeeded" | "exitCode" | "failed" | "cancelled" | "interrupted" | "unknown" | "other";

interface StateRow {
  group: JobGroup;
  key: JobStatusKey;
  glyph: StatusGlyph;
  tone: StatusTone;
}

/** Job Service state → display (wire names, snake_case). `exited` depends on the exit code. */
export const JOB_STATES: Record<string, StateRow> = {
  launch_pending: { group: "active", key: "starting", glyph: "ring", tone: "accent" },
  running: { group: "active", key: "running", glyph: "pulse", tone: "accent" },
  // Reserved for a Job Service scheduler (docs/research/job-scheduling-brief.md).
  queued: { group: "queued", key: "queued", glyph: "hollow", tone: "muted" },
  waiting_for_resources: { group: "queued", key: "queued", glyph: "hollow", tone: "muted" },
  // External (NCI PBS) job submitted and registered, not yet seen running by a trusted source.
  registered: { group: "queued", key: "registered", glyph: "hollow", tone: "muted" },
  exited: { group: "done", key: "succeeded", glyph: "check", tone: "green" },
  failed: { group: "done", key: "failed", glyph: "cross", tone: "danger" },
  cancelled: { group: "done", key: "cancelled", glyph: "cross", tone: "muted" },
  interrupted: { group: "done", key: "interrupted", glyph: "ring", tone: "warn" },
  launch_unknown: { group: "done", key: "unknown", glyph: "hollow", tone: "warn" },
};

export interface JobStatus extends StateRow {
  /** The wire state (shown for `other`). */
  raw: string;
  exitCode: number | null;
}

/** Status of a job. A non-zero exit is a failure with its code; an unknown state stays "in progress". */
export function jobStatus(job: Pick<JobRow, "state" | "exitCode">): JobStatus {
  const raw = String(job.state ?? "");
  const exitCode = typeof job.exitCode === "number" ? job.exitCode : null;
  const row = JOB_STATES[raw];
  if (!row) return { group: "active", key: "other", glyph: "hollow", tone: "muted", raw, exitCode };
  if (raw === "exited" && exitCode !== null && exitCode !== 0) return { group: "done", key: "exitCode", glyph: "cross", tone: "danger", raw, exitCode };
  return { ...row, raw, exitCode };
}

export const isJobFinished = (job: Pick<JobRow, "state" | "exitCode">) => jobStatus(job).group === "done";

/** "job_1deb…" */
export function shortJobId(jobId: string): string {
  return jobId.length > 12 ? `${jobId.slice(0, 8)}…` : jobId;
}

/**
 * What the job runs: the command (newer Job Service), else the action id; an external job's
 * scheduler name (unless it is only the bare `cx…` correlation marker) or id; else the job id.
 */
export function jobTitle(job: Pick<JobRow, "command" | "actionId" | "jobId"> & Partial<Pick<JobRow, "remoteName" | "remoteId">>): string {
  const name = (job.remoteName ?? "").trim();
  return (job.command ?? "").trim() || (job.actionId ?? "").trim() || (name && !/^cx[0-9a-f]{32}$/.test(name) ? name : "") || (job.remoteId ?? "").trim() || job.jobId;
}

/** Elapsed (in progress, until `nowSec`) or duration (finished) in seconds. */
export function jobSeconds(job: Pick<JobRow, "state" | "exitCode" | "createdAt" | "updatedAt">, nowSec: number): number {
  const end = isJobFinished(job) ? job.updatedAt : nowSec;
  return Math.max(0, end - job.createdAt);
}

/** Newest first: in progress by start, finished by end. */
export function sortJobs(rows: readonly JobRow[]): JobRow[] {
  return [...rows].sort((a, b) => {
    const ka = isJobFinished(a) ? a.updatedAt : a.createdAt;
    const kb = isJobFinished(b) ? b.updatedAt : b.createdAt;
    return kb - ka || (a.jobId < b.jobId ? 1 : -1);
  });
}

export interface AgentJobs {
  /** In progress and queued (newest first). */
  open: JobRow[];
  /** The most recent finished ones (newest first), at most `finishedLimit`. */
  finished: JobRow[];
  finishedTotal: number;
}

/** One agent's jobs for the capsule / status row. */
export function agentJobs(byId: Record<string, JobRow>, sessionId: string, finishedLimit = 10): AgentJobs {
  const mine = Object.values(byId).filter((j) => j.sessionId === sessionId);
  const open = sortJobs(mine.filter((j) => !isJobFinished(j)));
  const done = sortJobs(mine.filter(isJobFinished));
  return { open, finished: done.slice(0, finishedLimit), finishedTotal: done.length };
}

export function mergeJobs(byId: Record<string, JobRow>, rows: readonly JobRow[]): Record<string, JobRow> {
  if (rows.length === 0) return byId;
  const next = { ...byId };
  for (const r of rows) {
    if (!r || typeof r.jobId !== "string") continue;
    const old = next[r.jobId];
    if (!old || (r.revision ?? 0) >= (old.revision ?? 0)) next[r.jobId] = r;
  }
  return next;
}

/** Which human operations the running Job Service offers (an older one: list only). */
export function jobOperations(caps: { humanOperations?: unknown } | null | undefined): { cancel: boolean; output: boolean; markExternal: boolean } {
  const ops = Array.isArray(caps?.humanOperations) ? (caps.humanOperations as unknown[]) : [];
  return { cancel: ops.includes("cancel"), output: ops.includes("readOutput"), markExternal: ops.includes("markExternal") };
}

/** An external (scheduler, e.g. NCI PBS) job; rows of an older Job Service have no `source` = local. */
export function isExternalJob(job: Pick<JobRow, "source">): boolean {
  return typeof job.source === "string" && job.source !== "" && job.source !== "local";
}

/**
 * Whether a job can still be cancelled from here (the Job Service refuses finished ones anyway). An
 * external job runs on its scheduler: the owner cancels it there and marks it (手动标记).
 */
export const canCancelJob = (job: Pick<JobRow, "state" | "exitCode" | "source">) => !isJobFinished(job) && !isExternalJob(job);

/** A job has local output the Job Service can read (external jobs keep theirs on the remote host). */
export const hasLocalOutput = (job: Pick<JobRow, "source">) => !isExternalJob(job);

/** How long a finished job keeps the capsule's 作业 category visible on its own. */
export const RECENT_FINISHED_SECONDS = 30 * 60;

/** Whether the 作业 category shows: something runs, or a job ended within RECENT_FINISHED_SECONDS. */
export function jobsWorthShowing(data: AgentJobs, nowSec: number): boolean {
  if (data.open.length > 0) return true;
  const last = data.finished[0];
  return !!last && nowSec - last.updatedAt < RECENT_FINISHED_SECONDS;
}
