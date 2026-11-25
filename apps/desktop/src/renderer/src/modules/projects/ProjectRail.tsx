// 项目 page left list (owner 2026-11-25, option B with option A's rows): 全部项目 (the table), 新建项目, then 最近打开 —
// the projects opened on this device (recentProjects.ts), else the most recently active ones. A row: the icon in one
// slot for all rows (names line up), the name, 「主管 · ● 在线/成员」 under it, 需要你 at the end; no host dot (it read
// as a status) — the host is in the tooltip and in the table.
import { LayoutList, Plus } from "lucide-react";
import { useI18n } from "../../i18n";
import { SubNav, SUBNAV_ITEM, SUBNAV_OFF, SUBNAV_ON } from "../../components/Page";
import { EntityIcon } from "../../components/EntityIcon";
import { entityIconSlot, projectEntity } from "../../lib/entityIcon";
import { useProjectIcons } from "../../lib/projectIconSync";
import { useHostScope } from "../../lib/useHostScope";
import { sortProjects, type ProjectFacts } from "./projectTable";
import { useRecentProjects } from "./recentProjects";

/** Rows under 最近打开. */
const RECENT_SHOWN = 8;

export function ProjectRail({ facts, selected, onAll, onNew, onOpen }: { facts: readonly ProjectFacts[]; /** "all", "new", or the shown project's key. */ selected: string; onAll(): void; onNew(): void; onOpen(p: ProjectFacts): void }) {
  const { t, locale } = useI18n();
  const icons = useProjectIcons();
  const scope = useHostScope();
  const recent = useRecentProjects();
  const active = facts.filter((p) => !p.archived);
  const byKey = new Map(facts.map((p) => [p.key, p]));
  const opened = recent.map((k) => byKey.get(k)).filter((p): p is ProjectFacts => !!p);
  // The shown project is always in the list (opened from elsewhere, or archived).
  const current = byKey.get(selected);
  const fromHistory = opened.length > 0;
  const rows = (fromHistory ? opened : sortProjects(active, "activity", locale)).slice(0, RECENT_SHOWN);
  if (current && !rows.includes(current)) rows.unshift(current);
  const hosts = new Set(active.map((p) => p.hostId)).size;
  // The same name on two hosts (e.g. a project on this machine and on a workstation): the host leads the second line.
  const names = new Map<string, number>();
  for (const p of rows) names.set(p.name, (names.get(p.name) ?? 0) + 1);
  const hostFirst = (p: ProjectFacts) => ((names.get(p.name) ?? 0) > 1 ? `${scope.host(p.hostId)?.label ?? p.hostId} · ` : "");
  const slot = entityIconSlot(rows.map((p) => projectEntity(p.hostId, p.project)), icons, 22);
  return (
    <SubNav>
      <button onClick={onAll} className={`press ${SUBNAV_ITEM} ${selected === "all" ? SUBNAV_ON : SUBNAV_OFF}`} data-projects-rail="all">
        <span className="flex shrink-0 items-center justify-center text-subtle" style={{ width: slot }}><LayoutList size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui/[inherit] font-medium">{t("projects.all.nav")}</span>
          <span className="block truncate text-caption/[inherit] text-subtle">{hosts > 1 ? t("projects.all.navHosts", { n: active.length, hosts }) : t("projects.all.navCount", { n: active.length })}</span>
        </span>
      </button>
      <button onClick={onNew} className={`press mb-1 ${SUBNAV_ITEM} ${selected === "new" ? SUBNAV_ON : SUBNAV_OFF}`} data-projects-rail="new">
        <span className="flex shrink-0 items-center justify-center text-subtle" style={{ width: slot }}><Plus size={15} /></span>
        {t("projects.new")}
      </button>
      {rows.length > 0 && <div className="px-2 pt-2 pb-1 text-caption/[inherit] font-semibold text-subtle">{t(fromHistory ? "projects.recent" : "projects.recentActive")}</div>}
      {rows.map((p) => {
        const who = p.directorName ?? t("projects.all.noDirector");
        const count = p.online === null ? t("projects.members", { n: p.members }) : t("projects.teamOnline", { online: p.online, total: p.members });
        return (
          <button key={p.key} onClick={() => onOpen(p)} title={scope.hostsInScope.length > 1 ? `${p.name} · ${scope.host(p.hostId)?.label ?? p.hostId}` : undefined} className={`press ${SUBNAV_ITEM} ${selected === p.key ? SUBNAV_ON : SUBNAV_OFF}`} data-projects-rail={p.key}>
            <span className="flex shrink-0 items-center justify-center" style={{ width: slot }} data-project-icon-slot=""><EntityIcon entity={projectEntity(p.hostId, p.project)} size={22} slot={slot} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui/[inherit] font-medium">{p.name}</span>
              <span className="block truncate text-caption/[inherit] text-subtle">{hostFirst(p)}{p.archived ? t("projects.all.archivedTag") : `${who} · ${count}`}</span>
            </span>
            {!!p.needsYou && <span className="shrink-0 rounded-full bg-warn/20 px-1.5 text-xs font-semibold text-warn tabular-nums" title={t("projects.all.col.needsYou")}>{p.needsYou}</span>}
          </button>
        );
      })}
    </SubNav>
  );
}
