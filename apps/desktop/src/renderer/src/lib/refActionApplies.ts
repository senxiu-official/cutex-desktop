// Which `ref.action` items apply to a ref kind (docs/desktop-modules.md §19.8): shared by the menu rows
// (lib/refActions) and the hover bar's icon buttons (components/RefActions). Pure; no feature names.
import type { AppSlotEntry } from "../modules/slots";

/** Ref kinds an item without `kinds` does not reach: a `selection` is transient text (lib/selectionMenu), so only
 * items that list it act on it (a bookmark or pin of a selection would keep nothing that opens again). */
const EXPLICIT_ONLY: readonly string[] = ["selection"];

/** A shown `ref.action` item for this ref kind: listed in `kinds` (omitted = all but the explicit-only kinds) and not in
 * `excludeKinds`. */
export function refActionApplies(e: AppSlotEntry<"ref.action">, kind: string): boolean {
  const listed = e.item.kinds ? e.item.kinds.includes(kind) : !EXPLICIT_ONLY.includes(kind);
  return e.mode === "show" && listed && !e.item.excludeKinds?.includes(kind);
}
