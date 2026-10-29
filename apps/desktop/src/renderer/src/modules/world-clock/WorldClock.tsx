// The world clock widget (design 032; the reference example of docs/widget-authoring-guide.md), bare like the desktop
// clock (owner 2026-10-22: no card): one column per city, side by side — a small label line (name, optional pin /
// home icon), the time in large light digits, a small date + weekday line — over the wallpaper, readable by the
// clock's own text shadow. The 今天 / 明天 · 快 / 慢 N 小时 difference is the tooltip (or a line, option). More cities
// than fit across wrap into rows; one city looks like the normal clock. Time from the shared ticker (`now`).
import { Home, MapPin } from "lucide-react";
import { useI18n } from "../../i18n";
import { localTimeZone } from "../../lib/dateText";
import type { DesktopWidgetProps } from "../widgetTypes";
import { dateIn, dayDiff, hourDiff, timeIn } from "./zones";

export type CityIcon = "none" | "pin" | "home";
export interface City {
  label: string;
  tz: string;
  icon: CityIcon;
}

/** The stored list, malformed rows dropped (the shell already checked the schema). */
export function citiesOf(value: unknown): City[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as City).tz === "string")
    .map((c) => ({ label: typeof c.label === "string" ? c.label : "", tz: c.tz as string, icon: c.icon === "pin" || c.icon === "home" ? c.icon : "none" }));
}

/** Columns across and the digits' size for a box: a column wants ≥ 128 px; the digits follow the room of a cell. */
export function faceLayout(count: number, width: number, height: number): { columns: number; rows: number; big: number } {
  const columns = Math.max(1, Math.min(count, Math.floor(width / 128)));
  const rows = Math.ceil(count / columns);
  const cellW = width / columns;
  const cellH = height / Math.max(1, rows);
  const big = Math.round(Math.max(18, Math.min(64, cellW * 0.3, cellH * 0.5)));
  return { columns, rows, big };
}

export function WorldClockWidget({ settings, now, width, height }: DesktopWidgetProps) {
  const { t, locale } = useI18n();
  const cities = citiesOf(settings.cities);
  const hour12 = settings.hour12 === true;
  const showDiff = settings.showDiff === true;
  const showDate = settings.showDate !== false;
  const here = localTimeZone();
  const { columns, big } = faceLayout(cities.length, width, height);
  const diffText = (tz: string) => {
    const d = dayDiff(tz, here, now);
    const h = hourDiff(tz, here, now);
    const day = d > 0 ? t("world-clock.tomorrow") : d < 0 ? t("world-clock.yesterday") : t("world-clock.today");
    const hours = h === 0 ? t("world-clock.same") : t(h > 0 ? "world-clock.ahead" : "world-clock.behind", { h: Math.abs(h) });
    return `${day} · ${hours}`;
  };
  return (
    <div className="home-clock grid h-full w-full content-center justify-items-center gap-x-3 gap-y-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-world-clock="">
      {cities.map((c, i) => {
        const Icon = c.icon === "pin" ? MapPin : c.icon === "home" ? Home : null;
        return (
          <div key={`${c.tz}-${i}`} className="flex min-w-0 flex-col items-center text-center" title={`${c.label || c.tz} · ${diffText(c.tz)}`} data-world-clock-city={c.tz}>
            <span className="flex max-w-full items-center gap-1 text-ui/[inherit] opacity-90">
              {Icon && <Icon size={12} strokeWidth={2} className="shrink-0" />}
              <span className="truncate">{c.label || c.tz.split("/").pop()!.replace(/_/g, " ")}</span>
            </span>
            <b className="block font-light leading-[1.05] tracking-wide tabular-nums" style={{ fontSize: big }}>
              {timeIn(c.tz, now, locale, hour12)}
            </b>
            {showDate && height / Math.ceil(cities.length / columns) >= 72 && <span className="text-meta/[inherit] opacity-90">{dateIn(c.tz, now, locale)}</span>}
            {showDiff && <span className="text-caption/[inherit] opacity-80">{diffText(c.tz)}</span>}
          </div>
        );
      })}
    </div>
  );
}
