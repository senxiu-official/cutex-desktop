// 后端更新 → the run: its steps by phase (waiting for idle agents with whom it waits for, stop, backup,
// swap, start, verify …), cancel while nothing changed yet, and the outcome — committed, deferred,
// cancelled, rolled back, failed, or needs-owner with the commands to run on the host. Also the
// history list (each run expands to the same view).
import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDashed, Copy, Loader2, Minus, X } from "lucide-react";
import type { UpgradeRun } from "../../../../shared/backendUpgrade";
import { ArmedHint } from "../../components/ArmedHint";
import { Button, EmptyState, ErrorNote, IconButton, Loading, RefreshButton, Section } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { settingsAnchorId } from "../../lib/settingsNav";
import { formatAbsolute, formatWhen, useClock, useNow } from "../../lib/time";
import { useTargetApi } from "../../lib/targetHost";
import { useUpgradeAction } from "./hooks";
import { canCancel, formatDuration, runActive, runModeKeys, runRuntime, runSteps, runtimeLine, secondsSince, servicesDown, unixOf, type StepState } from "./model";
import { loadUpgradeStatus } from "./store";

/** "12 分钟前" with the full time as tooltip. */
export function When({ iso }: { iso: string | null | undefined }) {
  const { locale } = useI18n();
  const now = useClock();
  const unix = unixOf(iso);
  if (unix === null) return <>—</>;
  return <span title={formatAbsolute(unix)}>{formatWhen(unix, now, locale)}</span>;
}

/** One command the owner runs on the host, copyable. */
export function CommandLine({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
      <code className="min-w-0 flex-1 font-mono text-xs break-all select-all">{text}</code>
      <IconButton label={t("backend-upgrade.copy")} onClick={() => void navigator.clipboard.writeText(text).catch(() => {})}>
        <Copy size={13} />
      </IconButton>
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return <Check size={13} className="text-ok" />;
    case "current":
      return <Loader2 size={13} className="animate-spin text-accent" />;
    case "failed":
      return <X size={13} className="text-danger" />;
    case "stopped":
      return <Minus size={13} className="text-subtle" />;
    default:
      return <CircleDashed size={13} className="text-subtle/60" />;
  }
}

const phaseKey = (phase: string) => `backend-upgrade.phase.${phase}` as MessageKey;

/** The run's outcome line (terminal phases) — tone + text. */
function Outcome({ run }: { run: UpgradeRun }) {
  const { t } = useI18n();
  const downtime = formatDuration(run.downtimeMs);
  const vars = { from: run.fromRelease, to: run.toRelease, downtime: downtime ?? "—" };
  switch (run.phase) {
    case "committed":
      return <p className="py-2 text-xs text-ok-text">{t(run.kind === "rollback" ? "backend-upgrade.outcome.rolledBackOwner" : "backend-upgrade.outcome.committed", vars)}</p>;
    case "deferred":
      return <p className="py-2 text-xs text-warn">{t("backend-upgrade.outcome.deferred", vars)}</p>;
    case "cancelled":
      return <p className="py-2 text-xs text-subtle">{t("backend-upgrade.outcome.cancelled", vars)}</p>;
    case "rolled-back":
      return <p className="py-2 text-xs text-danger">{t("backend-upgrade.outcome.rolledBack", vars)}</p>;
    case "failed":
      return <p className="py-2 text-xs text-danger">{t("backend-upgrade.outcome.failed", vars)}</p>;
    case "needs-owner":
      return <p className="py-2 text-xs font-medium text-danger">{t("backend-upgrade.outcome.needsOwner", vars)}</p>;
    default:
      return null;
  }
}

/** Steps, waiting list, error / needs-owner details of one run. */
export function RunDetail({ run }: { run: UpgradeRun }) {
  const { t } = useI18n();
  const active = runActive(run);
  const now = useNow(active && run.phase === "waiting-idle");
  const steps = runSteps(run);
  const waited = run.phase === "waiting-idle" ? secondsSince(steps.find((s) => s.phase === "waiting-idle")?.at, now) : null;
  return (
    <div className="py-2">
      <ol className="space-y-1">
        {steps.map((s) => (
          <li key={s.phase} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 flex w-4 shrink-0 justify-center">
              <StepIcon state={s.state} />
            </span>
            <span className={`min-w-0 flex-1 ${s.state === "pending" ? "text-subtle" : s.state === "failed" ? "text-danger" : ""}`}>
              {t(phaseKey(s.phase))}
              {s.detail && <span className="ml-1.5 text-subtle">· {s.detail}</span>}
            </span>
            {s.at && (
              <span className="shrink-0 text-subtle tabular-nums">
                <When iso={s.at} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {run.phase === "waiting-idle" && (
        <div className="mt-2 rounded-md bg-surface-2/60 px-2.5 py-1.5 text-xs">
          <p className="text-muted">{t("backend-upgrade.run.waitingHint", { max: formatDuration(run.maxWaitSecs * 1000) ?? "—", waited: formatDuration((waited ?? 0) * 1000) ?? "—" })}</p>
          {(run.waitingFor ?? []).length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {(run.waitingFor ?? []).map((b, i) => (
                <li key={`${b.cutexSessionId ?? ""}|${b.reason}|${i}`} className="flex gap-2">
                  <span className="min-w-0 truncate">{b.name || b.cutexSessionId || t("backend-upgrade.run.someone")}</span>
                  <span className="shrink-0 text-subtle">{t(`backend-upgrade.busy.${["activeTurn", "threadActive", "packageRun"].includes(b.reason) ? b.reason : "other"}` as MessageKey, { reason: b.reason })}</span>
                  {b.detail && <span className="min-w-0 truncate text-subtle">· {b.detail}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-subtle">{t("backend-upgrade.run.checkingIdle")}</p>
          )}
        </div>
      )}
      {servicesDown(run) && <p className="mt-2 text-xs text-warn">{t("backend-upgrade.run.servicesDown")}</p>}
      {run.cancelRequested && active && <p className="mt-2 text-xs text-subtle">{t("backend-upgrade.run.cancelRequested")}</p>}
      <Outcome run={run} />
      {run.error && <ErrorNote>{`${run.error.code}: ${run.error.message}`}</ErrorNote>}
      {run.needsOwner && (
        <div className="space-y-1.5 pb-2">
          <p className="text-xs">{run.needsOwner.reason}</p>
          <p className="text-xs text-subtle">{t("backend-upgrade.run.needsOwnerCommands")}</p>
          {run.needsOwner.commands.map((c, i) => (
            <CommandLine key={i} text={c} />
          ))}
        </div>
      )}
      {(run.backupDir || (run.displaced ?? []).length > 0 || run.packageRunId) && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pb-1 text-xs text-subtle">
          {run.backupDir && (
            <>
              <dt>{t("backend-upgrade.run.backupDir")}</dt>
              <dd className="truncate font-mono select-text" title={run.backupDir}>
                {run.backupDir}
              </dd>
            </>
          )}
          {(run.displaced ?? []).length > 0 && (
            <>
              <dt>{t("backend-upgrade.run.displaced")}</dt>
              <dd className="font-mono break-all select-text">{(run.displaced ?? []).join(", ")}</dd>
            </>
          )}
          {run.packageRunId && (
            <>
              <dt>{t("backend-upgrade.run.packageRun")}</dt>
              <dd className="truncate font-mono select-text">{run.packageRunId}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

/**
 * A finished run of the last day as one line at the top (model runDisplay): the outcome, where its
 * steps are, and a dismiss (remembered per host for this run). Not for needs-owner (that keeps the card).
 */
export function RunNote({ run, onDismiss }: { run: UpgradeRun; onDismiss(): void }) {
  const { t } = useI18n();
  return (
    <Section id={settingsAnchorId("run")}>
      <div className="flex items-start gap-2" data-upgrade-run-note={run.phase}>
        <div className="min-w-0 flex-1">
          <Outcome run={run} />
          {run.error && <p className="-mt-1 pb-2 text-xs break-words text-danger">{`${run.error.code}: ${run.error.message}`}</p>}
          {run.phase === "committed" && <RuntimeNote run={run} className="-mt-1 pb-2 text-xs text-muted" />}
          <p className="-mt-1 pb-2 text-xs text-subtle">
            <When iso={run.finishedAt ?? run.createdAt} /> · {t("backend-upgrade.note.details")}
          </p>
        </div>
        <span className="pt-1.5">
          <IconButton label={t("backend-upgrade.note.dismiss")} onClick={onDismiss}>
            <X size={13} />
          </IconButton>
        </span>
      </div>
    </Section>
  );
}

/** What the run gives new agents (cutex's record only, model runtimeLine); nothing on older records. */
function RuntimeNote({ run, className }: { run: UpgradeRun; className: string }) {
  const { t } = useI18n();
  const line = runtimeLine(runRuntime(run, null));
  if (!line) return null;
  return (
    <p className={className} data-upgrade-runtime={run.runtimeChange ?? ""}>
      {t(line.key, line.vars)}
    </p>
  );
}

/**
 * The current run (or one that needs the owner), with cancel. `native`: the version a full run brings
 * as the manifest facts say (model releaseNative) — only used when the run carries no `runtimeChange`.
 */
export function RunSection({ hostId, run, native = null }: { hostId: string; run: UpgradeRun; native?: string | null }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const action = useUpgradeAction();
  const [armed, setArmed] = useArmed(run.runId);
  const anchor = useRef<HTMLSpanElement>(null);
  const active = runActive(run);
  const title = t(run.kind === "rollback" ? "backend-upgrade.run.titleRollback" : "backend-upgrade.run.title", { from: run.fromRelease, to: run.toRelease });
  const cancel = async () => {
    setArmed(false);
    await action.run(() => api.upgradeCancel());
    void loadUpgradeStatus(hostId);
  };
  const cancellable = canCancel(run);
  return (
    <Section
      id={settingsAnchorId("run")}
      title={title}
      hint={t(runModeKeys(runRuntime(run, native)).mode)}
      actions={
        active && cancellable ? (
          <span ref={anchor} className="inline-flex">
            {armed ? (
              <button className={`${ARMED_FORM_BUTTON} shrink-0 whitespace-nowrap`} disabled={action.busy} onClick={() => void cancel()}>
                {t("backend-upgrade.cancel")}
              </button>
            ) : (
              <Button disabled={action.busy} onClick={() => setArmed(true)}>
                {t("backend-upgrade.cancel")}
              </Button>
            )}
            {armed && <ArmedHint anchor={anchor} text={t("backend-upgrade.cancelArmed")} />}
          </span>
        ) : undefined
      }
    >
      <RunDetail run={run} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
    </Section>
  );
}

/** One history row: kind, from → to, outcome, when; expands to the run's details. */
function HistoryRow({ run }: { run: UpgradeRun }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tone = run.phase === "committed" ? "text-ok-text" : ["rolled-back", "failed", "needs-owner"].includes(run.phase) ? "text-danger" : runActive(run) ? "text-accent" : "text-subtle";
  const downtime = formatDuration(run.downtimeMs);
  return (
    <div className="-mx-4 border-b border-border px-4 py-1.5 last:border-b-0">
      <button type="button" className="flex min-h-7 w-full items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
        <span className="min-w-0 flex-1 truncate text-sm">
          {t(run.kind === "rollback" ? "backend-upgrade.history.rollback" : "backend-upgrade.history.apply", { from: run.fromRelease, to: run.toRelease })}
        </span>
        <span className={`shrink-0 text-xs ${tone}`}>{t(phaseKey(run.phase))}</span>
        {downtime && <span className="shrink-0 text-xs text-subtle tabular-nums group-data-[narrow]/card:hidden">{t("backend-upgrade.history.downtime", { downtime })}</span>}
        <span className="w-24 shrink-0 text-right text-xs text-subtle tabular-nums">
          <When iso={run.finishedAt ?? run.createdAt} />
        </span>
      </button>
      {open && (
        <div className="pl-5">
          <p className="font-mono text-[11px] text-subtle select-text">
            {run.runId} · {t(`backend-upgrade.class.${run.class}` as MessageKey)} · {t(`backend-upgrade.mode.short.${run.mode}` as MessageKey)}
            {run.requestedBy ? ` · ${run.requestedBy}` : ""}
          </p>
          <RuntimeNote run={run} className="pt-1 text-xs text-muted" />
          <RunDetail run={run} />
        </div>
      )}
    </div>
  );
}

export function HistorySection({ runs, error, onReload }: { runs: UpgradeRun[] | undefined; error: string | null; onReload(): void }) {
  const { t } = useI18n();
  return (
    <Section id={settingsAnchorId("history")} title={t("backend-upgrade.history.title")} actions={<RefreshButton onClick={onReload} />}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {runs === undefined ? <Loading rows={2} /> : runs.length === 0 ? <EmptyState>{t("backend-upgrade.history.empty")}</EmptyState> : runs.map((r) => <HistoryRow key={r.runId} run={r} />)}
    </Section>
  );
}
