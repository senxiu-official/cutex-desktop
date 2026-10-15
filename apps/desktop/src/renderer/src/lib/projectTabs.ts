// Tabs of the 项目 page (docs/desktop-modules.md §21): the core tabs plus the `project.tab` items of
// active modules whose capabilities the project's host has (the module may be active for another
// host of the scope). Pure merge; store / module bindings: lib/projectTabsView.ts. No module names.
import type { AppSlotEntry } from "../modules/slots";
import type { MessageKey } from "../i18n";
import type { ProjectTab } from "../store";

export type ProjectTabEntry = AppSlotEntry<"project.tab">;

/** The core tabs and their slot order (module items sort in between by `order`). */
export const CORE_PROJECT_TABS: readonly { tab: ProjectTab; order: number }[] = [
  { tab: "overview", order: 100 },
  { tab: "agents", order: 200 },
  { tab: "tasks", order: 300 },
  { tab: "memory", order: 400 },
  { tab: "settings", order: 500 },
];

/** One tab of the bar: a core tab (`entry` null) or a module's item. */
export interface ProjectTabSlot {
  tab: string;
  titleKey: MessageKey;
  entry: ProjectTabEntry | null;
}

/**
 * Core tabs + the given module entries (already filtered for the host), by order; a core tab wins a
 * tie, then the item id. An item reusing a core tab name or an earlier item's name is dropped.
 */
export function mergeProjectTabs(entries: readonly ProjectTabEntry[]): ProjectTabSlot[] {
  const core = CORE_PROJECT_TABS.map((c) => ({ order: c.order, rank: 0, id: "", slot: { tab: c.tab as string, titleKey: `projects.tab.${c.tab}` as MessageKey, entry: null } }));
  const seen = new Set<string>(core.map((c) => c.slot.tab));
  const extra = [...entries]
    .sort((a, b) => a.item.order - b.item.order || a.item.id.localeCompare(b.item.id))
    .filter((e) => (seen.has(e.item.tab) ? false : (seen.add(e.item.tab), true)))
    .map((e) => ({ order: e.item.order, rank: 1, id: e.item.id, slot: { tab: e.item.tab, titleKey: e.item.titleKey, entry: e } }));
  return [...core, ...extra].sort((a, b) => a.order - b.order || a.rank - b.rank || a.id.localeCompare(b.id)).map((x) => x.slot);
}
