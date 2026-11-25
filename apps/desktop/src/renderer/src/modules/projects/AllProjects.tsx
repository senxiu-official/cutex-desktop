// 项目 page, 「全部项目」 (owner 2026-11-25, option B): every project of the view scope's hosts in one table, with the
// archived-agents page's controls (设置 → 归档 → 已归档的智能体):
// - figures of what is shown; search (name, Director, directory), host, status and sort; 清除筛选; + 新建项目;
// - a checkbox per row, 全选 of the shown rows, Shift-click for a range; a new filter starts a new selection;
// - batch 归档 / 恢复 (an in-place second click: restorable, medium risk) and whole-project 暂停 / 恢复成员 where the host
//   offers it (project-run-control-v1); 移到主机 has no cutex call and stays disabled with the reason;
// - the host as a named colour chip (no dot at the row end, which read as a status); one host in view: no host column.
// The rows' figures: projectTable.ts. The calls: projectBatch.ts, whose store keeps a batch (its guard, progress and
// results) when this page is left; while one runs the filters are locked, and after it what failed or is unknown stays
// selected and in view whatever the filter, until its results are closed.
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Plus } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { Button, EmptyState, Select, TextInput, TextLink } from "../../components/settings/Form";
import { EntityIcon } from "../../components/EntityIcon";
import { HostMark } from "../../components/HostMark";
import { RowCheck } from "../../components/RowCheck";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { entityIconSlot, projectEntity } from "../../lib/entityIcon";
import { useProjectIcons } from "../../lib/projectIconSync";
import { relativeTime } from "../../lib/sidebarView";
import { useSizeFlags, widthAtLeast } from "../../lib/sizeFlags";
import { featuresOf, useApp } from "../../store";
import { useHostScope } from "../../lib/useHostScope";
import { openProject } from "./projectNav";
import { batchRetryKeys, dismissProjectBatch, dismissProjectBatchElsewhere, startProjectBatch, useProjectBatch, useProjectBatchElsewhere, type BatchItemResult, type BatchKind, type ProjectBatch } from "./projectBatch";
import { EMPTY_PROJECT_FILTER, isFiltered, matchesProject, PROJECT_RUN_CONTROL_FEATURE, PROJECT_SORTS, PROJECT_STATUSES, projectTotals, rangeKeys, sortProjects, type ProjectFacts, type ProjectFilter, type ProjectSort, type ProjectStatus } from "./projectTable";

/** Failures listed by name before 「等 N 个」. */
const FAILURES_SHOWN = 8;
/** Wide enough for the columns (rem); narrower, each project is two lines. */
const TABLE_FLAGS = { wide: widthAtLeast(46) };
const COLUMNS = (hostColumn: boolean) => `1rem minmax(0,1fr) ${hostColumn ? "8.5rem " : ""}7rem 5rem 5.5rem`;

export function AllProjects({ facts, newProject }: { facts: readonly ProjectFacts[]; newProject(): void }) {
  const { t, locale } = useI18n();
  const scope = useHostScope();
  const icons = useProjectIcons();
  const hostsState = useApp((s) => s.hosts);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  const [filter, setFilterState] = useState<ProjectFilter>(EMPTY_PROJECT_FILTER);
  const [sort, setSort] = useState<ProjectSort>("activity");
  const batch = useProjectBatch();
  const elsewhere = useProjectBatchElsewhere();
  // Coming back after a batch: what failed or is unknown is selected again.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(batchRetryKeys(batch)));
  const [anchor, setAnchor] = useState<string | null>(null);
  const results = batch?.results ?? null;
  const pinned = useMemo(() => new Set(batchRetryKeys(batch)), [batch]);
  useEffect(() => {
    if (results) setSelected(new Set(pinned));
  }, [results, pinned]);
  const [armed, setArmed] = useState<"archive" | "restore" | "pause" | null>(null);
  // A new selection disarms (not the arming itself: the kind is set together with it).
  const [armedOn, setArmedOn] = useArmed(selected);
  const [sizeRef, flags] = useSizeFlags(TABLE_FLAGS);

  const hostIds = useMemo(() => [...new Set(facts.map((p) => p.hostId))], [facts]);
  const hostColumn = hostIds.length > 1 || scope.showHostMarks;
  const active = facts.filter((p) => !p.archived);
  const shown = useMemo(() => sortProjects(facts.filter((p) => matchesProject(p, filter) || pinned.has(p.key)), sort, locale), [facts, filter, sort, locale, pinned]);
  const shownKeys = shown.map((p) => p.key);
  const picked = shown.filter((p) => selected.has(p.key));
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const running = !!batch && batch.results === null;
  const archivedView = filter.status === "archived";
  const slot = entityIconSlot(shown.map((p) => projectEntity(p.hostId, p.project)), icons, 22);
  const look = (hostId: string) => scope.host(hostId);
  const hostLabel = (hostId: string) => look(hostId)?.label ?? hostId;
  // Whole-project pause: on every picked project's host (cutex project-run-control-v1).
  const runControl = (hostId: string) => featuresOf({ hosts: hostsState, sidebar: null, byHost, features }, hostId).has(PROJECT_RUN_CONTROL_FEATURE);
  const pauseBlocked = picked.find((p) => !runControl(p.hostId));

  const setFilter = (next: Partial<ProjectFilter>) => {
    setFilterState((f) => ({ ...f, ...next }));
    // Batch actions act on what is shown: a new filter starts a new selection (what a batch left to retry stays).
    setSelected((prev) => new Set([...prev].filter((k) => pinned.has(k))));
    setAnchor(null);
    setArmedOn(false);
  };
  const toggle = (key: string, e: MouseEvent) => {
    const on = !selected.has(key);
    const keys = e.shiftKey ? rangeKeys(shownKeys, anchor, key) : [key];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) if (on) next.add(k); else next.delete(k);
      return next;
    });
    setAnchor(key);
    setArmedOn(false);
  };
  const run = (kind: BatchKind) => {
    setArmedOn(false);
    // The store refuses a second batch while one runs (another window of this page, or before coming back here).
    void startProjectBatch(kind, picked);
  };
  const arm = (kind: "archive" | "restore" | "pause") => {
    setArmed(kind);
    setArmedOn(true);
  };
  const armedButton = (kind: "archive" | "restore" | "pause", label: string, armedLabel: string, tone: "danger" | "accent", disabled = false, title?: string) =>
    armed === kind && armedOn && picked.length > 0 ? (
      <button type="button" className={tone === "danger" ? ARMED_FORM_BUTTON : ARMED_FORM_BUTTON.replace("border-danger-solid bg-danger-solid", "border-accent bg-accent").replace("text-white", "text-on-accent")} data-projects-armed={kind} disabled={running} onClick={() => run(kind)}>
        {armedLabel}
      </button>
    ) : (
      <Button disabled={running || !picked.length || disabled} title={title} onClick={() => arm(kind)}>
        {kind === "archive" ? <span className="text-danger">{label}</span> : label}
      </Button>
    );

  const totals = projectTotals(isFiltered(filter) ? shown : active);
  const figures = [
    isFiltered(filter) ? t("projects.all.figFiltered", { n: shown.length, total: archivedView ? facts.length - active.length : active.length }) : t("projects.all.figCount", { n: active.length }),
    hostIds.length > 1 ? t("projects.all.figHosts", { n: totals.hosts }) : null,
    // Unknown figures are left out and said so: never 「0 在线」 for a host that cannot be read.
    !archivedView && totals.online !== null
      ? totals.onlineUnknown
        ? t("projects.all.figOnlinePartial", { online: totals.online, members: t("projects.members", { n: totals.onlineMembers }), n: totals.onlineUnknown })
        : t("projects.all.figOnline", { online: totals.online, members: t("projects.members", { n: totals.onlineMembers }) })
      : null,
    !archivedView && totals.needsYou ? t(totals.needsPartial ? "projects.all.figNeedsPartial" : "projects.all.figNeeds", { n: totals.needsYou }) : null,
  ].filter(Boolean).join(" · ");

  if (!facts.length) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10" data-projects-empty="">
        <EmptyState action={<Button primary onClick={newProject}><Plus size={13} className="-ml-0.5 mr-1 inline" />{t("projects.new")}</Button>}>{t("projects.none")}</EmptyState>
      </div>
    );
  }

  return (
    <div ref={sizeRef} className="min-w-0 flex-1 overflow-y-auto" data-projects-all="">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold">{t("projects.all.title")}</h2>
          <span className="text-xs text-subtle tabular-nums" data-projects-figures="">{figures}</span>
        </div>

        {/* Filters + 新建项目 */}
        <div role="search" className="flex flex-wrap items-center gap-2 pb-2" data-projects-filters="">
          <TextInput search disabled={running} value={filter.text} onChange={(text) => setFilter({ text })} width="w-56" label={t("projects.all.search")} placeholder={t("projects.all.search")} />
          {hostIds.length > 1 && (
            <Select width="w-36" disabled={running} label={t("projects.all.host")} value={filter.host} onChange={(host) => setFilter({ host })}
              options={[{ value: "", label: t("projects.all.hostAll") }, ...hostIds.map((id) => ({ value: id, label: hostLabel(id) }))]} />
          )}
          <Select<ProjectStatus> width="w-36" disabled={running} label={t("projects.all.status")} value={filter.status} onChange={(status) => setFilter({ status })}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: t(`projects.all.status.${s || "all"}` as MessageKey) }))} />
          <Select<ProjectSort> width="w-36" label={t("projects.all.sort")} value={sort} onChange={setSort}
            options={PROJECT_SORTS.map((s) => ({ value: s, label: t(`projects.all.sort.${s}` as MessageKey) }))} />
          {isFiltered(filter) && !running && <TextLink onClick={() => setFilter(EMPTY_PROJECT_FILTER)}>{t("projects.all.clear")}</TextLink>}
          <span className="ml-auto"><Button onClick={newProject}><Plus size={13} className="-ml-0.5 mr-1 inline" />{t("projects.new")}</Button></span>
        </div>

        {/* Selection + batch actions */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2" data-projects-batch="">
          <RowCheck checked={allPicked} mixed={picked.length > 0 && !allPicked} disabled={running || !shown.length} label={t("projects.all.selectAll", { n: shown.length })}
            onClick={() => { setSelected(allPicked ? new Set() : new Set(shownKeys)); setAnchor(null); setArmedOn(false); }} />
          <span className="text-xs text-muted">{picked.length ? t("projects.all.selected", { n: picked.length, members: t("projects.members", { n: picked.reduce((n, p) => n + p.members, 0) }) }) : t("projects.all.selectAll", { n: shown.length })}</span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {archivedView ? (
              armedButton("restore", t("projects.all.restore"), t("projects.all.restoreArmed", { n: picked.length }), "accent")
            ) : (
              <>
                {armedButton("pause", t("projects.all.pause"), t("projects.all.pauseArmed", { n: picked.length }), "accent", !!pauseBlocked, pauseBlocked ? t("projects.all.pauseUnsupported", { host: hostLabel(pauseBlocked.hostId) }) : undefined)}
                <Button disabled={running || !picked.length || !!pauseBlocked} title={pauseBlocked ? t("projects.all.pauseUnsupported", { host: hostLabel(pauseBlocked.hostId) }) : undefined} onClick={() => run("resume")}>{t("projects.all.resume")}</Button>
                <Button disabled title={t("projects.all.moveUnsupported")} onClick={() => {}}>{t("projects.all.move")}</Button>
                {armedButton("archive", t("projects.all.archive"), t("projects.all.archiveArmed", { n: picked.length }), "danger")}
              </>
            )}
          </span>
          {armedOn && picked.length > 0 && armed && <p className="w-full text-xs text-subtle" data-projects-armed-note="">{t(`projects.all.${armed}Note` as MessageKey)}</p>}
          {!running && picked.length > 0 && !archivedView && pauseBlocked && <p className="w-full text-xs text-subtle">{t("projects.all.pauseUnsupported", { host: hostLabel(pauseBlocked.hostId) })}</p>}
        </div>

        {batch && <BatchStatus batch={batch} onDismiss={dismissProjectBatch} />}
        {!batch && elsewhere && (
          <div className="my-2 flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs" role="status" data-projects-elsewhere={elsewhere.kind ?? "unknown"}>
            <p className="min-w-0 flex-1 text-warn">{elsewhere.kind && elsewhere.total ? t(`projects.all.elsewhere.${elsewhere.kind}` as MessageKey, { n: elsewhere.total }) : t("projects.all.elsewhereUnknown")}</p>
            <TextLink onClick={dismissProjectBatchElsewhere}>{t("projects.all.dismiss")}</TextLink>
          </div>
        )}

        {shown.length === 0 ? (
          <EmptyState>{t("projects.all.noMatch")}</EmptyState>
        ) : (
          <div role="table" aria-label={t("projects.all.title")} data-projects-table={flags.wide ? "wide" : "narrow"}>
            {flags.wide && (
              <div role="row" className="grid items-center gap-x-3 border-b border-border px-2 py-1.5 text-xs text-subtle" style={{ gridTemplateColumns: COLUMNS(hostColumn) }}>
                <span />
                <span role="columnheader" style={{ paddingLeft: slot + 10 }}>{t("projects.all.col.project")}</span>
                {hostColumn && <span role="columnheader">{t("projects.all.col.host")}</span>}
                <span role="columnheader" className="text-right">{t("projects.all.col.online")}</span>
                <span role="columnheader" className="text-right">{t("projects.all.col.needsYou")}</span>
                <span role="columnheader" className="text-right">{t("projects.all.col.activity")}</span>
              </div>
            )}
            {shown.map((p) => (
              <ProjectRow key={p.key} p={p} wide={flags.wide} hostColumn={hostColumn} slot={slot} host={look(p.hostId)} checked={selected.has(p.key)} disabled={running} onToggle={(e) => toggle(p.key, e)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Num({ value, children }: { value: number | null; children?: React.ReactNode }) {
  const { t } = useI18n();
  if (value === null) return <span className="text-subtle" title={t("projects.all.unknownHint")}>—</span>;
  return <>{children ?? value}</>;
}

function ProjectRow({ p, wide, hostColumn, slot, host, checked, disabled, onToggle }: { p: ProjectFacts; wide: boolean; hostColumn: boolean; slot: number; host: ReturnType<ReturnType<typeof useHostScope>["host"]>; checked: boolean; disabled: boolean; onToggle(e: MouseEvent): void }) {
  const { t } = useI18n();
  const open = () => openProject(p.id, undefined, p.hostId);
  const who = p.directorName ? t("projects.all.director", { name: p.directorName }) : t("projects.all.noDirector");
  const online = <Num value={p.online}><span className="tabular-nums">{p.online ? <span className="mr-1 inline-block size-1.5 rounded-full bg-ok align-middle" aria-hidden /> : null}{p.online}<span className="text-subtle"> / {p.members}</span></span></Num>;
  const needs = <Num value={p.needsYou}>{p.needsYou ? <span className="rounded-full bg-warn/20 px-1.5 text-xs font-semibold text-warn tabular-nums" data-projects-needs="">{p.needsYou}</span> : <span className="text-subtle">—</span>}</Num>;
  const activity = p.archived ? <span className="text-subtle">{t("projects.all.archivedTag")}</span> : p.lastActivity ? <span className="tabular-nums" title={new Date(p.lastActivity).toLocaleString()}>{relativeTime(p.lastActivity)}</span> : <span className="text-subtle" title={t("projects.all.unknownHint")}>—</span>;
  const chip = host ? <HostMark host={host} className="max-w-full" /> : <span className="truncate text-xs text-muted">{p.hostId}</span>;
  // An archived project has no page to open (restore it first): its name is plain text.
  const Name = p.archived ? "span" : "button";
  const name = (
    <Name {...(p.archived ? {} : { type: "button" as const, onClick: open, "data-projects-open": p.key })} className={`${p.archived ? "" : "press "}flex min-w-0 flex-1 items-center gap-2.5 rounded text-left`}>
      <span className="flex shrink-0 items-center justify-center" style={{ width: slot }}><EntityIcon entity={projectEntity(p.hostId, p.project)} size={22} slot={slot} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui/[inherit] font-medium text-foreground">{p.name}</span>
        <span className="block truncate text-caption/[inherit] text-subtle">{who}</span>
      </span>
    </Name>
  );
  if (wide) {
    return (
      <div role="row" className={`grid items-center gap-x-3 border-b border-border/60 px-2 py-1.5 text-sm hover:bg-surface-2/50 ${checked ? "bg-accent/5" : ""}`} style={{ gridTemplateColumns: COLUMNS(hostColumn) }} data-projects-row={p.key}>
        <RowCheck checked={checked} disabled={disabled} label={t("projects.all.select", { name: p.name })} onClick={onToggle} />
        <span role="cell" className="flex min-w-0">{name}</span>
        {hostColumn && <span role="cell" className="min-w-0">{chip}</span>}
        <span role="cell" className="text-right">{online}</span>
        <span role="cell" className="text-right">{needs}</span>
        <span role="cell" className="text-right text-xs text-muted">{activity}</span>
      </div>
    );
  }
  // Narrow: two lines (name + Director; host · 在线 / 成员 · 最近活动), 需要你 at the end.
  return (
    <div role="row" className={`flex items-center gap-2.5 border-b border-border/60 px-2 py-1.5 text-sm hover:bg-surface-2/50 ${checked ? "bg-accent/5" : ""}`} data-projects-row={p.key}>
      <RowCheck checked={checked} disabled={disabled} label={t("projects.all.select", { name: p.name })} onClick={onToggle} />
      <span role="cell" className="flex min-w-0 flex-1 flex-col gap-0.5">
        {name}
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted" style={{ paddingLeft: slot + 10 }}>
          {hostColumn && <span className="min-w-0 max-w-[45%]">{chip}</span>}
          <span>{online}</span>
          <span>·</span>
          {activity}
        </span>
      </span>
      <span role="cell" className="shrink-0">{p.needsYou ? needs : null}</span>
    </div>
  );
}

function BatchStatus({ batch, onDismiss }: { batch: ProjectBatch; onDismiss(): void }) {
  const { t, locale } = useI18n();
  const results = batch.results;
  if (!results) {
    return (
      <div className="my-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs" role="status" data-projects-progress="running">
        <p>{t(`projects.all.running.${batch.kind}` as MessageKey, { done: batch.done, n: batch.total })}</p>
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-border"><div className="h-full bg-accent transition-[width]" style={{ width: `${(batch.done / Math.max(1, batch.total)) * 100}%` }} /></div>
      </div>
    );
  }
  const by = (s: BatchItemResult["status"]) => results.filter((r) => r.status === s);
  const failed = by("failed"), unknown = by("unknown"), skipped = by("skipped"), settling = by("settling");
  return (
    <div className="my-2 flex flex-wrap items-start gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs" role="status" data-projects-progress="done">
      <div className="min-w-0 flex-1 space-y-1">
        {/* 「已暂停 0 / 3」 would read as a failure when they are all still settling. */}
        {(by("done").length > 0 || settling.length === 0) && <p>{t(`projects.all.done.${batch.kind}` as MessageKey, { ok: by("done").length, n: batch.total })}</p>}
        {settling.length > 0 && <p data-projects-settling={settling.length}>{t(`projects.all.settling.${batch.kind === "pause" ? "pause" : "resume"}` as MessageKey, { n: settling.length })}</p>}
        {skipped.length > 0 && <p className="text-subtle">{t(`projects.all.skipped.${batch.kind}` as MessageKey, { n: skipped.length })}</p>}
        {unknown.length > 0 && <p className="text-warn" data-projects-unknown={unknown.length}>{t("projects.all.unknownResult", { n: unknown.length, names: new Intl.ListFormat(locale, { type: "conjunction" }).format(unknown.slice(0, FAILURES_SHOWN).map((r) => r.name)) })}</p>}
        {failed.length > 0 && (
          <div className="text-danger" data-projects-failures={failed.length}>
            <p>{t("projects.all.failed", { n: failed.length })}</p>
            <ul className="mt-0.5 list-disc pl-4">
              {failed.slice(0, FAILURES_SHOWN).map((f) => <li key={f.key}>{t("projects.all.failedItem", { name: f.name, error: f.error ?? "" })}</li>)}
              {failed.length > FAILURES_SHOWN && <li>{t("projects.all.failedMore", { n: failed.length - FAILURES_SHOWN })}</li>}
            </ul>
            <p className="mt-0.5 text-subtle">{t("projects.all.failedKeep")}</p>
          </div>
        )}
      </div>
      <TextLink onClick={onDismiss}>{t("projects.all.dismiss")}</TextLink>
    </div>
  );
}
