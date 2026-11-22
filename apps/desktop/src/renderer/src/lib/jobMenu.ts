// One action list per job (作业), shared by the capsule rows, the status-row chip and the 作业 page:
// open the submitting agent, view output, cancel (when the Job Service allows), 结束跟进 (every job the Job Service
// may still track: recorded by a Job Service with closeFollowUp, else a local mark on this device), copy.
import type { JobRow } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import type { MenuEntry } from "./contextMenu";
import { canCancelJob, canEndJobFollowUp, hasLocalOutput, jobTitle } from "./jobs";
import { endJobFollowUp } from "./jobFollowUp";
import { cancelJob, openJobOutput } from "./jobStore";
import { openHostAgent } from "./hostLists";
import { copyText } from "./menus";
import { useApp } from "../store";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Cancel a job; a refusal shows as a toast. */
export async function runCancelJob(job: JobRow, t: T, hostId?: string | null): Promise<void> {
  try {
    const r = await cancelJob(job, hostId);
    if (!r.ok) useApp.getState().notify(t(r.code === "job_service_operation_unsupported" || r.code === "unsupported" ? "jobs.cancelUnsupported" : "jobs.cancelFailed", { error: r.message || r.code }), "error");
  } catch (e) {
    useApp.getState().notify(t("jobs.cancelFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
  }
}

/** 结束跟进 on a job; a refusal shows as a toast (an action conflict with the shared words). */
export async function runEndJobFollowUp(job: JobRow, t: T, server: boolean, hostId?: string | null): Promise<void> {
  const r = await endJobFollowUp(job, server, hostId);
  if (r.kind === "conflict") useApp.getState().notify(t("followUp.actionConflict"), "error");
  else if (r.kind === "changed") useApp.getState().notify(t("jobs.followUp.changed", { error: r.message }), "error");
  else if (r.kind === "failed") useApp.getState().notify(t("jobs.followUp.failed", { error: r.message }), "error");
}

/** `opts.hostId`: the job's host (作业 page rows of another host); default the focus host. */
/**
 * `opts.markExternal`: 手动标记结果… for an unfinished external job (the 作业 page passes it when the
 * host has job-external). `opts.remote`: 复制 PBS 作业号 (module nci on).
 */
export function jobMenu(job: JobRow, t: T, nameOf: (id: string) => string, ops: { cancel: boolean; output: boolean; closeFollowUp?: boolean }, opts: { here?: string | null; hostId?: string | null; markExternal?: () => void; remote?: boolean } = {}): MenuEntry[] {
  const hostId = opts.hostId ?? useApp.getState().hosts?.active ?? "local";
  return [
    opts.here !== job.sessionId && { label: t("jobs.openAgent", { name: job.agentName ?? nameOf(job.sessionId) }), onSelect: () => openHostAgent(hostId, job.sessionId) },
    ops.output && hasLocalOutput(job) && { label: t("jobs.viewOutput"), onSelect: () => openJobOutput(job.jobId, hostId) },
    opts.markExternal && { label: t("jobs.markExternal"), onSelect: opts.markExternal },
    (ops.cancel && canCancelJob(job)) || canEndJobFollowUp(job) ? "separator" : false,
    ops.cancel && canCancelJob(job) && { label: t("jobs.cancel"), danger: true, confirm: t("jobs.cancelConfirm"), onSelect: () => runCancelJob(job, t, hostId) },
    // Medium risk: confirmed in place. An older Job Service: a local mark only (said in the ⓘ).
    canEndJobFollowUp(job) && {
      label: t("followUp.end"),
      armed: t("followUp.confirmButton"),
      info: ops.closeFollowUp ? t("followUp.confirm") : t("jobs.followUp.localInfo"),
      onSelect: () => runEndJobFollowUp(job, t, !!ops.closeFollowUp, hostId),
    },
    "separator",
    { label: t("jobs.copyId"), onSelect: () => copyText(job.jobId) },
    !!(job.command?.trim() || job.actionId?.trim()) && { label: t(job.command ? "jobs.copyCommand" : "jobs.copyAction"), onSelect: () => copyText(jobTitle(job)) },
    job.cwd && { label: t("jobs.copyCwd"), onSelect: () => copyText(job.cwd!) },
    opts.remote && job.remoteId && { label: t("jobs.copyRemoteId"), onSelect: () => copyText(job.remoteId!) },
  ];
}
