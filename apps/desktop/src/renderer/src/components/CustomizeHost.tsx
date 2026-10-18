// The 在主界面调整 panel host (docs/research/rfc-in-place-settings-20261018.md; lead decisions
// 2026-10-18): one non-modal panel at a time with a region's local settings (`customize.region`),
// placed against that region in the main row (lib/customize placeCustomizePanel): beside it at the top,
// at any window width (no drawer, owner 2026-10-18). Not draggable, no remembered position.
// Closes with ×, Esc or the entry again (services.ui.customize); clicking
// elsewhere in the main window leaves it open, so one can try things while it is there.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { placeCustomizePanel, takeCustomizeOpener, type CustomizePlacement, type CustomizeRegion, type Rect } from "../lib/customize";
import { requestSettingsReveal } from "../lib/settingsSearchView";
import { useUiPrefs } from "../lib/prefs";
import { services } from "../modules/app";
import { ItemBoundary } from "../modules/Outlet";
import { useSlot } from "../modules/react";
import { useApp } from "../store";
import { CompactSettings, TextLink } from "./settings/Form";

/** The element of a region (`data-customize-region` on it; the sidebar's `<aside>`). */
export function regionElement(region: CustomizeRegion): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-customize-region="${region}"]`);
}

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/** The first card of the panel still in view (全部设置 → opens the settings page there). */
function visibleAnchor(body: HTMLElement | null): string | undefined {
  if (!body) return undefined;
  const top = body.getBoundingClientRect().top;
  const cards = [...body.querySelectorAll<HTMLElement>("[data-settings-anchor]")];
  const card = cards.find((el) => el.getBoundingClientRect().bottom > top + 24) ?? cards[0];
  return card?.dataset.settingsAnchor?.replace(/^settings-/, "");
}

/** Mounted in the main row (App), which is its positioning box. */
export function CustomizeHost() {
  const { t } = useI18n();
  const customize = useApp((s) => s.customize);
  const close = useApp((s) => s.closeCustomize);
  const entry = useSlot("customize.region").find((e) => e.mode === "show" && e.item.region === customize?.region);
  const region = entry ? entry.item.region : null;
  const side = entry?.item.side ?? "right";
  const width = entry?.item.width;
  const reveal = entry?.item.reveal;
  const { sidebarOpen } = useUiPrefs();
  const box = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CustomizePlacement | null>(null);
  const titleId = useId();

  // Placement follows the row, the region (sidebar dragged wider) and the timeline frame (the composer grows).
  useLayoutEffect(() => {
    if (!region) return setPlace(null);
    const measure = () => {
      const row = rectOf(box.current);
      if (!row) return;
      const stage = rectOf(document.querySelector("[data-timeline-frame]"));
      const composer = rectOf(document.querySelector("[data-composer-block]"));
      const el = regionElement(region);
      // The faint outline (styles.css); set again on each measure, the region element may have re-mounted.
      if (el && !el.hasAttribute("data-customizing")) el.setAttribute("data-customizing", "");
      setPlace(placeCustomizePanel({ side, width, row, region: rectOf(el), stage, composer }));
    };
    reveal?.();
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [box.current, regionElement(region), document.querySelector("[data-timeline-frame]")]) if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      for (const el of document.querySelectorAll("[data-customizing]")) el.removeAttribute("data-customizing");
    };
  }, [region, sidebarOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- side / width / reveal belong to the region's item

  // Focus: into the panel when it opens; back to the entry (or the region) when it closes.
  const shown = !!region && !!place;
  useEffect(() => {
    if (shown) panel.current?.focus();
  }, [shown]);
  useEffect(() => {
    if (!region) return;
    return () => {
      const el = regionElement(region);
      const back = takeCustomizeOpener() ?? (el?.hasAttribute("tabindex") ? el : el?.querySelector<HTMLElement>("textarea, input, button"));
      if (useApp.getState().view.kind === "conversation") back?.focus({ preventScroll: true });
    };
  }, [region]);

  const Panel = entry?.item.Panel;
  return (
    <div ref={box} aria-hidden={entry ? undefined : true} className="pointer-events-none absolute inset-0 z-30">
      {entry && Panel && place && (
        <div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-customize-panel=""
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
          style={place}
          className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 pr-1.5 pl-3">
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {t(entry.item.titleKey)}
            </h2>
            <button
              type="button"
              title={t("common.close")}
              aria-label={t("common.close")}
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
          <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
            <ItemBoundary moduleId={entry.moduleId} resetKey={entry.item.region}>
              <CompactSettings>
                <Panel />
              </CompactSettings>
            </ItemBoundary>
          </div>
          <div className="flex h-9 shrink-0 items-center justify-end border-t border-border/60 px-3">
            <TextLink
              onClick={() => {
                const anchor = visibleAnchor(body.current);
                services.ui.openSettings(entry.item.settingsPage);
                if (anchor) requestSettingsReveal(anchor);
              }}
            >
              {t("customize.allSettings")}
            </TextLink>
          </div>
        </div>
      )}
    </div>
  );
}
