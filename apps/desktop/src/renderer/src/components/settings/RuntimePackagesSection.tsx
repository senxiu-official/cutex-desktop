// Settings → 运行时 → 升级 agent (cutex `runtime-package-upgrade`): explicit-launch agents of the
// connected host whose pinned runtime bundle is behind the selected one, 升级空闲的 (cutex runs the
// batch; busy agents are skipped), live per-agent progress, the last run's summary and 撤销.
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { CutexRefusal, OutdatedRuntimeAgent, RuntimePackageRun, RuntimePackageRunItem, RuntimePackageSummary } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, ARMED_FRAME, useArmed } from "../../lib/armedConfirm";
import { agentPackages, agentRuntimeState, idleCount, itemNote, itemOutcome, noteworthyItems, packageLabel, revertTarget } from "../../lib/runtimePackages";
import { revertRuntimePackageRun, startRuntimePackageUpgrade } from "../../lib/runtimePackageStore";
import { useActiveHostLabel, useHostRuntimePackages } from "../../lib/runtimePackagesView";
import { useTargetHostId } from "../../lib/targetHost";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { Button, ErrorNote, Loading, Section } from "./Form";

const STATE_TONE = { busy: "text-warn", offline: "text-subtle", online: "text-ok-text" } as const;
const KNOWN_ERRORS = ["run_in_progress", "nothing_to_upgrade", "selected_unavailable", "nothing_to_revert", "run_not_found"];
const KNOWN_SKIPS = ["busy", "alreadyCurrent", "notFound", "contractChanged", "notEligible"];
const KNOWN_FAILS = ["offlineFailed", "staleClaim", "reviewRefused", "targetMismatch", "selectedChanged", "applyFailed", "revertFailed", "interrupted"];

export function RuntimePackagesSection() {
  const { t } = useI18n();
  const host = useHostRuntimePackages();
  const hostLabel = useActiveHostLabel();
  if (!host) return null;
  const { view, error, actionError } = host;
  // All current and nothing to report: just the one quiet line.
  const quiet = !!view && view.agents.length === 0 && !view.activeRun && !view.lastRun;
  return (
    <Section title={t("runtimePackages.title")} hint={quiet ? undefined : t("runtimePackages.hint")}>
      {!view && !error && <Loading rows={1} />}
      {!view && error && <ErrorNote>{error}</ErrorNote>}
      {view && <Body hostLabel={hostLabel} starting={host.starting} />}
      {actionError && <ErrorNote>{refusalText(actionError, t)}</ErrorNote>}
    </Section>
  );
}

function refusalText(error: CutexRefusal, t: ReturnType<typeof useI18n>["t"]): string {
  return KNOWN_ERRORS.includes(error.code) ? t(`runtimePackages.error.${error.code}` as MessageKey) : `${error.code}: ${error.message}`;
}

function Body({ hostLabel, starting }: { hostLabel: string; starting: boolean }) {
  const hostId = useTargetHostId();
  const { t } = useI18n();
  const view = useHostRuntimePackages()!.view!;
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useArmed(view.agents.length);
  const target = packageLabel(view.selected) ?? t("runtimePackages.unknownTarget");
  const outdated = view.agents.length;
  const idle = idleCount(view.agents);
  const run = view.activeRun;
  const canStart = !!view.selected && !run && !starting && idle > 0;
  const headline = !view.selected
    ? t("runtimePackages.selectedError", { host: hostLabel, error: view.selectedError ?? "—" })
    : outdated > 0
      ? t("runtimePackages.outdated", { host: hostLabel, n: outdated, target })
      : t("runtimePackages.current", { host: hostLabel, target });
  return (
    <>
      <div className={`-mx-4 flex items-center gap-3 px-4 py-2.5 ${armed ? ARMED_FRAME : ""} ${outdated > 0 || run || view.lastRun ? "border-b border-border" : ""}`}>
        <p className={`min-w-0 flex-1 text-sm ${outdated > 0 ? "text-foreground" : "text-subtle"}`}>{headline}</p>
        {outdated > 0 &&
          (armed ? (
            <button
              className={ARMED_FORM_BUTTON}
              disabled={!canStart}
              onClick={() => {
                setArmed(false);
                void startRuntimePackageUpgrade(hostId);
              }}
            >
              {t("runtimePackages.upgradeAgain", { n: idle })}
            </button>
          ) : (
            <Button primary disabled={!canStart} title={idle === 0 ? t("runtimePackages.allBusy") : t("runtimePackages.upgradeHint")} onClick={() => setArmed(true)}>
              {starting ? <Loader2 size={12} className="inline animate-spin" /> : t("runtimePackages.upgrade")}
            </Button>
          ))}
      </div>
      {run ? (
        <RunBlock run={run} live />
      ) : (
        <>
          {outdated > 0 && (
            <div className="border-b border-border py-1.5 last:border-b-0">
              <button onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded py-0.5 text-xs text-muted hover:text-foreground" aria-expanded={open}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {t("runtimePackages.list", { n: outdated })}
              </button>
              {open && (
                <ul className="pt-1 pb-1">
                  {view.agents.map((a) => (
                    <AgentRow key={a.cutexSessionId} agent={a} selected={view.selected} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {view.lastRun && <RunBlock run={view.lastRun} live={false} />}
        </>
      )}
    </>
  );
}

function AgentRow({ agent, selected }: { agent: OutdatedRuntimeAgent; selected: RuntimePackageSummary | null }) {
  const { t } = useI18n();
  const state = agentRuntimeState(agent);
  const { current, target } = agentPackages(agent, selected);
  return (
    <li className="flex items-baseline gap-2 py-1 text-xs">
      <span className="w-24 shrink-0 truncate text-foreground" title={agent.cutexSessionId}>
        {agent.name}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={agent.repair ? (agent.current.missing ?? []).join("\n") || undefined : (agent.current.manifest ?? undefined)}>
        {agent.repair ? t("runtimePackages.agent.missing") : (current ?? t("runtimePackages.unreadable"))} → {target ?? "?"}
      </span>
      {agent.repair && (
        <span className="shrink-0 rounded bg-warn/15 px-1 text-[10px] text-warn-text" title={t("runtimePackages.agent.repairHint")}>
          {t("runtimePackages.agent.repair")}
        </span>
      )}
      <span className={`shrink-0 ${STATE_TONE[state]}`} title={state === "busy" && agent.busyReason ? t(`runtimePackages.busy.${agent.busyReason}` as MessageKey) : undefined}>
        {t(`runtimePackages.state.${state}` as MessageKey)}
      </span>
    </li>
  );
}

/** A run: live (every item with its state) or finished (summary + what did not simply move + 撤销). */
function RunBlock({ run, live }: { run: RuntimePackageRun; live: boolean }) {
  const hostId = useTargetHostId();
  const { t, locale } = useI18n();
  const now = useClock();
  const [armed, setArmed] = useArmed(run.runId);
  const target = revertTarget(useHostRuntimePackages()?.view ?? null);
  const revertable = target?.shownOn === run.runId ? target : null;
  const starting = useHostRuntimePackages()?.starting ?? false;
  const revert = run.kind === "revert";
  const c = run.counts;
  const when = Date.parse(run.finishedAt ?? run.startedAt);
  const rows = live ? run.items : noteworthyItems(run);
  return (
    <div className={`-mx-4 px-4 py-2 ${armed ? ARMED_FRAME : ""}`}>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {live ? (
            <span className="inline-flex items-center gap-1.5 text-accent">
              <Loader2 size={12} className="animate-spin" />
              {t(revert ? "runtimePackages.runningRevert" : "runtimePackages.running", { done: c.total - c.pending - (run.currentAgentId ? 1 : 0), total: c.total })}
            </span>
          ) : (
            <span title={Number.isFinite(when) ? formatAbsolute(when / 1000) : undefined}>
              {t(revert ? "runtimePackages.lastRevert" : "runtimePackages.lastUpgrade", {
                when: Number.isFinite(when) ? formatWhen(when / 1000, now, locale) : "—",
                moved: c.moved,
                skipped: c.skipped,
                failed: c.failed,
              })}
              {run.state === "interrupted" && <span className="ml-1 text-warn">{t("runtimePackages.interruptedRun")}</span>}
              {run.revertedBy.length > 0 && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] text-subtle">{t("runtimePackages.revertedTag")}</span>}
            </span>
          )}
        </p>
        {!live &&
          revertable &&
          (armed ? (
            <button
              className={ARMED_FORM_BUTTON}
              disabled={starting}
              onClick={() => {
                setArmed(false);
                void revertRuntimePackageRun(revertable.runId, hostId);
              }}
            >
              {t("runtimePackages.revertAgain", { n: revertable.agents })}
            </button>
          ) : (
            <Button disabled={starting} title={t("runtimePackages.revertHint")} onClick={() => setArmed(true)}>
              {t("runtimePackages.revert")}
            </Button>
          ))}
      </div>
      {rows.length > 0 && (
        <ul className="pt-1">
          {rows.map((item) => (
            <ItemRow key={item.cutexSessionId} item={item} revert={revert} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemRow({ item, revert }: { item: RuntimePackageRunItem; revert: boolean }) {
  const { t } = useI18n();
  const o = itemOutcome(item);
  let label: string;
  let tone: string;
  let reason: string | null = null;
  switch (o.kind) {
    case "pending":
      label = t("runtimePackages.item.pending");
      tone = "text-subtle";
      break;
    case "running":
      label = t(`runtimePackages.step.${o.step ?? "review"}` as MessageKey);
      tone = "text-accent";
      break;
    case "moved":
      label = t(revert ? "runtimePackages.item.reverted" : "runtimePackages.item.moved");
      tone = "text-ok-text";
      break;
    case "repaired":
      label = t(o.backOnline === false ? "runtimePackages.item.repairedOffline" : "runtimePackages.item.repaired");
      tone = o.backOnline === false ? "text-warn" : "text-ok-text";
      reason = item.reason;
      break;
    case "movedOffline":
      label = t(revert ? "runtimePackages.item.revertedOffline" : "runtimePackages.item.movedOffline");
      tone = "text-warn";
      reason = o.reason;
      break;
    case "skipped":
      label = KNOWN_SKIPS.includes(o.code) ? t(`runtimePackages.skip.${o.code}` as MessageKey) : t("runtimePackages.skip.other", { code: o.code });
      tone = "text-subtle";
      reason = o.code === "busy" ? null : o.reason;
      break;
    case "failed":
      label = KNOWN_FAILS.includes(o.code) ? t(`runtimePackages.fail.${o.code}` as MessageKey) : t("runtimePackages.fail.other", { code: o.code });
      tone = "text-danger";
      reason = o.reason;
      break;
  }
  // Known cases read as a short explanation; the raw cutex reason stays in the tooltip.
  const note = reason ? itemNote(item) : null;
  const versions = item.targetRuntimeVersion || item.targetFacadeRelease ? `${item.previousRuntimeVersion ?? "?"} / ${item.previousFacadeRelease ?? "?"} → ${item.targetRuntimeVersion ?? "?"} / ${item.targetFacadeRelease ?? "?"}` : undefined;
  return (
    <li className="py-1 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-foreground" title={item.cutexSessionId}>
          {item.name}
        </span>
        <span className={`inline-flex shrink-0 items-center gap-1 ${tone}`} title={versions}>
          {o.kind === "running" && <Loader2 size={11} className="animate-spin" />}
          {label}
        </span>
      </div>
      {reason && note && (
        <p className="mt-0.5 text-[11px] text-subtle select-text" title={reason}>
          {t(`runtimePackages.note.${note}` as MessageKey)}
        </p>
      )}
      {reason && !note && <p className="mt-0.5 line-clamp-3 font-mono text-[11px] break-words whitespace-pre-wrap text-subtle select-text">{reason}</p>}
    </li>
  );
}
