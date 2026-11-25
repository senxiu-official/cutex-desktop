// cutex Job Service jobs (作业): long-running commands agents submit with `cutex_job.submit`. Pure
// helpers for the capsule's 作业 category and the 作业 page. Job Service states pass through as-is;
// JOB_STATES is the one table mapping them to a group, glyph, tone and word, so a future scheduler's
// states (queued / waiting_for_resources) only need a row here. A state the table does not know reads 结果未确认
// (unconfirmed), is not counted as in progress, and still offers 结束跟进 (state surfaces S7).
import type { JobRow } from "../../../shared/ipc";
import { jobCanCloseFollowUp } from "../../../shared/ownerDispositions";
import type { StatusGlyph, StatusTone } from "./delegations";
import { isJobLocallyEnded } from "./jobLocalMarks";
import { jobActiveGroup } from "../../../shared/jobList";

export const JOB_SERVICE_FEATURE = "job-service";

/** in progress / waiting for a slot (no Job Service scheduler yet) / finished. */
export type JobGroup = "active" | "queued" | "done";
export type JobStatusKey =
  | "starting"
  | "running"
  | "queued"
  | "registered"
  | "succeeded"
  | "exitCode"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "processStopped"
  | "processExited"
  /** 结果未确认: the Job Service could not tell the outcome (launch_unknown, unconfirmed), or sent a state this table lacks. */
  | "unconfirmed"
  /** 已结束跟进 · 进程可能仍在运行: the owner's 结束跟进, recorded by the Job Service. */
  | "followUpEnded"
  /** 结果未确认 (this device only): 结束跟进 on an older Job Service, a local mark (lib/jobLocalMarks). */
  | "localEnded";

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
  // Legacy external state (migrated on load); the Job Service counts it as queued.
  stale: { group: "queued", key: "registered", glyph: "hollow", tone: "muted" },
  exited: { group: "done", key: "succeeded", glyph: "check", tone: "green" },
  failed: { group: "done", key: "failed", glyph: "cross", tone: "danger" },
  cancelled: { group: "done", key: "cancelled", glyph: "cross", tone: "muted" },
  interrupted: { group: "done", key: "interrupted", glyph: "ring", tone: "warn" },
  launch_unknown: { group: "done", key: "unconfirmed", glyph: "hollow", tone: "warn" },
  // r289 Job Service: terminal, outcome unconfirmed (`terminalReason: followUpEnded` after the owner's 结束跟进).
  unconfirmed: { group: "done", key: "unconfirmed", glyph: "hollow", tone: "warn" },
};

export interface JobStatus extends StateRow {
  /** The wire state (named in the hover of an unrecognized one). */
  raw: string;
  exitCode: number | null;
  /** The Job Service may still be tracking it: 结束跟进 applies (every non-terminal state, and an unrecognized one). */
  open: boolean;
  /** The wire state is not in JOB_STATES (shown as 结果未确认). */
  unrecognized?: boolean;
}

type StatusInput = Pick<JobRow, "state" | "exitCode"> & Partial<Pick<JobRow, "observedProcessState" | "jobId" | "launchPending" | "processAlive">> & { terminalReason?: unknown; followUpEnded?: unknown };

/** The owner's 结束跟进 recorded by the Job Service (`terminalReason: followUpEnded` or `followUpEnded: true`). */
const followUpEnded = (job: StatusInput) => job.terminalReason === "followUpEnded" || job.followUpEnded === true;

/**
 * Status of a job. A non-zero exit is a failure with its code; an unrecognized state reads 结果未确认 (not in
 * progress) and stays `open`. A job the owner ended locally (older Job Service) reads 结果未确认 until the Job Service
 * reports a final state.
 */
export function jobStatus(job: StatusInput): JobStatus {
  const s = baseStatus(job);
  // The Job Service's grouping wins (a launch being set up, or a process still alive after 结束跟进 / a terminal state, is
  // running), so the tabs agree with its totals; the word and `open` stay the state's. A local mark stays 已结束.
  return s.group !== "active" && s.key !== "localEnded" && jobActiveGroup(job) === "running" ? { ...s, group: "active" } : s;
}

function baseStatus(job: StatusInput): JobStatus {
  const raw = String(job.state ?? "");
  const exitCode = typeof job.exitCode === "number" ? job.exitCode : null;
  const row = JOB_STATES[raw];
  if (!row) {
    if (isJobLocallyEnded(job.jobId)) return { group: "done", key: "localEnded", glyph: "hollow", tone: "warn", raw, exitCode, open: false, unrecognized: true };
    return { group: "done", key: "unconfirmed", glyph: "hollow", tone: "warn", raw, exitCode, open: true, unrecognized: true };
  }
  if (row.group !== "done" && isJobLocallyEnded(job.jobId)) return { group: "done", key: "localEnded", glyph: "hollow", tone: "warn", raw, exitCode, open: false };
  if (row.key === "unconfirmed" && followUpEnded(job)) return { ...row, key: "followUpEnded", glyph: "cross", tone: "muted", raw, exitCode, open: false };
  if (raw === "exited" && exitCode !== null && exitCode !== 0) return { group: "done", key: "exitCode", glyph: "cross", tone: "danger", raw, exitCode, open: false };
  // The observed process only colours a running job: the job stays in progress until Job Service says otherwise.
  const observed = raw === "running" ? job.observedProcessState?.state : undefined;
  const open = row.group !== "done";
  if (observed === "stopped") return { ...row, key: "processStopped", glyph: "ring", tone: "warn", raw, exitCode, open };
  if (observed === "exited") return { ...row, key: "processExited", glyph: "ring", tone: "muted", raw, exitCode, open };
  return { ...row, raw, exitCode, open };
}

/** The hover explanation of a status (module jobs catalog), when it has one beyond its word. */
export function jobStatusTipKey(status: Pick<JobStatus, "key" | "unrecognized">): "jobs.status.unconfirmed.tip" | "jobs.status.unrecognized.tip" | "jobs.status.followUpEnded.tip" | "jobs.status.localEnded.tip" | "jobs.status.processStopped.tip" | "jobs.status.processExited.tip" | null {
  if (status.key === "localEnded") return "jobs.status.localEnded.tip";
  if (status.unrecognized) return "jobs.status.unrecognized.tip";
  if (status.key === "unconfirmed" || status.key === "followUpEnded" || status.key === "processStopped" || status.key === "processExited") return `jobs.status.${status.key}.tip`;
  return null;
}

/** 结束跟进 applies: the Job Service may still be tracking the job. */
export const canEndJobFollowUp = (job: StatusInput) => jobStatus(job).open;

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
    // A read without waiters (an agent's capsule) keeps the waiting delegations the last waiters read gave.
    if (!old || (r.revision ?? 0) >= (old.revision ?? 0)) next[r.jobId] = r.waitingDelegationIds === undefined && old?.waitingDelegationIds !== undefined && old.revision === r.revision ? { ...r, waitingDelegationIds: old.waitingDelegationIds } : r;
  }
  return next;
}

/** Which human operations the running Job Service offers (an older one: list only). */
export function jobOperations(caps: { humanOperations?: unknown } | null | undefined): { cancel: boolean; output: boolean; markExternal: boolean; closeFollowUp: boolean; activeList: boolean; outputTail: boolean } {
  const ops = Array.isArray(caps?.humanOperations) ? (caps.humanOperations as unknown[]) : [];
  return {
    // r296: the active list (+ host totals and waiting delegations) and the output tail.
    activeList: ops.includes("activeList"),
    outputTail: ops.includes("readOutputTail"),
    cancel: ops.includes("cancel"),
    output: ops.includes("readOutput"),
    markExternal: ops.includes("markExternal"),
    // r289 結束跟进 recorded by the Job Service; without it 结束跟进 is a local mark (lib/jobFollowUp).
    closeFollowUp: jobCanCloseFollowUp({ humanOperations: ops.filter((o): o is string => typeof o === "string") }),
  };
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
