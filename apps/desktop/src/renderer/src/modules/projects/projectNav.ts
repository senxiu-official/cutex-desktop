// Links inside the 项目 page (other code opens it with services.ui.openPage("projects.page", …)).
import { useApp } from "../../store";
import { services } from "../app";

/**
 * Selects a project (or "__new__" = the 新建 form) and optionally a tab (a core ProjectTab or a
 * module's `project.tab` name, lib/projectTabs.ts). `hostId`: the project's host
 * (multi-host P1: the page lists every host of the scope; the focus host needs no param).
 */
export function openProject(project: string | null, tab?: string, hostId?: string) {
  const focus = useApp.getState().hosts?.active ?? "local";
  services.ui.openPage("projects.page", { ...(project ? { project } : {}), ...(tab ? { tab } : {}), ...(hostId && hostId !== focus ? { host: hostId } : {}) });
}
