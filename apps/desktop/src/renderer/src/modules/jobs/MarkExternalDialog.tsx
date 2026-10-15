// 手动标记结果 (cutex job-external): the owner settles an unfinished external (NCI PBS) job after
// checking it on the scheduler — 成功 (exit 0) / 退出码 N / 失败 / 已取消, with a private note. Sent
// revision-guarded to the job's host (`POST /v2/job-service/mark-external`); a conflict means the job
// moved meanwhile (the list refreshes either way).
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { JobRow } from "../../../../shared/ipc";
import { Button, Segmented } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { jobTitle } from "../../lib/jobs";
import { markExternalJob } from "../../lib/jobStore";
import { markInput, sourceLabel, type MarkChoice } from "../../lib/remoteJobs";

const CHOICES: MarkChoice[] = ["succeeded", "exitCode", "failed", "cancelled"];

export function MarkExternalDialog({ job, hostId, onClose }: { job: JobRow; hostId: string; onClose(): void }) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<MarkChoice>("succeeded");
  const [exitCode, setExitCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = async () => {
    const r = markInput(job, { choice, exitCode, note });
    if ("error" in r) return setError(t(`jobs.mark.${r.error}` as MessageKey));
    setBusy(true);
    setError(null);
    try {
      const res = await markExternalJob(job, r.input, hostId);
      if (res.ok) return onClose();
      setError(t(res.code === "job_conflict" ? "jobs.mark.conflict" : "jobs.mark.failed", { error: res.message || res.code }));
    } catch (e) {
      setError(t("jobs.mark.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={t("jobs.mark.title")} className="w-[30rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t("jobs.mark.title")}</div>
            <div className="mt-0.5 truncate text-[11px] text-subtle" title={jobTitle(job)}>
              {[`${sourceLabel(job.source)} ${job.remoteId ?? ""}`.trim(), jobTitle(job) !== job.remoteId ? jobTitle(job) : ""].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button title={t("jobs.output.close")} onClick={onClose} className="shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-3 text-sm">
          <p className="text-xs text-muted">{t("jobs.mark.hint")}</p>
          <Segmented<MarkChoice> value={choice} onChange={setChoice} label={t("jobs.mark.title")} options={CHOICES.map((c) => ({ value: c, label: t(`jobs.mark.choice.${c}` as MessageKey) }))} />
          {choice === "exitCode" && (
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted">{t("jobs.mark.exitCode")}</span>
              <input value={exitCode} onChange={(e) => setExitCode(e.target.value)} inputMode="numeric" autoFocus className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent" />
            </label>
          )}
          <label className="block text-xs">
            <span className="text-muted">{t("jobs.mark.note")}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2048} placeholder={t("jobs.mark.notePlaceholder")} className="mt-1 w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent" />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
          <Button onClick={onClose}>{t("jobs.mark.cancel")}</Button>
          <Button primary onClick={() => void submit()} disabled={busy}>
            {t("jobs.mark.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
