// Which `ref.action` items apply to a ref kind (docs/desktop-modules.md §19.8): shared by the menu rows
// (lib/refActions) and the hover bar's icon buttons (components/RefActions). Pure; no feature names.
import type { AppSlotEntry } from "../modules/slots";

/** A shown `ref.action` item for this ref kind: listed in `kinds` (omitted = all) and not in `excludeKinds`. */
export function refActionApplies(e: AppSlotEntry<"ref.action">, kind: string): boolean {
  return e.mode === "show" && (!e.item.kinds || e.item.kinds.includes(kind)) && !e.item.excludeKinds?.includes(kind);
}
