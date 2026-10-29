import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleStop, Info, Lock, Search } from "lucide-react";
import { Button, IconBtn } from "../../components/Button";
import { DelegationGlyph } from "../../components/DelegationParts";
import { Tag } from "../../components/Tag";
import { useI18n } from "../../i18n";
import { useNow } from "../../lib/time";
import { buildUpgradeForest, descendantKeys, flattenUpgradeForest, nodeKey } from "./tree";
import type { DelegationRef, UpgradeNode, UpgradeSectionProps } from "./upgradeTypes";
import { ContinuationStatus } from "./ContinuationStatus";
import { CHECK, CHOICE, DANGER_SOLID, DIALOG, FIELD, nodeGlyph } from "./upgradeLook";
import { partyName } from "./upgradeParty";
import { TreeParty } from "./UpgradeParts";
import { useOverlayRoot } from "../../lib/ownerContext";

const readonlyActions: UpgradeNode["allowedActions"] = {
  readAttempts: false, stop: false, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false,
};
function actions(node: UpgradeNode): UpgradeNode["allowedActions"] {
  return (Object.keys(readonlyActions) as (keyof UpgradeNode["allowedActions"])[])
    .every(key => typeof node.allowedActions?.[key] === "boolean") ? node.allowedActions : readonlyActions;
}

export function TreePanel({ snapshot, busy, onAction, continuation = false }: UpgradeSectionProps & { continuation?: boolean }) {
  const overlayRoot = useOverlayRoot();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [all, setAll] = useState(false);
  const [stopRef, setStop] = useState<DelegationRef | null>(null);
  const [cascade, setCascade] = useState<"descendants" | "none">("descendants");
  const stopDialog = useRef<HTMLDialogElement>(null);
  const stopTitleId = useId();
  const normalNodes = useMemo(() => snapshot.nodes.filter((node): node is UpgradeNode => node.kind === "delegation"), [snapshot.nodes]);
  // The dialog must use current permissions and revision after a snapshot refresh.
  const stop = useMemo(() => normalNodes.reduce<UpgradeNode | null>((found, node) =>
    stopRef && nodeKey(node) === nodeKey(stopRef) && (!found || node.revision > found.revision) ? node : found, null), [normalNodes, stopRef]);
  const stopActions = stop ? actions(stop) : readonlyActions;
  const mayStop = !!stop && !stop.closed && (cascade === "descendants" ? stopActions.stop === true : stopActions.stopSelf === true);
  useEffect(() => {
    const dialog = stopDialog.current;
    if (stop && dialog) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [stop]);
  const forest = useMemo(() => buildUpgradeForest(snapshot.nodes), [snapshot.nodes]);
  const expanded = useMemo(() => new Set(normalNodes.map(nodeKey).filter(key => !collapsed.has(key))), [normalNodes, collapsed]);
  const flat = useMemo(() => flattenUpgradeForest(forest, expanded, all ? Infinity : 2), [forest, expanded, all]);
  const searching = !!query.trim() || issuesOnly;
  const allRows = useMemo(() => searching ? flattenUpgradeForest(forest, new Set(normalNodes.map(nodeKey)), Infinity) : flat, [searching, forest, normalNodes, flat]);
  const now = useNow(normalNodes.some(node => !node.closed && node.execution === "running"));
  function quietMinutes(node: UpgradeNode) {
    if (node.closed || node.execution !== "running" || !node.lastActivityAt) return null;
    const minutes = Math.floor((now - Date.parse(node.lastActivityAt)) / 60000);
    return Number.isFinite(minutes) && minutes >= 15 ? minutes : null;
  }
  const matches = new Set(allRows.filter(({ node, unresolved }) => {
    if (node.kind !== "delegation") return false;
    const match = `${node.title} ${partyName(node.requester)} ${partyName(node.target)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return match && (!issuesOnly || unresolved || quietMinutes(node) !== null || node.routingApproval?.state === "pending" || node.routingApproval?.state === "stale" || node.continuation?.state === "limited" || node.resumeEvidence.kind === "restartRecovery");
  }).map(({ node }) => nodeKey(node)));
  const rows = allRows.filter(({ node, relatedTo }) => node.kind === "delegation" ? matches.has(nodeKey(node))
    : relatedTo ? matches.has(relatedTo) : !query.trim());
  const stopCount = stop ? descendantKeys(snapshot.nodes, nodeKey(stop)).size : 0;
  function toggle(key: string) {
    setCollapsed(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  const issuesShown = snapshot.coverage !== "complete" || snapshot.unresolvedEdges.length > 0;
  return <section className="min-w-0" data-testid="delegation-upgrade-tree">
    <div className="flex flex-wrap items-center gap-2 pb-2">
      <div className="relative min-w-[10rem] flex-1">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-subtle" aria-hidden />
        <input className={`${FIELD} w-full pl-7`} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("delegations.upgrade.tree.search")} aria-label={t("delegations.upgrade.tree.search")} />
      </div>
      <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-ctl px-2 text-meta text-muted hover:bg-hover hover:text-foreground"><input type="checkbox" className={CHECK} checked={issuesOnly} onChange={event => setIssuesOnly(event.target.checked)} />{t("delegations.upgrade.tree.anomalies")}</label>
      <Button variant="ghost" onClick={() => { setAll(!all); setCollapsed(new Set()); }}>{all ? <ChevronsDownUp size={14} aria-hidden /> : <ChevronsUpDown size={14} aria-hidden />}{t(all ? "delegations.upgrade.tree.collapse" : "delegations.upgrade.tree.expand")}</Button>
    </div>
    {issuesShown && <p className="mb-1 flex items-start gap-1.5 px-1 text-meta text-subtle"><Info size={13} className="mt-0.5 shrink-0" aria-hidden />{t("delegations.upgrade.tree.partial")}</p>}
    {rows.length === 0 && <p className="py-8 text-center text-ui text-subtle">{t("delegations.upgrade.tree.empty")}</p>}
    <div className="space-y-px">
      {rows.map(({ node, depth, hasChildren, collapsedCount, unresolved, unresolvedReason, relation, relatedTo }) => {
        const key = nodeKey(node);
        if (node.kind === "redactedAncestor") return <article key={key} className="flex min-w-0 items-center gap-1.5 rounded-ctl py-1.5 pr-1 pl-7 text-meta text-subtle" data-placeholder-id={node.placeholderId} data-relation={relation} data-related-to={relatedTo}>
          <Lock size={12} className="shrink-0" aria-hidden /><p className="min-w-0 break-words">{t("delegations.upgrade.tree.ancestorRestricted")}</p>
        </article>;
        const allowed = actions(node);
        const cont = continuation ? node.continuation : null;
        const quiet = quietMinutes(node);
        const continuing = !!cont && cont.state !== "cancelled";
        const status = node.closed ? t("delegations.upgrade.tree.closed") : cont && continuing ? t("delegations.upgrade.tree.continuing", { n: cont.roundNumber }) : t(`delegations.upgrade.tree.${node.execution}`);
        const look = nodeGlyph(node, continuing, cont?.state === "limited");
        const approval = node.routingApproval?.state === "pending" || node.routingApproval?.state === "stale" ? node.routingApproval.state : null;
        const open = !collapsed.has(key) && (all || depth < 2);
        return <article key={key} className="group/row flex min-w-0 items-start gap-1 rounded-ctl py-1.5 pr-1 hover:bg-hover" style={{ paddingLeft: 4 + Math.min(depth, 8) * 16 }} data-node-id={node.id} data-node-host={node.hostId}>
          <button className="flex size-5 shrink-0 items-center justify-center rounded-chip text-subtle hover:bg-hover hover:text-foreground disabled:invisible" disabled={!hasChildren} aria-label={node.title} aria-expanded={hasChildren ? open : undefined} onClick={() => { if (!all && depth >= 2) setAll(true); else toggle(key); }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-5 min-w-0 items-center gap-1.5">
              <DelegationGlyph glyph={look.glyph} tone={look.tone} />
              <p className="min-w-0 flex-1 truncate text-ui font-medium" title={node.title}>{node.title}</p>
              {approval && <Tag tone="attention">{t(`delegations.upgrade.routing.${approval}`)}</Tag>}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[18px] text-meta text-muted">
              <span className={node.closed === "failed" ? "text-danger" : cont?.state === "limited" ? "text-warn-text" : ""}>{status}</span>
              <span className="text-subtle" aria-hidden>·</span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <TreeParty party={node.requester} />
                <span className="shrink-0 text-subtle">→</span>
                <TreeParty party={node.target} />
              </span>
              {(unresolved || unresolvedReason) && <span className="text-subtle"><span aria-hidden className="mr-1.5">·</span>{t(unresolvedReason === "unavailable" ? "delegations.upgrade.tree.unloaded" : "delegations.upgrade.tree.unknown")}</span>}
              {node.resumeEvidence.kind === "restartRecovery" && <Tag tone="attention">{t("delegations.upgrade.tree.recovered")}</Tag>}
              {quiet !== null && <Tag tone="attention">{t("delegations.upgrade.tree.quiet", { n: quiet })}</Tag>}
              {collapsedCount > 0 && <button className="text-accent hover:underline" onClick={() => { setAll(true); setCollapsed(prev => { const next = new Set(prev); next.delete(key); return next; }); }}>{t("delegations.upgrade.tree.children", { n: collapsedCount })}</button>}
            </div>
            {cont && <ContinuationStatus node={{ ...node, allowedActions: allowed }} busy={busy} phase={snapshot.runControl.phase} onAction={onAction} />}
          </div>
          {(allowed.stop === true || allowed.stopSelf === true) && !node.closed && <IconBtn size="sm" danger className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" label={t("delegations.upgrade.tree.stop")} disabled={busy} onClick={() => { setCascade(allowed.stop === true ? "descendants" : "none"); setStop(node.ref); }}><CircleStop size={14} /></IconBtn>}
        </article>;
      })}
    </div>
    {stop && createPortal(<dialog ref={stopDialog} onCancel={event => { event.preventDefault(); if (!busy) setStop(null); }} aria-labelledby={stopTitleId} className={DIALOG}>
        <h2 id={stopTitleId} className="text-title break-words">{t("delegations.upgrade.tree.stopTitle", { title: stop.title })}</h2>
        <div className="mt-4 space-y-2">
          <label className={CHOICE}><input className={CHECK} autoFocus={stopActions.stop === true} type="radio" name={stopTitleId} disabled={busy || stop.closed !== null || stopActions.stop !== true} checked={cascade === "descendants"} onChange={() => setCascade("descendants")} />{t("delegations.upgrade.tree.descendants", { n: stopCount })}</label>
          <label className={CHOICE}><input className={CHECK} autoFocus={stopActions.stop !== true} type="radio" name={stopTitleId} disabled={busy || stop.closed !== null || stopActions.stopSelf !== true} checked={cascade === "none"} onChange={() => setCascade("none")} />{t("delegations.upgrade.tree.only")}</label>
        </div>
        <p className="mt-3 text-meta text-muted">{t("delegations.upgrade.tree.stopNote")}</p>
        <div className="mt-5 flex justify-end gap-2"><Button disabled={busy} onClick={() => setStop(null)}>{t("delegations.upgrade.tree.cancel")}</Button><button type="button" className={DANGER_SOLID} disabled={busy || !mayStop} onClick={async () => { if (busy || !mayStop) return; try { await onAction({ kind: "stop", nodeId: stop.ref.id, nodeHostId: stop.ref.hostId, cascade, stopJobs: false, expectedRevision: stop.revision }); setStop(null); } catch { /* Workspace keeps the unconfirmed outcome visible. */ } }}>{t("delegations.upgrade.tree.stop")}</button></div>
    </dialog>, overlayRoot)}
  </section>;
}
