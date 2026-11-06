// Services: the owner's organised catalogue. Cards are the default; the details view keeps the
// operational table. Organisation lives on the cutex host, while the chosen view is per device.
import { useEffect, useMemo, useState } from "react";
import { isImeComposing } from "../../lib/ime";
import { MoreHorizontal, Star } from "lucide-react";
import type { ServicePatch, ServiceView, SidebarSnapshot } from "../../../../shared/ipc";
import { SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_ORGANIZE_FEATURE, SERVICES_PROJECT_SCOPE_FEATURE, SERVICES_IDLE_PRESETS_FEATURE } from "../../../../shared/servicesSettings";
import { useI18n, type MessageKey } from "../../i18n";
import { apiFor } from "../../bridge";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { openHostAgent, useListHosts, type ListHosts } from "../../lib/hostLists";
import { staleHostIds } from "../../lib/hostCounts";
import { useHostData } from "../../lib/useHostScope";
import { hostKey, type HostItem, type HostLook } from "../../lib/hostScope";
import { groupServices, openService, serviceMenu } from "../../lib/services";
import { projectColor } from "../../lib/sidebar";
import { projectIcon } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { serviceStatus } from "../../lib/status";
import { useApp } from "../../store";
import { Avatar } from "../../components/Avatar";
import { HostMark } from "../../components/HostMark";
import { MissingHosts, RowHost } from "../../components/HostListParts";
import { DataTable, type Column, type RowGroup } from "../../components/DataTable";
import { PageBody, PageToolbar } from "../../components/Page";
import { compareOrganizedServices, isOrganizeUnsupported, projectServiceList, serviceSection, type ServiceSection } from "./model";
import { ServiceLogs } from "../../components/ServiceLogs";
import { Segmented, Select } from "../../components/settings/Form";
import { ProjectLabel, StatusCell } from "../../components/StatusIcon";
import { ServiceCards, type ServiceCardRow } from "./ServiceCards";
import { ServiceOwnerFlyout } from "../../components/ServiceOwnerFlyout";
import { ServiceClaimStrip } from "../../components/ServiceClaimStrip";
import { ProjectBadge } from "../../components/ProjectBadge";
import { serviceScope, type ServiceScope } from "../../lib/projectServices";

type HealthScope = "all" | "running" | "down";
type Visibility = "active" | "hidden" | "archived";
type ViewMode = "cards" | "details";
type GroupMode = "purpose" | "project";
type ScopeFilter = "all" | ServiceScope;
type Row = HostItem<ServiceView>;
const VIEW_KEY = "cutex.services.view.v1";
const inHealth = (s: ServiceView, scope: HealthScope) => scope === "all" || (scope === "running" ? serviceStatus(s) === "running" : serviceStatus(s) !== "running");
const inScope = (s: ServiceView, filter: ScopeFilter) => filter === "all" || serviceScope(s) === filter;
const inVisibility = (s: ServiceView, visibility: Visibility) => (visibility === "archived" ? !!s.archived : visibility === "hidden" ? !!s.hidden && !s.archived : !s.hidden && !s.archived);

export function ServicesPage() {
  return <PageBody><ServicesTable /></PageBody>;
}

export function ProjectServicesTab({ hostId, projectId }: { hostId: string; projectId: string }) {
  return <ServicesTable project={{ hostId, projectId }} />;
}

function useProjectHosts(project: { hostId: string; projectId: string } | undefined, scope: ListHosts): ListHosts {
  const one = useHostData(project?.hostId ?? "");
  return useMemo(() => {
    if (!project) return scope;
    const data = one ? [one] : [];
    return { ...scope, data, missing: [], stale: staleHostIds(data), marks: false, multi: false };
  }, [project, scope, one]);
}

const sectionOrder: ServiceSection[] = ["foreground", "background", "unknown", "temporary"];

function purposeGroups(rows: Row[], t: (key: MessageKey) => string): RowGroup<Row>[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const section = serviceSection(row.item);
    const group = row.item.groupName?.trim() || "";
    const key = `${section}\u0000${group}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [as, ag] = a.split("\u0000") as [ServiceSection, string];
      const [bs, bg] = b.split("\u0000") as [ServiceSection, string];
      return sectionOrder.indexOf(as) - sectionOrder.indexOf(bs) || ag.localeCompare(bg);
    })
    .map(([key, grouped]) => {
      const [section, group] = key.split("\u0000") as [ServiceSection, string];
      return {
        key,
        label: <span className="inline-flex items-center gap-1.5"><span>{t(`services.purpose.${section}` as MessageKey)}</span>{group && <span className="font-normal text-subtle">/ {group}</span>}</span>,
        rows: grouped.sort((a, b) => compareOrganizedServices(a.item, b.item)),
      };
    });
}

function ServiceOrganizer({ row, hostName, done, error }: { row: Row; hostName: string; done(): void; error(message: string): void }) {
  const { t } = useI18n();
  const s = row.item;
  const patch = async (value: ServicePatch) => {
    try {
      await apiFor(row.hostId).patchService(s.slug, value);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      error(isOrganizeUnsupported(message) ? t("services.organize.upgrade", { host: hostName }) : message);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs">
      {s.lifetime === "persistent" && <Select width="w-32" label={t("services.purpose")} value={s.purpose === "foreground" || s.purpose === "background" ? s.purpose : "unknown"} options={(["foreground", "background", "unknown"] as const).map((purpose) => ({ value: purpose, label: t(`services.purpose.${purpose}`) }))} onChange={(purpose) => void patch({ purpose: purpose === "unknown" ? null : purpose })} />}
      <label className="grid gap-1 text-subtle">{t("services.group")}<input defaultValue={s.groupName ?? ""} maxLength={80}
        onBlur={(e) => { if (!isImeComposing(e)) void patch({ groupName: e.currentTarget.value.trim() || null }); }}
        onCompositionEnd={(e) => { if (e.currentTarget.ownerDocument.activeElement !== e.currentTarget) void patch({ groupName: e.currentTarget.value.trim() || null }); }}
        className="w-36 rounded border border-border bg-background px-2 py-1 text-foreground" /></label>
      <label className="grid min-w-52 flex-1 text-subtle">{t("services.note")}<input defaultValue={s.note ?? ""} maxLength={1000}
        onBlur={(e) => { if (!isImeComposing(e)) void patch({ note: e.currentTarget.value.trim() || null }); }}
        onCompositionEnd={(e) => { if (e.currentTarget.ownerDocument.activeElement !== e.currentTarget) void patch({ note: e.currentTarget.value.trim() || null }); }}
        className="w-full rounded border border-border bg-background px-2 py-1 text-foreground" /></label>
      <label className="grid gap-1 text-subtle">{t("services.sortOrder")}<input type="number" defaultValue={s.sortOrder ?? 0} onBlur={(e) => void patch({ sortOrder: Number(e.currentTarget.value) || 0 })} className="w-20 rounded border border-border bg-background px-2 py-1 text-foreground" /></label>
      <button onClick={done} className="rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-foreground">×</button>
    </div>
  );
}

function ServicesTable({ project }: { project?: { hostId: string; projectId: string } }) {
  const { t } = useI18n();
  const hosts = useProjectHosts(project, useListHosts());
  const projectId = project?.projectId;
  const refresh = useApp((s) => s.refreshServices);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<HealthScope>("all");
  const [visibility, setVisibility] = useState<Visibility>("active");
  const [view, setView] = useState<ViewMode>(() => (project ? "details" : localStorage.getItem(VIEW_KEY) === "details" ? "details" : "cards"));
  const [groupMode, setGroupMode] = useState<GroupMode>("purpose");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [logs, setLogs] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const served = useMemo(() => hosts.data.filter((d) => d.features.has("services")), [hosts.data]);
  const supportsOrganize = served.some((d) => d.features.has(SERVICES_ORGANIZE_FEATURE));
  // cutex services-project-scope: who manages a service (project / its registrant) is shown and filterable.
  const supportsScope = served.some((d) => d.features.has(SERVICES_PROJECT_SCOPE_FEATURE));
  const supported = served.length > 0;
  const unsupported = hosts.multi ? hosts.data.filter((d) => !d.features.has("services")).map((d) => hosts.look(d.hostId)).filter((h): h is HostLook => !!h) : [];
  const loaded = served.some((d) => d.services !== null);
  const all = useMemo(() => served.flatMap((d) => (projectId === undefined ? (d.services ?? []) : projectServiceList(d.services, projectId)).map((item): Row => ({ hostId: d.hostId, key: hostKey(d.hostId, item.slug), item }))), [served, projectId]);
  const sidebarOf = useMemo(() => new Map<string, SidebarSnapshot | null>(hosts.data.map((d) => [d.hostId, d.sidebar])), [hosts.data]);
  const icons = useUiPrefs().projectIcons;

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => { if (!project) localStorage.setItem(VIEW_KEY, view); }, [view, project]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => inVisibility(r.item, supportsOrganize ? visibility : "active")).filter((r) => inHealth(r.item, scope)).filter((r) => inScope(r.item, supportsScope ? scopeFilter : "all")).filter((r) => !q || `${r.item.displayName} ${r.item.slug} ${r.item.port} ${r.item.url} ${r.item.groupName ?? ""} ${r.item.note ?? ""}`.toLowerCase().includes(q));
  }, [all, query, scope, visibility, supportsOrganize, supportsScope, scopeFilter]);

  const purpose = useMemo(() => purposeGroups(rows, t), [rows, t]);
  const projectGroups = useMemo(() => {
    if (projectId !== undefined) return rows.length ? [{ key: projectId, label: null, rows: [...rows].sort((a, b) => compareOrganizedServices(a.item, b.item)) }] : [];
    return served.flatMap((d) => {
      const mine = new Map(rows.filter((r) => r.hostId === d.hostId).map((r) => [r.item, r] as const));
      const look = hosts.look(d.hostId);
      return groupServices([...mine.keys()], d.sidebar?.projects?.projects ?? []).map((g) => ({ key: hosts.multi ? hostKey(d.hostId, g.project?.project_id ?? "") : (g.project?.project_id ?? ""), label: <span className="inline-flex items-center gap-1.5">{hosts.marks && look && <HostMark host={look} />}{g.project ? <ProjectLabel icon={projectIcon(icons, d.hostId, g.project.project_id)} name={g.project.presentation.display_name} badge={g.project.presentation.badge_label} color={projectColor(g.project.presentation.color)} /> : t("services.noProject")}</span>, rows: g.services.map((x) => mine.get(x)!).sort((a, b) => compareOrganizedServices(a.item, b.item)) }));
    });
  }, [rows, served, hosts, t, icons, projectId]);
  const groups = projectId === undefined && groupMode === "purpose" ? purpose : projectGroups;

  const toggleSet = (write: (next: Set<string>) => void, current: ReadonlySet<string>, key: string) => { const next = new Set(current); if (!next.delete(key)) next.add(key); write(next); };
  const toggleLogs = (key: string) => toggleSet(setLogs, logs, key);
  const toggleEditing = (key: string) => toggleSet(setEditing, editing, key);
  const stale = (r: Row) => hosts.stale.has(r.hostId);
  const menu = (r: Row, organization: Parameters<typeof serviceMenu>[6] = []) => serviceMenu(r.item, t, setError, () => toggleLogs(r.key), r.hostId, view === "details" ? () => toggleEditing(r.key) : undefined, organization, <ServiceOwnerFlyout service={r.item} hostId={r.hostId} onError={setError} />);
  const ownerOf = ({ hostId, item: s }: Row) => {
    if (!s.ownerCutexSessionId) return null;
    const sidebar = sidebarOf.get(hostId);
    const active = sidebar?.active.find((x) => x.cutexSessionId === s.ownerCutexSessionId);
    const retired = active ? undefined : sidebar?.retired.find((x) => x.cutexSessionId === s.ownerCutexSessionId);
    return active ? { row: active, retired: false } : retired ? { row: retired, retired: true } : null;
  };
  /** A project-scope service: its project (from the host's sidebar) and that project's current Director. */
  const projectOf = ({ hostId, item: s }: Row) => {
    if (serviceScope(s) !== "project" || !s.projectId) return null;
    const sidebar = sidebarOf.get(hostId);
    const project = sidebar?.projects?.projects.find((p) => p.project_id === s.projectId) ?? null;
    const directorId = project?.director_cutex_session_id ?? null;
    const director = directorId ? sidebar?.active.find((x) => x.cutexSessionId === directorId)?.displayName ?? project?.director_name ?? null : null;
    return { id: s.projectId, name: project?.presentation.display_name || s.projectId, badge: project?.presentation.badge_label, color: projectColor(project?.presentation.color ?? ""), director };
  };
  /** The 负责人 cell / card line's tooltip for a project service: the registrant stays visible there. */
  const scopeTitle = (r: Row) => {
    const p = projectOf(r);
    if (!p) return undefined;
    const registrant = ownerOf(r)?.row.displayName ?? r.item.ownerCutexSessionId;
    return [t("services.ownerScope.projectTitle", { project: p.name }), p.director && t("services.ownerScope.directorTitle", { name: p.director }), registrant && t("services.owner", { name: registrant })].filter(Boolean).join(" · ");
  };
  const count = (sc: HealthScope) => all.filter((r) => inVisibility(r.item, supportsOrganize ? visibility : "active") && inHealth(r.item, sc) && inScope(r.item, supportsScope ? scopeFilter : "all")).length;
  const organizable = (row: Row) => served.some((host) => host.hostId === row.hostId && host.features.has(SERVICES_ORGANIZE_FEATURE));
  const tileEnabled = (row: Row) => served.some((host) => host.hostId === row.hostId && host.features.has("service-tiles"));
  const idleEnabled = (row: Row) => served.some((host) => host.hostId === row.hostId && host.features.has(SERVICES_IDLE_PRESETS_FEATURE));
  const ttlEnabled = (row: Row) => served.some((host) => host.hostId === row.hostId && host.features.has(SERVICES_EPHEMERAL_TTL_FEATURE));

  const bulk = async (kind: "hide" | "show" | "archive" | "restore") => {
    setError(null);
    try {
      await Promise.all(all.filter((row) => selected.has(row.key)).map((row) => kind === "archive" || kind === "restore" ? apiFor(row.hostId).serviceAction(row.item.slug, kind) : apiFor(row.hostId).patchService(row.item.slug, { hidden: kind === "hide" })));
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const columns: Column<Row>[] = [
    ...(supportsOrganize ? [{ key: "select", header: "", width: "2rem", cell: (r: Row) => organizable(r) ? <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggleSet(setSelected, selected, r.key)} aria-label={r.item.displayName || r.item.slug} /> : null }] : []),
    { key: "status", header: t("table.status"), width: hosts.marks ? "7.5rem" : "6.5rem", cell: (r) => <span className={`flex min-w-0 items-center gap-1.5 ${stale(r) ? "opacity-50" : ""}`}><RowHost host={hosts.look(r.hostId)} show={hosts.marks} /><StatusCell kind={serviceStatus(r.item)} label={t(`services.health.${r.item.health}` as MessageKey)} /></span> },
    { key: "name", header: t("table.service"), cell: (r) => <button disabled={stale(r) || r.item.archived} onClick={() => void openService(r.item, r.hostId).catch((e: unknown) => setError(String(e)))} title={r.item.url} className="flex max-w-full items-center gap-1 truncate text-left enabled:hover:underline disabled:text-subtle">{r.item.starred && <Star size={12} className="fill-current text-warn-text" />}<span className="truncate">{r.item.displayName || r.item.slug}</span></button> },
    { key: "retention", header: t("services.retention"), width: "7rem", cell: (r) => <span className="text-xs text-muted">{r.item.lifetime === "persistent" ? t(`services.purpose.${serviceSection(r.item)}` as MessageKey) : !ttlEnabled(r) ? "—" : r.item.effectiveIdleTtlMinutes == null ? t("services.idleTtl.0") : `${r.item.effectiveIdleTtlMinutes}m`}</span> },
    { key: "owner", header: t("table.owner"), width: "10rem", cell: (r) => { const p = projectOf(r); if (p) return <span data-service-scope="project" title={scopeTitle(r)} className="flex min-w-0 items-center gap-1 text-xs text-muted"><ProjectBadge badge={p.badge || p.name.slice(0, 1)} color={p.color} size="sm" /><span className="truncate">{t("services.ownerScope.project", { project: p.name })}</span></span>; const owner = ownerOf(r); return owner ? <button onClick={() => openHostAgent(r.hostId, owner.row.cutexSessionId)} className="flex min-w-0 items-center gap-1 text-xs text-muted hover:text-foreground"><Avatar name={owner.row.displayName} avatar={owner.row.avatar} seed={owner.row.cutexSessionId} size={16} /><span className="truncate">{owner.row.displayName}</span></button> : <span className="text-xs text-subtle">—</span>; } },
    { key: "url", header: t("services.url"), width: "13rem", cell: (r) => <span className="block truncate font-mono text-caption/[inherit] text-subtle" title={r.item.url}>{r.item.url}</span> },
    { key: "port", header: t("table.port"), width: "4rem", align: "right", cell: (r) => <span className="font-mono text-caption/[inherit] text-subtle">{r.item.port ? `:${r.item.port}` : "—"}</span> },
    ...(served.some((host) => host.features.has(SERVICES_IDLE_PRESETS_FEATURE)) ? [{ key: "idleStop", header: t("services.idleStop"), width: "11rem", cell: (r: Row) => idleEnabled(r) && r.item.runtime === "managed" && r.item.lifetime === "persistent" ? <span title={t("services.idleStop.hint")} className="text-xs text-muted"><span>{t(`services.idleStop.${r.item.idleStopPreset ?? "forever"}`)}</span>{(r.item.stoppedIdleAt ?? r.item.idleStopAt) && <span className="block text-caption text-subtle">{new Date((r.item.stoppedIdleAt ?? r.item.idleStopAt)!).toLocaleString()}</span>}{r.item.idleWakeFailedAt && <span className="block text-caption text-warn-text">{t("services.idleWakeFailed")}</span>}</span> : <span>—</span> }] : []),
    { key: "traffic", header: t("services.lastTraffic"), width: "8rem", cell: (r) => <span className="text-caption/[inherit] text-subtle">{r.item.lastTrafficAt ? new Date(r.item.lastTrafficAt).toLocaleString() : "—"}</span> },
    { key: "menu", header: "", width: "2rem", cell: (r) => <button disabled={stale(r)} onClick={(e) => openMenuFrom(e.currentTarget, menu(r))} className="rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground"><MoreHorizontal size={14} /></button> },
  ];

  return (
    <>
      <PageToolbar>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("services.search")} className="mr-auto w-48 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
        {supportsOrganize && <Select<Visibility> width="w-24" label={t("services.visibility.active")} value={visibility} onChange={setVisibility} options={(["active", "hidden", "archived"] as const).map((v) => ({ value: v, label: t(`services.visibility.${v}`) }))} />}
        {!project && <Segmented<ViewMode> value={view} onChange={setView} options={(["cards", "details"] as const).map((v) => ({ value: v, label: t(`services.view.${v}`) }))} />}
        {supportsScope && <Select<ScopeFilter> width="w-28" label={t("services.ownerScope.filter")} value={scopeFilter} onChange={setScopeFilter} options={(["all", "project", "session"] as const).map((v) => ({ value: v, label: t(`services.ownerScope.filter.${v}`) }))} />}
        {view === "details" && !project && <Select<GroupMode> width="w-28" label={t("services.group")} value={groupMode} onChange={setGroupMode} options={[{ value: "purpose", label: t("services.purpose") }, { value: "project", label: t("projects.title") }]} />}
        <Segmented<HealthScope> value={scope} onChange={setScope} options={(["all", "running", "down"] as const).map((s) => ({ value: s, label: `${t(`services.scope.${s}` as MessageKey)} ${count(s)}` }))} />
      </PageToolbar>
      {selected.size > 0 && supportsOrganize && <div className="mb-3 flex items-center gap-2 text-xs">{visibility === "active" && <button className="rounded border border-border px-2 py-1 hover:bg-surface-2" onClick={() => void bulk("hide")}>{t("services.bulk.hide")}</button>}{visibility !== "archived" && <button className="rounded border border-border px-2 py-1 hover:bg-surface-2" onClick={() => void bulk("archive")}>{t("services.bulk.archive")}</button>}{visibility === "hidden" && <button className="rounded border border-border px-2 py-1 hover:bg-surface-2" onClick={() => void bulk("show")}>{t("services.bulk.show")}</button>}{visibility === "archived" && <button className="rounded border border-border px-2 py-1 hover:bg-surface-2" onClick={() => void bulk("restore")}>{t("services.bulk.restore")}</button>}</div>}
      {hosts.multi && <MissingHosts hosts={hosts.missing} unsupported={unsupported} />}
      {error && <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {project && <ServiceClaimStrip hostId={project.hostId} projectId={project.projectId} className="mb-3" />}
      {!supported && hosts.missing.length === 0 && <p className="text-sm text-subtle">{t("services.unsupported")}</p>}
      {supported && !loaded && <p className="text-sm text-subtle">…</p>}
      {loaded && all.length === 0 && <p className="text-sm text-subtle">{t(projectId === undefined ? "services.none" : "services.projectNone")}</p>}
      {all.length > 0 && groups.length === 0 && <p className="text-sm text-subtle">{t("services.noMatch")}</p>}
      {rows.length > 0 && view === "cards" && !project && <ServiceCards rows={rows as ServiceCardRow[]} hostName={(row) => hosts.look(row.hostId)?.label ?? row.hostId} ownerName={(row) => { const p = projectOf(row); return p ? t("services.ownerScope.project", { project: p.name }) : ownerOf(row)?.row.displayName ?? t("services.reveal.someAgent"); }} ownerTitle={scopeTitle} stale={stale} tileEnabled={tileEnabled} organizable={organizable} menu={menu} refresh={refresh} error={setError} />}
      {groups.length > 0 && (view === "details" || !!project) && <DataTable columns={columns} groups={groups} rowKey={(r) => r.key} foldPrefix="services" onRowContextMenu={(e, r) => !stale(r) && contextMenu(() => menu(r))(e)} after={(r) => editing.has(r.key) ? <tr className="border-b border-border/60"><td colSpan={columns.length} className="px-2 py-2"><ServiceOrganizer row={r} hostName={hosts.look(r.hostId)?.label ?? r.hostId} done={() => toggleEditing(r.key)} error={setError} /></td></tr> : logs.has(r.key) ? <tr className="border-b border-border/60"><td colSpan={columns.length} className="px-2 py-2"><ServiceLogs slug={r.item.slug} hostId={r.hostId} /></td></tr> : null} />}
    </>
  );
}
