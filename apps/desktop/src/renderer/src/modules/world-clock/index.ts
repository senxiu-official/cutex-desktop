// 世界时钟 — bare, like the desktop clock (owner 2026-10-22); (design 032 §8, the reference widget of docs/widget-authoring-guide.md): a desktop widget kind with a
// settings form (cities: name + time zone; 12-hour; the difference from here), several instances allowed. The
// owner asked for Canberra + Chongqing: the defaults (Canberra keeps Australia/Sydney time; Chongqing China
// Standard Time, Asia/Shanghai — the canonical IANA zones of both cities).
import { Globe2 } from "lucide-react";
import { translate } from "../../i18n";
import { defineModule } from "../slots";
import type { WidgetSettings } from "../widgetTypes";
import { WorldClockWidget } from "./WorldClock";

export const WORLD_CLOCK = "world-clock.clock";

/** A new instance's settings: the two cities in the UI language. */
export function worldClockDefaults(_locale: string): WidgetSettings {
  return {
    cities: [
      { label: translate("world-clock.cityA"), tz: "Australia/Sydney", icon: "none" },
      { label: translate("world-clock.cityB"), tz: "Asia/Shanghai", icon: "none" },
    ],
    hour12: false,
    showDate: true,
    showDiff: false,
  };
}

export default defineModule({
  id: "world-clock",
  titleKey: "world-clock.title",
  descriptionKey: "world-clock.description",
  contributes: {
    "desktop.widget": [
      {
        id: WORLD_CLOCK,
        titleKey: "world-clock.widget",
        descriptionKey: "world-clock.widgetHint",
        icon: Globe2,
        // Units (1.24, 40 px): 6 × 2 by default, beside the desktop clock in the header (owner 2026-10-24: 左右平铺);
        // the step sizes are what a 1.22 desktop reads.
        size: { min: [16, 8], max: [96, 60], default: [36, 12], units: { min: [3, 2], max: [16, 10], default: [6, 2] } },
        shape: "bare",
        multiple: true,
        defaultPlace: { area: "header-right", order: 1 },
        refresh: "minute",
        settings: [
          {
            key: "cities",
            type: "list",
            labelKey: "world-clock.cities",
            hintKey: "world-clock.citiesHint",
            min: 1,
            max: 6,
            addLabelKey: "world-clock.addCity",
            itemDefaults: { label: "", tz: "UTC", icon: "none" },
            fields: [
              { key: "label", type: "text", labelKey: "world-clock.city", maxLength: 24 },
              { key: "tz", type: "timezone", labelKey: "world-clock.zone" },
              {
                key: "icon",
                type: "select",
                labelKey: "world-clock.icon",
                options: [
                  { value: "none", labelKey: "world-clock.iconNone" },
                  { value: "pin", labelKey: "world-clock.iconPin" },
                  { value: "home", labelKey: "world-clock.iconHome" },
                ],
              },
            ],
          },
          { key: "hour12", type: "toggle", labelKey: "world-clock.hour12" },
          { key: "showDate", type: "toggle", labelKey: "world-clock.showDate" },
          { key: "showDiff", type: "toggle", labelKey: "world-clock.showDiff" },
        ],
        defaults: worldClockDefaults,
        Widget: WorldClockWidget,
      },
    ],
  },
});
