// Job Service jobs (作业): the shared status mark (glyph + word) and the read-only output viewer.
// The 作业 status category (capsule section, status-row chip) lives in modules/jobs.
import { useCallback, useEffect, useRef, useState } from "react";
import { DelegationTag } from "./DelegationParts";
import { openDelegationDetail } from "../lib/delegationOpen";
import { focusHostId } from "../lib/hostKeys";
import { Copy, RefreshCw, X } from "lucide-react";
import type { JobRow, JobStream } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { formatSpan } from "../lib/delegations";
import { jobSeconds, jobStatus, jobStatusTipKey, jobTitle, jobOperations } from "../lib/jobs";
import { closeJobOutput, readJobOutput, useHostJobs, useJobOutputView, useJobs } from "../lib/jobStore";
import { useJobWord } from "../lib/jobsView";
import { copyText } from "../lib/menus";
import { useTrackOverlay } from "../lib/openOverlays";
import { formatAbsolute, useNow } from "../lib/time";
import { DelegationGlyph } from "./DelegationParts";
import { useOwnerWindow } from "../lib/ownerContext";
import { EntityMention } from "./EntityIcon";

const WORD_TONE = { danger: "text-danger", warn: "text-warn", green: "text-muted", accent: "text-muted", muted: "text-muted", neutral: "text-muted" } as const;

/** Glyph + word (never colour alone) + optional "· trailing". */
export function JobStatusMark({ job, trailing, className = "" }: { job: JobRow; trailing?: string | null; className?: string }) {
  const status = jobStatus(job);
  const word = useJobWord()(status);
  const { t } = useI18n();
  const observedAt = job.observedProcessState?.observedAtEpochMillis;
  // One hover wherever the mark shows (jobs page, capsule, status row): the full word (it may be cut) and what it means.
  const tipKey = jobStatusTipKey(status);
  const tip = status.key === "processStopped" || status.key === "processExited"
    ? t(`jobs.status.${status.key}.tip`, { time: typeof observedAt === "number" ? formatAbsolute(observedAt / 1000) : "" })
    : tipKey ? `${word}\n${t(tipKey, { state: status.raw })}` : undefined;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`} data-tip={tip}>
      <DelegationGlyph glyph={status.glyph} tone={status.tone} />
      <span className={`truncate ${WORD_TONE[status.tone]}`}>{word}</span>
      {trailing && <span className="shrink-0 text-subtle tabular-nums">· {trailing}</span>}
    </span>
  );
}

function useJobTimeOrNull(job: JobRow | undefined): string | null {
  const live = !!job && jobStatus(job).group !== "done";
  const now = useNow(live);
  return job ? formatSpan(jobSeconds(job, Math.floor(now / 1000))) : null;
}

// ---------- output viewer ----------

/** Output text kept per stream (the viewer pages on; older text past this is dropped). */
const MAX_TEXT = 2_000_000;

interface StreamView {
  text: string;
  next: number;
  eof: boolean;
  gap: boolean;
  loading: boolean;
  error: string | null;
}
const EMPTY_STREAM: StreamView = { text: "", next: 0, eof: false, gap: false, loading: false, error: null };

function OutputDialog({ jobId, hostId }: { jobId: string; hostId: string | null }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const focusJob = useJobs((s) => s.byId[jobId]);
  const hostJob = useHostJobs((s) => (hostId ? s.byHost[hostId]?.rows.find((j) => j.jobId === jobId) : undefined));
  const job = hostId ? hostJob : focusJob;
  const [stream, setStream] = useState<JobStream>("stdout");
  // r296 readOutputTail on this job's host: open at the newest output and follow it (off: the scroll stays put).
  const caps = useJobs((s) => s.caps);
  const hostCaps = useHostJobs((s) => (hostId ? s.byHost[hostId]?.caps : undefined));
  const tailOk = jobOperations(hostId ? hostCaps : caps).outputTail;
  const [follow, setFollow] = useState(true);
  const [tailFrom, setTailFrom] = useState<Record<JobStream, number>>({ stdout: 0, stderr: 0 });
  const preRef = useRef<HTMLPreElement>(null);
  const waitersAvailable = useJobs((s) => s.waitersAvailable);
  const hostWaiters = useHostJobs((s) => (hostId ? s.byHost[hostId]?.waitersAvailable : undefined));
  const [views, setViews] = useState<Record<JobStream, StreamView>>({ stdout: EMPTY_STREAM, stderr: EMPTY_STREAM });
  const viewsRef = useRef(views);
  viewsRef.current = views;

  useTrackOverlay(true);
  const time = useJobTimeOrNull(job);

  const load = useCallback(
    async (which: JobStream) => {
      const v = viewsRef.current[which];
      if (v.loading) return;
      setViews((s) => ({ ...s, [which]: { ...s[which], loading: true, error: null } }));
      try {
        const r = await readJobOutput(jobId, which, v.next, hostId);
        if (!r.ok) {
          setViews((s) => ({ ...s, [which]: { ...s[which], loading: false, error: r.message || r.code } }));
          return;
        }
        const p = r.value;
        setViews((s) => {
          const cur = s[which];
          const text = (cur.text + (p.gap && cur.text ? `\n[… ${t("jobs.output.gap", { n: p.omittedBytes ?? 0 })} …]\n` : "") + p.text).slice(-MAX_TEXT);
          return { ...s, [which]: { text, next: p.nextOffset, eof: p.eof || (p.nextOffset === v.next && !p.text), gap: cur.gap || !!p.gap, loading: false, error: null } };
        });
      } catch (e) {
        setViews((s) => ({ ...s, [which]: { ...s[which], loading: false, error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [jobId, hostId, t],
  );

  /** The newest retained page (r296): replaces what is shown; later reads continue from its `nextOffset`. */
  const loadTail = useCallback(
    async (which: JobStream) => {
      if (viewsRef.current[which].loading) return;
      setViews((s) => ({ ...s, [which]: { ...s[which], loading: true, error: null } }));
      try {
        const r = await readJobOutput(jobId, which, "tail", hostId);
        if (!r.ok) {
          setViews((s) => ({ ...s, [which]: { ...s[which], loading: false, error: r.message || r.code } }));
          return;
        }
        const p = r.value;
        setTailFrom((f) => ({ ...f, [which]: p.fromOffset }));
        setViews((s) => ({ ...s, [which]: { text: p.text, next: p.nextOffset, eof: p.eof, gap: p.fromOffset > 0 || !!p.gap, loading: false, error: null } }));
      } catch (e) {
        setViews((s) => ({ ...s, [which]: { ...s[which], loading: false, error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [jobId, hostId],
  );

  useEffect(() => {
    if (tailOk && !viewsRef.current[stream].text) void loadTail(stream);
    else void load(stream);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeJobOutput();
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }, []);

  const v = views[stream];
  const status = job ? jobStatus(job) : null;
  const finished = status?.group === "done";
  // Following: new output every 2 s while the job runs and the window is visible; the view stays at the bottom.
  useEffect(() => {
    if (!tailOk || !follow || finished) return;
    const timer = setInterval(() => !win.document.hidden && void load(stream), 2000);
    return () => clearInterval(timer);
  }, [tailOk, follow, finished, stream, load, win]);
  useEffect(() => {
    if (tailOk && follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [v.text, tailOk, follow]);
  const truncated = job?.[stream]?.truncated;
  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 pt-[7vh]" onMouseDown={(e) => e.target === e.currentTarget && closeJobOutput()}>
      <div role="dialog" aria-modal aria-label={t("jobs.output.title")} className="flex h-[min(82vh,46rem)] w-[56rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className={`min-w-0 truncate font-semibold ${job?.command ? "selectable font-mono text-ui/[inherit]" : ""}`} title={job ? jobTitle(job) : jobId}>
                {job ? jobTitle(job) : jobId}
              </span>
              {job && <JobStatusMark job={job} trailing={time} className="shrink-0 text-xs" />}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 text-caption/[inherit] text-subtle">
              <button onClick={() => copyText(jobId)} title={t("jobs.copyId")} className="inline-flex items-center gap-1 font-mono hover:text-foreground">
                {jobId}
                <Copy size={11} />
              </button>
              {job?.agentName && <span><EntityMention entity={{ kind: "agent", id: job.sessionId, name: job.agentName }}>{job.agentName}</EntityMention></span>}
              {job && <span title={formatAbsolute(job.createdAt)}>{t("jobs.started", { at: formatAbsolute(job.createdAt) })}</span>}
              {job?.cwd && <span className="selectable min-w-0 truncate font-mono">{job.cwd}</span>}
            </div>
            {job && (hostId ? hostWaiters : waitersAvailable) != null && (
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-caption/[inherit] text-subtle" data-job-output-waiters="">
                <span className="shrink-0">{t("jobs.col.waiters")}</span>
                <JobWaiters job={job} hostId={hostId} available={(hostId ? hostWaiters : waitersAvailable) ?? null} />
              </div>
            )}
          </div>
          <button title={t("jobs.output.close")} onClick={closeJobOutput} className="shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 text-xs">
          {(["stdout", "stderr"] as const).map((s) => {
            const summary = job?.[s];
            return (
              <button key={s} onClick={() => setStream(s)} className={`rounded-md px-2 py-1 ${stream === s ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}>
                {s}
                {summary?.observedBytes != null && <span className="ml-1 text-subtle tabular-nums">{formatBytes(summary.observedBytes)}</span>}
              </button>
            );
          })}
          {truncated && <span className="ml-2 text-caption/[inherit] text-warn-text" data-job-output-truncated="">{t(finished ? "jobs.output.truncatedDone" : "jobs.output.truncatedRunning")}</span>}
          <span className="ml-auto flex items-center gap-2">
            {tailOk && (
              <>
                <button onClick={() => { setFollow(true); void loadTail(stream); }} className="text-accent hover:underline" data-job-output-tail="">
                  {t("jobs.output.toEnd")}
                </button>
                {!finished && (
                  <label className="inline-flex items-center gap-1 text-muted">
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} data-job-output-follow="" />
                    {t("jobs.output.follow")}
                  </label>
                )}
              </>
            )}
            {v.loading && <span className="text-subtle">{t("jobs.output.loading")}</span>}
            {!v.eof && !v.loading && v.text && (
              <button onClick={() => void load(stream)} className="text-accent hover:underline">
                {t("jobs.output.more")}
              </button>
            )}
            {!finished && (
              <button onClick={() => void load(stream)} title={t("jobs.output.refresh")} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
                <RefreshCw size={13} />
              </button>
            )}
            <button onClick={() => copyText(v.text)} disabled={!v.text} title={t("jobs.output.copy")} className="rounded p-1 text-subtle enabled:hover:bg-surface-2 enabled:hover:text-foreground disabled:opacity-40">
              <Copy size={13} />
            </button>
          </span>
        </div>
        {v.error && <p className="px-4 py-2 text-xs text-danger">{t("jobs.output.failed", { error: v.error })}</p>}
        {tailOk && tailFrom[stream] > 0 && <p className="border-b border-border px-4 py-1 text-caption/[inherit] text-subtle" data-job-output-from="">{t("jobs.output.tailFrom", { size: formatBytes(tailFrom[stream]) })}</p>}
        <pre ref={preRef} className="min-h-0 flex-1 overflow-auto bg-background px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all text-foreground select-text">
          {v.text || (!v.loading && !v.error ? <span className="text-subtle">{t("jobs.output.empty")}</span> : null)}
        </pre>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * 等它的委托 of a job (r296 includeWaiters): each waiting delegation's #tag opens its detail (which leads to its card in the
 * requesting conversation). `available` false: the host could not read the waiting state — said, never 「无人等待」;
 * a row without the field (not asked / an older host): nothing.
 */
export function JobWaiters({ job, hostId, available, inline }: { job: Pick<JobRow, "waitingDelegationIds">; hostId: string | null; available: boolean | null; inline?: boolean }) {
  const { t } = useI18n();
  // Inline (a job row in the narrow page): a small 「等它 N」 chip; the links are in the output dialog's header.
  const chip = "shrink-0 rounded-sm px-1 text-caption/[inherit]";
  if (available === false)
    return inline
      ? <span className={`${chip} bg-warn/15 text-warn-text`} title={t("jobs.waiters.unreadHint")} data-job-waiters="unread">{t("jobs.waiters.inlineUnread")}</span>
      : <span className="text-caption/[inherit] text-warn-text" title={t("jobs.waiters.unreadHint")} data-job-waiters="unread">{t("jobs.waiters.unread")}</span>;
  const ids = job.waitingDelegationIds;
  if (!ids) return null;
  if (!ids.length) return inline ? <span hidden data-job-waiters="none" /> : <span className="text-caption/[inherit] text-subtle" data-job-waiters="none">{t("jobs.waiters.none")}</span>;
  if (inline)
    return <span className={`${chip} bg-accent-soft text-accent`} title={`${t("jobs.col.waiters")}\n${ids.join("\n")}`} data-job-waiters={ids.length}>{t("jobs.waiters.inline", { n: ids.length })}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5" data-job-waiters={ids.length}>
      {ids.map((askId) => <DelegationTag key={askId} askId={askId} onJump={() => openDelegationDetail(hostId ?? focusHostId(), askId)} />)}
    </span>
  );
}

/** The output viewer (App level; opened from any job row / menu). */
export function JobOutputDialog() {
  const jobId = useJobOutputView((s) => s.jobId);
  const hostId = useJobOutputView((s) => s.hostId);
  return jobId ? <OutputDialog key={`${hostId ?? ""}\n${jobId}`} jobId={jobId} hostId={hostId} /> : null;
}
