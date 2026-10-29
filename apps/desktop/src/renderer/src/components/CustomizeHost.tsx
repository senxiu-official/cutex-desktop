// 在主界面调整 (docs/research/rfc-in-place-settings-20261018.md; owner 2026-10-21): the live edit of a region
// of the real UI. The Settings Shelf (components/SettingsShelf) stays open beside it on the region's page —
// that is where the settings change — and the region itself is in edit state: a faint outline
// (`data-customizing`, styles.css) and a small 完成 bar placed against it (lib/customize
// placeCustomizePanel: right of the sidebar at the top, left of the right side, above the composer). It
// replaces the old separate panel with the same cards. Finishing (完成, Esc — lib/escChain row 5a — the
// entry again, the page header's 完成调整) returns to how Settings was (closed again when the edit opened
// it, maximised again). Clicking elsewhere in the main window keeps the edit on, so one can try things.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import { placeCustomizePanel, takeCustomizeOpener, type CustomizePlacement, type CustomizeRegion, type Rect } from "../lib/customize";
import { useUiPrefs } from "../lib/prefs";
import { useSlot } from "../modules/react";
import { useApp } from "../store";
import { useOwnerWindow } from "../lib/ownerContext";
import { queryAppWindows } from "../lib/appWindowSet";

/** The 完成 bar's width (px; narrower where the room is). */
const BAR_W = 300;

/** The element of a region (`data-customize-region` on it; the sidebar's `<aside>`). */
export function regionElement(region: CustomizeRegion): HTMLElement | null {
  return queryAppWindows<HTMLElement>(`[data-customize-region="${region}"]`);
}

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/** Mounted in the main row (PaneHost), which is its positioning box. */
export function CustomizeHost() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const customize = useApp((s) => s.customize);
  const finish = useApp((s) => s.closeCustomize);
  const entry = useSlot("customize.region").find((e) => e.mode === "show" && e.item.region === customize?.region);
  const region = entry ? entry.item.region : null;
  const side = entry?.item.side ?? "right";
  const reveal = entry?.item.reveal;
  const { sidebarOpen } = useUiPrefs();
  const box = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<CustomizePlacement | null>(null);

  // Placement follows the row, the region (sidebar dragged wider) and the timeline frame (the composer grows).
  useLayoutEffect(() => {
    if (!region) return setPlace(null);
    const measure = () => {
      const row = rectOf(box.current);
      if (!row) return;
      const stage = rectOf(win.document.querySelector("[data-timeline-frame]"));
      const composer = rectOf(win.document.querySelector("[data-composer-block]"));
      const el = regionElement(region);
      // The faint outline (styles.css); set again on each measure, the region element may have re-mounted.
      if (el && !el.hasAttribute("data-customizing")) el.setAttribute("data-customizing", "");
      setPlace(placeCustomizePanel({ side, width: BAR_W, row, region: rectOf(el), stage, composer }));
    };
    reveal?.();
    measure();
    const ro = new win.ResizeObserver(measure);
    for (const el of [box.current, regionElement(region), win.document.querySelector("[data-timeline-frame]")]) if (el) ro.observe(el);
    win.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      win.removeEventListener("resize", measure);
      for (const el of win.document.querySelectorAll("[data-customizing]")) el.removeAttribute("data-customizing");
    };
  }, [region, sidebarOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- side / reveal belong to the region's item

  // Finishing: the focus goes back to the entry that started the edit (a sidebar row, the settings button).
  useEffect(() => {
    if (!region) return;
    return () => {
      const back = takeCustomizeOpener();
      if (back) back.focus({ preventScroll: true });
    };
  }, [region]);

  return (
    <div ref={box} aria-hidden={entry ? undefined : true} className="pointer-events-none absolute inset-0 z-30">
      {entry && place && (
        <div
          role="status"
          data-customize-bar={entry.item.region}
          // Above the composer the bar sits on its bottom edge; elsewhere at the top, its own height.
          style={{ left: place.left, width: place.width, ...(place.bottom !== undefined ? { bottom: place.bottom } : { top: place.top }) }}
          className="pointer-events-auto absolute flex items-center gap-2 rounded-xl border border-accent/40 bg-background py-1.5 pr-1.5 pl-3 shadow-e2"
        >
          <SlidersHorizontal size={14} aria-hidden className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui/[inherit] font-semibold">{t(entry.item.titleKey)}</span>
            <span className="block truncate text-caption/[inherit] text-muted">{t("customize.editing.hint")}</span>
          </span>
          <button
            type="button"
            data-customize-done=""
            title={t("customize.doneTip")}
            onClick={finish}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-white outline-none hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Check size={13} aria-hidden />
            {t("customize.done")}
          </button>
        </div>
      )}
    </div>
  );
}
