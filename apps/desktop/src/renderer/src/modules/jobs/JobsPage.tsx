// 作业 page: cutex Job Service jobs (long-running commands agents submit with cutex_job.submit) as
// a light table like the 委托 page — grouped by the submitting agent's project, agent filter, state
// segmented filter (进行中 / 排队 / 已结束), search. Row: state (glyph + word) · what runs · agent ·
// started · elapsed / duration · exit code · ⋯ (open agent, view output, cancel, copy). Polled while
// open; older finished jobs page in with 加载更多. The nav entry only exists with cutex job-service.
// Multi-host (RFC §9.2): the scope's hosts that have a Job Service (Linux hosts), one project group per
// (host, project), a host dot on each row; the other hosts' newest page is polled here and actions on
// their rows go to them. 加载更多 pages the focus host only.
// External (NCI PBS) jobs: a source badge + the PBS job id after the title, a 可能过时 hint when no
// source event arrived for a while (state unchanged), no output / cancel (they run on Gadi), and
// 手动标记结果… in the row menu when the job's host has job-external (MarkExternalDialog).
import { useEffect, useMemo, useState } from "react";
import type { SidebarSnapshot } from "../../../../shared/ipc";
import { MoreHorizontal } from "lucide-react";
import { useModuleEnabled } from "../react";
import type { JobRow } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { formatSpan } from "../../lib/delegations";
import { jobMenu } from "../../lib/jobMenu";
import { hasLocalOutput, JOB_SERVICE_FEATURE, jobOperations, jobSeconds, jobStatus, jobTitle, sortJobs, type JobGroup } from "../../lib/jobs";
import { canMarkExternal, NCI_MODULE, sourceLabel } from "../../lib/remoteJobs";
import { JOB_EXTERNAL_FEATURE } from "../../../../shared/remoteJobs";
import { MarkExternalDialog } from "./MarkExternalDialog";
import { openJobOutput, refreshAllJobs, refreshHostJobs, useHostJobs, useJobs } from "../../lib/jobStore";
import { useListHosts } from "../../lib/hostLists";
import { hostKey, type HostKey } from "../../lib/hostScope";
import { useAllJobs, useJobOps } from "../../lib/jobsView";
import { openHostAgent } from "../../lib/hostLists";
import { projectColor } from "../../lib/sidebar";
import { projectIcon } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { groupByProject } from "../../lib/tasks";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { useApp } from "../../store";
import type { PageParams } from "../slots";
import { Avatar } from "../../components/Avatar";
import { HostMark } from "../../components/HostMark";
import { MissingHosts, RowHost } from "../../components/HostListParts";
import { DataTable, type Column } from "../../components/DataTable";
import { JobStatusMark } from "../../components/JobParts";
import { PageBody, PageToolbar } from "../../components/Page";
import { Segmented, Select } from "../../components/settings/Form";
import { ProjectLabel } from "../../components/StatusIcon";

type Scope = JobGroup;
const SCOPES: Scope[] = ["active", "queued", "done"];
type Row = JobRow & { projectId: string | null; hostId: string; key: HostKey };
/** Other hosts' lists: polled like the focus host's (lib/jobsView), faster while something runs. */
const HOST_POLL_FAST_MS = 10_000;
const HOST_POLL_SLOW_MS = 30_000;

/** Agent names / avatars / projects of each host's sidebar. */
function useAgents(sidebars: ReadonlyMap<string, SidebarSnapshot | null>) {
  return useMemo(() => {
    const byKey = new Map<string, NonNullable<SidebarSnapshot["active"][number]>>();
    for (const [hostId, sidebar] of sidebars) for (const s of [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])]) byKey.set(hostKey(hostId, s.cutexSessionId), s);
    return {
      who: (hostId: string, id: string, fallback?: string | null) => {
        const s = byKey.get(hostKey(hostId, id));
        return { name: s?.displayName ?? fallback ?? id, avatar: s?.avatar };
      },
      projectOf: (hostId: string, id: string) => (sidebars.get(hostId)?.hostRows?.[id]?.projectId as string | null | undefined) ?? null,
    };
  }, [sidebars]);
}

function Time({ job }: { job: JobRow }) {
  const now = useClock();
  return <span className="text-[11px] text-subtle tabular-nums">{formatSpan(jobSeconds(job, Math.floor(now / 1000)))}</span>;
}

function Started({ at }: { at: number }) {
  const { locale } = useI18n();
  const now = useClock();
  return (
    <span className="text-[11px] text-subtle" title={formatAbsolute(at)}>
      {formatWhen(at, now, locale)}
    </span>
  );
}

/** NCI · 123456.gadi-pbs · 可能过时 after an external job's title. */
function ExternalTags({ job }: { job: JobRow }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const label = sourceLabel(job.source);
  if (!label) return null;
  const last = job.lastSourceEventAt ? t("jobs.external.lastEvent", { at: formatWhen(job.lastSourceEventAt, now, locale) }) : t("jobs.external.noEvent");
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px]" title={`${t("jobs.external.sourceTitle", { source: label })}\n${last}`}>
      <span className="rounded border border-border px-1 text-[10px] font-medium text-muted">{label}</span>
      {job.remoteId && jobTitle(job) !== job.remoteId && <span className="font-mono text-subtle">{job.remoteId}</span>}
      {job.stale && jobStatus(job).group !== "done" && (
        <span className="rounded bg-warn/15 px-1 text-[10px] text-warn-text" title={t("jobs.external.staleHint")}>
          {t("jobs.external.stale")}
        </span>
      )}
    </span>
  );
}

function JobList({ preset, presetScope }: { preset?: string; presetScope?: Scope }) {
  const { t } = useI18n();
  const nciOn = useModuleEnabled(NCI_MODULE);
  const hosts = useListHosts();
  const { byId, allIds } = useAllJobs();
  const nextCursor = useJobs((s) => s.nextCursor);
  const loading = useJobs((s) => s.allLoading);
  const error = useJobs((s) => s.error);
  const focusOps = useJobOps();
  const hostJobs = useHostJobs((s) => s.byHost);
  // Hosts with a Job Service (only Linux hosts have one; the others are simply not listed).
  const served = useMemo(() => hosts.data.filter((d) => d.features.has(JOB_SERVICE_FEATURE)), [hosts.data]);
  const others = useMemo(() => served.filter((d) => !d.focus).map((d) => d.hostId), [served]);
  const sidebars = useMemo(() => new Map(hosts.data.map((d) => [d.hostId, d.sidebar] as const)), [hosts.data]);
  const { who, projectOf } = useAgents(sidebars);
  const focusServed = served.some((d) => d.focus);
  const [scope, setScope] = useState<Scope>(presetScope ?? "active");
  useEffect(() => setScope(presetScope ?? "active"), [presetScope, preset]);
  // The agent filter is per host: a preset (the capsule's 查看全部) is an agent of the focus host.
  const presetKey = preset ? hostKey(hosts.focus, preset) : "";
  const [agent, setAgent] = useState(presetKey);
  useEffect(() => setAgent(presetKey), [presetKey]);
  const [query, setQuery] = useState("");
  const [marking, setMarking] = useState<Row | null>(null);

  const othersRunning = others.some((id) => hostJobs[id]?.rows.some((j) => j.state === "running" || j.state === "launch_pending"));
  const otherIds = others.join("\n");
  useEffect(() => {
    const ids = otherIds ? otherIds.split("\n") : [];
    if (ids.length === 0) return;
    const run = () => ids.forEach((id) => void refreshHostJobs(id));
    run();
    const timer = setInterval(() => !document.hidden && run(), othersRunning ? HOST_POLL_FAST_MS : HOST_POLL_SLOW_MS);
    return () => clearInterval(timer);
  }, [otherIds, othersRunning]);

  const all: Row[] = [
    ...(focusServed ? Object.values(byId).map((j) => ({ ...j, hostId: hosts.focus, key: hostKey(hosts.focus, j.jobId) })) : []),
    ...others.flatMap((hostId) => (hostJobs[hostId]?.rows ?? []).map((j) => ({ ...j, hostId, key: hostKey(hostId, j.jobId) }))),
  ].map((j) => ({ ...j, projectId: projectOf(j.hostId, j.sessionId) }));
  const agentOf = (j: Pick<Row, "hostId" | "sessionId">) => hostKey(j.hostId, j.sessionId);
  const agentKeys = [...new Set([...all.map(agentOf), ...(agent ? [agent] : [])])];
  const agentNames = new Map(all.map((j) => [agentOf(j), j.agentName]));
  const nameOfKey = (key: string) => {
    const [hostId, id] = JSON.parse(key) as [string, string];
    return who(hostId, id, agentNames.get(key)).name;
  };
  const q = query.trim().toLowerCase();
  const filtered = all
    .filter((j) => !agent || agentOf(j) === agent)
    .filter((j) => !q || `${j.jobId} ${j.actionId} ${j.command ?? ""} ${j.cwd ?? ""} ${j.remoteId ?? ""} ${j.remoteName ?? ""} ${j.agentName ?? who(j.hostId, j.sessionId).name}`.toLowerCase().includes(q));
  const count = (s: Scope) => filtered.filter((j) => jobStatus(j).group === s).length;
  const rows = sortJobs(filtered.filter((j) => jobStatus(j).group === scope)) as Row[];
  const icons = useUiPrefs().projectIcons;
  const groups = served.flatMap((d) => {
    const projects = d.sidebar?.projects?.projects ?? [];
    const look = hosts.look(d.hostId);
    return groupByProject(rows.filter((r) => r.hostId === d.hostId), projects).map((g) => {
      const p = projects.find((x) => x.project_id === g.projectId);
      return {
        key: hosts.multi ? hostKey(d.hostId, g.projectId ?? "") : (g.projectId ?? ""),
        label: (
          <span className="inline-flex items-center gap-1.5">
            {hosts.marks && look && <HostMark host={look} />}
            {p ? <ProjectLabel icon={projectIcon(icons, d.hostId, p.project_id)} name={p.presentation.display_name} badge={p.presentation.badge_label} color={projectColor(p.presentation.color)} /> : t("tasks.noProject")}
          </span>
        ),
        rows: g.tasks,
      };
    });
  });
  const opsOf = (hostId: string) => (hostId === hosts.focus ? focusOps : jobOperations(hostJobs[hostId]?.caps));
  const anyOps = served.some((d) => {
    const o = opsOf(d.hostId);
    return o.cancel || o.output;
  });
  // NCI bits (tags, 手动标记结果…, 复制 PBS 作业号) only while module nci (NCI 远程作业) is on.
  const external = (hostId: string) => nciOn && !!served.find((d) => d.hostId === hostId)?.features.has(JOB_EXTERNAL_FEATURE);
  const menu = (j: Row) =>
    jobMenu(j, t, (id) => who(j.hostId, id).name, opsOf(j.hostId), { hostId: j.hostId, remote: nciOn, markExternal: canMarkExternal(j, external(j.hostId)) ? () => setMarking(j) : undefined });
  const output = (j: Row) => opsOf(j.hostId).output && hasLocalOutput(j);
  const loaded = allIds !== null || others.some((id) => hostJobs[id]);
  const otherError = others.map((id) => hostJobs[id]?.error).find((e) => !!e);

  const columns: Column<Row>[] = [
    {
      key: "status",
      header: t("table.status"),
      width: hosts.marks ? "9rem" : "8rem",
      cell: (j) => (
        <span className={`flex min-w-0 items-center gap-1.5 ${hosts.stale.has(j.hostId) ? "opacity-50" : ""}`}>
          <RowHost host={hosts.look(j.hostId)} show={hosts.marks} />
          <JobStatusMark job={j} className="min-w-0 text-xs" />
        </span>
      ),
    },
    {
      key: "job",
      header: t("jobs.col.job"),
      cell: (j) => (
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={() => output(j) && openJobOutput(j.jobId, j.hostId)}
            disabled={!output(j)}
            title={`${jobTitle(j)}\n${j.jobId}${nciOn && j.remoteId ? `\n${j.remoteId}` : ""}${j.cwd ? `\n${j.cwd}` : ""}`}
            className={`min-w-0 truncate text-left enabled:hover:underline ${j.command || jobTitle(j) === j.remoteId ? "font-mono text-xs" : ""}`}
          >
            {jobTitle(j)}
          </button>
          {j.command && j.actionId && <span className="min-w-0 shrink truncate text-xs text-subtle">{j.actionId}</span>}
          {nciOn && <ExternalTags job={j} />}
        </div>
      ),
    },
    {
      key: "agent",
      header: t("jobs.col.agent"),
      width: "9rem",
      cell: (j) => {
        const w = who(j.hostId, j.sessionId, j.agentName);
        return (
          <button onClick={() => openHostAgent(j.hostId, j.sessionId)} className="flex min-w-0 items-center gap-1 text-xs text-muted hover:text-foreground">
            <Avatar name={w.name} avatar={w.avatar} seed={j.sessionId} size={16} />
            <span className="truncate">{w.name}</span>
          </button>
        );
      },
    },
    { key: "started", header: t("jobs.col.started"), width: "5.5rem", cell: (j) => <Started at={j.createdAt} /> },
    { key: "time", header: t(scope === "done" ? "jobs.col.duration" : "jobs.col.elapsed"), width: "4.5rem", align: "right", cell: (j) => <Time job={j} /> },
    {
      key: "exit",
      header: t("jobs.col.exit"),
      width: "3.5rem",
      align: "right",
      cell: (j) => (j.exitCode != null ? <span className={`font-mono text-[11px] ${j.exitCode === 0 ? "text-subtle" : "text-danger"}`}>{j.exitCode}</span> : null),
    },
    {
      key: "menu",
      header: "",
      width: "2rem",
      cell: (j) => (
        <button onClick={(e) => openMenuFrom(e.currentTarget, menu(j))} aria-label={t("jobs.more")} className="rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100">
          <MoreHorizontal size={14} />
        </button>
      ),
    },
  ];
  const shown = scope === "done" ? columns : columns.filter((c) => c.key !== "exit");

  return (
    <>
      <PageToolbar>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("jobs.search")} className="mr-auto w-48 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
        <Select value={agent} options={[{ value: "", label: t("delegations.allAgents") }, ...agentKeys.map((key) => ({ value: key, label: nameOfKey(key) }))]} onChange={setAgent} />
        <Segmented<Scope> value={scope} onChange={setScope} options={SCOPES.map((s) => ({ value: s, label: `${t(`jobs.scope.${s}` as MessageKey)} ${count(s)}` }))} />
      </PageToolbar>
      {hosts.multi && <MissingHosts hosts={hosts.missing} />}
      {(focusServed ? error && allIds === null : !!otherError && !loaded) && <p className="py-2 text-sm text-subtle">{t("jobs.unavailableDetail", { error: (focusServed ? error : otherError)?.message || (focusServed ? error : otherError)?.code || "" })}</p>}
      {!error && !loaded && <p className="text-sm text-subtle">{t("delegations.loading")}</p>}
      {loaded && rows.length === 0 && <p className="py-2 text-sm text-subtle">{t(`jobs.none.${scope}` as MessageKey)}</p>}
      {rows.length > 0 && <DataTable columns={shown} groups={groups} rowKey={(j) => j.key} foldPrefix="jobs" onRowContextMenu={(e, j) => contextMenu(() => menu(j))(e)} />}
      {focusServed && nextCursor && scope === "done" && (
        <button onClick={() => void refreshAllJobs(true)} disabled={loading} className="mt-2 px-2 text-xs text-accent hover:underline disabled:opacity-50">
          {loading ? t("delegations.loading") : t("jobs.loadMore")}
        </button>
      )}
      {!anyOps && loaded && <p className="mt-4 px-2 text-[11px] text-subtle">{t("jobs.listOnlyHint")}</p>}
      {marking && <MarkExternalDialog job={marking} hostId={marking.hostId} onClose={() => setMarking(null)} />}
    </>
  );
}

/** The 作业 page `jobs.page` (params `agent` / `scope` preset the filters: the capsule's 查看全部). */
export function JobsPage({ params }: { params: PageParams }) {
  const agent = params.agent;
  const scope = params.scope === "active" || params.scope === "queued" || params.scope === "done" ? params.scope : undefined;
  return (
    <PageBody>
      <JobList preset={agent} presetScope={scope} />
    </PageBody>
  );
}
