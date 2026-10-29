// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "world-clock.title": "World clock",
  "world-clock.description": "The time in a few cities on the desktop, bare like the desktop clock (Canberra and Chongqing by default); hover shows how far each is from here",
  "world-clock.widget": "World clock",
  "world-clock.widgetHint": "The current time in a few cities, and how far they are from yours",
  "world-clock.cities": "Cities",
  "world-clock.citiesHint": "Name them as you like; the time zone sets the time",
  "world-clock.city": "Name",
  "world-clock.zone": "Time zone",
  "world-clock.addCity": "Add a city",
  "world-clock.hour12": "12-hour clock",
  "world-clock.showDiff": "Also write the difference from here below (hover shows it anyway)",
  "world-clock.icon": "Icon",
  "world-clock.iconNone": "None",
  "world-clock.iconPin": "Pin",
  "world-clock.iconHome": "Home",
  "world-clock.showDate": "Show the date and weekday",
  "world-clock.today": "Today",
  "world-clock.tomorrow": "Tomorrow",
  "world-clock.yesterday": "Yesterday",
  "world-clock.same": "Same as here",
  "world-clock.ahead": "{h} h ahead",
  "world-clock.behind": "{h} h behind",
  "world-clock.cityA": "Canberra",
  "world-clock.cityB": "Chongqing",
};
