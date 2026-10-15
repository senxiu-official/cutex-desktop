// Breadcrumb of the 项目 page: 项目 › <badge> <name> <id> (项目 › 新建项目 on the form).
import { useI18n } from "../../i18n";
import { projectIcon } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { hostKey } from "../../lib/hostKeys";
import { sidebarOf, useApp } from "../../store";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { ProjectBadge } from "../../components/ProjectBadge";
import type { PageCrumb, PageParams } from "../slots";

const NEW = "__new__";

export function useProjectsTitle(params: PageParams): readonly PageCrumb[] {
  const { t } = useI18n();
  const focus = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  // The project's own host (a host page: `params.host`), not always the focus host.
  const host = params.host ?? focus;
  const projects = useApp((s) => sidebarOf(s, host)?.projects?.projects);
  const projectId = params.project ?? null;
  const creating = projectId === NEW;
  const p = creating ? null : (projects?.find((x) => x.project_id === projectId) ?? projects?.[0]);
  const prefs = useUiPrefs();
  const remark = p ? (prefs.projectRemarks[hostKey(host, p.project_id)] ?? "") : "";
  const leaf = creating ? t("projects.new") : p?.presentation.display_name;
  if (!leaf) return [{ text: t("projects.nav") }];
  return [
    { text: t("projects.nav"), to: { page: "projects.page", params: { ...(p ? { project: p.project_id } : {}), ...(params.host ? { host: params.host } : {}) } } },
    {
      text: leaf,
      lead: p && <ProjectBadge icon={projectIcon(prefs.projectIcons, host, p.project_id)} badge={p.presentation.badge_label || p.presentation.display_name.slice(0, 1)} color={p.presentation.color} />,
      trail: p && (
        <>
          <span className="shrink-0 font-mono text-[11px] font-normal text-subtle">{p.project_id}</span>
          {remark && (
            <span className="ml-1 max-w-[24rem] min-w-0 truncate text-[11px] font-normal text-subtle" data-project-remark="" title={`${remark}\n${t("remark.tooltip")}`}>
              · {remark}
            </span>
          )}
        </>
      ),
    },
  ];
}
