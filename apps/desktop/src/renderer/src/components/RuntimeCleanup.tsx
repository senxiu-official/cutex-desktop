import { useEffect, useState } from "react";
import { Button } from "./settings/Form";
import type { RuntimePruneClaudeProcesses, RuntimePruneKind, RuntimePrunePlan, RuntimePruneVersion } from "../../../shared/runtimes";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { captureHostAction } from "../lib/hostSwitch";
import { useHostData } from "../lib/useHostScope";
import { EMPTY_PRUNE, pruneRuntimeVersions, refreshRuntimePrune, runtimePruneEnabled, useRuntimePruneStore, watchRuntimePrune } from "../lib/runtimePruneStore";
import { CLAUDE_PROCESS_LIST_MAX, claudeProcessInspection, pruneTotalSize, pruneVersionSize, runtimeBytes, runtimePruneReason } from "../lib/runtimePruneView";

/** Keyed by host + kind by its parent, so a target change cannot carry a confirmation across. */
export function RuntimeCleanup({ hostId, kind }: { hostId: string; kind: RuntimePruneKind }) {
  const { t } = useI18n();
  const data = useHostData(hostId);
  const enabled = data?.daemon.kind === "connected" && runtimePruneEnabled(hostId);
  const state = useRuntimePruneStore(s => s.byHost[hostId]) ?? EMPTY_PRUNE;
  const [confirm, setConfirm] = useState<{ plan: RuntimePrunePlan; versions: RuntimePruneVersion[]; current: () => boolean } | null>(null);
  // Registered before the read starts, so leaving Settings drops a read still waiting.
  useEffect(() => watchRuntimePrune(hostId), [hostId]);
  useEffect(() => { if (enabled) void refreshRuntimePrune(hostId); }, [hostId, enabled, data?.features]);
  const { plan, loading, pending, outcome, error, timedOut } = state;
  const versions = plan?.versions.filter(v => v.kind === kind) ?? [];
  const candidates = versions.filter(v => v.canPrune).slice(0, 100);
  const inspectionBlocked = candidates.length === 0 && versions.some(v => !v.canPrune && v.blockedReasons.includes("inspection_failed"));
  // Host-wide (cutex copies it onto every blocked Claude item): once, in the Claude section only.
  const unresolved = kind === "claude" ? claudeProcessInspection(versions) : null;
  const valid = confirm && confirm.current() && confirm.plan === plan;
  const ask = (versions: RuntimePruneVersion[]) => { if (plan) setConfirm({ plan, versions, current: captureHostAction(hostId) }); };
  if (!enabled) return null;
  const rows = outcome?.result.results.filter(r => outcome.plan.versions.some(v => v.id === r.id && v.kind === kind)) ?? [];
  return <div className="flex flex-col gap-2 border-t border-border/60 pt-2 text-xs" data-runtime-cleanup={kind} aria-busy={pending || loading}>
    <div className="flex flex-wrap items-center gap-2">
      {/* Actions are buttons like everywhere else in Settings (they were bare blue / grey words). */}
      {/* Without a plan there is nothing to count: 正在检查… while it loads (it read 清理（0）), no button after a timeout. */}
      {(plan || loading || pending) && <Button disabled={pending || loading || !candidates.length} onClick={() => ask(candidates)}>{pending ? t("runtimes.prune.pending") : loading ? t("runtimes.prune.checking") : t("runtimes.prune.action", { n: candidates.length })}</Button>}
      {timedOut && !loading
        ? <><span role="status" data-prune-timeout="" className="text-muted">{t("runtimes.prune.timeout")}</span><Button disabled={pending} onClick={() => void refreshRuntimePrune(hostId)}>{t("runtimes.prune.retry")}</Button></>
        : <Button disabled={pending || loading} onClick={() => void refreshRuntimePrune(hostId)}>{t("runtimes.prune.refresh")}</Button>}
      {inspectionBlocked && <span role="status" data-prune-inspection-blocked="" className="text-subtle">{t("runtimes.prune.inspection_failed")}</span>}
    </div>
    {unresolved && <ClaudeProcessHint inspection={unresolved} sidebar={data?.sidebar ?? null} />}
    {valid && <div className="flex flex-col gap-2 rounded border border-border p-2" data-prune-confirm="">
      <p>{t("runtimes.prune.confirm", { n: confirm.versions.length, size: pruneTotalSize(confirm.versions, t) })}</p>
      <ul className="max-h-40 overflow-auto">{confirm.versions.map(v => <li key={v.id} className="break-all">{v.release}{v.version && v.version !== v.release ? ` · ${v.version}` : ""} · {pruneVersionSize(v, t)}</li>)}</ul>
      <div className="flex gap-3"><button className="rounded px-2 py-1 text-danger enabled:hover:bg-hover disabled:opacity-50" disabled={pending || loading} onClick={() => { const c = confirm; setConfirm(null); void pruneRuntimeVersions(hostId, c.plan, c.versions.map(v => v.id), c.current); }}>{t("runtimes.prune.delete")}</button><button disabled={pending} onClick={() => setConfirm(null)}>{t("runtimes.prune.cancel")}</button></div>
    </div>}
    {error && <p role="alert" className="text-danger">{t("runtimes.prune.error")}</p>}
    {rows.length > 0 && <div role="status"><p>{t("runtimes.prune.freed", { size: runtimeBytes(rows.reduce((n, r) => n + r.freedBytes, 0)) })}</p><ul>{rows.map(r => <li key={r.id}>{outcome!.plan.versions.find(v => v.id === r.id)?.release} · {r.status === "deleted" ? t("runtimes.prune.deleted") : t(r.status === "refused" ? "runtimes.prune.refused" : "runtimes.prune.failed")} {r.status !== "deleted" && t(runtimePruneReason(r.reason))}</li>)}</ul></div>}
    {versions.length > 0 && <details><summary className="cursor-pointer text-muted">{t("runtimes.prune.plan")}</summary><ul className="mt-2 flex flex-col gap-2">{versions.map(v => <li key={v.id} className="flex flex-wrap items-center gap-2"><span className="break-all font-mono">{v.release}{v.version && v.version !== v.release ? ` · ${v.version}` : ""}</span><span className="text-muted">{pruneVersionSize(v, t)}</span>{v.canPrune ? <button className="text-accent disabled:opacity-50" disabled={pending || loading} onClick={() => ask([v])}>{t("runtimes.prune.delete")}</button> : <span className="text-subtle">{v.blockedReasons.length ? v.blockedReasons.map(r => t(runtimePruneReason(r))).join(" · ") : t("runtimes.prune.unknown")}</span>}</li>)}</ul></details>}
  </div>;
}

/** Claude processes whose runtime cutex could not resolve (e.g. started before an upgrade): old Claude versions wait
 *  until their agents restart. A quiet hint with the processes listed; `sessionId` is what the process reported, not
 *  authenticated, so it only names an agent (no restart action from it). */
function ClaudeProcessHint({ inspection, sidebar }: { inspection: RuntimePruneClaudeProcesses; sidebar: SidebarSnapshot | null }) {
  const { t } = useI18n();
  const rows = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  const shown = inspection.processes.slice(0, CLAUDE_PROCESS_LIST_MAX);
  const more = Math.max(0, inspection.unresolvedProcessCount - shown.length);
  return <details className="text-subtle" data-claude-processes="">
    <summary className="cursor-pointer">{t("runtimes.prune.claudeProcesses", { n: inspection.unresolvedProcessCount })}</summary>
    <ul className="mt-1 flex flex-col gap-0.5">
      {shown.map((p, i) => {
        const name = p.sessionId ? rows.find(r => r.cutexSessionId === p.sessionId)?.displayName : undefined;
        return <li key={`${p.pid ?? ""}:${p.sessionId ?? ""}:${i}`} data-claude-process="" className="flex flex-wrap gap-2">
          <span className="font-mono">{p.pid != null ? `PID ${p.pid}` : t("runtimes.prune.claudeProcessNoPid")}</span>
          <span className={name ? "" : "break-all font-mono"}>{name ?? p.sessionId ?? t("runtimes.prune.claudeProcessNoAgent")}</span>
        </li>;
      })}
      {more > 0 && <li data-claude-processes-more="">{t("runtimes.prune.claudeProcessesMore", { n: more })}</li>}
    </ul>
  </details>;
}
