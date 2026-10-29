// Device-local last project for the context-following project view.
import { sidebarOf, useApp } from "../../store";
import type { ViewParams } from "./model";

type State = ReturnType<typeof useApp.getState>;
export type ProjectContext = Required<ViewParams>;
const KEY = "cutex-desktop.project-view.last-project";
let last: ProjectContext | null = null;

export function selectedProject(s: State): ProjectContext | null {
  const hostId = s.selectedHost ?? s.hosts?.active ?? "local";
  const projectId = s.selectedId ? sidebarOf(s, hostId)?.hostRows[s.selectedId]?.projectId : null;
  return projectId ? { hostId, projectId } : null;
}

export function rememberProject(project: ProjectContext): void {
  if (last?.hostId === project.hostId && last.projectId === project.projectId) return;
  last = project;
  try { localStorage.setItem(KEY, JSON.stringify(project)); } catch { /* local preference only */ }
}

export function contextProject(s: State): ProjectContext | null {
  const focused = selectedProject(s);
  if (focused) return focused;
  return last && sidebarOf(s, last.hostId)?.projects?.projects.some((p) => p.project_id === last!.projectId) ? last : null;
}

export function startProjectContext(): () => void {
  last = null;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof stored?.hostId === "string" && typeof stored?.projectId === "string") last = stored;
  } catch { /* unset or invalid preference */ }
  const update = (s: State) => { const project = selectedProject(s); if (project) rememberProject(project); };
  update(useApp.getState());
  return useApp.subscribe(update);
}
