import { CircleAlert, Clock, Hourglass } from "lucide-react";
import { Button } from "../../components/Button";
import { useI18n } from "../../i18n";
import type { UpgradeIntent, UpgradeNode, UpgradeRunControl } from "./upgradeTypes";

/** Continuation round is distinct from native attempt number. Absence keeps ordinary results. */
export function ContinuationStatus({ node, busy, phase, onAction }: {
  node: UpgradeNode; busy: boolean; phase: UpgradeRunControl["phase"]; onAction(intent: UpgradeIntent): Promise<void>;
}) {
  const { t, locale } = useI18n();
  const cont = node.continuation;
  if (!cont) return null;
  // Under the row's meta line, aligned with the title: a `--surface` block (no frame), limited = the attention face.
  return <div className={`mt-1.5 ml-[18px] space-y-1 rounded-ctl px-2.5 py-2 text-meta text-muted ${cont.state === "limited" ? "bg-attention-soft" : "bg-surface"}`} data-continuation-state={cont.state}>
    {cont.waitingFor && <p className="flex items-start gap-1.5"><Hourglass size={12} className="mt-0.5 shrink-0 text-subtle" aria-hidden />{t(cont.waitingFor.kind === "after" ? "delegations.upgrade.tree.waitAfter" : "delegations.upgrade.tree.waitChildren")}</p>}
    {cont.nextWakeAt && <p className="flex items-start gap-1.5"><Clock size={12} className="mt-0.5 shrink-0 text-subtle" aria-hidden />{t("delegations.upgrade.tree.next", { time: new Date(cont.nextWakeAt).toLocaleString(locale) })}</p>}
    {cont.state === "cancelled" && <p>{t("delegations.upgrade.tree.continueCancelled")}</p>}
    {cont.state === "limited" && <>
      <p className="flex items-center gap-1.5 font-medium text-warn-text"><CircleAlert size={12} className="shrink-0" aria-hidden />{t("delegations.upgrade.tree.limited")}</p>
      <p>{t("delegations.upgrade.tree.limitNote", { rounds: cont.maxRounds, hours: cont.maxElapsedSeconds / 3600 })}</p>
      {node.allowedActions.resumeContinuation && !node.closed && <Button size="sm" className="mt-1" disabled={busy || phase !== "running"} onClick={() => void onAction({ kind: "resumeContinuation", nodeId: node.id, nodeHostId: node.hostId, expectedRevision: cont.revision }).catch(() => undefined)}>{t("delegations.upgrade.tree.approveMore")}</Button>}
    </>}
  </div>;
}
