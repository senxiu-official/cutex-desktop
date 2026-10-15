// The 作业 status category (DESIGN §4.20): Job Service jobs of one agent. Rows: what runs (command /
// action id) · status (glyph + word) · elapsed or duration; a row opens the output (when the Job
// Service offers it) and has a sibling 取消 (armed two-click) while it runs. 已结束 · N expands
// inline to the recent finished ones, then a link to the 作业 page filtered to this agent.
import { useState } from "react";
import { Hourglass } from "lucide-react";
import { NCI_MODULE } from "../../lib/remoteJobs";
import { useModuleEnabled } from "../react";
import type { JobRow } from "../../../../shared/ipc";
import { JobStatusMark } from "../../components/JobParts";
import { FinishedFold } from "../../components/FinishedFold";
import { StatusChip } from "../../components/StatusChip";
import { useI18n } from "../../i18n";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { contextMenu } from "../../lib/contextMenu";
import { formatSpan } from "../../lib/delegations";
import { useAgentNames } from "../../lib/delegationsView";
import { jobMenu, runCancelJob } from "../../lib/jobMenu";
import { canCancelJob, hasLocalOutput, jobSeconds, jobStatus, jobTitle, shortJobId, type AgentJobs } from "../../lib/jobs";
import { openJobOutput, useJobs } from "../../lib/jobStore";
import { useAgentJobs, useJobOps, useJobWord } from "../../lib/jobsView";
import { useNow } from "../../lib/time";
import { services } from "../app";
import type { StatusBarProps } from "../slots";
import { CAPSULE_ROW, CAPSULE_ROW_ACTION, CAPSULE_ROW_MAIN, capsuleRowActions } from "../../lib/capsuleRows";

/** Elapsed (running) / duration (finished). */
function useJobTime(job: JobRow): string {
  const live = jobStatus(job).group !== "done";
  const now = useNow(live);
  return formatSpan(jobSeconds(job, Math.floor(now / 1000)));
}

function Row({ job, sessionId }: { job: JobRow; sessionId: string }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const ops = useJobOps();
  const nciOn = useModuleEnabled(NCI_MODULE);
  const [armed, setArmed] = useArmed();
  const time = useJobTime(job);
  const menu = () => jobMenu(job, t, nameOf, ops, { here: sessionId, remote: nciOn });
  const title = jobTitle(job);
  const cancellable = ops.cancel && canCancelJob(job);
  // lib/capsuleRows: the status / time is the meta; 取消 takes its place on hover / focus.
  return (
    <li data-capsule-row="" className={`${CAPSULE_ROW} gap-1 hover:bg-hover`}>
      <button
        onClick={(e) => (ops.output && hasLocalOutput(job) ? openJobOutput(job.jobId) : contextMenu(menu)(e))}
        onContextMenu={contextMenu(menu)}
        title={`${title}\n${job.jobId}${nciOn && job.remoteId ? `\n${job.remoteId}` : ""}${job.cwd ? `\n${job.cwd}` : ""}`}
        className={CAPSULE_ROW_MAIN}
      >
        <span className={`min-w-0 flex-1 truncate ${job.command ? "font-mono text-[12px]" : ""}`}>{title}</span>
        <JobStatusMark job={job} trailing={time} className={`max-w-[45%] shrink-0 text-[11px] tabular-nums ${cancellable && !armed ? "group-hover/row:hidden group-focus-within/row:hidden" : ""}`} />
      </button>
      {cancellable && (
        <span className={capsuleRowActions(armed)}>
          {armed ? (
            <button className={`${ARMED_BUTTON} shrink-0`} onClick={() => (setArmed(false), void runCancelJob(job, t))}>
              {t("jobs.cancel")}
            </button>
          ) : (
            <button onClick={() => setArmed(true)} title={t("jobs.cancelConfirm")} className={`${CAPSULE_ROW_ACTION} hover:text-danger`}>
              {t("jobs.cancel")}
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** Unfinished jobs + the 已结束 fold. */
export function JobsBody({ sessionId, data }: { sessionId: string; data: AgentJobs }) {
  const { t } = useI18n();
  const error = useJobs((s) => s.error);
  return (
    <div>
      {error && data.open.length === 0 && data.finishedTotal === 0 && <p data-capsule-line="" className="px-2 py-1 text-[11px] text-subtle">{t("jobs.unavailable")}</p>}
      {data.open.length > 0 && (
        <ul>
          {data.open.map((j) => (
            <Row key={j.jobId} job={j} sessionId={sessionId} />
          ))}
        </ul>
      )}
      {data.finishedTotal > 0 && (
        <FinishedFold label={t("jobs.closed", { n: data.finishedTotal })} viewAll={t("jobs.viewAll")} onViewAll={() => services.ui.openPage("jobs.page", { agent: sessionId, scope: "done" })}>
          <ul>
            {data.finished.map((j) => (
              <Row key={j.jobId} job={j} sessionId={sessionId} />
            ))}
          </ul>
        </FinishedFold>
      )}
    </div>
  );
}

/** Header meta: 2 运行中 · 最久 12m. */
export function JobsMeta({ data }: { sessionId?: string; data: AgentJobs }) {
  const { t } = useI18n();
  const now = useNow(data.open.length > 0);
  if (data.open.length === 0) return <span>{t("jobs.finishedOnly", { n: data.finishedTotal })}</span>;
  const oldest = Math.max(...data.open.map((j) => jobSeconds(j, Math.floor(now / 1000))));
  return (
    <>
      <span>{t("jobs.running", { n: data.open.length })}</span>
      <span>·</span>
      <span>{t("jobs.oldest", { t: formatSpan(oldest) })}</span>
    </>
  );
}

/** The collapsed line: 作业 · <what> 运行中 12m (the newest unfinished one; else the latest finished). */
export function JobLine({ data }: { data: AgentJobs }) {
  const { t } = useI18n();
  const job = data.open[0] ?? data.finished[0];
  const live = !!job && jobStatus(job).group !== "done";
  const now = useNow(live);
  const word = useJobWord();
  if (!job) return null;
  const time = formatSpan(jobSeconds(job, Math.floor(now / 1000)));
  return (
    <>
      <span className="text-subtle">{t("jobs.statusTitle")} ·</span> <span className={job.command ? "font-mono text-xs" : "font-medium"}>{job.command ? jobTitle(job) : job.actionId || shortJobId(job.jobId)}</span>{" "}
      <span className="text-subtle">
        {word(jobStatus(job))}
        {time && ` ${time}`}
      </span>
    </>
  );
}

/** Status-row chip (作业 N ▸) with the rows in a panel floating up (placement 输入栏). Polls only while placed there. */
export function JobsStatusBar({ sessionId, inline }: StatusBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const data = useAgentJobs(sessionId, inline);
  const n = data.open.length;
  if (!inline || n === 0) return null;
  return (
    <StatusChip
      open={open}
      onOpenChange={setOpen}
      className="text-accent"
      label={
        <>
          <Hourglass size={13} />
          {t("jobs.count", { n })}
        </>
      }
    >
      <div className="flex h-6 items-center gap-1.5 px-2 text-[11px] text-subtle tabular-nums">
        <JobsMeta data={data} />
      </div>
      <JobsBody sessionId={sessionId} data={data} />
    </StatusChip>
  );
}
