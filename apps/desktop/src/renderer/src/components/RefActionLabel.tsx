// A `ref.action` row's label in a menu (docs/desktop-modules.md §19.8): the item's live state for this
// ref (useState: 已加书签 / another title / why it is unavailable). Menus are built outside React, so the
// hook runs here, inside the open menu.
import { useI18n } from "../i18n";
import type { AppSlotEntry, CutexRef } from "../modules/slots";

export function RefActionLabel({ entry, cref }: { entry: AppSlotEntry<"ref.action">; cref: CutexRef }) {
  const { t } = useI18n();
  const state = entry.item.useState?.(cref) ?? null;
  return (
    <span className={state?.disabledReason ? "opacity-50" : undefined} title={state?.disabledReason}>
      {t(state?.titleKey ?? entry.item.titleKey)}
      {state?.active && <span className="ml-1.5 text-accent">✓</span>}
    </span>
  );
}
