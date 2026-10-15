// Settings → 状态显示 → 放在哪里: one radio table — rows are the `conversation.status` items of the
// modules that are on and available on this host (slot order), columns the places (输入栏 / 胶囊 /
// 两者 / 不显示). Each row is its own radiogroup (arrow keys move within the row, skipping places
// that cannot be picked now). Values are module-host placement overrides (per device).
// v1.2 (docs/desktop-modules.md §16): a row shows the saved choice (requested) even when its surface
// is off; a place whose surface provider is off / unavailable (or the item does not support) cannot
// be picked as a new choice, and the row says why its saved choice does not show.
import { useRef } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { radioKeyTarget } from "../../lib/formA11y";
import type { PlacedStatus } from "../../lib/statusItems";
import { setStatusPlace, useStatusItems, useSurfaceProviders } from "../../lib/statusItemsView";
import { placeSelectable, type SurfaceProviders } from "../../lib/statusSurfaces";
import { services } from "../../modules/app";
import { STATUS_PLACES, STATUS_SURFACES, type StatusPlace } from "../../modules/slots";
import { Button, Notice } from "./Form";

const GRID = "grid grid-cols-[minmax(6rem,1fr)_repeat(4,minmax(3.5rem,4.5rem))_1.5rem] items-center gap-x-3";

function PlaceRow({ placed, providers }: { placed: PlacedStatus; providers: SurfaceProviders }) {
  const { t } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const { item, place: value, supported, resolved } = placed;
  const set = (place: StatusPlace) => setStatusPlace(item, place);
  const labelId = `status-place-${item.id}`;
  const noteId = `status-place-note-${item.id}`;
  const selectable = STATUS_PLACES.map((p) => placeSelectable(p, supported, providers));
  const surfaceName = (s: string) => t(`shell.statusPlace.${s}` as MessageKey);
  const note = resolved.unavailable.map((u) => t(`shell.statusPlace.unavailable.${u.reason}` as MessageKey, { surface: surfaceName(u.surface) })).join(" · ");
  // Arrow keys: the next pickable place in that direction (the saved one counts, so focus never strands).
  const step = (from: number, key: string): number | null => {
    let at = from;
    for (let n = 0; n < STATUS_PLACES.length; n++) {
      const next = radioKeyTarget(key, at, STATUS_PLACES.length);
      if (next === null) return null;
      if (selectable[next] || STATUS_PLACES[next] === value) return next;
      at = next;
    }
    return null;
  };
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={note ? noteId : undefined} className={GRID}>
        <span id={labelId} className="truncate text-sm">
          {t(item.titleKey)}
        </span>
        {STATUS_PLACES.map((place, i) => {
          const on = value === place;
          const disabled = !selectable[i];
          const offSurface = disabled ? STATUS_SURFACES.find((s) => !providers[s].available && (place === s || place === "both")) : undefined;
          return (
            <span key={place} className="flex justify-center">
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="radio"
                aria-checked={on}
                aria-disabled={disabled || undefined}
                aria-label={t(`shell.statusPlace.${place}` as MessageKey)}
                title={offSurface ? t("shell.statusPlace.optionOff", { surface: surfaceName(offSurface) }) : undefined}
                tabIndex={on ? 0 : -1}
                onClick={() => !disabled && set(place)}
                onKeyDown={(e) => {
                  const next = step(i, e.key);
                  if (next === null) return;
                  e.preventDefault();
                  refs.current[next]?.focus();
                  if (selectable[next]) set(STATUS_PLACES[next]!);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${on ? "border-accent" : "border-subtle/60"}`}>{on && <span className="h-2 w-2 rounded-full bg-accent" />}</span>
              </button>
            </span>
          );
        })}
        <span />
      </div>
      {note && (
        <p id={noteId} className="mt-0.5 text-xs text-subtle">
          {note}
        </p>
      )}
    </div>
  );
}

export function StatusPlaceTable() {
  const { t } = useI18n();
  const items = useStatusItems(null);
  const providers = useSurfaceProviders();
  // A surface whose module the owner turned off (the capsule): say so once, with the way back.
  const off = STATUS_SURFACES.filter((s) => {
    const p = providers[s];
    return !p.available && p.reason === "disabled";
  });
  return (
    <>
      {off.map((s) => (
        <Notice key={s} tone="info">
          <span className="flex flex-wrap items-center gap-2">
            {t("shell.statusPlace.surfaceOff", { surface: t(`shell.statusPlace.${s}` as MessageKey) })}
            <Button onClick={() => services.ui.openSettings("modules")}>{t("modules.openModules")}</Button>
          </span>
        </Notice>
      ))}
      <div className="overflow-x-auto">
        <div className={`${GRID} border-b border-border py-2 text-xs text-subtle`} aria-hidden>
          <span />
          {STATUS_PLACES.map((place) => (
            <span key={place} className="text-center">
              {t(`shell.statusPlace.${place}` as MessageKey)}
            </span>
          ))}
          <span />
        </div>
        {items.map((p) => (
          <PlaceRow key={p.item.id} placed={p} providers={providers} />
        ))}
      </div>
    </>
  );
}
