// Pure helpers of the 服务 module (project tab, docs/desktop-modules.md §21).
import type { ServiceView } from "../../../../shared/ipc";
import { serviceStatus, statusRank } from "../../lib/status";

/** One project's services: problems first (same ranks as the 服务 page), then by name. */
export function projectServiceList(services: readonly ServiceView[] | null | undefined, projectId: string): ServiceView[] {
  return (services ?? [])
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => statusRank(serviceStatus(a)) - statusRank(serviceStatus(b)) || (a.displayName || a.slug).localeCompare(b.displayName || b.slug));
}
