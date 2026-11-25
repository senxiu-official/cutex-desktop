// 设置 → 归档 → 已归档的智能体 (owner 2026-11-24): every archived agent of the settings host with
// - filters: name / project text, project, model family, archive date (presets); sort by archive date, size, activity, name;
// - selection: a checkbox per row, 全选 of the filtered rows, Shift-click for a range; the filter changing clears it;
// - batch 恢复 (medium risk: an in-place second click) and 永久删除 (high risk: a dialog that names the count and the size
//   and wants 删除 typed). cutex has no batch endpoint: each agent is one call, three at a time (runBounded); every one
//   settles, the progress shows, failures stay listed with their reason and stay selected for another try;
// - figures (./archivedStats): totals and per-agent size / tokens / turns, read once per agent and kept.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import type { SessionResource } from "@cutex-desktop/protocol";
import { useI18n, type MessageKey } from "../../i18n";
import { Avatar } from "../../components/Avatar";
import { RowCheck } from "../../components/RowCheck";
import { Button, EmptyState, ErrorNote, IconButton, ListRow, Section, Select, SettingsGroup, TextInput, TextLink } from "../../components/settings/Form";
import { agentFeaturesOf, lacks } from "../../lib/agentFeatures";
import { agentFamilyNow } from "../../lib/agentLook";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { archivedProjectOf, projectOfArchived } from "../../lib/archivedAgent";
import { promptDialog } from "../../lib/contextMenu";
import { hostApi } from "../../lib/hostLists";
import { deleteAgent, restoreArchived, SESSION_FEATURES } from "../../lib/menus";
import { FAMILY_LABEL } from "../../lib/portraitPacks";
import { refusalText } from "../../lib/profileCreate";
import { restoreWithDirector } from "../../lib/projectArchive";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { useSidebarModel } from "../../lib/sidebarView";
import { useTargetFeatures, useTargetHostId, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";
import { useApp } from "../../store";
import { STORAGE_FEATURE } from "../../../../shared/storage";
import { EMPTY_FILTER, NO_PROJECT, archivedAtOf, lastActiveOf, matchesArchived, rangeIds, sortArchived, totalsOf, type ArchivedFacts, type ArchivedFilter, type ArchivedSort, type ArchivedWhen } from "./archivedFilter";
import { BATCH_CONCURRENCY, USAGE_LEDGER_FEATURE, figuresKey, formatCount, formatSize, loadArchivedStats, runBounded, useArchivedStats, type ArchivedFigures } from "./archivedStats";

const WHENS: ArchivedWhen[] = ["all", "7d", "30d", "90d", "older90d"];
const SORTS: ArchivedSort[] = ["archived", "size", "active", "name"];
/** Failures listed by name before 「等 N 个」. */
const FAILURES_SHOWN = 8;

type Batch = { kind: "restore" | "delete"; total: number; done: number; ok: number; failures: { id: string; name: string; error: string }[]; running: boolean };

export function ArchivedManagerPage() {
  useScrollToSettingsAnchor();
  return <ArchivedManager />;
}

export function ArchivedManager() {
  const { t, locale } = useI18n();
  const { archived } = useSidebarModel();
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const canDelete = features.has(SESSION_FEATURES.delete);
  const support = useMemo(() => ({ size: features.has(STORAGE_FEATURE), usage: features.has(USAGE_LEDGER_FEATURE) }), [features]);
  const kept = useArchivedStats((s) => s.figures[hostId]);
  const statsLoading = useArchivedStats((s) => !!s.loading[hostId]);
  const statsError = useArchivedStats((s) => s.errors[hostId] ?? null);
  const readAt = useArchivedStats((s) => s.readAt[hostId] ?? null);
  const [filter, setFilterState] = useState<ArchivedFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<ArchivedSort>("archived");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [restoreArmed, setRestoreArmed] = useArmed(`${hostId}:${selected.size}`);
  const now = Date.now();

  const sessions = useMemo(() => archived.map((row) => row.session), [archived]);
  const sessionKeys = sessions.map(figuresKey).join(",");
  // One controller per host while the page shows it: leaving the page or switching host stops the reads between requests.
  const reads = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    reads.current = controller;
    return () => controller.abort();
  }, [hostId]);
  useEffect(() => {
    void loadArchivedStats(hostId, hostApi(hostId), sessions, support, { signal: reads.current?.signal });
    // Keyed by the agents' ids@revisions: a page reopen with the same archived agents reads nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, sessionKeys, support]);

  const facts: ArchivedFacts[] = useMemo(() => archived.map((row) => {
    const own = projectOfArchived(row.session);
    return {
      id: row.session.cutexSessionId,
      name: row.name,
      session: row.session,
      project: own ? { id: own.id, name: own.name ?? own.id } : null,
      family: agentFamilyNow(row.session.cutexSessionId) ?? "other",
      archivedAt: archivedAtOf(row.session),
      lastActiveAt: lastActiveOf(row.session),
      figures: kept?.[figuresKey(row.session)] ?? null,
    };
  }), [archived, kept]);
  const rowOf = useMemo(() => new Map(archived.map((row) => [row.session.cutexSessionId, row])), [archived]);
  const shown = useMemo(() => sortArchived(facts.filter((x) => matchesArchived(x, filter, now)), sort, locale), [facts, filter, sort, locale, now]);
  const shownIds = shown.map((x) => x.id);
  const picked = shown.filter((x) => selected.has(x.id));
  const pickedTotals = totalsOf(picked);
  const all = totalsOf(facts);
  const filtered = filter !== EMPTY_FILTER && JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER);
  const running = !!batch?.running;

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const x of facts) if (x.project) seen.set(x.project.id, x.project.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [facts, locale]);
  const families = useMemo(() => [...new Set(facts.map((x) => x.family))].sort(), [facts]);
  const familyLabel = (f: string) => (f === "other" ? t("archive.manage.familyOther") : (FAMILY_LABEL as Record<string, string>)[f] ?? f);

  const setFilter = (next: Partial<ArchivedFilter>) => {
    setFilterState((f) => ({ ...f, ...next }));
    // Batch actions act on what is shown: a new filter starts a new selection.
    setSelected(new Set());
    setAnchor(null);
  };
  const toggle = (id: string, e: MouseEvent) => {
    const on = !selected.has(id);
    const ids = e.shiftKey ? rangeIds(shownIds, anchor, id) : [id];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const x of ids) if (on) next.add(x); else next.delete(x);
      return next;
    });
    setAnchor(id);
  };
  const allPicked = shown.length > 0 && picked.length === shown.length;

  const run = async (kind: Batch["kind"], list: ArchivedFacts[], work: (s: SessionResource) => Promise<void>) => {
    setBatch({ kind, total: list.length, done: 0, ok: 0, failures: [], running: true });
    const results = await runBounded(list, BATCH_CONCURRENCY, (x) => work(x.session), (done) => setBatch((b) => (b ? { ...b, done } : b)));
    const failures = results.flatMap((r, i) => (r.status === "rejected" ? [{ id: list[i]!.id, name: list[i]!.name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }] : []));
    setBatch({ kind, total: list.length, done: list.length, ok: list.length - failures.length, failures, running: false });
    // What failed stays selected for another try; the rest are gone from the list.
    setSelected(new Set(failures.map((f) => f.id)));
    void useApp.getState().refreshHostSidebar(hostId).catch(() => {});
  };
  const restoreSelected = () => {
    setRestoreArmed(false);
    void run("restore", picked, (s) => restoreArchived(s, true, hostId));
  };
  const deleteSelected = async () => {
    const deletable = picked.filter((x) => canDelete && !lacks(agentFeaturesOf(x.session), "threadDelete"));
    const skipped = picked.length - deletable.length;
    const totals = totalsOf(deletable);
    const word = t("archive.manage.deleteWord");
    const title = totals.measured ? t("archive.manage.deleteTitle", { n: deletable.length, size: formatSize(totals.bytes, locale) }) : t("archive.manage.deleteTitleNoSize", { n: deletable.length });
    const hint = [t("archive.manage.deleteHint", { word }), skipped ? t("archive.manage.deleteSkipped", { n: skipped }) : ""].filter(Boolean).join(" ");
    if (!deletable.length) return;
    const typed = await promptDialog(title, "", { expect: word, mismatch: t("archive.manage.deleteMismatch", { word }), hint, placeholder: word, danger: true, okLabel: t("archive.manage.deleteOk", { n: deletable.length }) });
    if (typed !== word) return;
    await run("delete", deletable, async (s) => {
      const result = await useApp.getState().deleteSession(s.cutexSessionId, s.revision, hostId);
      if (!result.ok) throw new Error(refusalText(result.error, t));
    });
  };

  const statsLine = () => {
    const parts: string[] = [];
    const base = filtered ? totalsOf(shown) : all;
    parts.push(filtered ? t("archive.manage.filtered", { n: shown.length, total: facts.length }) : t("archive.manage.count", { n: facts.length }));
    if (support.size && base.measured) parts.push(base.measured < base.count ? t("archive.manage.stats.sizePartial", { size: formatSize(base.bytes, locale), measured: base.measured, n: base.count }) : t("archive.manage.stats.size", { size: formatSize(base.bytes, locale) }));
    if (support.usage && base.withUsage) parts.push(t("archive.manage.stats.tokens", { tokens: formatCount(base.tokens, locale), turns: formatCount(base.turns, locale) }));
    return parts.join(" · ");
  };

  if (!archived.length) return <Section id={settingsAnchorId("list-all")} title={t("archive.list")}><EmptyState>{t("archive.archiveEmpty")}</EmptyState></Section>;
  return (
    <Section id={settingsAnchorId("list-all")} title={t("archive.all", { n: archived.length })}>
      {/* Figures: totals of what is shown, how they were read, 重新统计. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-xs text-subtle" data-archived-stats="">
        <span className="tabular-nums text-muted" data-archived-totals="">{statsLine()}</span>
        {(support.size || support.usage) && (
          <>
            {statsLoading ? <span role="status">{t("archive.manage.stats.reading")}</span> : readAt ? <span title={t("archive.manage.stats.hint")}>{t("archive.manage.stats.readAt", { when: new Date(readAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}</span> : null}
            {!statsLoading && <TextLink onClick={() => void loadArchivedStats(hostId, hostApi(hostId), sessions, support, { force: true, signal: reads.current?.signal })}>{t("archive.manage.stats.refresh")}</TextLink>}
          </>
        )}
      </div>
      {statsError && <ErrorNote>{t("archive.manage.stats.error", { error: statsError })}</ErrorNote>}

      {/* Filters */}
      <div role="search" className="flex flex-wrap items-center gap-2 py-2" data-archived-filters="">
        <TextInput search value={filter.text} onChange={(text) => setFilter({ text })} width="w-48" label={t("archive.manage.search")} placeholder={t("archive.manage.search")} />
        {projects.length > 0 && (
          <Select width="w-40" label={t("archive.manage.project")} value={filter.project} onChange={(project) => setFilter({ project })}
            options={[{ value: "", label: t("archive.manage.projectAll") }, { value: NO_PROJECT, label: t("archive.manage.projectNone") }, ...projects.map(([id, name]) => ({ value: id, label: name }))]} />
        )}
        {families.length > 1 && (
          <Select width="w-32" label={t("archive.manage.family")} value={filter.family} onChange={(family) => setFilter({ family })}
            options={[{ value: "", label: t("archive.manage.familyAll") }, ...families.map((f) => ({ value: f, label: familyLabel(f) }))]} />
        )}
        <Select<ArchivedWhen> width="w-32" label={t("archive.manage.when")} value={filter.when} onChange={(when) => setFilter({ when })} options={WHENS.map((w) => ({ value: w, label: t(`archive.manage.when.${w}` as MessageKey) }))} />
        <Select<ArchivedSort> width="w-40" label={t("archive.manage.sort")} value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s, label: t(`archive.manage.sort.${s}` as MessageKey) }))} />
        {filtered && <TextLink onClick={() => setFilter(EMPTY_FILTER)}>{t("archive.manage.clearFilter")}</TextLink>}
      </div>

      {/* Selection + batch actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2" data-archived-batch="">
        <RowCheck checked={allPicked} mixed={picked.length > 0 && !allPicked} disabled={running || !shown.length} label={t("archive.manage.selectAll", { n: shown.length })}
          onClick={() => { setSelected(allPicked ? new Set() : new Set(shownIds)); setAnchor(null); }} />
        <span className="text-xs text-muted">{picked.length ? (pickedTotals.measured ? t("archive.manage.selected", { n: picked.length, size: formatSize(pickedTotals.bytes, locale) }) : t("archive.manage.selectedNoSize", { n: picked.length })) : t("archive.manage.selectAll", { n: shown.length })}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {restoreArmed && picked.length > 0 ? (
            <SettingsGroup agents="now" source="host"><button type="button" className={ARMED_FORM_BUTTON.replace("border-danger-solid bg-danger-solid", "border-accent bg-accent")} data-archived-restore-armed="" disabled={running} onClick={restoreSelected}>{t("archive.manage.restoreArmed", { n: picked.length })}</button></SettingsGroup>
          ) : (
            <Button disabled={running || !picked.length} onClick={() => setRestoreArmed(true)}>{t("archive.manage.restore")}</Button>
          )}
          {canDelete && <Button disabled={running || !picked.length} onClick={() => void deleteSelected()}><span className="text-danger">{t("archive.manage.delete")}</span></Button>}
        </span>
        {restoreArmed && picked.length > 0 && <p className="w-full text-xs text-subtle">{t("archive.manage.restoreNote")}</p>}
      </div>

      {batch && <BatchStatus batch={batch} onDismiss={() => setBatch(null)} />}

      {shown.length === 0 ? (
        <EmptyState>{t("archive.manage.noMatch")}</EmptyState>
      ) : (
        <div data-archived-list="">
          {shown.map((x) => (
            <ManagedRow key={x.id} facts={x} color={rowOf.get(x.id)?.color ?? null} checked={selected.has(x.id)} disabled={running} canDelete={canDelete} support={support} onToggle={(e) => toggle(x.id, e)} />
          ))}
        </div>
      )}
    </Section>
  );
}

function BatchStatus({ batch, onDismiss }: { batch: Batch; onDismiss(): void }) {
  const { t } = useI18n();
  const failed = batch.failures;
  return (
    <div className="my-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs" role="status" data-archived-progress={batch.running ? "running" : "done"}>
      {batch.running ? (
        <>
          <p>{t(`archive.manage.running.${batch.kind}` as MessageKey, { done: batch.done, n: batch.total })}</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-border"><div className="h-full bg-accent transition-[width]" style={{ width: `${(batch.done / Math.max(1, batch.total)) * 100}%` }} /></div>
        </>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p>{t(`archive.manage.done.${batch.kind}` as MessageKey, { ok: batch.ok, n: batch.total })}</p>
            {failed.length > 0 && (
              <div className="text-danger" data-archived-failures={failed.length}>
                <p>{t("archive.manage.failed", { n: failed.length })}</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {failed.slice(0, FAILURES_SHOWN).map((f) => <li key={f.id}>{t("archive.manage.failedItem", { name: f.name, error: f.error })}</li>)}
                  {failed.length > FAILURES_SHOWN && <li>{t("archive.manage.failedMore", { n: failed.length - FAILURES_SHOWN })}</li>}
                </ul>
                <p className="mt-0.5 text-subtle">{t("archive.manage.failedKeep")}</p>
              </div>
            )}
          </div>
          <TextLink onClick={onDismiss}>{t("archive.manage.dismiss")}</TextLink>
        </div>
      )}
    </div>
  );
}

function ManagedRow({ facts, color, checked, disabled, canDelete, support, onToggle }: { facts: ArchivedFacts; color: string | null; checked: boolean; disabled: boolean; canDelete: boolean; support: { size: boolean; usage: boolean }; onToggle(e: MouseEvent): void }) {
  const { t, locale } = useI18n();
  const select = useTargetSelect();
  const hostId = useTargetHostId();
  const projects = useTargetSidebar()?.projects;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = facts.session;
  const archivedProject = archivedProjectOf(session, projects);
  const date = (ms: number | null) => (ms === null ? null : new Date(ms).toLocaleDateString(locale));
  const detail = [
    facts.project ? (archivedProject ? t("archive.row.projectArchived", { project: archivedProject.name }) : facts.project.name) : null,
    facts.archivedAt !== null ? t("archive.row.archivedAt", { when: date(facts.archivedAt)! }) : null,
    facts.lastActiveAt !== null ? t("archive.manage.row.lastActive", { when: date(facts.lastActiveAt)! }) : null,
  ].filter(Boolean).join(" · ");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup agents="now" source="host"><ListRow
      leading={<span className="flex items-center gap-2.5" data-archived-row={facts.id}><RowCheck checked={checked} disabled={disabled} label={t("archive.manage.select", { name: facts.name })} onClick={onToggle} /><Avatar name={facts.name} color={color} avatar={session.avatar} seed={session.cutexSessionId} size={20} /></span>}
      title={facts.name}
      detail={detail || undefined}
      actions={
        <>
          <Figures figures={facts.figures} support={support} />
          <Button disabled={busy || disabled} onClick={() => void select(facts.id)}>{t("archive.row.view")}</Button>
          <Button disabled={busy || disabled} onClick={() => void act(() => restoreWithDirector(session, t, hostId))} title={archivedProject ? t("archive.banner.projectArchived", { project: archivedProject.name }) : undefined}>
            {t("archive.row.restore")}
          </Button>
          {canDelete && !lacks(agentFeaturesOf(session), "threadDelete") && (
            <IconButton label={t("archive.row.delete")} danger disabled={busy || disabled} onClick={() => void act(() => deleteAgent(session, t, hostId))}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </>
      }
      below={error ? <p className="mt-1 text-xs text-danger">{error}</p> : undefined}
    /></SettingsGroup>
  );
}

/** Size and tokens at the row end (fixed width, right-aligned, so the columns line up). */
function Figures({ figures, support }: { figures: ArchivedFigures | null; support: { size: boolean; usage: boolean } }) {
  const { t, locale } = useI18n();
  if (!support.size && !support.usage) return null;
  const size = figures === null ? "…" : figures.bytes === null ? "—" : formatSize(figures.bytes, locale);
  const tokens = figures?.tokens ?? null;
  return (
    <span className="mr-1 flex min-w-20 flex-col items-end whitespace-nowrap text-right text-xs tabular-nums leading-tight text-muted" data-archived-figures="">
      {support.size && <span title={figures?.bytes === null ? t("archive.manage.row.noCopy") : figures?.files !== null && figures?.files !== undefined ? t("archive.manage.row.files", { n: figures.files }) : undefined}>{size}</span>}
      {support.usage && tokens !== null && tokens > 0 && <span className="text-subtle" title={t("archive.manage.row.turns", { n: figures?.turns ?? 0 })}>{t("archive.manage.row.tokens", { tokens: formatCount(tokens, locale) })}</span>}
    </span>
  );
}
