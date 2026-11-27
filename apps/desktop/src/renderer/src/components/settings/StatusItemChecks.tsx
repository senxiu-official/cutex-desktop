// Which status items show in a place, one checkbox each (owner 2026-11-28): the status row on 会话 → 输入 (「输入框上方」),
// the capsule on its module's own settings page. The items are the `conversation.status` items of the modules that
// are on (useStatusItems); a saved place keeps the other side (lib/statusItems rowPlace / capsuleToggle).
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { rowPlace, shownOn, type PlacedStatus } from "../../lib/statusItems";
import { setStatusPlace, useStatusItems, useSurfaceProviders } from "../../lib/statusItemsView";
import { capsuleOff } from "../../lib/statusSurfaces";
import type { StatusPlace, StatusSurfaceId } from "../../modules/slots";
import { Checkbox, RowGroup, SettingsGroup } from "./Form";

export function StatusItemChecks({ title, hint, surface, checked, next, kind }: {
  title: ReactNode;
  hint?: ReactNode;
  /** The place the checkboxes are about: an item that cannot show there is greyed. */
  surface: StatusSurfaceId;
  checked(p: PlacedStatus): boolean;
  /** The saved place after the owner (un)ticks the item. */
  next(p: PlacedStatus, on: boolean): StatusPlace;
  kind: "row" | "capsule";
}) {
  const { t } = useI18n();
  const items = useStatusItems(null);
  return (
    <SettingsGroup agents="none" source="local">
      <RowGroup title={title} hint={hint}>
        <div data-status-checks={kind} className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-1 py-2">
          {items.map((p) => {
            const label = t(p.item.titleKey);
            const on = checked(p);
            const disabled = !p.supported.includes(surface);
            return (
              <label key={p.item.id} data-status-check={p.item.id} className={`flex min-w-0 items-center gap-2 text-sm ${disabled ? "text-subtle" : "cursor-pointer"}`}>
                <Checkbox checked={on} disabled={disabled} label={label} onChange={(v) => setStatusPlace(p.item, next(p, v))} />
                <span className="truncate">{label}</span>
              </label>
            );
          })}
        </div>
      </RowGroup>
    </SettingsGroup>
  );
}

/** 会话 → 输入 → 输入框上方: which items show in the status row (all on by default). */
export function StatusRowChecks() {
  const { t } = useI18n();
  const off = capsuleOff(useSurfaceProviders());
  return <StatusItemChecks kind="row" surface="bar" title={t("shell.statusRow.items")} hint={t("shell.statusRow.itemsHint")} checked={(p) => shownOn(p, "bar")} next={(p, on) => rowPlace(p.place, on, off)} />;
}
