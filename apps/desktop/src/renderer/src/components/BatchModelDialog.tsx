// 批量换模型 (owner 2026-11-18): one dialog — scope, the model in use (per Profile, with agent counts), the target from
// that Profile's own catalog, the reasoning effort (kept by default), a preview with ticks, one in-place confirm, then a
// result per agent. Rules and routes: lib/batchModel. Mounted once (components/Overlays).
import { useEffect, useMemo } from "react";
import { Check, Loader2, Replace, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { isImeComposing } from "../lib/ime";
import { useOwnerWindow } from "../lib/ownerContext";
import {
  applyBatch, batchRows, batchSources, chooseEffort, chooseSource, chooseTarget, closeBatchModel, runningOn, scopeAgents, setBatchScope, tickedRows, toggleBatchRow, useBatchModel,
  type BatchModelScope, type BatchRow,
} from "../lib/batchModel";
import { EntitySelect } from "./EntitySelect";
import { EntityMention } from "./EntityIcon";
import { tNodes } from "../lib/textNodes";
import { sidebarOf, useApp } from "../store";
import { claudeAliasLabels, claudeCatalogChoices, looksClaude } from "../lib/claudeModels";
import { effortAppliesNextTurn } from "../lib/effortNextTurn";
import { Checkbox } from "./settings/Form";
import { ArmedButton } from "./ArmedButton";
import { btn } from "./Button";

const SELECT = "min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-60";

function Row({ row, checked, disabled }: { row: BatchRow; checked: boolean; disabled: boolean }) {
  const { t } = useI18n();
  const reason = row.block === "runtimeLacksModel" && row.runtimeVersion
    ? t("batchModel.block.runtimeLacksModelVersion", { version: row.runtimeVersion })
    : row.block ? t(`batchModel.block.${row.block}` as MessageKey) : null;
  return (
    <li data-testid="batch-model-row" data-block={row.block ?? undefined}>
      <label className={`flex items-center gap-2 rounded-md py-1 pr-1 pl-1 ${row.block ? "opacity-55" : "cursor-pointer hover:bg-surface-2"}`} title={reason ?? undefined}>
        <Checkbox checked={!row.block && checked} disabled={!!row.block || disabled} onChange={() => toggleBatchRow(row.id)} label={row.name} />
        <span className="min-w-0 truncate text-sm">{row.name}</span>
        {row.effortNone && !row.block && <span className="shrink-0 text-xs text-subtle" data-effort-none="">{t("batchModel.effortNone")}</span>}
        {!row.effortNone && (row.effort || row.effortSent) && (
          <span className={`shrink-0 text-xs ${row.effortFallback && !row.block ? "text-warn-text" : "text-subtle"}`} data-effort-fallback={row.effortFallback ? "" : undefined}
            title={row.effortFallback && !row.block ? t("batchModel.effortFallback", { effort: row.effortSent ?? "—" }) : undefined}>
            {row.effortSent && row.effortSent !== row.effort ? `${row.effort ?? "—"} → ${row.effortSent}` : row.effort}
            {row.effortFallback && !row.block ? ` ${t("batchModel.effortFallbackShort")}` : ""}
          </span>
        )}
        <span className={`ml-auto shrink-0 text-xs ${row.block ? "text-warn-text" : "text-subtle"}`}>{reason ?? t(`batchModel.when.${row.when}` as MessageKey)}</span>
      </label>
    </li>
  );
}

/** Renders nothing until opened. */
export function BatchModelDialog() {
  const open = useBatchModel((s) => !!s.scope);
  return open ? <OpenBatchModelDialog /> : null;
}

function OpenBatchModelDialog() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const s = useBatchModel();
  const scope = s.scope!;
  const sidebar = useApp((app) => sidebarOf(app, scope.hostId));
  const projects = sidebar?.projects?.projects ?? [];
  // Which agents run a turn now (lib/batchModel runningOn): rows and the effort line follow the ledger delivery too.
  const running = useApp((app) => { const side = sidebarOf(app, scope.hostId); return side ? side.active.filter((x) => runningOn(app, scope.hostId, x)).map((x) => x.cutexSessionId).join("\n") : ""; });
  const agents = useMemo(() => scopeAgents(scope), [scope, sidebar, running]);
  const sources = useMemo(() => batchSources(agents), [agents]);
  const source = sources.find((x) => x.key === s.sourceKey) ?? null;
  const rows = useMemo(() => (source && s.target ? batchRows(agents, source, s.target, s.runtimeModels, { choice: s.effort, catalogTarget: s.catalog?.find((m) => m.id === s.target) }) : []), [agents, source, s.target, s.runtimeModels, s.effort, s.catalog]);
  const ticked = tickedRows(rows, s.unticked);
  // The listed online agents' deliveries (an unopened session has no ledger cache): read and kept live while listed.
  const watched = rows.filter((r) => r.online).map((r) => r.id).join("\n");
  const watchInputs = useApp((app) => app.watchInputs);
  useEffect(() => (watched && watchInputs ? watchInputs(watched.split("\n"), scope.hostId) : undefined), [watched, scope.hostId, watchInputs]);
  const target = s.catalog?.find((m) => m.id === s.target);
  const busy = s.phase === "applying";
  const done = s.phase === "done";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => !isImeComposing(e) && e.key === "Escape" && !busy && closeBatchModel();
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [busy]);

  const scopeChoices: { key: string; label: string; scope: BatchModelScope }[] = [
    ...(s.selection?.ids ? [{ key: "ids", label: t("batchModel.scope.selected", { n: s.selection.ids.length }), scope: s.selection }] : []),
    { key: "all", label: t("batchModel.scope.all"), scope: { hostId: scope.hostId, label: t("batchModel.scope.all") } },
    ...projects.map((p) => ({ key: `p:${p.project_id}`, label: p.presentation.display_name || p.project_id, scope: { hostId: scope.hostId, projectId: p.project_id, label: p.presentation.display_name || p.project_id } })),
    { key: "independent", label: t("batchModel.scope.independent"), scope: { hostId: scope.hostId, independent: true, label: t("batchModel.scope.independent") } },
  ];
  const scopeKey = scope.ids ? "ids" : scope.projectId ? `p:${scope.projectId}` : scope.independent ? "independent" : "all";
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? agents.find((a) => a.id === id)?.name ?? id;
  const targets = (s.catalog ?? []).filter((m) => !source || m.id !== source.model);
  // Claude catalogs: 「Opus 5.5」, never the catalog's 「Opus (alias)」 (docs/design/024-model-list.md 三).
  // The select lists the raw targets, so an alias the fold hides under its family row (`opus[1m]`) is named by the
  // same rule (「Opus 5.5 · 1M 上下文」), with 「 · 跟随最新」 only where it would read like another target.
  const claudeNames = looksClaude(targets.map((m) => m.id)) ? new Map(claudeCatalogChoices(targets, s.target ?? null, t).map((c) => [c.id, c.option])) : null;
  if (claudeNames) {
    const shown = (m: (typeof targets)[number]) => m.entryDisplayName || claudeNames.get(m.id) || m.displayName;
    for (const [id, a] of claudeAliasLabels(targets, (m) => m.id)) {
      if (claudeNames.has(id)) continue;
      const name = a.oneM ? t("claudeModels.oneMName", { model: a.name }) : a.name;
      claudeNames.set(id, targets.some((m) => m.id !== id && shown(m) === name) ? `${name} · ${t("claudeModels.latestTag")}` : name);
    }
  }
  const targetName = (m: (typeof targets)[number]) => m.entryDisplayName || claudeNames?.get(m.id) || m.displayName;
  // Claude r56: a ticked running Claude agent that gets an effort keeps its current one until its next turn. `busy` is
  // the same running rule as the row's 「正在运行：本轮结束后生效」 (lib/batchModel runningOn), so the two agree.
  const effortNextTurn = ticked.some((r) => !r.block && !!r.effortSent && effortAppliesNextTurn(r.runtime, r.busy));
  const succeeded = s.results.filter((r) => r.ok);
  const failed = s.results.filter((r) => !r.ok);

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeBatchModel()}>
      <div role="dialog" aria-modal="true" aria-label={t("batchModel.title")} className="flex max-h-[80vh] w-[38rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-surface p-4 shadow-2xl" data-testid="batch-model-dialog">
        <div className="flex items-center gap-2">
          <Replace size={15} className="shrink-0 text-muted" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("batchModel.title")}</h2>
          <button title={t("batchModel.close")} disabled={busy} onClick={closeBatchModel} className="shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
            <X size={15} />
          </button>
        </div>
        {!done && (
          <div className="mt-3 grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-2 text-sm">
            <span className="text-xs text-muted">{t("batchModel.scope")}</span>
            <EntitySelect className={`flex w-full items-center justify-between gap-2 ${SELECT}`} value={scopeKey} disabled={busy} testId="batch-model-scope" label={t("batchModel.scope")}
              onChange={(value) => { const next = scopeChoices.find((c) => c.key === value); if (next) setBatchScope(next.scope); }}
              options={scopeChoices.map((c) => ({ value: c.key, label: c.label, entity: c.scope.projectId ? { kind: "project" as const, id: c.scope.projectId, hostId: scope.hostId } : null }))} />
            <span className="text-xs text-muted">{t("batchModel.from")}</span>
            <EntitySelect className={`flex w-full items-center justify-between gap-2 ${SELECT}`} value={s.sourceKey ?? ""} disabled={busy || sources.length === 0} testId="batch-model-source" label={t("batchModel.from")}
              onChange={(value) => void chooseSource(sources.find((x) => x.key === value) ?? null, agents)}
              options={[{ value: "", label: sources.length ? t("batchModel.pickSource") : t("batchModel.noSources") },
                ...sources.map((x) => ({ value: x.key, label: t("batchModel.sourceOption", { model: x.model, profile: x.profile, n: x.count }), entity: { kind: "profile" as const, ref: x.profile, hostId: scope.hostId } }))]} />
            <span className="text-xs text-muted">{t("batchModel.to")}</span>
            <select className={SELECT} value={s.target ?? ""} disabled={busy || !source || !s.catalog} data-testid="batch-model-target"
              onChange={(e) => chooseTarget(e.target.value || null)}>
              <option value="">{!source ? "—" : !s.catalog ? t("batchModel.loadingCatalog") : targets.length ? t("batchModel.pickTarget") : t("batchModel.noTargets")}</option>
              {targets.map((m) => <option key={m.id} value={m.id}>{targetName(m) ? `${targetName(m)} (${m.id})` : m.id}</option>)}
            </select>
            <span className="text-xs text-muted">{t("batchModel.effort")}</span>
            <select className={SELECT} value={s.effort} disabled={busy || !target} data-testid="batch-model-effort" onChange={(e) => chooseEffort(e.target.value)}>
              <option value="keep">{t("batchModel.effortKeep")}</option>
              {(target?.supportedReasoningEfforts ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            {effortNextTurn && <p className="col-start-2 text-xs text-warn-text" data-batch-effort-next-turn="">{t("composer.effort.nextTurn")}</p>}
            {source && <p className="col-start-2 text-xs text-subtle">{tNodes(t, "batchModel.sameProfile", { profile: <EntityMention entity={{ kind: "profile", ref: source.profile, hostId: scope.hostId }}>{source.profile}</EntityMention> })}</p>}
            {s.catalogError && <p className="col-start-2 text-xs text-danger">{t("batchModel.catalogFailed", { error: s.catalogError })}</p>}
          </div>
        )}
        <div className="mt-3 min-h-16 flex-1 overflow-y-auto border-y border-border py-1" data-testid="batch-model-list">
          {!done && (!source || !s.target) && <p className="px-1 py-3 text-sm text-muted">{t("batchModel.pickFirst")}</p>}
          {!done && source && s.target && rows.length === 0 && <p className="px-1 py-3 text-sm text-muted">{t("batchModel.noneToChange")}</p>}
          {!done && rows.length > 0 && (
            <ul>
              {rows.map((row) => <Row key={row.id} row={row} checked={!s.unticked.has(row.id)} disabled={busy} />)}
            </ul>
          )}
          {(busy || done) && s.results.length > 0 && (
            <ul className="mt-1 space-y-0.5 px-1 text-sm" data-testid="batch-model-results">
              {s.results.map((r) => (
                <li key={r.id} className="flex items-center gap-2" data-ok={r.ok ? "" : undefined}>
                  {r.ok ? <Check size={13} className="shrink-0 text-ok" /> : <X size={13} className="shrink-0 text-danger" />}
                  <span className="min-w-0 truncate">{nameOf(r.id)}</span>
                  <span className={`ml-auto min-w-0 truncate text-xs ${r.ok ? "text-subtle" : "text-danger"}`} title={r.ok ? undefined : r.error}>
                    {r.ok ? t(`batchModel.done.${r.when}` as MessageKey) : r.error}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {done && <p className="mt-2 text-sm" data-testid="batch-model-summary">{t("batchModel.summary", { ok: succeeded.length, failed: failed.length, model: s.target ?? "" })}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {done ? (
            <button onClick={closeBatchModel} className={btn({ variant: "primary" })}>{t("batchModel.close")}</button>
          ) : (
            <>
              <button onClick={closeBatchModel} disabled={busy} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
                {t("batchModel.cancel")}
              </button>
              <ArmedButton
                shape="flex items-center gap-1.5 rounded-md px-3 py-1 text-sm disabled:opacity-40"
                idle="bg-accent text-on-accent"
                hint={t("batchModel.armed", { n: ticked.length, model: s.target ?? "" })}
                resetKey={`${s.sourceKey}|${s.target}|${s.effort}|${ticked.map((r) => r.id).join(",")}`}
                disabled={busy || ticked.length === 0 || s.pendingReads > 0}
                testId="batch-model-apply"
                onConfirm={() => void applyBatch(ticked)}
              >
                {(busy || s.pendingReads > 0) && <Loader2 size={13} className="animate-spin" />}
                {s.pendingReads > 0 ? t("batchModel.readingRuntimes") : t("batchModel.apply", { n: ticked.length })}
              </ArmedButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
