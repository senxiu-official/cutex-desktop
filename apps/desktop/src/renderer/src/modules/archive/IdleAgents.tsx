// 设置 → 归档 → 整理不常用的智能体 (owner 2026-11-26): the settings host's active agents filtered by days unused (3 / 7 /
// 14 / 30 or a typed number), project, Profile and online; 全选当前筛选的 ticks those that can go (./idleFilter
// defaultPicks: not pinned, not paused by the owner — those can be ticked by hand), then 归档所选 — restorable, so an
// in-place second click (owner rule: confirm by risk) that says where to restore them.
// Never archived from here, with the reason on the row: working now, unfinished delegations, a project's Director or
// 副主管, cutex's allowedActions without archive, owning services. The archive itself is cutex's own
// `cutex/session/retire` per agent (the 归档 menu and the member page use the same method; the store fences it by the
// agent's revision and runtime generation), three at a time; the agent is read again right before its call, and every
// failure stays listed with its reason. cutex has no batch endpoint and needs none.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Avatar } from "../../components/Avatar";
import { RowCheck } from "../../components/RowCheck";
import { Button, EmptyState, ListRow, Section, Select, SettingsGroup, TextInput, TextLink } from "../../components/settings/Form";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { useAgentPauses, agentPauseNow } from "../../lib/agentPause";
import { useHostRecords } from "../../lib/delegationStore";
import { isUnfinished, requesterSession } from "../../lib/delegations";
import { hostApi } from "../../lib/hostLists";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { useSidebarModel } from "../../lib/sidebarView";
import { conversationActivity, type AgentRow } from "../../lib/sidebar";
import { useTargetFeatures, useTargetHostId, useTargetSelect } from "../../lib/targetHost";
import { sidebarOf, useApp } from "../../store";
import { STORAGE_FEATURE } from "../../../../shared/storage";
import { rangeIds } from "./archivedFilter";
import { BATCH_CONCURRENCY, formatSize, readSizes, runBounded } from "./archivedStats";
import {
  DEFAULT_IDLE_FILTER, IDLE_DAY_PRESETS, NO_PROJECT, defaultPicks, idleDaysOf, idleExclusion, isBusy, matchesIdle, parseDays, selectable, sortIdle,
  type IdleFacts, type IdleFilter, type IdleOnline,
} from "./idleFilter";

const FAILURES_SHOWN = 8;
const ONLINES: IdleOnline[] = ["all", "online", "offline"];
type Batch = { total: number; done: number; ok: number; failures: { id: string; name: string; error: string }[]; running: boolean };

export function IdleAgentsPage() {
  useScrollToSettingsAnchor();
  return <IdleAgents />;
}

/** Every active agent row of the model (projects, then agents without one, then quick chats), with its online state. */
function activeRows(model: ReturnType<typeof useSidebarModel>): { row: AgentRow; online: boolean; project: { id: string; name: string } | null }[] {
  const out: { row: AgentRow; online: boolean; project: { id: string; name: string } | null }[] = [];
  for (const g of model.groups) {
    const project = g.kind === "project" ? { id: g.id, name: g.name } : null;
    for (const row of g.online) out.push({ row, online: true, project });
    for (const row of g.offline) out.push({ row, online: false, project });
  }
  for (const row of model.chats) out.push({ row, online: row.status !== "offline", project: null });
  return out;
}

export function IdleAgents() {
  const { t, locale } = useI18n();
  const model = useSidebarModel();
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const records = useHostRecords(hostId);
  const services = useApp((s) => ((s.hosts?.active ?? "local") === hostId ? s.services : s.byHost[hostId]?.services) ?? []);
  const pauses = useAgentPauses((s) => s.byKey);
  const [filter, setFilterState] = useState<IdleFilter>(DEFAULT_IDLE_FILTER);
  const [custom, setCustom] = useState(false);
  const [daysText, setDaysText] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [sizes, setSizes] = useState<Map<string, { bytes: number }> | null>(null);
  const [armed, setArmed] = useArmed(`${hostId}:${selected.size}`);
  const now = Date.now();

  // Sizes once per host while the page shows it (cutex host-storage: the agents' local copies).
  const sizeSupport = features.has(STORAGE_FEATURE);
  const rows = useMemo(() => activeRows(model), [model]);
  const idsKey = rows.map((r) => r.row.id).sort().join(",");
  const reads = useRef<AbortController | null>(null);
  useEffect(() => {
    setSizes(null);
    if (!sizeSupport || !idsKey) return;
    const controller = new AbortController();
    reads.current = controller;
    void readSizes(hostApi(hostId), new Set(idsKey.split(",")), controller.signal).then((m) => { if (!controller.signal.aborted) setSizes(m); }, () => {});
    return () => controller.abort();
  }, [hostId, sizeSupport, idsKey]);

  const facts: IdleFacts[] = useMemo(() => {
    const open = new Map<string, number>();
    for (const d of Object.values(records)) {
      if (!isUnfinished(d)) continue;
      for (const id of new Set([requesterSession(d.requester), d.target])) if (id) open.set(id, (open.get(id) ?? 0) + 1);
    }
    const owners = new Map<string, number>();
    for (const s of services) if (s.ownerCutexSessionId) owners.set(s.ownerCutexSessionId, (owners.get(s.ownerCutexSessionId) ?? 0) + 1);
    return rows.map(({ row, online, project }) => {
      const session = row.session;
      const activity = conversationActivity(session);
      return {
        id: row.id, name: row.name, session, project, profile: row.profile, online,
        lastActiveAt: activity > 0 ? activity : null,
        pinned: row.pinned,
        paused: !!agentPauseNow(hostId, row.id),
        exclusion: idleExclusion({ session, busy: isBusy(session) || row.status === "running", openDelegations: open.get(row.id) ?? 0, isDirector: row.isDirector, isDeputy: !!row.isOperator, ownedServices: owners.get(row.id) ?? 0 }),
        ...(sizeSupport ? { bytes: sizes ? sizes.get(row.id)?.bytes ?? null : undefined } : {}),
      };
    });
    // `pauses`: a pause change re-reads agentPauseNow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, records, services, hostId, sizes, sizeSupport, pauses]);

  const shown = useMemo(() => sortIdle(facts.filter((x) => matchesIdle(x, filter, now)), locale), [facts, filter, locale, now]);
  const shownIds = shown.map((x) => x.id);
  const choosable = shown.filter(selectable);
  const picked = choosable.filter((x) => selected.has(x.id));
  const pickedBytes = picked.reduce((n, x) => n + (x.bytes ?? 0), 0);
  const excluded = shown.length - choosable.length;
  const running = !!batch?.running;

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const x of facts) if (x.project) seen.set(x.project.id, x.project.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [facts, locale]);
  const profiles = useMemo(() => [...new Set(facts.map((x) => x.profile).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, locale)), [facts, locale]);

  const setFilter = (next: Partial<IdleFilter>) => {
    setFilterState((f) => ({ ...f, ...next }));
    // Batch actions act on what is shown: a new filter starts a new selection.
    setSelected(new Set());
    setAnchor(null);
  };
  const toggle = (id: string, e: MouseEvent) => {
    const on = !selected.has(id);
    const ids = (e.shiftKey ? rangeIds(shownIds, anchor, id) : [id]).filter((x) => choosable.some((c) => c.id === x));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const x of ids) if (on) next.add(x); else next.delete(x);
      return next;
    });
    setAnchor(id);
  };
  const defaults = defaultPicks(shown);
  const allDefaultPicked = defaults.length > 0 && defaults.every((id) => selected.has(id)) && picked.length === defaults.length;

  const archiveSelected = async () => {
    setArmed(false);
    const list = picked;
    setBatch({ total: list.length, done: 0, ok: 0, failures: [], running: true });
    const results = await runBounded(list, BATCH_CONCURRENCY, async (x) => {
      // Read again right before the call: a turn started, a delegation arrived or cutex changed its answer meanwhile.
      const now = sidebarOf(useApp.getState(), hostId)?.active.find((s) => s.cutexSessionId === x.id);
      if (!now) throw new Error(t("archive.idle.failed.gone"));
      if (isBusy(now)) throw new Error(t("archive.idle.excluded.busy"));
      if (now.allowedActions && !now.allowedActions.includes("archive")) throw new Error(t("archive.idle.excluded.notAllowed"));
      await useApp.getState().sessionAction(x.id, "cutex/session/retire", { reason: "desktop" }, hostId);
    }, (done) => setBatch((b) => (b ? { ...b, done } : b)));
    const failures = results.flatMap((r, i) => (r.status === "rejected" ? [{ id: list[i]!.id, name: list[i]!.name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }] : []));
    setBatch({ total: list.length, done: list.length, ok: list.length - failures.length, failures, running: false });
    // What failed stays selected for another try; the rest are gone from the list (now in 已归档).
    setSelected(new Set(failures.map((f) => f.id)));
    void useApp.getState().refreshHostSidebar(hostId).catch(() => {});
  };

  const daysValue = custom ? "custom" : String(filter.days);
  const dayOptions = [
    { value: "0", label: t("archive.idle.days.any") },
    ...IDLE_DAY_PRESETS.map((d) => ({ value: String(d), label: t("archive.idle.days.n", { n: d }) })),
    { value: "custom", label: t("archive.idle.days.custom") },
  ];
  const filtered = JSON.stringify(filter) !== JSON.stringify(DEFAULT_IDLE_FILTER);

  return (
    <Section id={settingsAnchorId("idle-all")} title={t("archive.idle.count", { n: facts.length })} hint={t("archive.idle.hint")}>
      <div role="search" className="flex flex-wrap items-center gap-2 py-2" data-idle-filters="">
        <Select width="w-44" label={t("archive.idle.days")} value={daysValue} options={dayOptions}
          onChange={(v) => { if (v === "custom") { setCustom(true); setDaysText(String(filter.days || 60)); setFilter({ days: filter.days || 60 }); } else { setCustom(false); setFilter({ days: Number(v) }); } }} />
        {custom && (
          <span className="flex items-center gap-1 text-xs text-muted" data-idle-custom-days="">
            <TextInput value={daysText} width="w-16" label={t("archive.idle.days.customLabel")} onChange={(v) => { setDaysText(v); const n = parseDays(v); if (n !== null) setFilter({ days: n }); }} />
            {t("archive.idle.days.unit")}
          </span>
        )}
        <TextInput search value={filter.text} onChange={(text) => setFilter({ text })} width="w-44" label={t("archive.idle.search")} placeholder={t("archive.idle.search")} />
        {projects.length > 0 && (
          <Select width="w-40" label={t("archive.manage.project")} value={filter.project} onChange={(project) => setFilter({ project })}
            options={[{ value: "", label: t("archive.manage.projectAll") }, { value: NO_PROJECT, label: t("archive.manage.projectNone") }, ...projects.map(([id, name]) => ({ value: id, label: name }))]} />
        )}
        {profiles.length > 1 && (
          <Select width="w-36" label={t("archive.idle.profile")} value={filter.profile} onChange={(profile) => setFilter({ profile })}
            options={[{ value: "", label: t("archive.idle.profileAll") }, ...profiles.map((p) => ({ value: p, label: p }))]} />
        )}
        <Select<IdleOnline> width="w-40" label={t("archive.idle.online")} value={filter.online} onChange={(online) => setFilter({ online })} options={ONLINES.map((o) => ({ value: o, label: t(`archive.idle.online.${o}` as MessageKey) }))} />
        {filtered && <TextLink onClick={() => { setCustom(false); setFilter(DEFAULT_IDLE_FILTER); }}>{t("archive.manage.clearFilter")}</TextLink>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2" data-idle-batch="">
        <RowCheck checked={allDefaultPicked} mixed={picked.length > 0 && !allDefaultPicked} disabled={running || !defaults.length} label={t("archive.idle.selectAll", { n: defaults.length })}
          onClick={() => { setSelected(allDefaultPicked ? new Set() : new Set(defaults)); setAnchor(null); }} />
        <span className="text-xs text-muted" data-idle-count="">
          {picked.length ? (pickedBytes ? t("archive.idle.selected", { n: picked.length, size: formatSize(pickedBytes, locale) }) : t("archive.idle.selectedNoSize", { n: picked.length })) : t("archive.idle.selectAll", { n: defaults.length })}
          {excluded > 0 && ` · ${t("archive.idle.excludedCount", { n: excluded })}`}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {armed && picked.length > 0 ? (
            <SettingsGroup agents="now" source="host"><button type="button" className={ARMED_FORM_BUTTON} data-idle-archive-armed="" disabled={running} onClick={() => void archiveSelected()}>{t("archive.idle.archiveArmed", { n: picked.length })}</button></SettingsGroup>
          ) : (
            <Button disabled={running || !picked.length} onClick={() => setArmed(true)}>{t("archive.idle.archive")}</Button>
          )}
        </span>
        {armed && picked.length > 0 && <p className="w-full text-xs text-subtle">{t("archive.idle.archiveNote")}</p>}
      </div>

      {batch && <IdleBatchStatus batch={batch} onDismiss={() => setBatch(null)} />}

      {shown.length === 0 ? (
        <EmptyState>{t(facts.length ? "archive.idle.noMatch" : "archive.idle.empty")}</EmptyState>
      ) : (
        <div data-idle-list="">
          {shown.map((x) => <IdleRow key={x.id} facts={x} now={now} color={rows.find((r) => r.row.id === x.id)?.row.color ?? null} checked={selected.has(x.id)} disabled={running} sizeSupport={sizeSupport} onToggle={(e) => toggle(x.id, e)} />)}
        </div>
      )}
    </Section>
  );
}

function IdleBatchStatus({ batch, onDismiss }: { batch: Batch; onDismiss(): void }) {
  const { t } = useI18n();
  const failed = batch.failures;
  return (
    <div className="my-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs" role="status" data-idle-progress={batch.running ? "running" : "done"}>
      {batch.running ? (
        <>
          <p>{t("archive.idle.running", { done: batch.done, n: batch.total })}</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-border"><div className="h-full bg-accent transition-[width]" style={{ width: `${(batch.done / Math.max(1, batch.total)) * 100}%` }} /></div>
        </>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p>{t("archive.idle.done", { ok: batch.ok, n: batch.total })}</p>
            {batch.ok > 0 && <p className="text-subtle">{t("archive.idle.doneWhere")}</p>}
            {failed.length > 0 && (
              <div className="text-danger" data-idle-failures={failed.length}>
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

function IdleRow({ facts, now, color, checked, disabled, sizeSupport, onToggle }: { facts: IdleFacts; now: number; color: string | null; checked: boolean; disabled: boolean; sizeSupport: boolean; onToggle(e: MouseEvent): void }) {
  const { t, locale } = useI18n();
  const select = useTargetSelect();
  const days = idleDaysOf(facts, now);
  const used = days === null ? t("archive.idle.row.unknown") : days === 0 ? t("archive.idle.row.today") : t("archive.idle.row.days", { n: days });
  const detail = [
    facts.project?.name ?? t("archive.manage.projectNone"),
    used,
    facts.profile,
    facts.online ? t("archive.idle.row.online") : null,
  ].filter(Boolean).join(" · ");
  const notes = [facts.pinned ? t("archive.idle.row.pinned") : null, facts.paused ? t("archive.idle.row.paused") : null].filter(Boolean).join(" · ");
  const size = !sizeSupport ? null : facts.bytes === undefined ? "…" : facts.bytes === null ? "—" : formatSize(facts.bytes, locale);
  return (
    <SettingsGroup agents="now" source="host"><ListRow
      leading={<span className="flex items-center gap-2.5" data-idle-row={facts.id} data-idle-excluded={facts.exclusion ?? undefined}>
        <RowCheck checked={checked} disabled={disabled || !!facts.exclusion} label={t("archive.manage.select", { name: facts.name })} onClick={onToggle} />
        <Avatar name={facts.name} color={color} avatar={facts.session.avatar} seed={facts.session.cutexSessionId} size={20} />
      </span>}
      title={<span className={facts.exclusion ? "text-muted" : undefined}>{facts.name}</span>}
      detail={detail}
      actions={<>
        {size !== null && <span className="mr-1 min-w-14 text-right text-xs tabular-nums text-muted" data-idle-size="">{size}</span>}
        <Button disabled={disabled} onClick={() => void select(facts.id)}>{t("archive.idle.row.open")}</Button>
      </>}
      below={facts.exclusion || notes ? <p className="mt-0.5 text-xs text-subtle">
        {facts.exclusion && <span className="text-warn" data-idle-reason={facts.exclusion}>{t(`archive.idle.excluded.${facts.exclusion}` as MessageKey)}</span>}
        {facts.exclusion && notes && " · "}
        {notes}
      </p> : undefined}
    /></SettingsGroup>
  );
}
