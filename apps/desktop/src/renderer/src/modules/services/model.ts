// Pure helpers of the 服务 module (project tab, docs/desktop-modules.md §21).
import type { ServiceView } from "../../../../shared/ipc";
import { serviceStatus, statusRank } from "../../lib/status";

export type ServiceSection = "foreground" | "background" | "unknown" | "temporary";
export const serviceSectionOrder: readonly ServiceSection[] = ["foreground", "background", "unknown", "temporary"];

/** Old hosts can advertise organisation while rejecting its newer PATCH fields. */
export function serviceOrganizationError(reason: unknown, upgradeMessage: string): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /(?:unknown|unsupported|unrecognized|unexpected)\s+(?:field|parameter)/i.test(message)
    && /\b(?:sort_?order|group_?name|purpose|lifetime)\b/i.test(message) ? upgradeMessage : message;
}

export interface OrganizedServiceRow {
  key: string;
  item: ServiceView;
}

export interface OrganizedServiceGroup<T extends OrganizedServiceRow> {
  key: string;
  name: string;
  rows: T[];
}

export interface OrganizedServiceSection<T extends OrganizedServiceRow> {
  section: ServiceSection;
  groups: OrganizedServiceGroup<T>[];
}

/** Purpose applies only to persistent services; future values stay safely uncategorised. */
export function serviceSection(service: ServiceView): ServiceSection {
  if (service.lifetime !== "persistent") return "temporary";
  if (service.purpose === "foreground" || service.purpose === "background") return service.purpose;
  return "unknown";
}

/** Owner order inside a purpose/custom-group section. */
export function compareOrganizedServices(a: ServiceView, b: ServiceView): number {
  return Number(!!b.starred) - Number(!!a.starred) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || statusRank(serviceStatus(a)) - statusRank(serviceStatus(b)) || (a.displayName || a.slug).localeCompare(b.displayName || b.slug);
}

/** Purpose sections and custom groups in the owner's persisted service order. */
export function organizedServiceSections<T extends OrganizedServiceRow>(rows: readonly T[]): OrganizedServiceSection<T>[] {
  const sections = new Map<ServiceSection, Map<string, T[]>>();
  for (const row of rows) {
    const section = serviceSection(row.item);
    const name = row.item.groupName?.trim() || "";
    const groups = sections.get(section) ?? new Map<string, T[]>();
    groups.set(name, [...(groups.get(name) ?? []), row]);
    sections.set(section, groups);
  }
  return serviceSectionOrder.flatMap((section) => {
    const groups = sections.get(section);
    if (!groups) return [];
    const organized = [...groups.entries()].map(([name, grouped]) => ({
      key: `${section}\u0000${name}`,
      name,
      rows: grouped.sort((a, b) => compareOrganizedServices(a.item, b.item)),
    }));
    organized.sort((a, b) => {
      const first = (group: OrganizedServiceGroup<T>) => Math.min(...group.rows.map((row) => row.item.sortOrder ?? 0));
      return first(a) - first(b) || Number(!!a.name) - Number(!!b.name) || a.name.localeCompare(b.name);
    });
    return [{ section, groups: organized }];
  });
}

/**
 * A cutex older than the owner fields (`services-organize`, r258) refuses them with serde's
 * `unknown field \`sortOrder\``: the page says the host needs an upgrade instead of that text.
 */
export function isOrganizeUnsupported(message: string): boolean {
  return /unknown field\W+(purpose|groupName|starred|sortOrder|note|hidden|archived)\b/.test(message);
}

/** One project's services: problems first (same ranks as the 服务 page), then by name. */
export function projectServiceList(services: readonly ServiceView[] | null | undefined, projectId: string): ServiceView[] {
  return (services ?? [])
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => statusRank(serviceStatus(a)) - statusRank(serviceStatus(b)) || (a.displayName || a.slug).localeCompare(b.displayName || b.slug));
}
