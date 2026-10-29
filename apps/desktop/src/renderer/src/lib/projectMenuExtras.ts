// Module rows in the sidebar project menu (lib/projectMenus; there is no project-menu slot): a module
// registers a builder on activate (e.g. 钉到托盘 for a project's overview page) and drops it on
// deactivate. Built when the menu opens, so a builder answers for the state then (null / false: no row).
// Shell code: names no feature.
import type { MenuEntry } from "./contextMenu";

export interface ProjectMenuTarget {
  hostId: string;
  projectId: string;
  name: string;
}

export type ProjectMenuExtra = (project: ProjectMenuTarget) => MenuEntry | null | false;

const extras = new Map<string, ProjectMenuExtra>();

/** Registers a builder under `id`; returns the unregister. */
export function registerProjectMenuExtra(id: string, build: ProjectMenuExtra): () => void {
  extras.set(id, build);
  return () => {
    if (extras.get(id) === build) extras.delete(id);
  };
}

/** The registered rows for `project` now (builders that throw are skipped). */
export function projectMenuExtras(project: ProjectMenuTarget): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const build of extras.values()) {
    try {
      const entry = build(project);
      if (entry) out.push(entry);
    } catch {
      /* a module's row never breaks the menu */
    }
  }
  return out;
}
