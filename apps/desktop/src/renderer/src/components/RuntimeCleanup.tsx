import { useEffect, useState } from "react";
import { Button } from "./settings/Form";
import type { RuntimePruneKind, RuntimePrunePlan, RuntimePruneVersion } from "../../../shared/runtimes";
import { useI18n } from "../i18n";
import { captureHostAction } from "../lib/hostSwitch";
import { useHostData } from "../lib/useHostScope";
import { EMPTY_PRUNE, pruneRuntimeVersions, refreshRuntimePrune, runtimePruneEnabled, useRuntimePruneStore } from "../lib/runtimePruneStore";
import { runtimeBytes, runtimePruneReason } from "../lib/runtimePruneView";

/** Keyed by host + kind by its parent, so a target change cannot carry a confirmation across. */
export function RuntimeCleanup({ hostId, kind }: { hostId: string; kind: RuntimePruneKind }) {
  const { t } = useI18n();
  const data = useHostData(hostId);
  const enabled = data?.daemon.kind === "connected" && runtimePruneEnabled(hostId);
  const state = useRuntimePruneStore(s => s.byHost[hostId]) ?? EMPTY_PRUNE;
  const [confirm, setConfirm] = useState<{ plan: RuntimePrunePlan; versions: RuntimePruneVersion[]; current: () => boolean } | null>(null);
  useEffect(() => { if (enabled) void refreshRuntimePrune(hostId); }, [hostId, enabled, data?.features]);
  const { plan, loading, pending, outcome, error } = state;
  const versions = plan?.versions.filter(v => v.kind === kind) ?? [];
  const candidates = versions.filter(v => v.canPrune).slice(0, 100);
  const inspectionBlocked = candidates.length === 0 && versions.some(v => !v.canPrune && v.blockedReasons.includes("inspection_failed"));
  const valid = confirm && confirm.current() && confirm.plan === plan;
  const ask = (versions: RuntimePruneVersion[]) => { if (plan) setConfirm({ plan, versions, current: captureHostAction(hostId) }); };
  if (!enabled) return null;
  const rows = outcome?.result.results.filter(r => outcome.plan.versions.some(v => v.id === r.id && v.kind === kind)) ?? [];
  return <div className="flex flex-col gap-2 border-t border-border/60 pt-2 text-xs" data-runtime-cleanup={kind} aria-busy={pending || loading}>
    <div className="flex flex-wrap items-center gap-2">
      {/* Actions are buttons like everywhere else in Settings (they were bare blue / grey words). */}
      <Button disabled={pending || loading || !candidates.length} onClick={() => ask(candidates)}>{pending ? t("runtimes.prune.pending") : t("runtimes.prune.action", { n: candidates.length })}</Button>
      <Button disabled={pending || loading} onClick={() => void refreshRuntimePrune(hostId)}>{t("runtimes.prune.refresh")}</Button>
      {inspectionBlocked && <span role="status" data-prune-inspection-blocked="" className="text-subtle">{t("runtimes.prune.inspection_failed")}</span>}
      {loading && <span role="status">{t("runtimes.prune.loading")}</span>}
    </div>
    {valid && <div className="flex flex-col gap-2 rounded border border-border p-2" data-prune-confirm="">
      <p>{t("runtimes.prune.confirm", { n: confirm.versions.length, size: runtimeBytes(confirm.versions.reduce((n, v) => n + v.bytes, 0)) })}</p>
      <ul className="max-h-40 overflow-auto">{confirm.versions.map(v => <li key={v.id} className="break-all">{v.release}{v.version && v.version !== v.release ? ` · ${v.version}` : ""} · {runtimeBytes(v.bytes)}</li>)}</ul>
      <div className="flex gap-3"><button className="rounded px-2 py-1 text-danger enabled:hover:bg-hover disabled:opacity-50" disabled={pending || loading} onClick={() => { const c = confirm; setConfirm(null); void pruneRuntimeVersions(hostId, c.plan, c.versions.map(v => v.id), c.current); }}>{t("runtimes.prune.delete")}</button><button disabled={pending} onClick={() => setConfirm(null)}>{t("runtimes.prune.cancel")}</button></div>
    </div>}
    {error && <p role="alert" className="text-danger">{t("runtimes.prune.error")}</p>}
    {rows.length > 0 && <div role="status"><p>{t("runtimes.prune.freed", { size: runtimeBytes(rows.reduce((n, r) => n + r.freedBytes, 0)) })}</p><ul>{rows.map(r => <li key={r.id}>{outcome!.plan.versions.find(v => v.id === r.id)?.release} · {r.status === "deleted" ? t("runtimes.prune.deleted") : t(r.status === "refused" ? "runtimes.prune.refused" : "runtimes.prune.failed")} {r.status !== "deleted" && t(runtimePruneReason(r.reason))}</li>)}</ul></div>}
    {versions.length > 0 && <details><summary className="cursor-pointer text-muted">{t("runtimes.prune.plan")}</summary><ul className="mt-2 flex flex-col gap-2">{versions.map(v => <li key={v.id} className="flex flex-wrap items-center gap-2"><span className="break-all font-mono">{v.release}{v.version && v.version !== v.release ? ` · ${v.version}` : ""}</span><span className="text-muted">{runtimeBytes(v.bytes)}</span>{v.canPrune ? <button className="text-accent disabled:opacity-50" disabled={pending || loading} onClick={() => ask([v])}>{t("runtimes.prune.delete")}</button> : <span className="text-subtle">{v.blockedReasons.length ? v.blockedReasons.map(r => t(runtimePruneReason(r))).join(" · ") : t("runtimes.prune.unknown")}</span>}</li>)}</ul></details>}
  </div>;
}
