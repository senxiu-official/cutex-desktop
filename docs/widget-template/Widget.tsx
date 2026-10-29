// Template (docs/widget-authoring-guide.md §2 Step 4): copy to modules/<id>/Widget.tsx.
// Fill the box (h-full), adapt to width / height, no timers (use `now` with refresh), no side effects (use `actions`),
// do nothing on click while `arranging`. The shell draws the card; you draw padding and content. For shape "bare" use
// `home-clock` on the root instead (no card: text on the wallpaper; guide rule 5). Dates: lib/dateText `formatDate`.
import { useI18n } from "../../i18n";
import type { DesktopWidgetProps } from "../widgetTypes";

export function MyWidget({ settings, height, arranging, actions }: DesktopWidgetProps) {
  const { t } = useI18n();
  const label = typeof settings.label === "string" && settings.label ? settings.label : t("my-widget.widget");
  const compact = settings.compact === true || height < 120;
  // Read every setting defensively: a field without a default may be absent.
  const rows = typeof settings.rows === "number" ? settings.rows : 5;
  return (
    <div className="flex h-full flex-col px-3.5 py-3" data-my-widget="">
      <b className="truncate text-[13px] font-semibold">{label}</b>
      {!compact && <p className="mt-1 text-xs home-sub">{t("my-widget.empty")}</p>}
      {/* Clickable things are <button type="button">: focusable and Enter / Space for free. */}
      <button type="button" className="mt-auto self-start text-xs text-accent" onClick={() => !arranging && actions.openPage("delegations.page")}>
        {t("my-widget.count", { n: rows })} →
      </button>
    </div>
  );
}
