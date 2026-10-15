// `ref.action` items as menu rows (docs/desktop-modules.md §19.8): the same list backs the hover bars'
// 「⋯ 更多」 and the right-click menus of turns, agents, side tabs / pages and module pages. Built lazily
// like every menu (current state when opened); an item's live state (useState) shows in its label row.
// Shell file: no feature names.
import { createElement } from "react";
import { translate } from "../i18n";
import { appModules } from "../modules/app";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, CutexRef } from "../modules/slots";
import { RefActionLabel } from "../components/RefActionLabel";
import type { MenuEntry } from "./contextMenu";
import { useApp } from "../store";
import { entryGateNow } from "./hostGatingView";

type ActionEntry = AppSlotEntry<"ref.action">;

const ICON = 14;

const applies = (e: ActionEntry, kind: string) => e.mode === "show" && (!e.item.kinds || e.item.kinds.includes(kind));

/** The `ref.action` items for a ref kind now (shown items, by order); none before the module host starts. */
export function refActionsFor(kind: string): ActionEntry[] {
  let entries: readonly ActionEntry[];
  try {
    entries = appModules().snapshot("ref.action");
  } catch {
    return [];
  }
  return entries.filter((e) => applies(e, kind));
}

/** Hook form: whether any action applies to this kind (the hover bar's 「⋯」 only shows then). */
export function useHasRefActions(kind: string): boolean {
  return useSlot("ref.action").some((e) => applies(e, kind));
}

/** Menu rows for `ref` (empty when nothing applies); `separator` first when `lead` is set and there are rows.
 * Actions whose module / item capabilities `ref`'s host lacks are left out (they would call that host). */
export function refActionEntries(ref: CutexRef | null, lead = false): MenuEntry[] {
  if (!ref) return [];
  const actions = refActionsFor(ref.kind).filter((e) => entryGateNow(ref.hostId, e).ok);
  if (!actions.length) return [];
  const rows: MenuEntry[] = actions.map((e) => {
    const Icon = e.item.icon;
    return {
      label: translate(e.item.titleKey),
      icon: createElement(Icon, { size: ICON }),
      labelNode: e.item.useState ? createElement(RefActionLabel, { entry: e, cref: ref }) : undefined,
      onSelect: async () => {
        try {
          await e.item.run(ref);
        } catch (err) {
          useApp.getState().notify(err instanceof Error ? err.message : String(err), "error");
        }
      },
    };
  });
  return lead ? ["separator", ...rows] : rows;
}
