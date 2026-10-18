// Services (docs/WAVELINE.md "cutex services"): the web services agents started, in the same light
// table as Tasks — status column (problems first), projects as foldable group rows. Click a name
// to open it; the rest is in ⋯ / the context menu. Multi-host (RFC §9.2): the scope's connected hosts,
// one project group per (host, project) with the host chip, a host dot on each row; actions go to the
// row's host. The 项目 page's 服务 tab (`project.tab`, §21) is the same table for one project of one
// host: no project group rows, no host marks.
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ServiceView, SidebarSnapshot } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { openHostAgent, useListHosts, type ListHosts } from "../../lib/hostLists";
import { staleHostIds } from "../../lib/hostCounts";
import { useHostData } from "../../lib/useHostScope";
import { hostKey, type HostItem, type HostLook } from "../../lib/hostScope";
import { groupServices, openService, serviceMenu } from "../../lib/services";
import { projectColor } from "../../lib/sidebar";
import { projectIcon } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { serviceStatus, statusRank } from "../../lib/status";
import { useApp } from "../../store";
import { Avatar } from "../../components/Avatar";
import { HostMark } from "../../components/HostMark";
import { MissingHosts, RowHost } from "../../components/HostListParts";
import { DataTable, type Column } from "../../components/DataTable";
import { PageBody, PageToolbar } from "../../components/Page";
import { projectServiceList } from "./model";
import { ServiceLogs } from "../../components/ServiceLogs";
import { Segmented } from "../../components/settings/Form";
import { ProjectLabel, StatusCell } from "../../components/StatusIcon";

type Scope = "all" | "running" | "down";
type Row = HostItem<ServiceView>;
const inScope = (s: ServiceView, scope: Scope) => scope === "all" || (scope === "running" ? serviceStatus(s) === "running" : serviceStatus(s) !== "running");

export function ServicesPage() {
  return (
    <PageBody>
      <ServicesTable />
    </PageBody>
  );
}

/** The 项目 page's 服务 tab: this project's services on its host. */
export function ProjectServicesTab({ hostId, projectId }: { hostId: string; projectId: string }) {
  return <ServicesTable project={{ hostId, projectId }} />;
}

/** One project of one host as the table's only host (no marks, no notices about other hosts). */
function useProjectHosts(project: { hostId: string; projectId: string } | undefined, scope: ListHosts): ListHosts {
  const one = useHostData(project?.hostId ?? "");
  return useMemo(() => {
    if (!project) return scope;
    const data = one ? [one] : [];
    return { ...scope, data, missing: [], stale: staleHostIds(data), marks: false, multi: false };
  }, [project, scope, one]);
}

/** `project`: only that project's services of that host (the 项目 page tab); otherwise the whole 服务 page. */
function ServicesTable({ project }: { project?: { hostId: string; projectId: string } }) {
  const { t } = useI18n();
  const hosts = useProjectHosts(project, useListHosts());
  const projectId = project?.projectId;
  const refresh = useApp((s) => s.refreshServices);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [logs, setLogs] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Hosts whose cutex has the services registry (the page shows when any host of the scope has it).
  const served = useMemo(() => hosts.data.filter((d) => d.features.has("services")), [hosts.data]);
  const supported = served.length > 0;
  const unsupported = hosts.multi ? hosts.data.filter((d) => !d.features.has("services")).map((d) => hosts.look(d.hostId)).filter((h): h is HostLook => !!h) : [];
  const loaded = served.some((d) => d.services !== null);
  const all = useMemo(
    () => served.flatMap((d) => (projectId === undefined ? (d.services ?? []) : projectServiceList(d.services, projectId)).map((item): Row => ({ hostId: d.hostId, key: hostKey(d.hostId, item.slug), item }))),
    [served, projectId],
  );
  const sidebarOf = useMemo(() => new Map<string, SidebarSnapshot | null>(hosts.data.map((d) => [d.hostId, d.sidebar])), [hosts.data]);
  const icons = useUiPrefs().projectIcons;

  // The focus host's list is (re)read here; the other hosts' are followed by the store (byHost).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = all.filter((r) => inScope(r.item, scope)).filter((r) => !q || `${r.item.displayName} ${r.item.slug} ${r.item.port}`.toLowerCase().includes(q));
    const byStatus = (x: Row, y: Row) => statusRank(serviceStatus(x.item)) - statusRank(serviceStatus(y.item));
    // One project: a single group without a header row (projectServiceList already sorted it).
    if (projectId !== undefined) return rows.length ? [{ key: projectId, label: null, rows }] : [];
    // Per host (switcher order), its projects in its sidebar order; the group key carries the host.
    return served.flatMap((d) => {
      const mine = new Map(rows.filter((r) => r.hostId === d.hostId).map((r) => [r.item, r] as const));
      const look = hosts.look(d.hostId);
      return groupServices([...mine.keys()], d.sidebar?.projects?.projects ?? []).map((g) => ({
        key: hosts.multi ? hostKey(d.hostId, g.project?.project_id ?? "") : (g.project?.project_id ?? ""),
        label: (
          <span className="inline-flex items-center gap-1.5">
            {hosts.marks && look && <HostMark host={look} />}
            {g.project ? <ProjectLabel icon={projectIcon(icons, d.hostId, g.project.project_id)} name={g.project.presentation.display_name} badge={g.project.presentation.badge_label} color={projectColor(g.project.presentation.color)} /> : t("services.noProject")}
          </span>
        ),
        // groupServices sorts by name; keep problems first inside each project.
        rows: g.services.map((x) => mine.get(x)!).sort(byStatus),
      }));
    });
  }, [all, served, hosts, query, scope, t, icons, projectId]);

  const toggleLogs = (key: string) =>
    setLogs((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const stale = (r: Row) => hosts.stale.has(r.hostId);
  const menu = (r: Row) => serviceMenu(r.item, t, setError, () => toggleLogs(r.key), r.hostId);
  const ownerOf = ({ hostId, item: s }: Row) => {
    if (!s.ownerCutexSessionId) return null;
    const sidebar = sidebarOf.get(hostId);
    const active = sidebar?.active.find((x) => x.cutexSessionId === s.ownerCutexSessionId);
    const retired = active ? undefined : sidebar?.retired.find((x) => x.cutexSessionId === s.ownerCutexSessionId);
    return active ? { row: active, retired: false } : retired ? { row: retired, retired: true } : null;
  };
  const count = (sc: Scope) => all.filter((r) => inScope(r.item, sc)).length;

  const columns: Column<Row>[] = [
    {
      key: "status",
      header: t("table.status"),
      width: hosts.marks ? "7.5rem" : "6.5rem",
      cell: (r) => {
        const s = r.item;
        const kind = serviceStatus(s);
        const restarts = s.process?.restarts ?? 0;
        return (
          <span className={`flex min-w-0 items-center gap-1.5 ${stale(r) ? "opacity-50" : ""}`}>
            <RowHost host={hosts.look(r.hostId)} show={hosts.marks} />
            <StatusCell kind={kind} label={kind === "error" && restarts > 0 ? t("services.restarts", { n: restarts }) : t(`services.health.${s.health}` as MessageKey)} />
          </span>
        );
      },
    },
    {
      key: "name",
      header: t("table.service"),
      cell: (r) => (
        <button disabled={stale(r)} onClick={() => void openService(r.item, r.hostId).catch((e: unknown) => setError(String(e)))} title={r.item.url} className="block max-w-full truncate text-left enabled:hover:underline disabled:text-subtle">
          {r.item.displayName || r.item.slug}
        </button>
      ),
    },
    {
      key: "owner",
      header: t("table.owner"),
      width: "11rem",
      cell: (r) => {
        const owner = ownerOf(r);
        if (!owner) return <span className="text-xs text-subtle">—</span>;
        return (
          <button onClick={() => openHostAgent(r.hostId, owner.row.cutexSessionId)} className={`flex min-w-0 items-center gap-1 text-xs hover:text-foreground ${owner.retired ? "text-subtle" : "text-muted"}`} title={owner.retired ? t("services.ownerRetired") : undefined}>
            <Avatar name={owner.row.displayName} avatar={owner.row.avatar} seed={owner.row.cutexSessionId} size={16} minor />
            <span className="truncate">{owner.row.displayName}</span>
            {owner.retired && <span className="shrink-0 text-[10px] text-warn-text">{t("services.retiredTag")}</span>}
          </button>
        );
      },
    },
    { key: "port", header: t("table.port"), width: "5rem", align: "right", cell: (r) => <span className="font-mono text-[11px] text-subtle">:{r.item.port}</span> },
    {
      key: "menu",
      header: "",
      width: "2rem",
      cell: (r) => (
        <button disabled={stale(r)} onClick={(e) => openMenuFrom(e.currentTarget, menu(r))} className="rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground">
          <MoreHorizontal size={14} />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageToolbar>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("services.search")} className="mr-auto w-48 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
        <Segmented<Scope> value={scope} onChange={setScope} options={(["all", "running", "down"] as const).map((s) => ({ value: s, label: `${t(`services.scope.${s}` as MessageKey)} ${count(s)}` }))} />
      </PageToolbar>
      {hosts.multi && <MissingHosts hosts={hosts.missing} unsupported={unsupported} />}
      {error && <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {!supported && hosts.missing.length === 0 && <p className="text-sm text-subtle">{t("services.unsupported")}</p>}
      {supported && !loaded && <p className="text-sm text-subtle">…</p>}
      {loaded && all.length === 0 && <p className="text-sm text-subtle">{t(projectId === undefined ? "services.none" : "services.projectNone")}</p>}
      {all.length > 0 && groups.length === 0 && <p className="text-sm text-subtle">{t("services.noMatch")}</p>}
      {groups.length > 0 && (
        <DataTable
          columns={columns}
          groups={groups}
          rowKey={(r) => r.key}
          foldPrefix="services"
          onRowContextMenu={(e, r) => !stale(r) && contextMenu(() => menu(r))(e)}
          after={(r) =>
            logs.has(r.key) ? (
              <tr className="border-b border-border/60">
                <td colSpan={columns.length} className="px-2 py-2">
                  <ServiceLogs slug={r.item.slug} hostId={r.hostId} />
                </td>
              </tr>
            ) : null
          }
        />
      )}
    </>
  );
}
