// Job Service jobs (作业): the shared status mark (glyph + word) and the read-only output viewer.
// The 作业 status category (capsule section, status-row chip) lives in modules/jobs.
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, X } from "lucide-react";
import type { JobRow, JobStream } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { formatSpan } from "../lib/delegations";
import { jobSeconds, jobStatus, jobTitle } from "../lib/jobs";
import { closeJobOutput, readJobOutput, useHostJobs, useJobOutputView, useJobs } from "../lib/jobStore";
import { useJobWord } from "../lib/jobsView";
import { copyText } from "../lib/menus";
import { useTrackOverlay } from "../lib/openOverlays";
import { formatAbsolute, useNow } from "../lib/time";
import { DelegationGlyph } from "./DelegationParts";

const WORD_TONE = { danger: "text-danger", warn: "text-warn", green: "text-muted", accent: "text-muted", muted: "text-muted", neutral: "text-muted" } as const;

/** Glyph + word (never colour alone) + optional "· trailing". */
export function JobStatusMark({ job, trailing, className = "" }: { job: JobRow; trailing?: string | null; className?: string }) {
  const status = jobStatus(job);
  const word = useJobWord()(status);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
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
  const { t } = useI18n();
  const focusJob = useJobs((s) => s.byId[jobId]);
  const hostJob = useHostJobs((s) => (hostId ? s.byHost[hostId]?.rows.find((j) => j.jobId === jobId) : undefined));
  const job = hostId ? hostJob : focusJob;
  const [stream, setStream] = useState<JobStream>("stdout");
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

  useEffect(() => {
    void load(stream);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeJobOutput();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const v = views[stream];
  const status = job ? jobStatus(job) : null;
  const finished = status?.group === "done";
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[7vh]" onMouseDown={(e) => e.target === e.currentTarget && closeJobOutput()}>
      <div role="dialog" aria-modal aria-label={t("jobs.output.title")} className="flex h-[min(82vh,46rem)] w-[56rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className={`min-w-0 truncate font-semibold ${job?.command ? "font-mono text-[13px]" : ""}`} title={job ? jobTitle(job) : jobId}>
                {job ? jobTitle(job) : jobId}
              </span>
              {job && <JobStatusMark job={job} trailing={time} className="shrink-0 text-xs" />}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 text-[11px] text-subtle">
              <button onClick={() => copyText(jobId)} title={t("jobs.copyId")} className="inline-flex items-center gap-1 font-mono hover:text-foreground">
                {jobId}
                <Copy size={11} />
              </button>
              {job?.agentName && <span>{job.agentName}</span>}
              {job && <span title={formatAbsolute(job.createdAt)}>{t("jobs.started", { at: formatAbsolute(job.createdAt) })}</span>}
              {job?.cwd && <span className="min-w-0 truncate font-mono">{job.cwd}</span>}
            </div>
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
          {job?.[stream]?.truncated && <span className="ml-2 text-[11px] text-warn-text">{t("jobs.output.truncated")}</span>}
          <span className="ml-auto flex items-center gap-2">
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
        <pre className="min-h-0 flex-1 overflow-auto bg-background px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all text-foreground select-text">
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

/** The output viewer (App level; opened from any job row / menu). */
export function JobOutputDialog() {
  const jobId = useJobOutputView((s) => s.jobId);
  const hostId = useJobOutputView((s) => s.hostId);
  return jobId ? <OutputDialog key={`${hostId ?? ""}\n${jobId}`} jobId={jobId} hostId={hostId} /> : null;
}
